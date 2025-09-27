const pool = require('../../db');

const getJournals = async (req, res) => {
    const { page = 1, limit = 10, search, startDate, endDate } = req.query;
    
    try {
        let baseQuery = `FROM general_journal gj`;
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (search) {
            conditions.push(`(gj.description ILIKE $${paramIndex} OR gj.reference_number ILIKE $${paramIndex})`);
            values.push(`%${search}%`);
            paramIndex++;
        }
        if (startDate) {
            conditions.push(`gj.entry_date >= $${paramIndex++}`);
            values.push(startDate);
        }
        if (endDate) {
            conditions.push(`gj.entry_date <= $${paramIndex++}`);
            values.push(endDate);
        }

        const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
        
        const countQuery = `SELECT COUNT(gj.id) ${baseQuery}${whereClause}`;

        const dataQuery = `
            SELECT 
                gj.id, 
                gj.entry_date, 
                gj.reference_number, 
                gj.description,
                (SELECT SUM(debit) FROM journal_entries WHERE journal_id = gj.id) as total_debit,
                (SELECT SUM(credit) FROM journal_entries WHERE journal_id = gj.id) as total_credit
            ${baseQuery}${whereClause}
            ORDER BY gj.entry_date DESC, gj.id DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        const countResult = await pool.query(countQuery, values);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit) || 1;
        const offset = (page - 1) * limit;

        const dataResult = await pool.query(dataQuery, [...values, limit, offset]);

        res.json({
            data: dataResult.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            }
        });

    } catch (err) {
        console.error('Error fetching journals:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data jurnal.' });
    }
};

const createJournal = async (req, res) => {
    const { entry_date, reference_number, description, entries } = req.body;

    if (!entry_date || !description || !Array.isArray(entries) || entries.length < 2) {
        return res.status(400).json({ error: 'Data tidak lengkap. Tanggal, deskripsi, dan minimal 2 entri jurnal diperlukan.' });
    }

    const totalDebit = entries.reduce((sum, entry) => sum + (parseFloat(entry.debit) || 0), 0);
    const totalCredit = entries.reduce((sum, entry) => sum + (parseFloat(entry.credit) || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit === 0) {
        return res.status(400).json({ error: 'Total debit dan kredit harus seimbang dan tidak boleh nol.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const journalHeaderResult = await client.query(`INSERT INTO general_journal (entry_date, reference_number, description) VALUES ($1, $2, $3) RETURNING id;`, [entry_date, reference_number, description]);
        const journalId = journalHeaderResult.rows[0].id;

        // Build a single query for bulk inserting journal entries to prevent multiple round-trips.
        const entryValues = [];
        const entryQueryParts = [];
        let paramIndex = 1;

        for (const entry of entries) {
            // Each group of placeholders corresponds to one row: (journal_id, account_id, debit, credit)
            entryQueryParts.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
            entryValues.push(journalId, entry.account_id, parseFloat(entry.debit) || 0, parseFloat(entry.credit) || 0);
        }

        const entryQuery = `INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ${entryQueryParts.join(', ')}`;
        await client.query(entryQuery, entryValues);
        
        await client.query('COMMIT');
        res.status(201).json({ message: 'Jurnal berhasil dibuat.', id: journalId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating journal:', err.message);
        res.status(500).json({ error: 'Gagal membuat jurnal baru.' });
    } finally {
        client.release();
    }
};

const getJournalById = async (req, res) => {
    const { id } = req.params;

    try {
        const headerQuery = `
            SELECT 
                gj.id, gj.entry_date, gj.reference_number, gj.description,
                (SELECT SUM(debit) FROM journal_entries WHERE journal_id = gj.id) as total_debit,
                (SELECT SUM(credit) FROM journal_entries WHERE journal_id = gj.id) as total_credit
            FROM general_journal gj
            WHERE gj.id = $1
        `;
        const headerResult = await pool.query(headerQuery, [id]);

        if (headerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Jurnal tidak ditemukan.' });
        }

        const entriesQuery = `
            SELECT je.account_id, je.debit, je.credit, coa.account_number, coa.account_name
            FROM journal_entries je
            JOIN chart_of_accounts coa ON je.account_id = coa.id
            WHERE je.journal_id = $1
            ORDER BY je.id ASC
        `;
        const entriesResult = await pool.query(entriesQuery, [id]);

        res.json({ header: headerResult.rows[0], entries: entriesResult.rows });
    } catch (err) {
        console.error('Error fetching journal details:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail jurnal.' });
    }
};

const updateJournal = async (req, res) => {
    const { id } = req.params;
    const { entry_date, reference_number, description, entries } = req.body;

    if (!entry_date || !description || !Array.isArray(entries) || entries.length < 2) {
        return res.status(400).json({ error: 'Data tidak lengkap.' });
    }

    const totalDebit = entries.reduce((sum, entry) => sum + (parseFloat(entry.debit) || 0), 0);
    const totalCredit = entries.reduce((sum, entry) => sum + (parseFloat(entry.credit) || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit === 0) {
        return res.status(400).json({ error: 'Total debit dan kredit harus seimbang dan tidak boleh nol.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Update header
        await client.query('UPDATE general_journal SET entry_date = $1, reference_number = $2, description = $3 WHERE id = $4', [entry_date, reference_number, description, id]);

        // Delete old entries
        await client.query('DELETE FROM journal_entries WHERE journal_id = $1', [id]);

        // Insert new entries
        const entryValues = [];
        const entryQueryParts = [];
        let paramIndex = 1;
        for (const entry of entries) {
            entryQueryParts.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
            entryValues.push(id, entry.account_id, parseFloat(entry.debit) || 0, parseFloat(entry.credit) || 0);
        }
        const entryQuery = `INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ${entryQueryParts.join(', ')}`;
        await client.query(entryQuery, entryValues);

        await client.query('COMMIT');
        res.json({ message: 'Jurnal berhasil diperbarui.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating journal:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui jurnal.' });
    } finally {
        client.release();
    }
};

const deleteJournal = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM general_journal WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting journal:', err.message);
        res.status(500).json({ error: 'Gagal menghapus jurnal.' });
    }
};

module.exports = { getJournals, createJournal, getJournalById, updateJournal, deleteJournal };