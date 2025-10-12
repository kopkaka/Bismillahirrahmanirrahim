const pool = require('../../db');
const fs = require('fs');
const path = require('path');
const { getAccountId } = require('../utils/getAccountId.util');
const { createNotification } = require('../utils/notification.util');
const accountTypeController = require('./accounttype.controller');

const getAllPermissions = async (req, res) => { // NOSONAR
    try {
        const result = await pool.query('SELECT key, description FROM permissions ORDER BY description');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching permissions:', err.message);
        res.status(500).json({ error: 'Gagal mengambil daftar hak akses.' });
    }
};

const getRolePermissions = async (req, res) => { // NOSONAR
    const { roleName } = req.params;
    try {
        const result = await pool.query('SELECT permission_key FROM role_permissions WHERE role_name = $1', [roleName]);
        // Return an array of strings, e.g., ['viewDashboard', 'viewSettings']
        res.json(result.rows.map(row => row.permission_key));
    } catch (err) {
        console.error(`Error fetching permissions for role ${roleName}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil hak akses untuk peran ini.' });
    }
};

const updateRolePermissions = async (req, res) => { // NOSONAR
    const { roleName } = req.params;
    const { permissions } = req.body; // Expects an array of permission keys
    const { role: currentUserRole } = req.user;

    // Security: Prevent admin from editing their own role via this UI
    if (roleName === 'admin') {
        return res.status(403).json({ error: 'Hak akses untuk peran admin tidak dapat diubah.' });
    }
    // Security: Prevent a user from editing permissions of their own role to avoid self-lockout.
    if (roleName === currentUserRole) {
        return res.status(403).json({ error: 'Anda tidak dapat mengubah hak akses untuk peran Anda sendiri.' });
    }
    if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'Data hak akses tidak valid.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM role_permissions WHERE role_name = $1', [roleName]);

        if (permissions.length > 0) {
            const insertQueryParts = permissions.map((_, index) => `($1, $${index + 2})`).join(', ');
            const queryParams = [roleName, ...permissions];
            const insertQuery = `INSERT INTO role_permissions (role_name, permission_key) VALUES ${insertQueryParts}`;
            await client.query(insertQuery, queryParams);
        }

        await client.query('COMMIT');
        res.json({ message: `Hak akses untuk peran ${roleName} berhasil diperbarui.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error updating permissions for role ${roleName}:`, err.message);
        if (err.code === '23503') return res.status(400).json({ error: 'Satu atau lebih hak akses yang diberikan tidak valid.' });
        res.status(500).json({ error: 'Gagal memperbarui hak akses.' });
    } finally {
        client.release();
    }
};

// GET Company Info
const getCompanyInfo = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM company_info WHERE id = 1');
        if (result.rows.length === 0) {
            // Jika belum ada info, kembalikan struktur default
            return res.json({ id: 1, name: '', address: '', phone: '', logo_url: null });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching company info:', err.message);
        res.status(500).json({ error: 'Gagal mengambil informasi koperasi.' });
    }
};

// PUT Update Company Info
const updateCompanyInfo = async (req, res) => {
    const { name, address, phone } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const oldInfoResult = await client.query('SELECT logo_url FROM company_info WHERE id = 1');
        const oldLogoPath = oldInfoResult.rows.length > 0 ? oldInfoResult.rows[0].logo_url : null;
        let newLogoUrl = oldLogoPath;
        if (req.file) { // Path dari multer sudah benar (contoh: uploads/logo/...)
            newLogoUrl = req.file.path.replace(/\\/g, '/');
        }
        const query = `UPDATE company_info SET name = $1, address = $2, phone = $3, logo_url = $4 WHERE id = 1 RETURNING *;`;
        const result = await client.query(query, [name, address, phone, newLogoUrl]);
        if (req.file && oldLogoPath && oldLogoPath !== newLogoUrl) { // Jika ada file baru dan path lama ada
            const fullOldPath = path.resolve(process.cwd(), oldLogoPath.startsWith('/') ? oldLogoPath.substring(1) : oldLogoPath);
            fs.unlink(fullOldPath, (err) => { if (err) console.error('Gagal menghapus file logo lama:', err); });
        }
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating company info:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui informasi koperasi.' });
    } finally {
        client.release();
    }
};

const getPaymentMethods = async (req, res) => { // NOSONAR
    try {
        // Ambil semua kolom yang relevan, termasuk is_active dan account_id
        const result = await pool.query('SELECT id, name, is_active, account_id FROM payment_methods ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching payment methods:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data metode pembayaran.' });
    }
};

const getAllProductsForDropdown = async (req, res) => { // NOSONAR
     try {
        const result = await pool.query('SELECT id, name FROM products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
}

/**
 * @desc    Maps a payment method to a Chart of Accounts account.
 * @route   PUT /api/admin/map-payment-method-account/:id
 * @access  Private (Admin/Settings)
 */
const mapPaymentMethodAccount = async (req, res) => {
    const { id } = req.params;
    const { accountId } = req.body;
    try {
        const result = await pool.query('UPDATE payment_methods SET account_id = $1 WHERE id = $2 RETURNING *', [accountId, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Metode pembayaran tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error mapping payment method account:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan maping akun.' });
    }
};

const createManualSaving = async (req, res) => { // NOSONAR
    const { memberId, savingTypeId, amount, date, description } = req.body;
    const { id: adminUserId } = req.user;

    if (!memberId || !savingTypeId || !amount || !date) {
        return res.status(400).json({ error: 'Data tidak lengkap: ID Anggota, Tipe Simpanan, Jumlah, dan Tanggal diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch details for journaling
        const detailsRes = await client.query(`
            SELECT 
                st.name as saving_type_name, 
                st.account_id, 
                m.name as member_name
            FROM saving_types st, members m
            WHERE st.id = $1 AND m.id = $2
        `, [savingTypeId, memberId]);

        if (detailsRes.rows.length === 0) {
            throw new Error('Tipe simpanan atau anggota tidak ditemukan.');
        }
        const details = detailsRes.rows[0];

        if (!details.account_id) {
            // Throw a more specific error to be caught and sent to the client.
            throw new Error(`Tipe simpanan "${details.saving_type_name}" belum terhubung ke akun Chart of Accounts.`);
        }

        // 3. Create Journal Entry
        const cashAccountId = await getAccountId('Kas', client);
        const journalDescription = `Setoran ${details.saving_type_name} a/n ${details.member_name} (Manual)`;

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

        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [date, journalDescription, referenceNumber]);
        const journalId = journalHeaderRes.rows[0].id;
        const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
        await client.query(journalEntriesQuery, [journalId, cashAccountId, amount, details.account_id]);

        // 4. Insert the saving with 'Approved' status and the new journal_id
        const savingDesc = description || `Input manual oleh admin ID: ${adminUserId}`;
        await client.query('INSERT INTO savings (member_id, saving_type_id, amount, date, status, description, journal_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [memberId, savingTypeId, amount, date, 'Approved', savingDesc, journalId]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Simpanan berhasil dicatat dan dijurnalkan.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating manual saving:', err.message);
        // Send specific, known configuration errors back to the client.
        const isClientError = err.message.includes('belum terhubung') || err.message.includes('tidak ditemukan');
        res.status(isClientError ? 400 : 500).json({ error: err.message });
    } finally {
        client.release();
    }
};

const getGeneralLedger = async (req, res) => { // NOSONAR
    const { startAccountId, endAccountId, startDate, endDate } = req.query;

    if (!startAccountId || !endAccountId || !startDate || !endDate) {
        return res.status(400).json({ error: 'Rentang akun, tanggal mulai, dan tanggal akhir diperlukan.' });
    }

    const client = await pool.connect();
    try {
        // 1. Get account numbers for the start and end IDs
        const startAccountRes = await client.query('SELECT account_number FROM chart_of_accounts WHERE id = $1', [startAccountId]);
        const endAccountRes = await client.query('SELECT account_number FROM chart_of_accounts WHERE id = $1', [endAccountId]);

        if (startAccountRes.rows.length === 0) throw new Error('Akun awal tidak ditemukan.');
        if (endAccountRes.rows.length === 0) throw new Error('Akun akhir tidak ditemukan.');

        const startAccountNumber = startAccountRes.rows[0].account_number;
        const endAccountNumber = endAccountRes.rows[0].account_number;

        // Ensure start account is less than or equal to end account
        const [finalStart, finalEnd] = startAccountNumber <= endAccountNumber ? [startAccountNumber, endAccountNumber] : [endAccountNumber, startAccountNumber];

        // 2. Get all accounts within that range
        const accountsToProcessRes = await client.query(
            `SELECT id, account_number, account_name, account_type 
             FROM chart_of_accounts 
             WHERE account_number >= $1 AND account_number <= $2
             ORDER BY account_number ASC`,
            [finalStart, finalEnd]
        );
        const accountsToProcess = accountsToProcessRes.rows;

        if (accountsToProcess.length === 0) {
            return res.json([]);
        }

        const allLedgers = [];

        // 3. Loop through each account and generate its ledger
        for (const account of accountsToProcess) {
            const isDebitNormalBalance = ['Aset', 'HPP', 'Biaya'].includes(account.account_type);

            const beginningBalanceQuery = `
                SELECT COALESCE(SUM(CASE WHEN $1 THEN je.debit - je.credit ELSE je.credit - je.debit END), 0) as balance
                FROM journal_entries je
                JOIN general_journal gj ON je.journal_id = gj.id
                WHERE je.account_id = $2 AND gj.entry_date < $3
            `;

            const transactionsQuery = `
                SELECT gj.entry_date, gj.description, gj.reference_number, je.debit, je.credit
                FROM journal_entries je
                JOIN general_journal gj ON je.journal_id = gj.id
                WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3
                ORDER BY gj.entry_date ASC, gj.id ASC
            `;

            const [beginningBalanceRes, transactionsRes] = await Promise.all([
                client.query(beginningBalanceQuery, [isDebitNormalBalance, account.id, startDate]),
                client.query(transactionsQuery, [account.id, startDate, endDate])
            ]);

            let runningBalance = parseFloat(beginningBalanceRes.rows[0].balance);
            const beginningBalance = runningBalance;

            const transactions = transactionsRes.rows.map(tx => {
                const debit = parseFloat(tx.debit);
                const credit = parseFloat(tx.credit);
                runningBalance += isDebitNormalBalance ? (debit - credit) : (credit - debit);
                return { date: tx.entry_date, description: tx.description, reference: tx.reference_number, debit, credit, balance: runningBalance };
            });

            // Only add ledger if it has transactions or a non-zero balance
            if (transactions.length > 0 || Math.abs(beginningBalance) > 0.001) {
                allLedgers.push({
                    account: { id: account.id, account_number: account.account_number, account_name: account.account_name },
                    summary: { beginningBalance, endingBalance: runningBalance },
                    transactions
                });
            }
        }

        res.json(allLedgers);
    } catch (err) {
        console.error('Error generating general ledger:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan buku besar.' });
    } finally {
        client.release();
    }
};

const getMemberLoanHistory = async (req, res) => { // NOSONAR
    const { id: memberId } = req.params;

    try {
        // This query joins loans with their types and terms for a comprehensive history.
        const query = `
            SELECT 
                l.id,
                l.amount,
                l.date,
                l.status,
                l.remaining_principal AS "remainingPrincipal",
                lt.name AS "loanTypeName",
                ltm.tenor_months AS "tenorMonths",
                ltm.interest_rate AS "interestRate"
            FROM loans l
            JOIN loan_types lt ON l.loan_type_id = lt.id
            JOIN loan_terms ltm ON l.loan_term_id = ltm.id
            WHERE l.member_id = $1
            ORDER BY l.date DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error(`Error fetching loan history for member ${memberId}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat pinjaman anggota.' });
    }
};

const getPendingSales = async (req, res) => { // NOSONAR
    try {
        const query = `
            SELECT 
                s.id,
                s.order_id,
                s.sale_date,
                s.total_amount,
                s.status,
                m.name as member_name
            FROM sales s
            JOIN members m ON s.member_id = m.id
            WHERE s.status = 'Menunggu Pengambilan'
            ORDER BY s.sale_date ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending sales:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pesanan masuk.' });
    }
};

/**
 * @desc    Get all members with pending resignation requests
 * @route   GET /api/admin/pending-resignations
 * @access  Private (Admin)
 */
const getPendingResignations = async (req, res) => { // NOSONAR
    try {
        const query = `
            SELECT
                m.id,
                m.name,
                m.cooperative_number,
                m.approval_date,
                m.updated_at AS request_date,
                (
                    SELECT COALESCE(SUM(s.amount), 0)
                    FROM savings s
                    WHERE s.member_id = m.id AND s.status = 'Approved'
                ) AS total_savings
            FROM
                members m
            WHERE
                m.status = 'Pending Resignation'
            ORDER BY
                m.updated_at ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending resignations:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data permintaan pengunduran diri.' });
    }
};

/**
 * @desc    Process a member's resignation request. Changes status to Inactive and creates journal entries.
 * @route   POST /api/admin/process-resignation
 * @access  Private (Admin)
 */
const processResignation = async (req, res) => { // NOSONAR
    const { memberId } = req.body;

    if (!memberId) {
        return res.status(400).json({ error: 'ID Anggota diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch member data and lock the row for update
        const memberRes = await client.query("SELECT id, name, status FROM members WHERE id = $1 FOR UPDATE", [memberId]);
        if (memberRes.rows.length === 0) throw new Error('Anggota tidak ditemukan.');
        const member = memberRes.rows[0];

        // 2. Validate current status
        if (member.status !== 'Pending Resignation') {
            throw new Error(`Hanya anggota dengan status 'Pending Resignation' yang dapat diproses. Status saat ini: ${member.status}.`);
        }

        // 3. Final check for active loans as a safeguard
        const activeLoanCheck = await client.query("SELECT id FROM loans WHERE member_id = $1 AND status = 'Approved'", [memberId]);
        if (activeLoanCheck.rows.length > 0) {
            throw new Error('Gagal memproses. Anggota ini ternyata masih memiliki pinjaman aktif.');
        }

        // 4. Get total savings, grouped by saving type to get their account IDs
        const savingsRes = await client.query(`
            SELECT
                st.name as saving_type_name,
                st.account_id,
                COALESCE(SUM(s.amount), 0) as total_amount
            FROM savings s
            JOIN saving_types st ON s.saving_type_id = st.id
            WHERE s.member_id = $1 AND s.status = 'Approved'
            GROUP BY st.name, st.account_id
            HAVING COALESCE(SUM(s.amount), 0) > 0;
        `, [memberId]);

        const savingsByType = savingsRes.rows;
        const totalSavingsToReturn = savingsByType.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);

        // 5. Create Journal Entries if there are savings to return
        if (totalSavingsToReturn > 0) {
            const description = `Pengembalian seluruh simpanan a/n ${member.name} karena mengundurkan diri.`;

            // Security & Maintainability: Fetch account ID dynamically.
            const cashAccountId = await getAccountId('Kas', client);

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
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, referenceNumber]);
            const journalId = journalHeaderRes.rows[0].id;

            const journalEntries = [];
            // Debit each savings liability account
            for (const saving of savingsByType) {
                if (!saving.account_id) throw new Error(`Tipe simpanan "${saving.saving_type_name}" belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.`);
                journalEntries.push({ journal_id: journalId, account_id: saving.account_id, debit: saving.total_amount, credit: 0 });
            }
            // Credit the cash account
            journalEntries.push({ journal_id: journalId, account_id: cashAccountId, debit: 0, credit: totalSavingsToReturn });

            const journalQueryParts = journalEntries.map((_, i) => `($${i*4 + 1}, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4})`);
            const journalValues = journalEntries.flatMap(e => [e.journal_id, e.account_id, e.debit, e.credit]);
            await client.query(`INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ${journalQueryParts.join(', ')}`, journalValues);
        }

        // 6. Update member status to 'Inactive' and set resignation date
        await client.query("UPDATE members SET status = 'Inactive', resignation_date = NOW() WHERE id = $1", [memberId]);

        await client.query('COMMIT');

        // 7. Create notification for the member
        createNotification(member.id, 'Pengunduran diri Anda telah selesai diproses. Keanggotaan Anda sekarang tidak aktif.', 'profile').catch(err => console.error(`Failed to create resignation processed notification for user ${member.id}:`, err));
        res.json({ message: `Pengunduran diri anggota "${member.name}" berhasil diproses. Status diubah menjadi Inactive.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error processing resignation:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses pengunduran diri.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get history of monthly closings.
 * @route   GET /api/admin/accounting/closings
 * @access  Private (Accounting)
 */
const getMonthlyClosings = async (req, res) => { // NOSONAR
    try {
        const result = await pool.query(
            'SELECT year, month, closed_at, net_income FROM monthly_closings ORDER BY year DESC, month DESC LIMIT 12'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching monthly closings history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat tutup buku.' });
    }
};

const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
};

/**
 * @desc    Processes the monthly closing of books.
 * @route   POST /api/admin/accounting/close-month
 * @access  Private (Accounting)
 */
const processMonthlyClosing = async (req, res) => { // NOSONAR
    const { year, month } = req.body;
    const { id: userId } = req.user;

    if (!year || !month) {
        return res.status(400).json({ error: 'Tahun dan bulan diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check if the month is already closed
        const existingClosing = await client.query(
            'SELECT * FROM monthly_closings WHERE year = $1 AND month = $2',
            [year, month]
        );
        if (existingClosing.rows.length > 0) {
            throw new Error(`Bulan ${month}/${year} sudah pernah ditutup.`);
        }

        // 2. Define date range for the selected month
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of the month

        // 3. Get all income and expense accounts with balances in the period
        const accountsToCloseQuery = `
            SELECT
                coa.id,
                coa.account_type,
                COALESCE(SUM(
                    CASE
                        WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit
                        ELSE je.debit - je.credit
                    END
                ), 0) as balance
            FROM journal_entries je
            JOIN chart_of_accounts coa ON je.account_id = coa.id
            JOIN general_journal gj ON je.journal_id = gj.id
            WHERE gj.entry_date BETWEEN $1 AND $2
              AND coa.account_type IN ('Pendapatan', 'HPP', 'Biaya')
            GROUP BY coa.id, coa.account_type
            HAVING COALESCE(SUM(CASE WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit ELSE je.debit - je.credit END), 0) != 0;
        `;
        const accountsToCloseRes = await client.query(accountsToCloseQuery, [startDate, endDate]);
        const accountsToClose = accountsToCloseRes.rows;

        if (accountsToClose.length === 0) {
            await client.query('INSERT INTO monthly_closings (year, month, closed_by_user_id, net_income) VALUES ($1, $2, $3, 0)', [year, month, userId]);
            await client.query('COMMIT');
            return res.json({ message: `Tidak ada transaksi pendapatan/biaya pada periode ${month}/${year}. Bulan ditandai sebagai ditutup.` });
        }

        // 4. Calculate Net Income and prepare closing entries
        let netIncome = 0;
        const closingEntries = [];
        accountsToClose.forEach(acc => {
            const balance = parseFloat(acc.balance);
            netIncome += balance;
            if (acc.account_type === 'Pendapatan') closingEntries.push({ account_id: acc.id, debit: balance, credit: 0 });
            else closingEntries.push({ account_id: acc.id, debit: 0, credit: balance });
        });

        // 5. Create closing journal entry
        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const description = `Jurnal Penutup Bulan ${monthNames[month - 1]} ${year}`;

        // --- Generate Automatic Journal Reference Number ---
        const entryDate = new Date(endDate);
        const refYear = entryDate.getFullYear();
        const refMonth = String(entryDate.getMonth() + 1).padStart(2, '0');
        const refDay = String(entryDate.getDate()).padStart(2, '0');
        const prefix = `JRNL-${refYear}${refMonth}${refDay}-`;

        const seqResult = await client.query("SELECT COUNT(*) FROM general_journal WHERE reference_number LIKE $1", [`${prefix}%`]);
        const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
        const referenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        // --- End of Generation ---
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [endDate, description, referenceNumber]);
        const journalId = journalHeaderRes.rows[0].id;

        // Improvement: Fetch account ID dynamically
        const incomeSummaryAccountRes = await client.query("SELECT id FROM chart_of_accounts WHERE account_number = '3-2110'");
        if (incomeSummaryAccountRes.rows.length === 0) throw new Error("Akun 'Ikhtisar Laba Rugi' (3-2110) tidak ditemukan di COA.");
        const incomeSummaryAccountId = incomeSummaryAccountRes.rows[0].id;

        if (netIncome > 0) closingEntries.push({ account_id: incomeSummaryAccountId, debit: 0, credit: netIncome });
        else if (netIncome < 0) closingEntries.push({ account_id: incomeSummaryAccountId, debit: -netIncome, credit: 0 });

        const journalQueryParts = closingEntries.map((_, i) => `($1, $${i*3 + 2}, $${i*3 + 3}, $${i*3 + 4})`);
        const journalValues = [journalId, ...closingEntries.flatMap(e => [e.account_id, e.debit, e.credit])];
        await client.query(`INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ${journalQueryParts.join(', ')}`, journalValues);

        await client.query('INSERT INTO monthly_closings (year, month, closed_by_user_id, net_income, journal_id) VALUES ($1, $2, $3, $4, $5)', [year, month, userId, netIncome, journalId]);

        await client.query('COMMIT');
        res.status(201).json({ message: `Proses tutup buku untuk ${monthNames[month - 1]} ${year} berhasil. Laba/rugi sebesar ${formatCurrency(netIncome)} telah dicatat.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error processing monthly closing:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses tutup buku.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Re-opens a previously closed accounting month.
 * @route   POST /api/admin/accounting/reopen-month
 * @access  Private (Accounting)
 */
const reopenMonthlyClosing = async (req, res) => { // NOSONAR
    const { year, month } = req.body;

    if (!year || !month) {
        return res.status(400).json({ error: 'Tahun dan bulan diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Find the closing record to get the journal_id
        const closingRes = await client.query(
            'SELECT journal_id FROM monthly_closings WHERE year = $1 AND month = $2 FOR UPDATE',
            [year, month]
        );
        if (closingRes.rows.length === 0) {
            throw new Error(`Periode ${month}/${year} tidak ditemukan atau belum ditutup.`);
        }
        const { journal_id } = closingRes.rows[0];

        // 2. Check if a subsequent month is already closed
        const nextClosingRes = await client.query(
            'SELECT 1 FROM monthly_closings WHERE (year > $1) OR (year = $1 AND month > $2) LIMIT 1',
            [year, month]
        );
        if (nextClosingRes.rows.length > 0) {
            throw new Error('Tidak dapat membuka periode ini karena periode berikutnya sudah ditutup. Buka periode yang lebih baru terlebih dahulu.');
        }

        // 3. Delete the closing journal entry (cascades to journal_entries)
        if (journal_id) {
            await client.query('DELETE FROM general_journal WHERE id = $1', [journal_id]);
        }

        // 4. Delete the record from monthly_closings
        await client.query('DELETE FROM monthly_closings WHERE year = $1 AND month = $2', [year, month]);

        await client.query('COMMIT');
        res.json({ message: `Periode ${String(month).padStart(2, '0')}/${year} berhasil dibuka kembali.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error reopening monthly closing:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membuka kembali periode.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get the closing status for each month of a given year.
 * @route   GET /api/admin/reports/monthly-closing-status
 * @access  Private (Accounting)
 */
const getMonthlyClosingStatus = async (req, res) => { // NOSONAR
    const { year } = req.query;

    if (!year || isNaN(parseInt(year))) {
        return res.status(400).json({ error: 'Tahun yang valid diperlukan.' });
    }

    try {
        const closedMonthsRes = await pool.query(
            'SELECT month, closed_at, net_income FROM monthly_closings WHERE year = $1',
            [year]
        );
        const closedMonthsMap = new Map(closedMonthsRes.rows.map(row => [row.month, row]));

        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const report = [];

        for (let i = 1; i <= 12; i++) {
            const closedData = closedMonthsMap.get(i);
            report.push({ month: i, monthName: monthNames[i - 1], status: closedData ? 'Ditutup' : 'Terbuka', closedAt: closedData ? closedData.closed_at : null, netIncome: closedData ? closedData.net_income : null, });
        }

        res.json(report);
    } catch (err) {
        console.error('Error fetching monthly closing status:', err.message);
        res.status(500).json({ error: 'Gagal mengambil status tutup buku.' });
    }
};

const updateUser = async (req, res) => { // NOSONAR
    const { id: targetUserId } = req.params;
    const { id: currentUserId } = req.user;
    const { name, phone, company_id, position_id, status, role: newRole } = req.body;
    const client = await pool.connect();

    // Validasi dasar
    if (!name || !status || !newRole) {
        return res.status(400).json({ error: 'Nama, Status, dan Role wajib diisi.' });
    }
    const validRoles = ['admin', 'manager', 'akunting', 'member'];
    if (!validRoles.includes(newRole)) {
        return res.status(400).json({ error: 'Role yang diberikan tidak valid.' });
    }

    try {
        await client.query('BEGIN');

        const userRes = await client.query('SELECT role, status FROM members WHERE id = $1 FOR UPDATE', [targetUserId]);
        if (userRes.rows.length === 0) {
            throw new Error('Pengguna tidak ditemukan.');
        }
        const { role: currentRole } = userRes.rows[0];

        // --- Security Checks ---
        if (parseInt(targetUserId, 10) === currentUserId) {
            if (status !== 'Active') {
                throw new Error('Anda tidak dapat mengubah status akun Anda sendiri menjadi tidak aktif.');
            }
            if (newRole !== currentRole) {
                throw new Error('Anda tidak dapat mengubah role Anda sendiri.');
            }
        }

        // Prevent demoting the last admin
        if (currentRole === 'admin' && newRole !== 'admin') {
            const adminCountRes = await client.query("SELECT COUNT(*) FROM members WHERE role = 'admin'");
            if (parseInt(adminCountRes.rows[0].count, 10) <= 1) {
                throw new Error('Tidak dapat mengubah role admin terakhir. Harus ada minimal satu admin.');
            }
        }

        const query = `
            UPDATE members 
            SET 
                name = $1, 
                phone = $2, 
                company_id = $3, 
                position_id = $4, 
                status = $5,
                role = $6,
                updated_at = NOW()
            WHERE id = $7
            RETURNING id, name, email, role, status;
        `;
        const values = [
            name,
            phone || null,
            company_id || null,
            position_id || null,
            status,
            newRole,
            targetUserId
        ];

        const result = await client.query(query, values);
        
        await client.query('COMMIT');
        res.json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating user:', err.message);
        const isClientError = err.message.includes('Anda tidak dapat') || err.message.includes('admin terakhir') || err.message.includes('Pengguna tidak ditemukan');
        res.status(isClientError ? 403 : 500).json({ error: err.message || 'Gagal memperbarui data pengguna.' });
    } finally {
        client.release();
    }
};

const deleteUser = async (req, res) => { // NOSONAR
    const { id: targetUserId } = req.params;
    const { id: currentUserId } = req.user;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Prevent self-deletion
        if (parseInt(targetUserId, 10) === currentUserId) {
            throw new Error('Anda tidak dapat menghapus akun Anda sendiri.');
        }

        // Check if the user exists and get their role
        const userRes = await client.query('SELECT role FROM members WHERE id = $1', [targetUserId]);
        if (userRes.rows.length === 0) {
            throw new Error('Pengguna tidak ditemukan.');
        }
        
        // Prevent deleting the last admin
        if (userRes.rows[0].role === 'admin') {
            const adminCountRes = await client.query("SELECT COUNT(*) FROM members WHERE role = 'admin'");
            if (parseInt(adminCountRes.rows[0].count, 10) <= 1) {
                throw new Error('Tidak dapat menghapus admin terakhir. Harus ada minimal satu admin.');
            }
        }

        // Prevent deleting users with financial history. Suggest deactivation instead.
        const savingsCheck = await client.query('SELECT id FROM savings WHERE member_id = $1 LIMIT 1', [targetUserId]);
        if (savingsCheck.rows.length > 0) throw new Error('Tidak dapat menghapus pengguna yang memiliki riwayat simpanan. Ubah status menjadi "Inactive".');
        const loansCheck = await client.query('SELECT id FROM loans WHERE member_id = $1 LIMIT 1', [targetUserId]);
        if (loansCheck.rows.length > 0) throw new Error('Tidak dapat menghapus pengguna yang memiliki riwayat pinjaman. Ubah status menjadi "Inactive".');

        await client.query('DELETE FROM members WHERE id = $1', [targetUserId]);
        
        await client.query('COMMIT');
        res.status(204).send();
    } catch (err) { await client.query('ROLLBACK'); console.error('Error deleting user:', err.message); res.status(400).json({ error: err.message }); } finally { client.release(); }
};

/**
 * @desc    Get all announcements
 * @route   GET /api/admin/announcements
 * @access  Private (Admin)
 */
const getAnnouncements = async (req, res) => { // NOSONAR
    try {
        const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching announcements:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

/**
 * @desc    Get a single announcement by ID
 * @route   GET /api/admin/announcements/:id
 * @access  Private (Admin)
 */
const getAnnouncementById = async (req, res) => { // NOSONAR
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching announcement by id [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

/**
 * @desc    Create a new announcement
 * @route   POST /api/admin/announcements
 * @access  Private (Admin)
 */
const createAnnouncement = async (req, res) => { // NOSONAR
    const { title, content, is_published } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Judul dan isi pengumuman wajib diisi.' });
    }
    try {
        // Validasi tambahan
        if (typeof title !== 'string' || typeof content !== 'string') {
            return res.status(400).json({ error: 'Format data tidak valid.' });
        }

        const query = `
            INSERT INTO announcements (title, content, is_published)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await pool.query(query, [title, content, is_published === 'true' || is_published === true]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating announcement:', err.message);
        res.status(500).json({ error: 'Gagal membuat pengumuman baru.' });
    }
};

/**
 * @desc    Update an announcement
 * @route   PUT /api/admin/announcements/:id
 * @access  Private (Admin)
 */
const updateAnnouncement = async (req, res) => { // NOSONAR
    const { id } = req.params;
    const { title, content, is_published } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Judul dan isi pengumuman wajib diisi.' });
    }
    try {
        const query = `
            UPDATE announcements
            SET title = $1, content = $2, is_published = $3, updated_at = NOW()
            WHERE id = $4 RETURNING *;
        `;
        const result = await pool.query(query, [title, content, is_published === 'true' || is_published === true, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating announcement [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal memperbarui pengumuman.' });
    }
};

/**
 * @desc    Delete an announcement
 * @route   DELETE /api/admin/announcements/:id
 * @access  Private (Admin)
 */
const deleteAnnouncement = async (req, res) => { // NOSONAR
    const { id } = req.params;
    try {
        const deleteOp = await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting announcement [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal menghapus pengumuman.' });
    }
};

/**
 * @desc    Get all items for a specific sale order
 * @route   GET /api/admin/sales/:orderId/items
 * @access  Private (Accounting)
 */
const getSaleItemsByOrderId = async (req, res) => { // NOSONAR
    const { orderId } = req.params;
    try {
        const saleRes = await pool.query('SELECT id FROM sales WHERE order_id = $1', [orderId]);
        if (saleRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
        }
        const saleId = saleRes.rows[0].id;

        const itemsRes = await pool.query(`
            SELECT 
                si.quantity, 
                si.price, 
                si.subtotal,
                p.name as product_name 
            FROM sale_items si 
            JOIN products p ON si.product_id = p.id 
            WHERE si.sale_id = $1
        `, [saleId]);

        res.json(itemsRes.rows);
    } catch (err) {
        console.error(`Error fetching sale items for order ${orderId}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil detail barang pesanan.' });
    }
};

/**
 * @desc    Get full details of a specific sale order for cashier verification
 * @route   GET /api/admin/sales/order/:orderId
 * @access  Private (Accounting)
 */
const getSaleDetailsByOrderId = async (req, res) => { // NOSONAR
    const { orderId } = req.params;
    const client = await pool.connect();
    try {
        const saleHeaderRes = await client.query(`
            SELECT 
                s.id, 
                s.order_id, 
                s.sale_date, 
                s.total_amount, 
                m.id as member_id, 
                m.name as member_name, 
                m.cooperative_number
            FROM sales s
            LEFT JOIN members m ON s.member_id = m.id
            WHERE s.order_id = $1
        `, [orderId]);

        if (saleHeaderRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
        }
        const header = saleHeaderRes.rows[0];

        const saleItemsRes = await client.query(`
            SELECT si.quantity, si.price, p.name 
            FROM sale_items si 
            JOIN products p ON si.product_id = p.id 
            WHERE si.sale_id = $1
        `, [header.id]);

        const responseData = {
            orderId: header.order_id,
            user: header.member_id ? { id: header.member_id, name: header.member_name, coopNumber: header.cooperative_number } : { id: null, name: 'Pelanggan Tunai', coopNumber: null },
            items: saleItemsRes.rows,
            total: parseFloat(header.total_amount),
            timestamp: header.sale_date
        };

        res.json(responseData);
    } catch (err) {
        console.error(`Error fetching sale details for admin on order ${orderId}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil detail pesanan.' });
    } finally {
        client.release();
    }
};

module.exports = {
    getAllPermissions,
    getRolePermissions,
    updateRolePermissions,
    getCompanyInfo, // Menggunakan fungsi lokal
    getPaymentMethods,
    mapPaymentMethodAccount,
    updateCompanyInfo, // Menggunakan fungsi lokal
    getAccounts: require('./account.controller').getAccounts, // Menggunakan require langsung
    getAllProductsForDropdown,
    createManualSaving,
    getPendingResignations,
    processResignation,
    // Account Type CRUD
    getAccountTypes: accountTypeController.getAccountTypes,
    createAccountType: accountTypeController.createAccountType,
    updateAccountType: accountTypeController.updateAccountType,
    deleteAccountType: accountTypeController.deleteAccountType
};