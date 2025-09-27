const pool = require('../../db');
const bcrypt = require('bcryptjs');
const { createNotification } = require('../utils/notification.util');
const path = require('path');
const fs = require('fs');

/**
 * @desc    Mendapatkan statistik dasbor untuk anggota yang sedang login.
 * @route   GET /api/member/stats
 * @access  Private
 */
const getMemberStats = async (req, res) => {
    const memberId = req.user.id;

    try {
        // Performance: Combine multiple statistic queries into a single database round-trip using subqueries.
        const statsQuery = `
            SELECT
                (
                    SELECT COALESCE(SUM(amount), 0)
                    FROM savings
                    WHERE member_id = $1 AND status = 'Approved'
                ) AS total_savings,
                (
                    SELECT COALESCE(SUM(remaining_principal), 0)
                    FROM loans
                    WHERE member_id = $1 AND status = 'Approved'
                ) AS active_loan,
                (
                    SELECT COALESCE(SUM(total_shu_amount), 0)
                    FROM shu_distributions sd
                    WHERE sd.member_id = $1 AND sd.year = (
                        -- Subquery to find the most recent year a member received SHU
                        SELECT MAX(year) FROM shu_distributions WHERE member_id = $1
                    )
                ) AS last_shu;
        `;
        const statsResult = await pool.query(statsQuery, [memberId]);
        const stats = statsResult.rows[0];

        const totalSavings = parseFloat(stats.total_savings);

        // Business Logic: Max loan amount is 1.5x total savings.
        const maxLoanAmount = totalSavings * 1.5;

        res.json({
            totalSavings,
            activeLoan: parseFloat(stats.active_loan),
            lastSHU: parseFloat(stats.last_shu),
            maxLoanAmount
        });

    } catch (err) {
        console.error('Error fetching member stats:', err.message);
        res.status(500).json({ error: 'Gagal mengambil statistik anggota.' });
    }
};

/**
 * @desc    Mendapatkan detail profil untuk anggota yang sedang login.
 * @route   GET /api/member/profile
 * @access  Private
 */
const getMemberProfile = async (req, res) => {
    const memberId = req.user.id;

    try {
        const query = `
            SELECT
                m.id,
                m.name,
                m.email,
                m.cooperative_number,
                m.ktp_number,
                m.phone,
                m.address_province,
                m.address_city,
                m.address_district,
                m.address_village,
                m.address_detail,
                m.heir_name,
                m.heir_kk_number,
                m.heir_relationship,
                m.heir_phone,
                m.approval_date,
                m.status,
                m.selfie_photo_path,
                c.name AS company_name,
                p.name AS position_name
            FROM members m
            LEFT JOIN companies c ON m.company_id = c.id
            LEFT JOIN positions p ON m.position_id = p.id
            WHERE m.id = $1
        `;
        const result = await pool.query(query, [memberId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profil anggota tidak ditemukan.' });
        }

        res.json(result.rows[0]);

    } catch (err) {
        console.error('Error fetching member profile:', err.message);
        res.status(500).json({ error: 'Gagal mengambil profil anggota.' });
    }
};

/**
 * @desc    Mendapatkan riwayat simpanan untuk anggota yang sedang login.
 * @route   GET /api/member/savings
 * @access  Private
 */
const getMemberSavings = async (req, res) => {
    const memberId = req.user.id;

    try {
        const query = `
            SELECT 
                s.id, 
                s.saving_type_id,
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
        console.error('Error fetching member savings:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat simpanan.' });
    }
};

/**
 * @desc    Mendapatkan riwayat pinjaman untuk anggota yang sedang login.
 * @route   GET /api/member/loans
 * @access  Private
 */
const getMemberLoans = async (req, res) => {
    const memberId = req.user.id;

    try {
        const query = `
            SELECT 
                l.id,
                l.amount,
                l.date,
                l.status,
                l.remaining_principal AS "remainingPrincipal",
                lt.tenor_months AS "tenorMonths"
            FROM loans l
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            WHERE l.member_id = $1
            ORDER BY l.date DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching member loans:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat pinjaman.' });
    }
};

/**
 * @desc    Mendapatkan daftar pengajuan (simpanan/pinjaman) yang sedang diproses untuk anggota.
 * @route   GET /api/member/applications
 * @access  Private
 */
const getMemberApplications = async (req, res) => {
    const memberId = req.user.id;

    try {
        // Query ini menggabungkan data dari tabel savings dan loans yang statusnya 'Pending'
        const query = `
            SELECT 
                id,
                'Simpanan' AS type,
                amount,
                date,
                status
            FROM savings
            WHERE member_id = $1 AND status = 'Pending'
            
            UNION ALL
            
            SELECT 
                id,
                'Pinjaman' AS type,
                amount,
                date,
                status
            FROM loans
            WHERE member_id = $1 AND status = 'Pending'
            
            ORDER BY date DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching member applications:', err.message);
        res.status(500).json({ error: 'Gagal mengambil daftar pengajuan.' });
    }
};

/**
 * @desc    Membuat pengajuan pinjaman baru untuk anggota yang sedang login.
 * @route   POST /api/member/loans
 * @access  Private
 */
const createLoanApplication = async (req, res) => {
    const memberId = req.user.id;
    const { loan_term_id, amount, bank_name, bank_account_number } = req.body;

    if (!loan_term_id || !amount || parseFloat(amount) <= 0 || !bank_name || !bank_account_number) {
        return res.status(400).json({ error: 'Produk pinjaman, jumlah, dan informasi rekening bank harus diisi dengan benar.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check for existing active or pending loans to prevent duplicate applications.
        const existingLoanCheck = await client.query(
            "SELECT id, status FROM loans WHERE member_id = $1 AND status IN ('Pending', 'Approved by Accounting', 'Approved')",
            [memberId]
        );
        if (existingLoanCheck.rows.length > 0) {
            const existingStatus = existingLoanCheck.rows[0].status;
            if (existingStatus === 'Approved') {
                throw new Error('Anda masih memiliki pinjaman aktif. Lunasi pinjaman sebelumnya untuk mengajukan yang baru.');
            } else {
                throw new Error('Anda sudah memiliki pengajuan pinjaman yang sedang diproses.');
            }
        }

        // 2. Check loan ceiling based on total savings.
        const savingsResult = await client.query(
            "SELECT COALESCE(SUM(amount), 0) AS total_savings FROM savings WHERE member_id = $1 AND status = 'Approved'",
            [memberId]
        );
        const totalSavings = parseFloat(savingsResult.rows[0].total_savings);
        const maxLoanAmount = totalSavings * 1.5;

        if (parseFloat(amount) > maxLoanAmount) {
            throw new Error(`Jumlah pinjaman melebihi plafon maksimal Anda (${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(maxLoanAmount)}).`);
        }

        // 3. Get loan_type_id from loan_term_id.
        const termResult = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loan_term_id]);
        if (termResult.rows.length === 0) {
            throw new Error('Produk pinjaman tidak ditemukan.');
        }
        const loan_type_id = termResult.rows[0].loan_type_id;

        // 4. Insert new loan application.
        const insertQuery = `
            INSERT INTO loans (member_id, loan_type_id, loan_term_id, amount, date, status, remaining_principal, bank_name, bank_account_number)
            VALUES ($1, $2, $3, $4, NOW(), 'Pending', $5, $6, $7)
            RETURNING *
        `;
        const newLoanResult = await client.query(insertQuery, [memberId, loan_type_id, loan_term_id, amount, amount, bank_name, bank_account_number]);
        const newLoan = newLoanResult.rows[0];

        // 5. Notify admins and accountants about the new application.
        const memberName = (await client.query('SELECT name FROM members WHERE id = $1', [memberId])).rows[0].name;
        const approverRoles = ['admin', 'akunting'];
        const approversRes = await client.query('SELECT id FROM members WHERE role = ANY($1::varchar[]) AND status = \'Active\'', [approverRoles]);
        
        const notificationMessage = `Pengajuan pinjaman baru dari ${memberName} sebesar ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount)} menunggu persetujuan.`;
        const notificationLink = 'approvals'; // Link to approvals page in admin panel

        for (const approver of approversRes.rows) {
            // Fire-and-forget notification creation.
            createNotification(approver.id, notificationMessage, notificationLink)
                .catch(err => console.error(`Failed to create notification for user ${approver.id}:`, err));
        }

        await client.query('COMMIT');
        res.status(201).json(newLoan);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating loan application:', err.message);
        
        // Check if the error is a business logic violation we threw, and send a 400 status.
        const isClientError = err.message.includes('pinjaman aktif') || 
                              err.message.includes('sedang diproses') || 
                              err.message.includes('melebihi plafon') || 
                              err.message.includes('tidak ditemukan') ||
                              err.message.includes('rekening bank');
                              
        res.status(isClientError ? 400 : 500).json({ error: err.message || 'Gagal membuat pengajuan pinjaman.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Membatalkan pengajuan pinjaman oleh anggota.
 * @route   DELETE /api/member/loans/:id/cancel
 * @access  Private
 */
const cancelLoanApplication = async (req, res) => {
    const { id: loanId } = req.params;
    const { id: memberId } = req.user;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Ambil pinjaman dan pastikan milik anggota yang benar & statusnya 'Pending'
        const loanRes = await client.query(
            "SELECT status, amount, member_id FROM loans WHERE id = $1 AND member_id = $2 FOR UPDATE",
            [loanId, memberId]
        );

        if (loanRes.rows.length === 0) {
            throw new Error('Pengajuan pinjaman tidak ditemukan atau Anda tidak berhak membatalkannya.');
        }

        const loan = loanRes.rows[0];
        if (loan.status !== 'Pending') {
            throw new Error(`Pengajuan tidak dapat dibatalkan karena statusnya sudah "${loan.status}".`);
        }

        // 2. Hapus pengajuan pinjaman
        await client.query('DELETE FROM loans WHERE id = $1', [loanId]);

        // 3. (Opsional) Kirim notifikasi ke admin bahwa pengajuan dibatalkan
        const memberName = (await client.query('SELECT name FROM members WHERE id = $1', [memberId])).rows[0].name;
        const notificationMessage = `Pengajuan pinjaman dari ${memberName} telah dibatalkan oleh yang bersangkutan.`;
        const approversRes = await client.query("SELECT id FROM members WHERE role = ANY($1::varchar[]) AND status = 'Active'", [['admin', 'akunting']]);
        for (const approver of approversRes.rows) {
            createNotification(approver.id, notificationMessage, 'approvals').catch(err => console.error(`Gagal membuat notifikasi pembatalan untuk user ${approver.id}:`, err));
        }

        await client.query('COMMIT');
        res.json({ message: 'Pengajuan pinjaman berhasil dibatalkan.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cancelling loan application:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membatalkan pengajuan pinjaman.' });
    } finally {
        client.release();
    }
};

const getVoluntarySavingsBalance = async (req, res) => {
    const memberId = req.user.id;
    try {
        // Query ini menghitung total setoran 'Simpanan Sukarela' dikurangi total 'Penarikan Simpanan Sukarela'
        // yang statusnya sudah 'Approved'.
        const query = `
            SELECT 
                COALESCE(SUM(CASE WHEN st.name = 'Simpanan Sukarela' THEN s.amount ELSE 0 END), 0) - 
                COALESCE(SUM(CASE WHEN st.name = 'Penarikan Simpanan Sukarela' THEN s.amount ELSE 0 END), 0) as "availableBalance"
            FROM savings s
            JOIN saving_types st ON s.saving_type_id = st.id
            WHERE s.member_id = $1 AND s.status = 'Approved'
              AND st.name IN ('Simpanan Sukarela', 'Penarikan Simpanan Sukarela');
        `;
        const result = await pool.query(query, [memberId]);
        res.json({ availableBalance: parseFloat(result.rows[0].availableBalance) });
    } catch (err) {
        console.error('Error fetching voluntary savings balance:', err.message);
        res.status(500).json({ error: 'Gagal mengambil saldo simpanan sukarela.' });
    }
};

const createWithdrawalApplication = async (req, res) => {
    const memberId = req.user.id;
    const { amount, description } = req.body;

    if (!amount || parseFloat(amount) <= 0 || !description?.trim()) {
        return res.status(400).json({ error: 'Jumlah dan keterangan penarikan wajib diisi.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get available balance
        const balanceQuery = `SELECT COALESCE(SUM(CASE WHEN st.name = 'Simpanan Sukarela' THEN s.amount ELSE -s.amount END), 0) as "balance" FROM savings s JOIN saving_types st ON s.saving_type_id = st.id WHERE s.member_id = $1 AND s.status = 'Approved' AND st.name IN ('Simpanan Sukarela', 'Penarikan Simpanan Sukarela')`;
        const balanceRes = await client.query(balanceQuery, [memberId]);
        const availableBalance = parseFloat(balanceRes.rows[0].balance);

        if (parseFloat(amount) > availableBalance) {
            throw new Error('Jumlah penarikan melebihi saldo simpanan sukarela Anda yang tersedia.');
        }

        // 2. Get saving type ID for withdrawal
        const typeRes = await client.query("SELECT id FROM saving_types WHERE name = 'Penarikan Simpanan Sukarela'");
        if (typeRes.rows.length === 0) throw new Error('Tipe transaksi penarikan tidak ditemukan di sistem.');
        const withdrawalTypeId = typeRes.rows[0].id;

        // 3. Insert into savings table with 'Pending' status
        const insertQuery = `INSERT INTO savings (member_id, saving_type_id, amount, description, status) VALUES ($1, $2, $3, $4, 'Pending') RETURNING *`;
        const newWithdrawal = await client.query(insertQuery, [memberId, withdrawalTypeId, amount, description]);

        // 4. Notify admins (logic can be added here if needed)

        await client.query('COMMIT');
        res.status(201).json(newWithdrawal.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating withdrawal application:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mengajukan penarikan.' });
    } finally {
        client.release();
    }
};

const _getInstallmentDetails = (loan, installmentNumber) => {
    const principal = parseFloat(loan.amount);
    const tenor = parseInt(loan.tenor_months, 10);
    const monthlyInterestRate = parseFloat(loan.interest_rate) / 100;

    if (tenor <= 0) {
        return { principalComponent: 0, interestComponent: 0, total: 0 };
    }

    const principalComponent = principal / tenor;
    const remainingPrincipal = principal - ((installmentNumber - 1) * principalComponent);
    const interestComponent = remainingPrincipal * monthlyInterestRate;
    const total = principalComponent + interestComponent;

    return { principalComponent, interestComponent, total };
};

const getActiveLoanForPayment = async (req, res) => {
    const memberId = req.user.id;
    try {
        const loanRes = await pool.query( // Periksa semua pinjaman yang belum lunas
            `SELECT l.id, l.amount, l.remaining_principal, lt.tenor_months, lt.interest_rate
             FROM loans l
             JOIN loan_terms lt ON l.loan_term_id = lt.id
             WHERE l.member_id = $1 AND l.status != 'Lunas' AND l.status != 'Rejected'`,
            [memberId]
        );

        if (loanRes.rows.length === 0) {
            return res.json(null); // Kembalikan null jika tidak ada pinjaman aktif
        }
        const loan = loanRes.rows[0];

        // Jika statusnya belum 'Approved', berarti masih pending. Kembalikan null agar frontend tahu.
        if (loan.status !== 'Approved') {
            return res.json(null);
        }

        // Cari angsuran berikutnya yang harus dibayar
        const lastPaymentRes = await pool.query(
            "SELECT MAX(installment_number) as last_paid FROM loan_payments WHERE loan_id = $1 AND status = 'Approved'",
            [loan.id]
        );
        const nextInstallmentNumber = (lastPaymentRes.rows[0].last_paid || 0) + 1;

        if (nextInstallmentNumber > parseInt(loan.tenor_months, 10)) {
            return res.json(null); // Pinjaman sudah lunas
        }

        // Hitung jumlah untuk angsuran berikutnya
        const { total: nextInstallmentAmount } = _getInstallmentDetails(loan, nextInstallmentNumber);

        res.json({
            loanId: loan.id,
            remainingPrincipal: loan.remaining_principal,
            nextInstallment: {
                number: nextInstallmentNumber,
                amount: nextInstallmentAmount
            }
        });

    } catch (err) {
        console.error('Error fetching active loan for payment:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pinjaman aktif.' });
    }
};

const submitLoanPayment = async (req, res) => {
    const memberId = req.user.id;
    const { loanId, installmentNumber } = req.body;
    const proofFile = req.file;

    if (!loanId || !installmentNumber || !proofFile) {
        return res.status(400).json({ error: 'Data pembayaran tidak lengkap.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const loanRes = await client.query("SELECT l.id, l.amount, lt.tenor_months, lt.interest_rate FROM loans l JOIN loan_terms lt ON l.loan_term_id = lt.id WHERE l.id = $1 AND l.member_id = $2 AND l.status = 'Approved' FOR UPDATE", [loanId, memberId]);
        if (loanRes.rows.length === 0) throw new Error('Pinjaman aktif tidak ditemukan.');
        
        const pendingPaymentCheck = await client.query("SELECT id FROM loan_payments WHERE loan_id = $1 AND installment_number = $2 AND status = 'Pending'", [loanId, installmentNumber]);
        if (pendingPaymentCheck.rows.length > 0) throw new Error(`Pembayaran untuk angsuran ke-${installmentNumber} sudah pernah diajukan dan sedang menunggu verifikasi.`);

        const { total: amountToPay } = _getInstallmentDetails(loanRes.rows[0], parseInt(installmentNumber, 10));
        const proofPath = proofFile.path.replace(/\\/g, '/');

        await client.query(`INSERT INTO loan_payments (loan_id, payment_date, amount_paid, installment_number, status, proof_path, payment_method) VALUES ($1, NOW(), $2, $3, 'Pending', $4, 'Transfer')`, [loanId, amountToPay, installmentNumber, proofPath]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Bukti pembayaran berhasil dikirim.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error submitting loan payment:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mengirim bukti pembayaran.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Membuat pengajuan simpanan sukarela baru untuk anggota yang sedang login.
 * @route   POST /api/member/savings
 * @access  Private
 */
const createSavingApplication = async (req, res) => {
    const memberId = req.user.id;
    const { amount, description } = req.body; // Diambil dari FormData
    const proofPhoto = req.file; // Diambil dari middleware multer

    if (!amount || parseFloat(amount) <= 0 || !description?.trim()) {
        return res.status(400).json({ error: 'Jumlah setoran dan keterangan wajib diisi.' });
    }

    // Dapatkan path file jika ada
    const proofPath = proofPhoto ? proofPhoto.path.replace(/\\/g, '/') : null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Maintainability Improvement: Avoid using "magic strings" like 'Simpanan Sukarela'.
        // If the name changes in the database, this code would break. It's better to use a
        // more stable identifier, like an ID stored in an environment variable.
        const VOLUNTARY_SAVING_TYPE_NAME = 'Simpanan Sukarela';
        const savingTypeResult = await client.query("SELECT id FROM saving_types WHERE name = $1 LIMIT 1", [VOLUNTARY_SAVING_TYPE_NAME]);
        if (savingTypeResult.rows.length === 0) {
            // This is a server configuration issue, not a client error.
            throw new Error(`Konfigurasi sistem: Tipe simpanan "${VOLUNTARY_SAVING_TYPE_NAME}" tidak ditemukan.`);
        }
        const savingTypeId = savingTypeResult.rows[0].id;

        const insertQuery = `
            INSERT INTO savings (member_id, saving_type_id, amount, date, status, description, proof_path)
            VALUES ($1, $2, $3, NOW(), 'Pending', $4, $5)
            RETURNING *
        `;
        const newSavingResult = await client.query(insertQuery, [memberId, savingTypeId, amount, description, proofPath]);
        const newSaving = newSavingResult.rows[0];

        // Notify admins and accountants
        const memberName = (await client.query('SELECT name FROM members WHERE id = $1', [memberId])).rows[0].name;
        const approverRoles = ['admin', 'akunting'];
        const approversRes = await client.query('SELECT id FROM members WHERE role = ANY($1::varchar[]) AND status = \'Active\'', [approverRoles]);
        
        const notificationMessage = `Pengajuan simpanan sukarela dari ${memberName} sebesar ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount)} menunggu persetujuan.`;
        const notificationLink = 'approvals'; // Link to approvals page in admin panel

        for (const approver of approversRes.rows) {
            createNotification(approver.id, notificationMessage, notificationLink)
                .catch(err => console.error(`Failed to create notification for user ${approver.id}:`, err));
        }

        await client.query('COMMIT');
        res.status(201).json(newSaving);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating saving application:', err.message);
        res.status(err.message.includes('Konfigurasi sistem') ? 400 : 500).json({ error: err.message || 'Gagal membuat pengajuan simpanan.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Mendapatkan detail pinjaman beserta jadwal angsuran.
 * @route   GET /api/member/loans/:id/details
 * @access  Private
 */
const getLoanDetails = async (req, res) => {
    const memberId = req.user.id;
    const { id: loanId } = req.params;

    try {
        // 1. Ambil data pinjaman utama dan pastikan pinjaman milik anggota yang login
        const loanQuery = `
            SELECT 
                l.id,
                l.amount,
                l.date AS start_date,
                l.status,
                lt.tenor_months,
                lt.interest_rate
            FROM loans l
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            WHERE l.id = $1 AND l.member_id = $2
        `;
        const loanResult = await pool.query(loanQuery, [loanId, memberId]);

        if (loanResult.rows.length === 0) {
            // Security: Crucial check to prevent users from accessing other users' loans.
            return res.status(404).json({ error: 'Pinjaman tidak ditemukan atau Anda tidak berhak mengaksesnya.' });
        }
        const loan = loanResult.rows[0];
        const principal = parseFloat(loan.amount);
        const tenor = parseInt(loan.tenor_months);
        const monthlyInterestRate = parseFloat(loan.interest_rate) / 100;

        // 2. Ambil data pembayaran yang sudah dilakukan untuk pinjaman ini
        const paymentsQuery = 'SELECT installment_number, payment_date, amount_paid FROM loan_payments WHERE loan_id = $1';
        const paymentsResult = await pool.query(paymentsQuery, [loanId]);
        const paymentsMap = new Map(paymentsResult.rows.map(p => [p.installment_number, p]));

        // 3. Buat jadwal angsuran (amortisasi)
        const installments = [];
        let remainingPrincipal = principal;
        const principalPerMonth = principal / tenor;

        for (let i = 1; i <= tenor; i++) {
            const interestForMonth = remainingPrincipal * monthlyInterestRate;
            const totalInstallment = principalPerMonth + interestForMonth;
            
            const dueDate = new Date(loan.start_date);
            dueDate.setMonth(dueDate.getMonth() + i);

            const payment = paymentsMap.get(i);

            installments.push({
                installmentNumber: i,
                dueDate: dueDate.toISOString(),
                amount: totalInstallment,
                paymentDate: payment ? payment.payment_date : null,
                status: payment ? 'Lunas' : 'Belum Lunas'
            });

            remainingPrincipal -= principalPerMonth;
        }
        
        const totalPaid = Array.from(paymentsMap.values()).reduce((sum, p) => sum + parseFloat(p.amount_paid), 0);
        const monthlyInstallmentFirst = principalPerMonth + (principal * monthlyInterestRate);

        res.json({
            summary: {
                id: loan.id,
                amount: principal,
                tenor: tenor,
                interestRate: loan.interest_rate,
                startDate: loan.start_date,
                status: loan.status,
                monthlyInstallment: monthlyInstallmentFirst, // Cicilan bulan pertama
                totalPaid: totalPaid
            },
            installments: installments
        });

    } catch (err) {
        console.error('Error fetching loan details:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail pinjaman.' });
    }
};

/**
 * @desc    Mendapatkan riwayat SHU untuk anggota yang sedang login.
 * @route   GET /api/member/shu-history
 * @access  Private
 */
const getMemberShuHistory = async (req, res) => {
    const memberId = req.user.id;

    try {
        const query = `
            SELECT 
                year,
                total_shu_amount,
                shu_from_capital,
                shu_from_services,
                distribution_date
            FROM shu_distributions
            WHERE member_id = $1
            ORDER BY year DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching member SHU history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat SHU.' });
    }
};

const getNotifications = async (req, res) => {
    const memberId = req.user.id;
    try {
        const query = `
            SELECT id, message, link, is_read, created_at
            FROM notifications
            WHERE member_id = $1
            ORDER BY created_at DESC
            LIMIT 10
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching notifications:', err.message);
        res.status(500).json({ error: 'Gagal mengambil notifikasi.' });
    }
};

const getUnreadNotificationCount = async (req, res) => {
    const memberId = req.user.id;
    try {
        const query = `SELECT COUNT(*) FROM notifications WHERE member_id = $1 AND is_read = FALSE`;
        const result = await pool.query(query, [memberId]);
        res.json({ count: parseInt(result.rows[0].count, 10) });
    } catch (err) {
        console.error('Error fetching unread notification count:', err.message);
        res.status(500).json({ error: 'Gagal mengambil jumlah notifikasi.' });
    }
};

const markNotificationAsRead = async (req, res) => {
    const memberId = req.user.id;
    const { id: notificationId } = req.params;
    try {
        const query = `
            UPDATE notifications
            SET is_read = TRUE
            WHERE id = $1 AND member_id = $2
            RETURNING id
        `;
        const result = await pool.query(query, [notificationId, memberId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Notifikasi tidak ditemukan atau Anda tidak berhak.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error marking notification as read:', err.message);
        res.status(500).json({ error: 'Gagal menandai notifikasi.' });
    }
};

/**
 * @desc    Membuat permintaan pengunduran diri untuk anggota yang sedang login.
 * @route   POST /api/member/request-resignation
 * @access  Private
 */
const createResignationRequest = async (req, res) => {
    const memberId = req.user.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Periksa apakah anggota masih memiliki pinjaman aktif
        const activeLoanCheck = await client.query(
            "SELECT id FROM loans WHERE member_id = $1 AND status = 'Approved'",
            [memberId]
        );

        if (activeLoanCheck.rows.length > 0) {
            throw new Error('Anda tidak dapat mengundurkan diri karena masih memiliki pinjaman yang aktif. Harap lunasi pinjaman Anda terlebih dahulu.');
        }

        // 2. Ubah status anggota menjadi 'Pending Resignation' dan catat waktu permintaan
        const updateResult = await client.query(
            "UPDATE members SET status = 'Pending Resignation', updated_at = NOW() WHERE id = $1 AND status = 'Active' RETURNING name",
            [memberId]
        );

        if (updateResult.rowCount === 0) {
            throw new Error('Gagal mengajukan pengunduran diri. Mungkin status Anda sudah tidak aktif.');
        }

        // 3. Buat notifikasi untuk semua admin
        const memberName = updateResult.rows[0].name;
        const adminsRes = await client.query("SELECT id FROM members WHERE role = 'admin' AND status = 'Active'");
        
        const notificationMessage = `Anggota "${memberName}" telah mengajukan pengunduran diri.`;
        // Arahkan admin ke halaman persetujuan, di mana tab pengunduran diri berada
        const notificationLink = 'approvals'; 

        for (const admin of adminsRes.rows) {
            createNotification(admin.id, notificationMessage, notificationLink)
                .catch(err => console.error(`Failed to create resignation notification for admin ${admin.id}:`, err));
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Permintaan pengunduran diri Anda telah berhasil diajukan dan akan segera diproses oleh admin.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating resignation request:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mengajukan pengunduran diri.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Membatalkan permintaan pengunduran diri untuk anggota yang sedang login.
 * @route   POST /api/member/cancel-resignation
 * @access  Private
 */
const cancelResignationRequest = async (req, res) => {
    const memberId = req.user.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch member and lock the row
        const memberRes = await client.query(
            "SELECT status, name FROM members WHERE id = $1 FOR UPDATE",
            [memberId]
        );

        if (memberRes.rows.length === 0) throw new Error('Anggota tidak ditemukan.');

        const { status: currentStatus, name: memberName } = memberRes.rows[0];

        // 2. Validate status
        if (currentStatus !== 'Pending Resignation') {
            throw new Error('Tidak ada permintaan pengunduran diri yang aktif untuk dibatalkan.');
        }

        // 3. Update status back to 'Active'
        await client.query(
            "UPDATE members SET status = 'Active', updated_at = NOW() WHERE id = $1",
            [memberId]
        );

        // 4. Notify admins that the request was cancelled (optional but good practice)
        const adminsRes = await client.query("SELECT id FROM members WHERE role = 'admin' AND status = 'Active'");
        const notificationMessage = `Permintaan pengunduran diri dari anggota "${memberName}" telah dibatalkan oleh yang bersangkutan.`;
        for (const admin of adminsRes.rows) {
            createNotification(admin.id, notificationMessage, 'approvals').catch(err => console.error(`Failed to create resignation cancellation notification for admin ${admin.id}:`, err));
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Permintaan pengunduran diri Anda telah berhasil dibatalkan.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cancelling resignation request:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membatalkan permintaan pengunduran diri.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get all permissions for the currently logged-in user's role.
 * @route   GET /api/member/permissions
 * @access  Private
 */
const getMyPermissions = async (req, res) => {
    // Performance Improvement: Permissions are already loaded into the JWT by auth.middleware.js.
    // There is no need to query the database again. We can directly return the permissions
    // from the req.user object. This reduces database load and improves response time.
    if (!req.user || !req.user.permissions) {
        return res.status(500).json({ error: 'Informasi hak akses tidak tersedia dalam sesi.' });
    }
    res.json(req.user.permissions);
};

/**
 * @desc    Change user's password
 * @route   PUT /api/member/change-password
 * @access  Private
 */
const changePassword = async (req, res) => {
    const { id: userId } = req.user;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // --- Validation ---
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Semua field wajib diisi.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Password baru dan konfirmasi tidak cocok.' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password baru harus memiliki minimal 8 karakter.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch current user's password hash
        const userRes = await client.query('SELECT password FROM members WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            throw new Error('Pengguna tidak ditemukan.');
        }
        const storedHash = userRes.rows[0].password;

        // 2. Compare current password with the stored hash
        const isMatch = await bcrypt.compare(currentPassword, storedHash);
        if (!isMatch) {
            throw new Error('Password saat ini salah.');
        }

        // 3. Hash the new password
        const salt = await bcrypt.genSalt(10);
        const newHashedPassword = await bcrypt.hash(newPassword, salt);

        // 4. Update the password in the database
        await client.query('UPDATE members SET password = $1 WHERE id = $2', [newHashedPassword, userId]);

        await client.query('COMMIT');
        res.json({ message: 'Password berhasil diubah.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error changing password:', err.message);
        const isClientError = err.message.includes('salah') || err.message.includes('tidak ditemukan');
        res.status(isClientError ? 400 : 500).json({ error: err.message || 'Gagal mengubah password.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Update member's profile photo
 * @route   PUT /api/member/profile/photo
 * @access  Private
 */
const updateProfilePhoto = async (req, res) => {
    const memberId = req.user.id;

    if (!req.file) {
        return res.status(400).json({ error: 'Tidak ada file foto yang diunggah.' });
    }

    const newPhotoPath = req.file.path;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get the old photo path to delete it later
        const oldPhotoRes = await client.query('SELECT selfie_photo_path FROM members WHERE id = $1', [memberId]);
        const oldPhotoPath = oldPhotoRes.rows[0]?.selfie_photo_path;

        // 2. Update the database with the new photo path
        const updateRes = await client.query(
            'UPDATE members SET selfie_photo_path = $1 WHERE id = $2 RETURNING selfie_photo_path',
            [newPhotoPath, memberId]
        );

        await client.query('COMMIT');

        // 3. Delete the old photo file from the server after the database is successfully updated
        if (oldPhotoPath) {
            // FIX: Construct the absolute path from the project's root directory.
            const fullOldPath = path.resolve(process.cwd(), oldPhotoPath.startsWith('/') ? oldPhotoPath.substring(1) : oldPhotoPath);
            fs.unlink(fullOldPath, (err) => {
                if (err) {
                    console.error(`Gagal menghapus file foto lama: ${fullOldPath}`, err);
                } else {
                    console.log(`File foto lama berhasil dihapus: ${fullOldPath}`);
                }
            });
        }

        res.json({
            message: 'Foto profil berhasil diperbarui.',
            newPhotoPath: updateRes.rows[0].selfie_photo_path
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating profile photo:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui foto profil.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Helper function to generate chart data for the last 12 months
 * @param   {string} table - The table to query ('savings', 'loans', 'sales')
 * @param   {string} amountColumn - The column to sum (e.g., 'amount', 'total_amount')
 * @param   {number} memberId - The ID of the member
 * @param   {string[]} statusFilter - Array of statuses to include (e.g., ['Approved'])
 * @returns {Promise<object[]>} - Array of objects with month and total
 */
const getMonthlyChartData = async (table, amountColumn, memberId, statusFilter = []) => {
    let statusClause = '';
    if (statusFilter.length > 0) {
        statusClause = `AND status IN (${statusFilter.map(s => `'${s}'`).join(', ')})`;
    }

    const query = `
        WITH months AS (
            SELECT generate_series(
                date_trunc('month', NOW() - INTERVAL '11 months'),
                date_trunc('month', NOW()),
                '1 month'::interval
            ) AS month
        )
        SELECT
            to_char(m.month, 'YYYY-MM') AS month,
            COALESCE(SUM(t.${amountColumn}), 0) AS total
        FROM months m
        LEFT JOIN ${table} t ON date_trunc('month', t.date) = m.month AND t.member_id = $1 ${statusClause}
        GROUP BY m.month
        ORDER BY m.month;
    `;
    // Note: 'date' column is assumed for loans and savings. For sales, it's 'sale_date'.
    // We'll adjust the query text if the table is 'sales'.
    const finalQuery = (table === 'sales') ? query.replace(/t\.date/g, 't.sale_date') : query;

    const result = await pool.query(finalQuery, [memberId]);
    return result.rows;
};

/**
 * @desc    Get savings data for chart
 * @route   GET /api/member/chart-data/savings
 * @access  Private
 */
const getSavingsChartData = async (req, res) => {
    try {
        const data = await getMonthlyChartData('savings', 'amount', req.user.id, ['Approved']);
        res.json(data);
    } catch (err) {
        console.error('Error fetching savings chart data:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data grafik simpanan.' });
    }
};

/**
 * @desc    Get loans data for chart
 * @route   GET /api/member/chart-data/loans
 * @access  Private
 */
const getLoansChartData = async (req, res) => {
    try {
        const data = await getMonthlyChartData('loans', 'amount', req.user.id, ['Approved']);
        res.json(data);
    } catch (err) {
        console.error('Error fetching loans chart data:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data grafik pinjaman.' });
    }
};

/**
 * @desc    Get shop transactions data for chart
 * @route   GET /api/member/chart-data/transactions
 * @access  Private
 */
const getTransactionsChartData = async (req, res) => {
    try {
        // The 'sales' table has 'sale_date' and 'total_amount'
        const data = await getMonthlyChartData('sales', 'total_amount', req.user.id, ['Selesai']);
        res.json(data);
    } catch (err) {
        console.error('Error fetching transactions chart data:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data grafik transaksi.' });
    }
};

/**
 * @desc    Get SHU history for chart
 * @route   GET /api/member/chart-data/shu
 * @access  Private
 */
const getShuChartData = async (req, res) => {
    try {
        const query = `
            SELECT year, total_shu_amount
            FROM shu_distributions
            WHERE member_id = $1
            ORDER BY year DESC
            LIMIT 5
        `;
        const result = await pool.query(query, [req.user.id]);
        // Reverse to show oldest to newest
        res.json(result.rows.reverse());
    } catch (err) {
        console.error('Error fetching SHU chart data:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data grafik SHU.' });
    }
};

/**
 * @desc    Get latest published announcements for members.
 * @route   GET /api/member/announcements
 * @access  Private
 */
const getAnnouncements = async (req, res) => {
    try {
        const query = `
            SELECT id, title, content, created_at
            FROM announcements
            WHERE is_published = TRUE
            ORDER BY created_at DESC
            LIMIT 5;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching announcements:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

/**
 * @desc    Get sales history for the logged-in member
 * @route   GET /api/member/sales
 * @access  Private
 */
const getMemberSalesHistory = async (req, res) => {
    const memberId = req.user.id;
    try {
        const query = `
            SELECT order_id, sale_date, total_amount, status
            FROM sales
            WHERE member_id = $1
            ORDER BY sale_date DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching member sales history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat transaksi.' });
    }
};

/**
 * @desc    Get details of a specific sale order for the logged-in member
 * @route   GET /api/member/sales/:orderId
 * @access  Private
 */
const getSaleDetailsByOrderIdForMember = async (req, res) => {
    const { orderId } = req.params;
    const memberId = req.user.id;
    const client = await pool.connect();
    try {
        const saleHeaderRes = await client.query(`
            SELECT s.id, s.order_id, s.sale_date, s.total_amount, m.id as member_id, m.name as member_name, m.cooperative_number
            FROM sales s
            JOIN members m ON s.member_id = m.id
            WHERE s.order_id = $1 AND s.member_id = $2
        `, [orderId, memberId]);

        if (saleHeaderRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pesanan tidak ditemukan atau Anda tidak berhak mengaksesnya.' });
        }
        const header = saleHeaderRes.rows[0];

        const saleItemsRes = await client.query(`SELECT si.quantity, si.price, p.name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = $1`, [header.id]);

        const responseData = { orderId: header.order_id, user: { id: header.member_id, name: header.member_name, coopNumber: header.cooperative_number }, items: saleItemsRes.rows, total: parseFloat(header.total_amount), timestamp: header.sale_date };

        res.json(responseData);
    } catch (err) {
        console.error(`Error fetching sale details for member on order ${orderId}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil detail pesanan.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Membatalkan pesanan penjualan (sale order) oleh admin atau anggota pemilik.
 * @route   POST /api/public/sales/:orderId/cancel
 * @access  Private (Admin, Akunting, atau pemilik pesanan)
 */
const cancelSaleOrder = async (req, res) => {
    const { orderId } = req.params;
    const { id: userId, role: userRole } = req.user; // Diambil dari token JWT

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Dapatkan detail pesanan
        const saleRes = await client.query(
            'SELECT id, member_id, status FROM sales WHERE order_id = $1 FOR UPDATE',
            [orderId]
        );

        if (saleRes.rows.length === 0) {
            throw new Error('Pesanan tidak ditemukan.');
        }

        const sale = saleRes.rows[0];

        // 2. Otorisasi: Hanya admin/akunting atau pemilik pesanan yang bisa membatalkan
        if (userRole !== 'admin' && userRole !== 'akunting' && sale.member_id !== userId) {
            throw new Error('Anda tidak memiliki izin untuk membatalkan pesanan ini.');
        }

        // 3. Cek apakah pesanan masih bisa dibatalkan
        if (sale.status !== 'Menunggu Pengambilan') {
            throw new Error(`Pesanan dengan status "${sale.status}" tidak dapat dibatalkan.`);
        }

        // 4. Dapatkan item yang dipesan untuk mengembalikan stok
        const itemsRes = await client.query('SELECT product_id, quantity FROM sale_items WHERE sale_id = $1', [sale.id]);
        for (const item of itemsRes.rows) {
            await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
        }
        await client.query("UPDATE sales SET status = 'Dibatalkan' WHERE id = $1", [sale.id]);
        if (sale.member_id) {
            const cancelledBy = (userRole === 'admin' || userRole === 'akunting') ? 'oleh Admin' : 'oleh Anda';
            await createNotification(sale.member_id, `Pesanan Anda #${orderId} telah dibatalkan ${cancelledBy}.`, 'transactions');
        }
        await client.query('COMMIT');
        res.json({ message: `Pesanan ${orderId} berhasil dibatalkan.` });
    } catch (err) { await client.query('ROLLBACK'); console.error('Error cancelling sale order:', err.message); res.status(400).json({ error: err.message || 'Gagal membatalkan pesanan.' }); } finally { client.release(); }
};

module.exports = {
    getMemberStats,
    getMemberProfile,
    getMemberSavings,
    getMemberLoans,
    getMemberApplications,
    createLoanApplication,
    createSavingApplication,
    cancelLoanApplication,
    getLoanDetails,
    getMemberShuHistory,
    getNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
    createResignationRequest,
    cancelResignationRequest,
    getMyPermissions,
    changePassword,
    updateProfilePhoto,
    getSavingsChartData,
    getLoansChartData,
    getTransactionsChartData,
    getShuChartData,
    getAnnouncements,
    getMemberSalesHistory,
    getSaleDetailsByOrderIdForMember,
    getVoluntarySavingsBalance,
    createWithdrawalApplication,
    getActiveLoanForPayment,
    submitLoanPayment,
    cancelSaleOrder,
};