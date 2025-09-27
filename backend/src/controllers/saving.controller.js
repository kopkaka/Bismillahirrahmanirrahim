const pool = require('../../db');
const ExcelJS = require('exceljs');

// GET semua simpanan
const getSavings = async (req, res) => {
    try {
        const { startDate, endDate, search, savingTypeId, status, page = 1, limit = 10 } = req.query;

        let baseQuery = `
            FROM savings s
            LEFT JOIN saving_types st ON s.saving_type_id = st.id
            LEFT JOIN members m ON s.member_id = m.id
        `;
        
        let countQuery = `SELECT COUNT(s.id) ${baseQuery}`;
        let dataQuery = `
            SELECT 
                s.id, 
                s.member_id AS "memberId", 
                s.saving_type_id AS "savingTypeId",
                st.name AS "savingTypeName",
                m.name AS "memberName",
                m.cooperative_number AS "cooperativeNumber",
                s.amount, 
                s.date, 
                s.status,
                s.description,
                s.proof_path
            ${baseQuery}
        `;

        const params = [];
        const whereClauses = [];
        let paramIndex = 1;

        if (startDate) {
            whereClauses.push(`s.date::date >= $${paramIndex++}`);
            params.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`s.date::date <= $${paramIndex++}`);
            params.push(endDate);
        }
        if (search) {
            whereClauses.push(`m.name ILIKE $${paramIndex++}`);
            params.push(`%${search}%`);
        }
        if (savingTypeId) {
            whereClauses.push(`s.saving_type_id = $${paramIndex++}`);
            params.push(savingTypeId);
        }
        if (status) {
            whereClauses.push(`s.status = $${paramIndex++}`);
            params.push(status);
        }

        if (whereClauses.length > 0) {
            const whereString = ` WHERE ${whereClauses.join(' AND ')}`;
            countQuery += whereString;
            dataQuery += whereString;
        }

        // Get total items for pagination
        const countResult = await pool.query(countQuery, params);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);
        const offset = (page - 1) * limit;

        // Add ordering and pagination to the main query
        dataQuery += ` ORDER BY s.date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        const queryParams = [...params, limit, offset];

        const result = await pool.query(dataQuery, queryParams);

        res.json({
            data: result.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            }
        });

    } catch (err) {
        console.error('Error fetching savings:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data simpanan.' });
    }
};

// GET simpanan by member ID
const getSavingsByMember = async (req, res) => {
    try {
        const { memberId } = req.params;
        const query = `
            SELECT 
                s.id, 
                s.member_id AS "memberId", 
                s.saving_type_id AS "savingTypeId",
                st.name AS "savingTypeName",
                s.amount, 
                s.date, 
                s.status,
                s.description
            FROM savings s
            LEFT JOIN saving_types st ON s.saving_type_id = st.id
            WHERE s.member_id = $1
            ORDER BY s.date DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching savings by member:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data simpanan anggota.' });
    }
};

// POST simpanan baru
const createSaving = async (req, res) => {
    try {
        const { memberId, savingTypeId, amount, description } = req.body;
        if (!memberId || !savingTypeId || !amount) {
            return res.status(400).json({ error: 'Data tidak lengkap: memberId, savingTypeId, dan amount diperlukan.' });
        }
        const newSaving = await pool.query(
            'INSERT INTO savings (member_id, saving_type_id, amount, status, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [memberId, savingTypeId, amount, 'Pending', description || null]
        );
        res.status(201).json(newSaving.rows[0]);
    } catch (err) {
        console.error('Error creating saving:', err.message);
        res.status(500).json({ error: 'Gagal membuat data simpanan baru.' });
    }
};

// PUT update status simpanan
const updateSavingStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ error: 'Status tidak valid.' });
        }

        // Ambil detail simpanan sebelum update
        const savingRes = await client.query(`
            SELECT s.amount, s.saving_type_id, s.status as current_status, st.name as saving_type_name, st.account_id, m.name as member_name
            FROM savings s
            JOIN saving_types st ON s.saving_type_id = st.id
            JOIN members m ON s.member_id = m.id
            WHERE s.id = $1 FOR UPDATE
        `, [id]);

        if (savingRes.rows.length === 0) {
            throw new Error('Simpanan tidak ditemukan.');
        }

        const saving = savingRes.rows[0];

        // Update status simpanan
        const updatedSaving = await client.query('UPDATE savings SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
        if (updatedSaving.rows.length === 0) {
            throw new Error('Gagal memperbarui status simpanan.');
        }

        // --- LOGIKA JURNAL OTOMATIS ---
        // Buat jurnal hanya jika status diubah menjadi "Approved" dari status lain.
        if (status === 'Approved' && saving.current_status !== 'Approved') {
            if (!saving.account_id) {
                throw new Error(`Tipe simpanan "${saving.saving_type_name}" belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.`);
            }

            const isWithdrawal = saving.saving_type_name === 'Penarikan Simpanan Sukarela';

            // Improvement: Fetch cash account ID dynamically instead of hardcoding
            const cashAccountRes = await client.query("SELECT id FROM chart_of_accounts WHERE account_number = '1-1110'"); // Assuming '1-1110' is Kas
            if (cashAccountRes.rows.length === 0) throw new Error("Akun 'Kas' (1-1110) tidak ditemukan di COA.");
            const cashAccountId = cashAccountRes.rows[0].id;

            const description = isWithdrawal
                ? `Penarikan simpanan sukarela a/n ${saving.member_name}`
                : `Setoran ${saving.saving_type_name} a/n ${saving.member_name}`;

            // --- Generate Automatic Journal Reference Number ---
            const entryDate = new Date();
            const year = entryDate.getFullYear();
            const month = String(entryDate.getMonth() + 1).padStart(2, '0');
            const day = String(entryDate.getDate()).padStart(2, '0');
            const prefix = `JRNL-${year}${month}${day}-`;

            const seqResult = await client.query("SELECT COUNT(*) FROM general_journal WHERE reference_number LIKE $1", [`${prefix}%`]);
            const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
            const referenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
            // --- End of Generation ---

            // 1. Buat header jurnal
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, referenceNumber]);
            const journalId = journalHeaderRes.rows[0].id;

            // 2. Update simpanan dengan journal_id
            await client.query('UPDATE savings SET journal_id = $1 WHERE id = $2', [journalId, id]);

            // 3. Buat entri jurnal (Debit dan Kredit)
            // Jika penarikan, balik logikanya: Debit Akun Simpanan, Kredit Kas
            const debitAccountId = isWithdrawal ? saving.account_id : cashAccountId;
            const creditAccountId = isWithdrawal ? cashAccountId : saving.account_id;
            const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
            await client.query(journalEntriesQuery, [journalId, debitAccountId, saving.amount, creditAccountId]);
        }

        await client.query('COMMIT');
        res.json(updatedSaving.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating saving status:', err.message);
        // Berikan pesan error yang spesifik untuk kesalahan yang diketahui (client error)
        if (err.message.includes('belum terhubung ke akun COA')) {
            return res.status(400).json({ error: err.message });
        }
        // Untuk error lain, berikan pesan generik (server error)
        res.status(500).json({ error: 'Terjadi kesalahan internal saat memperbarui status simpanan.' });
    } finally {
        client.release();
    }
};

// PUT update a saving
const updateSaving = async (req, res) => {
    try {
        const { id } = req.params;
        const { memberId, savingTypeId, amount, description } = req.body;
        if (!memberId || !savingTypeId || !amount) {
            return res.status(400).json({ error: 'Data tidak lengkap: memberId, savingTypeId, dan amount diperlukan.' });
        }
        const updatedSaving = await pool.query(
            'UPDATE savings SET member_id = $1, saving_type_id = $2, amount = $3, description = $4 WHERE id = $5 RETURNING *',
            [memberId, savingTypeId, amount, description || null, id]
        );
        if (updatedSaving.rows.length === 0) {
            return res.status(404).json({ error: 'Simpanan tidak ditemukan.' });
        }
        res.json(updatedSaving.rows[0]);
    } catch (err) {
        console.error('Error updating saving:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui data simpanan.' });
    }
};

// DELETE a saving
const deleteSaving = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Ambil journal_id dari simpanan yang akan dihapus
        const savingRes = await client.query('SELECT journal_id FROM savings WHERE id = $1', [id]);
        if (savingRes.rows.length === 0) {
            return res.status(404).json({ error: 'Simpanan tidak ditemukan.' });
        }
        const { journal_id } = savingRes.rows[0];

        // 2. Hapus data simpanan
        await client.query('DELETE FROM savings WHERE id = $1', [id]);

        // 3. Jika ada journal_id terkait, hapus juga jurnalnya
        // ON DELETE CASCADE pada tabel journal_entries akan menghapus detailnya secara otomatis.
        if (journal_id) {
            await client.query('DELETE FROM general_journal WHERE id = $1', [journal_id]);
        }

        await client.query('COMMIT');
        res.status(204).send();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting saving:', err.message);
        res.status(500).json({ error: 'Gagal menghapus data simpanan.' });
    } finally {
        client.release();
    }
};

const exportSavingsTemplate = async (req, res) => {
    try {
        // 1. Fetch all active members
        const membersResult = await pool.query(
            "SELECT cooperative_number, name FROM members WHERE status = 'Active' AND role = 'member' ORDER BY name ASC"
        );
        const members = membersResult.rows;

        if (members.length === 0) {
            return res.status(404).json({ error: 'Tidak ada anggota aktif yang ditemukan untuk membuat template.' });
        }

        // 2. Fetch all saving types for the dropdown validation
        const savingTypesResult = await pool.query('SELECT name FROM saving_types ORDER BY name ASC');
        const savingTypes = savingTypesResult.rows.map(st => st.name);

        // 3. Create a new workbook and worksheet with exceljs
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Data Simpanan');

        // 4. Add headers and set column widths
        worksheet.columns = [
            { header: 'Nomor Koperasi', key: 'cooperative_number', width: 20 },
            { header: 'Nama Anggota', key: 'name', width: 30 },
            { header: 'Tipe Simpanan', key: 'saving_type', width: 25 },
            { header: 'Jumlah', key: 'amount', width: 15 },
            { header: 'Tanggal (YYYY-MM-DD)', key: 'date', width: 20 },
            { header: 'Keterangan', key: 'description', width: 30 }
        ];

        // 5. Add data rows
        members.forEach(member => {
            worksheet.addRow({
                cooperative_number: member.cooperative_number,
                name: member.name
                // Other columns are left blank for user to fill
            });
        });

        // 6. Add data validation (dropdown) for 'Tipe Simpanan' column
        if (savingTypes.length > 0) {
            const savingTypeList = `"${savingTypes.join(',')}"`;
            // Apply validation to all data rows in the 'Tipe Simpanan' column (C)
            for (let i = 2; i <= members.length + 1; i++) {
                worksheet.getCell(`C${i}`).dataValidation = {
                    type: 'list',
                    allowBlank: false,
                    formulae: [savingTypeList],
                    showErrorMessage: true,
                    errorStyle: 'stop',
                    errorTitle: 'Tipe Simpanan Tidak Valid',
                    error: `Silakan pilih tipe simpanan dari daftar: ${savingTypes.join(', ')}`
                };
            }
        }
        
        // 7. Write to buffer and send response
        res.setHeader('Content-Disposition', 'attachment; filename="template_simpanan_anggota.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        const buffer = await workbook.xlsx.writeBuffer();
        res.send(buffer);

    } catch (err) {
        console.error('Error exporting savings template:', err);
        res.status(500).json({ error: 'Gagal mengekspor template.' });
    }
};

// NEW: Controller to handle Excel file upload for bulk savings
// Anda perlu menggunakan middleware seperti 'multer' di rute Anda untuk menangani 'req.file'
// Contoh di file rute: router.post('/savings/bulk-upload', upload.single('savingsFile'), uploadBulkSavings);
const uploadBulkSavings = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet(1); // Get the first worksheet

        const savingsToCreate = [];
        const headerRow = worksheet.getRow(1).values;
        
        // Create a map of header names to column indices.
        // This makes the import robust against column reordering.
        const headerMap = {};
        // Note: exceljs returns a sparse array for row.values, so we use a standard for loop.
        for (let i = 1; i < headerRow.length; i++) {
            if (headerRow[i]) {
                headerMap[headerRow[i].toString().trim()] = i;
            }
        }

        const colIdx = {
            cooperative_number: headerMap['Nomor Koperasi'] || headerMap['cooperative_number'],
            saving_type_name: headerMap['Tipe Simpanan'] || headerMap['saving_type_name'],
            amount: headerMap['Jumlah'] || headerMap['amount'],
            date: headerMap['Tanggal (YYYY-MM-DD)'] || headerMap['date'],
            description: headerMap['Keterangan'] || headerMap['description'],
        };

        // Iterate over all rows that have values in a worksheet
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            // Skip header row
            if (rowNumber === 1) return;

            // Extract values using the mapped column indices
            const cooperative_number = row.getCell(colIdx.cooperative_number).value;
            const amount = row.getCell(colIdx.amount).value;

            // Only process rows that have both a cooperative number and an amount
            if (cooperative_number && amount != null && parseFloat(amount) > 0) {
                savingsToCreate.push({
                    cooperative_number: cooperative_number,
                    saving_type_name: row.getCell(colIdx.saving_type_name).value,
                    amount: amount,
                    date: row.getCell(colIdx.date).value,
                    description: row.getCell(colIdx.description).value,
                });
            }
        });

        if (!Array.isArray(savingsToCreate) || savingsToCreate.length === 0) {
            return res.status(400).json({ error: 'File Excel tidak berisi data simpanan yang valid untuk diproses.' });
        }

        // 1. Ambil semua ID unik dari data yang diunggah
        const cooperativeNumbers = [...new Set(savingsToCreate.map(s => s.cooperative_number).filter(Boolean))];
        const savingTypeNames = [...new Set(savingsToCreate.map(s => s.saving_type_name).filter(Boolean))];

        // 2. Ambil ID yang sesuai dari database dalam satu kali query
        const membersResult = await client.query('SELECT id, cooperative_number FROM members WHERE cooperative_number = ANY($1::varchar[])', [cooperativeNumbers]);
        const savingTypesResult = await client.query('SELECT id, name FROM saving_types WHERE name = ANY($1::varchar[])', [savingTypeNames]);

        // 3. Buat Map untuk pencarian cepat
        const memberIdMap = new Map(membersResult.rows.map(m => [m.cooperative_number, m.id]));
        const savingTypeIdMap = new Map(savingTypesResult.rows.map(st => [st.name, st.id]));

        const values = [];
        const insertQueryParts = [];
        let paramIndex = 1;

        // 4. Validasi setiap baris dan siapkan untuk bulk insert
        for (let i = 0; i < savingsToCreate.length; i++) {
            const saving = savingsToCreate[i];
            if (!saving.cooperative_number) continue; // Lewati baris kosong
            const memberId = memberIdMap.get(saving.cooperative_number);
            const savingTypeId = savingTypeIdMap.get(saving.saving_type_name);

            // Skip rows that don't have a valid amount
            if (saving.amount == null || isNaN(parseFloat(saving.amount)) || parseFloat(saving.amount) <= 0) continue;

            // Berikan pesan error yang jelas jika ada data yang tidak ditemukan
            if (!memberId) throw new Error(`Baris ${i + 2}: Nomor Koperasi "${saving.cooperative_number}" tidak ditemukan.`);
            if (!savingTypeId) throw new Error(`Baris ${i + 2}: Tipe Simpanan "${saving.saving_type_name}" tidak ditemukan.`);
            
            // Use provided date, or default to today if invalid/missing
            const date = saving.date && (new Date(saving.date) instanceof Date && !isNaN(new Date(saving.date))) ? new Date(saving.date) : new Date();
            const description = saving.description || null;

            insertQueryParts.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'Approved', $${paramIndex++})`);
            values.push(memberId, savingTypeId, parseFloat(saving.amount), date, description);
        }

        // 5. Lakukan bulk insert jika ada data yang valid
        if (values.length > 0) {
            const insertQuery = `INSERT INTO savings (member_id, saving_type_id, amount, date, status, description) VALUES ${insertQueryParts.join(', ')}`;
            await client.query(insertQuery, values);
        }

        // --- LOGIKA JURNAL OTOMATIS UNTUK SETIAP SIMPANAN ---
        // Ambil ID Akun Kas sekali saja untuk efisiensi
        const cashAccountRes = await client.query("SELECT id FROM chart_of_accounts WHERE account_number = '1-1110'");
        if (cashAccountRes.rows.length === 0) throw new Error("Akun 'Kas' (1-1110) tidak ditemukan di COA.");
        const cashAccountId = cashAccountRes.rows[0].id;

        // Ambil ID Akun Simpanan yang relevan
        const accountMappingRes = await client.query('SELECT st.name, st.account_id FROM saving_types st WHERE st.name = ANY($1::varchar[])', [savingTypeNames]);
        const accountIdMap = new Map(accountMappingRes.rows.map(row => [row.name, row.account_id]));

        for (const saving of savingsToCreate) {
            const memberId = memberIdMap.get(saving.cooperative_number);
            const memberName = (await client.query('SELECT name FROM members WHERE id = $1', [memberId])).rows[0].name;
            const savingAccountId = accountIdMap.get(saving.saving_type_name);

            if (!savingAccountId) {
                throw new Error(`Tipe simpanan "${saving.saving_type_name}" belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.`);
            }

            const amount = parseFloat(saving.amount);
            const date = saving.date && !isNaN(new Date(saving.date)) ? new Date(saving.date) : new Date();
            const journalDescription = `Setoran ${saving.saving_type_name} a/n ${memberName} via Excel`;

            // --- Generate Automatic Journal Reference Number ---
            const entryDate = new Date(date);
            const year = entryDate.getFullYear();
            const month = String(entryDate.getMonth() + 1).padStart(2, '0');
            const day = String(entryDate.getDate()).padStart(2, '0');
            const prefix = `JRNL-${year}${month}${day}-`;

            const seqResult = await client.query("SELECT COUNT(*) FROM general_journal WHERE reference_number LIKE $1", [`${prefix}%`]);
            const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
            const referenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
            // --- End of Generation ---

            // 1. Buat header jurnal untuk setiap transaksi
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [date, journalDescription, referenceNumber]);
            const journalId = journalHeaderRes.rows[0].id;

            // 2. Buat entri jurnal (Debit Kas, Kredit Akun Simpanan)
            const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
            await client.query(journalEntriesQuery, [journalId, cashAccountId, amount, savingAccountId]);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: `${savingsToCreate.length} baris data simpanan berhasil diunggah dan diproses.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk savings upload error:', err);
        res.status(400).json({ error: err.message || 'Terjadi kesalahan saat memproses file.' });
    } finally {
        client.release();
    }
};

module.exports = { getSavings, getSavingsByMember, createSaving, updateSavingStatus, uploadBulkSavings, updateSaving, deleteSaving, exportSavingsTemplate };