const pool = require('../../db');
const ExcelJS = require('exceljs');

const getAccounts = async (req, res) => {
    try {
        // Query dimodifikasi untuk menambahkan flag 'is_parent'
        // 'is_parent' akan bernilai true jika ID akun ini ada di kolom parent_id akun lain.
        const query = `
            SELECT 
                coa.id, 
                coa.account_number, 
                coa.account_name, 
                coa.account_type, 
                coa.parent_id,
                EXISTS(SELECT 1 FROM chart_of_accounts child WHERE child.parent_id = coa.id) as is_parent
            FROM chart_of_accounts coa 
            ORDER BY coa.account_number ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createAccount = async (req, res) => {
    const { account_number, account_name, account_type, parent_id } = req.body;
    // Validasi yang lebih spesifik untuk memastikan field yang wajib ada dan tidak kosong.
    if (!account_number?.trim() || !account_name?.trim() || !account_type?.trim()) {
        return res.status(400).json({ error: 'No. Akun, Nama Akun, dan Tipe Akun wajib diisi.' });
    }
    // Pastikan parent_id adalah integer yang valid atau null jika kosong
    const final_parent_id = parent_id ? parseInt(parent_id, 10) : null;
    try {
        const result = await pool.query(
            'INSERT INTO chart_of_accounts (account_number, account_name, account_type, parent_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [account_number.trim(), account_name.trim(), account_type.trim(), final_parent_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating account:', error.message);
        // Memberikan feedback yang lebih baik jika terjadi duplikasi data (unique constraint violation)
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Nomor atau Nama Akun sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat akun baru.' });
    }
};

const updateAccount = async (req, res) => {
    const { id } = req.params;
    const { account_number, account_name, account_type, parent_id } = req.body;

    // Validasi dasar
    if (!account_number?.trim() || !account_name?.trim() || !account_type?.trim()) {
        return res.status(400).json({ error: 'No. Akun, Nama Akun, dan Tipe Akun wajib diisi.' });
    }
    // Pastikan parent_id adalah integer yang valid atau null jika kosong
    const final_parent_id = parent_id ? parseInt(parent_id, 10) : null;

    try {
        const result = await pool.query(
            'UPDATE chart_of_accounts SET account_number = $1, account_name = $2, account_type = $3, parent_id = $4 WHERE id = $5 RETURNING *',
            [account_number.trim(), account_name.trim(), account_type.trim(), final_parent_id, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Akun tidak ditemukan.' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating account:', error.message);
        // Memberikan feedback yang lebih baik jika terjadi duplikasi data
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Nomor atau Nama Akun sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui akun.' });
    }
};

const deleteAccount = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM chart_of_accounts WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting account:', error.message);
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Akun ini masih digunakan oleh data lain (misal: jurnal atau tipe simpanan).' });
        }
        res.status(500).json({ error: 'Gagal menghapus akun.' });
    }
};

const getJournalableAccounts = async (req, res) => {
    try {
        // Akun yang "bisa dijurnal" adalah akun yang tidak menjadi induk bagi akun lain.
        // Kita mencari semua akun yang ID-nya tidak ada di kolom parent_id.
        const query = `
            SELECT id, account_number, account_name 
            FROM chart_of_accounts
            WHERE id NOT IN (SELECT DISTINCT parent_id FROM chart_of_accounts WHERE parent_id IS NOT NULL)
            ORDER BY account_number ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching journalable accounts:', error.message);
        res.status(500).json({ error: 'Gagal mengambil daftar akun untuk jurnal.' });
    }
};

const exportAccountsToExcel = async (req, res) => {
    try {
        const query = `
            SELECT 
                coa.account_number, 
                coa.account_name, 
                coa.account_type, 
                parent.account_number as parent_account_number,
                parent.account_name as parent_account_name,
                EXISTS(SELECT 1 FROM chart_of_accounts child WHERE child.parent_id = coa.id) as is_parent
            FROM chart_of_accounts coa 
            LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
            ORDER BY coa.account_number ASC
        `;
        const result = await pool.query(query);
        const accounts = result.rows;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Daftar Akun');

        worksheet.columns = [
            { header: 'No. Akun', key: 'account_number', width: 20 },
            { header: 'Nama Akun', key: 'account_name', width: 40 },
            { header: 'Tipe Akun', key: 'account_type', width: 20 },
            { header: 'Akun Induk (Nomor)', key: 'parent_account_number', width: 20 },
            { header: 'Akun Induk (Nama)', key: 'parent_account_name', width: 40 },
        ];

        accounts.forEach(account => {
            const row = worksheet.addRow({
                account_number: account.account_number,
                account_name: account.account_name,
                account_type: account.account_type,
                parent_account_number: account.parent_account_number || '',
                parent_account_name: account.parent_account_name || ''
            });

            if (account.is_parent) {
                row.font = { bold: true };
            }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Daftar_Akun_COA.xlsx"');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting accounts to Excel:', error.message);
        res.status(500).json({ error: 'Gagal mengekspor data akun.' });
    }
};

const importAccountsFromExcel = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet(1);

        const accountsToUpsert = [];
        const headerRow = worksheet.getRow(1).values;
        const headerMap = {};
        // exceljs returns a sparse array, so a standard for loop is safer
        for (let i = 1; i < headerRow.length; i++) {
            if (headerRow[i]) {
                headerMap[headerRow[i].toString().trim().toLowerCase()] = i;
            }
        }

        const colIdx = {
            account_number: headerMap['no. akun'],
            account_name: headerMap['nama akun'],
            account_type: headerMap['tipe akun'],
            parent_account_number: headerMap['akun induk (nomor)'], // Tetap cari kolom ini
        };

        if (!colIdx.account_number || !colIdx.account_name || !colIdx.account_type) {
            throw new Error("Header kolom tidak sesuai. Pastikan ada kolom 'No. Akun', 'Nama Akun', dan 'Tipe Akun'.");
        }

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return;

            const accountNumber = row.getCell(colIdx.account_number).value?.toString().trim();
            const accountName = row.getCell(colIdx.account_name).value?.toString().trim();
            const accountType = row.getCell(colIdx.account_type).value?.toString().trim();
            // Handle parent_account_number being optional in the file
            const parentAccountNumber = colIdx.parent_account_number ? row.getCell(colIdx.parent_account_number)?.value?.toString().trim() || null : null;

            if (accountNumber && accountName && accountType) {
                accountsToUpsert.push({ account_number: accountNumber, account_name: accountName, account_type: accountType, parent_account_number: parentAccountNumber, rowNumber: rowNumber });
            }
        });

        if (accountsToUpsert.length === 0) {
            return res.status(400).json({ error: 'File Excel tidak berisi data akun yang valid untuk diimpor.' });
        }

        // --- First Pass: Upsert all accounts with parent_id as NULL to ensure they exist ---
        const upsertQuery = `
            INSERT INTO chart_of_accounts (account_number, account_name, account_type, parent_id)
            VALUES ($1, $2, $3, NULL)
            ON CONFLICT (account_number) DO UPDATE SET
                account_name = EXCLUDED.account_name,
                account_type = EXCLUDED.account_type;
        `;

        for (const acc of accountsToUpsert) {
            await client.query(upsertQuery, [acc.account_number, acc.account_name, acc.account_type]);
        }

        // --- Second Pass: Update parent_id for all accounts ---
        // Now that all accounts from the file exist in the DB, we can safely get their IDs.
        const allAccountsRes = await client.query('SELECT id, account_number FROM chart_of_accounts');
        const accountNumberToIdMap = new Map(allAccountsRes.rows.map(acc => [acc.account_number, acc.id]));

        const updateParentQuery = `UPDATE chart_of_accounts SET parent_id = $1 WHERE account_number = $2`;
        
        for (const acc of accountsToUpsert) {
            if (acc.parent_account_number) {
                const parentId = accountNumberToIdMap.get(acc.parent_account_number);
                if (parentId === undefined) { throw new Error(`Baris ${acc.rowNumber}: Akun Induk dengan nomor '${acc.parent_account_number}' tidak ditemukan.`); }
                await client.query(updateParentQuery, [parentId, acc.account_number]);
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `${accountsToUpsert.length} akun berhasil diimpor atau diperbarui.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error importing accounts from Excel:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mengimpor file.' });
    } finally {
        client.release();
    }
};

module.exports = { getAccounts, createAccount, updateAccount, deleteAccount, getJournalableAccounts, exportAccountsToExcel, importAccountsFromExcel };