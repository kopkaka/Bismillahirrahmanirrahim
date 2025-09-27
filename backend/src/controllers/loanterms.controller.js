const pool = require('../../db');

// GET semua tenor pinjaman
const getLoanTerms = async (req, res) => {
    try {
        const query = `
            SELECT 
                lt.id, lt.loan_type_id, lt.tenor_months, lt.interest_rate,
                l_types.name as loan_type_name
            FROM loan_terms lt
            JOIN loan_types l_types ON lt.loan_type_id = l_types.id
            ORDER BY l_types.name, lt.tenor_months
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching loan terms:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data tenor pinjaman.' });
    }
};

// POST tenor pinjaman baru
const createLoanTerm = async (req, res) => {
    const { loan_type_id, tenor_months, interest_rate } = req.body;
    // Validation with specific error messages to help debugging
    if (loan_type_id == null || loan_type_id === '') {
        return res.status(400).json({ error: 'Tipe Pinjaman wajib diisi.' });
    }
    if (tenor_months == null || tenor_months === '') {
        return res.status(400).json({ error: 'Tenor (bulan) wajib diisi.' });
    }
    if (interest_rate == null || interest_rate === '') {
        return res.status(400).json({ error: 'Suku Bunga wajib diisi.' });
    }
    try {
        const newLoanTerm = await pool.query(
            'INSERT INTO loan_terms (loan_type_id, tenor_months, interest_rate) VALUES ($1, $2, $3) RETURNING *',
            [loan_type_id, tenor_months, interest_rate]
        );
        res.status(201).json(newLoanTerm.rows[0]);
    } catch (err) {
        console.error('Error creating loan term:', err.message);
        if (err.code === '23505') { // unique_violation
            return res.status(400).json({ error: 'Kombinasi Tipe Pinjaman dan Tenor tersebut sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat tenor pinjaman baru.' });
    }
};

// PUT (update) tenor pinjaman
const updateLoanTerm = async (req, res) => {
    const { id } = req.params;
    const { loan_type_id, tenor_months, interest_rate } = req.body;
    // Validation with specific error messages to help debugging
    if (loan_type_id == null || loan_type_id === '') {
        return res.status(400).json({ error: 'Tipe Pinjaman wajib diisi.' });
    }
    if (tenor_months == null || tenor_months === '') {
        return res.status(400).json({ error: 'Tenor (bulan) wajib diisi.' });
    }
    if (interest_rate == null || interest_rate === '') {
        return res.status(400).json({ error: 'Suku Bunga wajib diisi.' });
    }
    try {
        const updatedLoanTerm = await pool.query(
            'UPDATE loan_terms SET loan_type_id = $1, tenor_months = $2, interest_rate = $3 WHERE id = $4 RETURNING *',
            [loan_type_id, tenor_months, interest_rate, id]
        );
        if (updatedLoanTerm.rows.length === 0) {
            return res.status(404).json({ error: 'Tenor pinjaman tidak ditemukan.' });
        }
        res.json(updatedLoanTerm.rows[0]);
    } catch (err) {
        console.error('Error updating loan term:', err.message);
        if (err.code === '23505') { // unique_violation
            return res.status(400).json({ error: 'Kombinasi Tipe Pinjaman dan Tenor tersebut sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui tenor pinjaman.' });
    }
};

// DELETE tenor pinjaman
const deleteLoanTerm = async (req, res) => {
    try {
        const { id } = req.params;
        const deleteOp = await pool.query('DELETE FROM loan_terms WHERE id = $1', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ error: 'Tenor pinjaman tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting loan term:', err.message);
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Tenor ini masih digunakan oleh data pinjaman lain.' });
        }
        res.status(500).json({ error: 'Gagal menghapus tenor pinjaman.' });
    }
};

module.exports = { getLoanTerms, createLoanTerm, updateLoanTerm, deleteLoanTerm };