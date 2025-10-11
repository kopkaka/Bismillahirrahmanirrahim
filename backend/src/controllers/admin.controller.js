const pool = require('../../db');
const fs = require('fs');
const path = require('path');
const { createNotification } = require('../utils/notification.util');
const { getApprovalCounts } = require('./approval.controller');
const dashboardService = require('../services/dashboard.service');
const accountTypeController = require('./accounttype.controller');

const getDashboardStats = async (req, res) => {
    try {
        // Performance: Combine multiple queries into a single database round-trip using subqueries.
        const statsQuery = `
            SELECT
                (SELECT COUNT(*) FROM members WHERE status = 'Active' AND role = 'member') AS total_members,
                (SELECT COALESCE(SUM(CASE 
                                        WHEN st.name = 'Penarikan Simpanan Sukarela' THEN -s.amount 
                                        ELSE s.amount 
                                    END), 0) 
                 FROM savings s JOIN saving_types st ON s.saving_type_id = st.id WHERE s.status = 'Approved') AS total_savings,
                (SELECT COALESCE(SUM(remaining_principal), 0) FROM loans WHERE status = 'Approved') AS total_active_loans,
                (SELECT COUNT(*) FROM members WHERE status = 'Pending') AS pending_members
        `;
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];

        res.json({
            totalMembers: parseInt(stats.total_members, 10),
            totalSavings: parseFloat(stats.total_savings),
            totalActiveLoans: parseFloat(stats.total_active_loans),
            pendingMembers: parseInt(stats.pending_members, 10),
        });
    } catch (err) {
        console.error('Error fetching dashboard stats:', err.message);
        res.status(500).json({ error: 'Gagal mengambil statistik dasbor.' });
    }
};

const getCashFlowSummary = async (req, res) => {
    try {
        const data = await dashboardService.getCashFlowSummary(req.query.startDate, req.query.endDate);
        res.json(data);
    } catch (err) {
        console.error('Error fetching cash flow summary:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan arus kas.' });
    }
};
const getMemberGrowth = async (req, res) => {
    try {
        const data = await dashboardService.getMemberGrowth();
        res.json(data);
    } catch (err) {
        console.error('Error fetching member growth data:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pertumbuhan anggota.' });
    }
};
const getIncomeStatementSummary = async (req, res) => {
    try {
        const processedData = await dashboardService.getIncomeStatementSummary(req.query.year);
        res.json(processedData);
    } catch (err) {
        console.error('Error fetching income statement summary:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan laba rugi.' });
    }
};

// Helper function to handle side effects of final loan approval
const handleFinalLoanApproval = async (client, loanDetails) => {
    const { id: loanId, member_id, amount, loan_type_name, member_name, account_id } = loanDetails;

    if (!account_id) {
        throw new Error(`Tipe pinjaman "${loan_type_name}" belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.`);
    }

    // Improvement: Fetch cash account ID dynamically instead of hardcoding
    const cashAccountRes = await client.query("SELECT id FROM chart_of_accounts WHERE account_number = '1-1110'"); // Assuming '1-1110' is Kas
    if (cashAccountRes.rows.length === 0) throw new Error("Akun 'Kas' (1-1110) tidak ditemukan di COA.");
    const cashAccountId = cashAccountRes.rows[0].id;

    const description = `Pencairan pinjaman ${loan_type_name} a/n ${member_name}`;

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

    const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
    await client.query(journalEntriesQuery, [journalId, account_id, amount, cashAccountId]);

    createNotification(
        member_id,
        `Selamat! Pinjaman Anda sebesar ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount)} telah disetujui dan dicairkan.`,
        'loans'
    );
};

const getPendingLoansForAdmin = async (req, res) => {
    try {
        // Query ini mengambil semua pinjaman dengan status yang memerlukan tindakan,
        // dan menggabungkannya dengan informasi anggota dan tipe pinjaman.
        const query = `
            SELECT 
                l.id,
                l.amount,
                l.date,
                l.status,
                l.bank_name,
                l.bank_account_number,
                l.member_id,
                m.name AS "memberName",
                m.cooperative_number AS "cooperativeNumber",
                lt.tenor_months AS "tenorMonths",
                ltp.name AS "loanTypeName"
            FROM loans l
            JOIN members m ON l.member_id = m.id
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            JOIN loan_types ltp ON lt.loan_type_id = ltp.id
            WHERE l.status IN ('Pending', 'Approved by Accounting')
            ORDER BY l.date ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending loans for admin:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengajuan pinjaman.' });
    }
};

const getPendingLoans = async (req, res) => {
    // This function is now an alias for the new, more descriptive function.
    // This ensures backward compatibility if it's called elsewhere.
    return getPendingLoansForAdmin(req, res);
};

const getPendingLoanPayments = async (req, res) => {
    try {
        const query = `
            SELECT 
                lp.id,
                lp.loan_id,
                lp.installment_number,
                lp.amount_paid,
                lp.payment_date,
                lp.proof_path,
                m.name as member_name
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.id
            JOIN members m ON l.member_id = m.id
            WHERE lp.status = 'Pending'
            ORDER BY lp.payment_date ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending loan payments:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pembayaran angsuran.' });
    }
};

const updateLoanPaymentStatus = async (req, res) => {
    const { id: paymentId } = req.params;
    const { status: newStatus } = req.body;

    if (!['Approved', 'Rejected'].includes(newStatus)) {
        return res.status(400).json({ error: 'Status tidak valid.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
 
        // 1. Get payment details and lock the corresponding loan row
        const paymentRes = await client.query(`
            SELECT 
                lp.loan_id, lp.installment_number, lp.status as current_status, lp.amount_paid,
                l.member_id, l.amount as loan_amount, l.remaining_principal,
                lt.tenor_months, lt.interest_rate,
                l_types.account_id as loan_account_id, l_types.name as loan_type_name,
                m.name as member_name
            FROM loan_payments lp 
            JOIN loans l ON lp.loan_id = l.id
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            JOIN loan_types l_types ON l.loan_type_id = l_types.id
            JOIN members m ON l.member_id = m.id
            WHERE lp.id = $1 FOR UPDATE
        `, [paymentId]);

        if (paymentRes.rows.length === 0) throw new Error('Data pembayaran tidak ditemukan.');
        const payment = paymentRes.rows[0];
 
        if (payment.current_status !== 'Pending') throw new Error(`Pembayaran ini sudah pernah diproses dengan status: ${payment.current_status}.`);
 
        // 2. Update the payment status
        await client.query('UPDATE loan_payments SET status = $1 WHERE id = $2', [newStatus, paymentId]);
 
        if (newStatus === 'Approved') {
            // --- LOGIKA KEUANGAN YANG HILANG DITAMBAHKAN DI SINI ---

            // 3. Calculate principal and interest components for this installment
            const { principalComponent, interestComponent } = _getInstallmentDetails({
                amount: payment.loan_amount,
                tenor_months: payment.tenor_months,
                interest_rate: payment.interest_rate
            }, parseInt(payment.installment_number, 10));

            // 4. Update remaining principal on the main loan
            const newRemainingPrincipal = parseFloat(payment.remaining_principal) - principalComponent;
            await client.query('UPDATE loans SET remaining_principal = $1 WHERE id = $2', [Math.max(0, newRemainingPrincipal), payment.loan_id]);

            // 5. Check if the loan is fully paid
            if (newRemainingPrincipal <= 1) { // Use a small threshold for floating point inaccuracies
                await client.query("UPDATE loans SET status = 'Lunas' WHERE id = $1", [payment.loan_id]);
            }

            // 6. Create Journal Entries
            if (!payment.loan_account_id) throw new Error(`Tipe pinjaman "${payment.loan_type_name}" belum terhubung ke akun COA Piutang.`);
            
            const cashAccountId = 3; // Asumsi ID Akun Kas
            const interestIncomeAccountId = 7; // Asumsi ID Akun Pendapatan Jasa Simpan Pinjam
            const description = `Penerimaan angsuran ke-${payment.installment_number} pinjaman ${payment.loan_type_name} a/n ${payment.member_name}`;
            
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description) VALUES (NOW(), $1) RETURNING id', [description]);
            const journalId = journalHeaderRes.rows[0].id;

            const journalEntriesQuery = `
                INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES 
                ($1, $2, $3, 0),      -- Debit Kas (total pembayaran)
                ($1, $4, 0, $5),      -- Kredit Piutang (pokok)
                ($1, $6, 0, $7)       -- Kredit Pendapatan Bunga
            `;
            await client.query(journalEntriesQuery, [journalId, cashAccountId, payment.amount_paid, payment.loan_account_id, principalComponent, interestIncomeAccountId, interestComponent]);

            // 6.5. Link the journal entry to the payment record
            await client.query('UPDATE loan_payments SET journal_id = $1 WHERE id = $2', [journalId, paymentId]);

            // 7. Send notification
            createNotification(payment.member_id, `Pembayaran angsuran ke-${payment.installment_number} Anda telah dikonfirmasi.`, 'loans');

        } else { // newStatus is 'Rejected'
            createNotification(payment.member_id, `Pembayaran angsuran ke-${payment.installment_number} Anda ditolak. Silakan hubungi admin.`, 'application');
        }
 
        await client.query('COMMIT');
        res.json({ message: `Status pembayaran berhasil diubah menjadi ${newStatus}.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating loan payment status:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memperbarui status pembayaran.' });
    } finally {
        client.release();
    }
};

// Helper function to handle side effects of loan rejection
const handleLoanRejection = (member_id, rejectionReason) => {
    createNotification(member_id, `Mohon maaf, pengajuan pinjaman Anda telah ditolak. ${rejectionReason ? 'Alasan: ' + rejectionReason : 'Silakan hubungi pengurus untuk informasi lebih lanjut.'}`, 'applications');
};

const updateLoanStatus = async (req, res) => {
    const { id } = req.params;
    const { status: newStatus, reason: rejectionReason } = req.body;
    const { role: userRole } = req.user;

    // --- 1. Define State Machine & Validate Input ---
    const ALLOWED_STATUSES = ['Approved by Accounting', 'Approved', 'Rejected'];
    if (!ALLOWED_STATUSES.includes(newStatus)) {
        return res.status(400).json({ error: 'Status baru tidak valid.' });
    }

    // Defines what a role can do from a given state.
    const STATE_TRANSITIONS = {
        'Pending': {
            'akunting': ['Approved by Accounting', 'Rejected'],
            'admin': ['Approved by Accounting', 'Approved', 'Rejected']
        },
        'Approved by Accounting': {
            'manager': ['Approved', 'Rejected'],
            'admin': ['Approved', 'Rejected']
        }
        // By default, no transitions are allowed from 'Approved', 'Rejected', or 'Lunas' via this function.
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // --- 2. Fetch current state and lock the record ---
        const loanRes = await client.query(`
            SELECT l.status, l.amount, l.member_id, lt.name as loan_type_name, lt.account_id, m.name as member_name
            FROM loans l
            JOIN loan_types lt ON l.loan_type_id = lt.id
            JOIN members m ON l.member_id = m.id
            WHERE l.id = $1 FOR UPDATE
        `, [id]);

        if (loanRes.rows.length === 0) {
            throw new Error('Pengajuan pinjaman tidak ditemukan.');
        }
        const loan = loanRes.rows[0];
        const currentStatus = loan.status;

        // --- 3. Authorize the state transition ---
        const allowedNextStates = STATE_TRANSITIONS[currentStatus]?.[userRole];
        if (!allowedNextStates || !allowedNextStates.includes(newStatus)) {
            return res.status(403).json({
                error: `Peran '${userRole}' tidak dapat mengubah status dari '${currentStatus}' menjadi '${newStatus}'.`
            });
        }

        // --- 4. Perform the update ---
        const isFinalApproval = newStatus === 'Approved' && currentStatus !== 'Approved';
        const isRejection = newStatus === 'Rejected' && currentStatus !== 'Rejected';

        const updateFields = ['status = $1'];
        const updateParams = [newStatus];
        let paramIndex = 2;

        if (isFinalApproval) {
            updateFields.push('date = NOW()', 'remaining_principal = amount');
        }
        // Future enhancement: Save rejection reason to the database.
        // if (isRejection && rejectionReason) {
        //     updateFields.push(`rejection_reason = $${paramIndex++}`);
        //     updateParams.push(rejectionReason);
        // }
        updateParams.push(id);

        const updateQuery = `UPDATE loans SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await client.query(updateQuery, updateParams);

        // --- 5. Handle side-effects (Journaling and Notifications) ---
        if (isFinalApproval) {
            await handleFinalLoanApproval(client, loan);
        } else if (isRejection) {
            handleLoanRejection(loan.member_id, rejectionReason);
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating loan status:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memperbarui status pinjaman.' });
    } finally {
        client.release();
    }
};

// Helper to calculate installment details for a flat-principal loan model.
// Interest is calculated on the remaining principal at the start of each period.
const _getInstallmentDetails = (loan, installmentNumber) => {
    const principal = parseFloat(loan.amount);
    const tenor = parseInt(loan.tenor_months, 10);
    // FIX: Annual interest rate must be divided by 12 to get the monthly rate.
    const monthlyInterestRate = (parseFloat(loan.interest_rate) / 100) / 12;

    if (tenor <= 0) {
        return { principalComponent: 0, interestComponent: 0, total: 0 };
    }

    const principalComponent = principal / tenor;
    // Remaining principal at the START of the `installmentNumber` period
    const remainingPrincipal = principal - ((installmentNumber - 1) * principalComponent);
    const interestComponent = remainingPrincipal * monthlyInterestRate;
    const total = principalComponent + interestComponent;

    return { principalComponent, interestComponent, total };
};

const recordLoanPayment = async (req, res) => {
    const { loanId, installmentNumber: requestedInstallmentNumberStr } = req.body;
    const { role: userRole, id: userId } = req.user;

    if (!['admin', 'akunting'].includes(userRole)) {
        return res.status(403).json({ error: 'Anda tidak memiliki izin untuk mencatat pembayaran.' });
    }

    if (!loanId || !requestedInstallmentNumberStr) {
        return res.status(400).json({ error: 'ID Pinjaman dan Nomor Angsuran diperlukan.' });
    }

    const requestedInstallmentNumber = parseInt(requestedInstallmentNumberStr, 10);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get loan details and lock the row
        const loanQuery = `
            SELECT 
                l.id, l.amount, l.status, 
                lt.tenor_months, lt.interest_rate,
                l_types.account_id as loan_account_id,
                l_types.name as loan_type_name,
                m.name as member_name
            FROM loans l
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            JOIN loan_types l_types ON l.loan_type_id = l_types.id
            JOIN members m ON l.member_id = m.id
            WHERE l.id = $1 FOR UPDATE
        `;
        const loanResult = await client.query(loanQuery, [loanId]);

        if (loanResult.rows.length === 0) {
            throw new Error('Pinjaman tidak ditemukan.');
        }
        const loan = loanResult.rows[0];

        if (loan.status !== 'Approved') {
            throw new Error(`Hanya pinjaman dengan status "Approved" yang bisa dibayar. Status saat ini: ${loan.status}.`);
        }

        // 2. Validate installment sequence and check for duplicates
        const paidInstallmentsCountResult = await client.query('SELECT COUNT(*) FROM loan_payments WHERE loan_id = $1', [loanId]);
        const paidInstallmentsCount = parseInt(paidInstallmentsCountResult.rows[0].count, 10);

        if (requestedInstallmentNumber !== paidInstallmentsCount + 1) {
            throw new Error(`Pembayaran harus berurutan. Angsuran berikutnya yang harus dibayar adalah ke-${paidInstallmentsCount + 1}.`);
        }

        const existingPayment = await client.query(
            'SELECT id FROM loan_payments WHERE loan_id = $1 AND installment_number = $2',
            [loanId, requestedInstallmentNumber]
        );
        if (existingPayment.rows.length > 0) {
            throw new Error(`Angsuran ke-${requestedInstallmentNumber} sudah pernah dibayar.`);
        }

        // 3. Calculate payment amount for this installment
        const { principalComponent, interestComponent, total: totalInstallmentAmount } = _getInstallmentDetails(loan, requestedInstallmentNumber);

        // 4. Record the payment
        await client.query(
            "INSERT INTO loan_payments (loan_id, payment_date, amount_paid, installment_number, notes, status, payment_method) VALUES ($1, NOW(), $2, $3, $4, 'Approved', 'Potong Gaji')",
            [loanId, totalInstallmentAmount, requestedInstallmentNumber, `Dicatat manual oleh ${userRole} ID: ${userId}`]
        );

        // 5. Update remaining_principal on the loan
        // Recalculate remaining principal based on total principal paid so far.
        const newRemainingPrincipal = parseFloat(loan.amount) - (paidInstallmentsCount + 1) * principalComponent;
        await client.query(
            'UPDATE loans SET remaining_principal = $1 WHERE id = $2',
            [Math.max(0, newRemainingPrincipal), loanId]
        );

        // 6. Check if all installments are paid and update status to 'Lunas'
        const totalPaidCount = paidInstallmentsCount + 1;
        let finalStatus = 'Approved';
        if (totalPaidCount >= parseInt(loan.tenor_months, 10)) {
            await client.query(
                "UPDATE loans SET status = 'Lunas', remaining_principal = 0 WHERE id = $1",
                [loanId]
            );
            finalStatus = 'Lunas';
        }

        // --- LOGIKA JURNAL OTOMATIS UNTUK PEMBAYARAN ANGSURAN ---
        if (!loan.loan_account_id) {
            throw new Error(`Tipe pinjaman "${loan.loan_type_name}" belum terhubung ke akun COA Piutang. Harap lakukan maping di Pengaturan.`);
        }

        const cashAccountId = 3; // Asumsi ID Akun Kas dari koperasi.sql
        const interestIncomeAccountId = 7; // Asumsi ID Akun Pendapatan Jasa Simpan Pinjam dari koperasi.sql
        const description = `Pembayaran angsuran ke-${requestedInstallmentNumber} pinjaman ${loan.loan_type_name} a/n ${loan.member_name}`;

        // 7. Buat header jurnal
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

        // 8. Buat entri jurnal (Debit Kas, Kredit Piutang, Kredit Pendapatan Bunga)
        const journalEntriesQuery = `
            INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES 
            ($1, $2, $3, 0),      -- Debit Kas
            ($1, $4, 0, $5),      -- Kredit Piutang (Pokok)
            ($1, $6, 0, $7)       -- Kredit Pendapatan Bunga
        `;
        // Total credit (principalComponent + interestComponent) must equal total debit (totalInstallmentAmount)
        await client.query(journalEntriesQuery, [journalId, cashAccountId, totalInstallmentAmount, loan.loan_account_id, principalComponent, interestIncomeAccountId, interestComponent]);

        await client.query('COMMIT');
        res.json({ 
            message: `Pembayaran angsuran ke-${requestedInstallmentNumber} berhasil dicatat.`,
            loanStatus: finalStatus
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error recording loan payment:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mencatat pembayaran.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Cancel/rollback an approved loan payment.
 * @route   DELETE /api/admin/loan-payments/:id
 * @access  Private (Admin)
 */
const cancelLoanPayment = async (req, res) => {
    const { id: paymentId } = req.params;
    const { id: adminUserId } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get payment details and lock the loan row
        const paymentRes = await client.query(`
            SELECT 
                lp.loan_id, lp.status, lp.installment_number,
                lp.journal_id,
                l.member_id, l.status as loan_status, l.amount as loan_amount,
                lt.tenor_months, lt.interest_rate
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.id
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            WHERE lp.id = $1 FOR UPDATE
        `, [paymentId]);

        if (paymentRes.rows.length === 0) {
            throw new Error('Data pembayaran tidak ditemukan.');
        }
        const payment = paymentRes.rows[0];

        if (payment.status !== 'Approved') {
            throw new Error(`Hanya pembayaran dengan status "Approved" yang dapat dibatalkan. Status saat ini: ${payment.status}.`);
        }

        // 2. Recalculate the principal component that was paid
        const { principalComponent } = _getInstallmentDetails({
            amount: payment.loan_amount,
            tenor_months: payment.tenor_months,
            interest_rate: payment.interest_rate
        }, parseInt(payment.installment_number, 10));

        // 3. Add the principal back to the loan's remaining_principal
        await client.query(
            'UPDATE loans SET remaining_principal = remaining_principal + $1 WHERE id = $2',
            [principalComponent, payment.loan_id]
        );

        // 4. If the loan was 'Lunas', revert its status to 'Approved'
        if (payment.loan_status === 'Lunas') {
            await client.query("UPDATE loans SET status = 'Approved' WHERE id = $1", [payment.loan_id]);
        }

        // 5. Delete the associated journal entry if it exists
        if (payment.journal_id) {
            await client.query('DELETE FROM general_journal WHERE id = $1', [payment.journal_id]);
        }

        // 6. Delete the loan payment record itself
        await client.query('DELETE FROM loan_payments WHERE id = $1', [paymentId]);

        // 7. Notify the member
        createNotification(
            payment.member_id,
            `Pembayaran angsuran ke-${payment.installment_number} Anda telah dibatalkan oleh admin.`,
            'loans'
        ).catch(err => console.error(`Gagal membuat notifikasi pembatalan untuk user ${payment.member_id}:`, err));

        await client.query('COMMIT');
        res.json({ message: 'Pembayaran berhasil dibatalkan.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cancelling loan payment:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membatalkan pembayaran.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Save commitment letter signature for a loan.
 * @route   POST /api/admin/loans/:id/commitment
 * @access  Private (Admin, Akunting)
 */
const saveLoanCommitment = async (req, res) => {
    const { id: loanId } = req.params;
    const signatureFile = req.file;

    if (!signatureFile) {
        return res.status(400).json({ error: 'File tanda tangan tidak ditemukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get the old signature path to delete it later
        const oldSignatureRes = await client.query('SELECT commitment_signature_path FROM loans WHERE id = $1', [loanId]);
        if (oldSignatureRes.rows.length === 0) {
            throw new Error('Pinjaman tidak ditemukan.');
        }
        const oldSignaturePath = oldSignatureRes.rows[0]?.commitment_signature_path;

        // 2. Update the database with the new signature path
        const newSignaturePath = signatureFile.path.replace(/\\/g, '/');
        await client.query('UPDATE loans SET commitment_signature_path = $1 WHERE id = $2', [newSignaturePath, loanId]);

        // 3. Delete the old signature file if it exists
        if (oldSignaturePath) {
            const fullOldPath = path.resolve(process.cwd(), oldSignaturePath);
            fs.unlink(fullOldPath, (err) => { if (err) console.error(`Gagal menghapus file tanda tangan lama: ${fullOldPath}`, err); });
        }

        await client.query('COMMIT');
        res.json({ message: 'Tanda tangan berhasil disimpan.', path: newSignaturePath });
    } catch (err) { await client.query('ROLLBACK'); console.error('Error saving loan commitment:', err.message); res.status(500).json({ error: 'Gagal menyimpan tanda tangan.' }); } finally { client.release(); }
};

const getLoanDetailsForAdmin = async (req, res) => {
    const { id: loanId } = req.params;

    try {
        // 1. Get main loan data
        const loanQuery = `
            SELECT 
                l.id,
                l.amount, l.commitment_signature_path,
                l.date AS start_date, l.status,
                l.member_id,
                ltp.name as loan_type_name,
                m.name as member_name,
                m.cooperative_number as "cooperativeNumber",
                lt.tenor_months,
                lt.interest_rate
            FROM loans l
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            JOIN loan_types ltp ON l.loan_type_id = ltp.id
            JOIN members m ON l.member_id = m.id
            WHERE l.id = $1
        `;
        const loanResult = await pool.query(loanQuery, [loanId]);

        if (loanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pinjaman tidak ditemukan.' });
        }
        const loan = loanResult.rows[0];
        const principal = parseFloat(loan.amount);
        const tenor = parseInt(loan.tenor_months);
        const monthlyInterestRate = parseFloat(loan.interest_rate) / 100;

        // 2. Get payment data
        const paymentsQuery = "SELECT installment_number, payment_date, amount_paid FROM loan_payments WHERE loan_id = $1 AND status = 'Approved'";
        const paymentsResult = await pool.query(paymentsQuery, [loanId]);
        const paymentsMap = new Map(paymentsResult.rows.map(p => [p.installment_number, p]));

        // 3. Generate amortization schedule
        const installments = [];
        for (let i = 1; i <= tenor; i++) {
            // Use the helper to ensure calculation is consistent with payment recording
            const { total: totalInstallment } = _getInstallmentDetails(loan, i);
            
            const dueDate = new Date(loan.start_date);
            dueDate.setMonth(dueDate.getMonth() + i);

            const payment = paymentsMap.get(i);
            installments.push({
                installmentNumber: i,
                dueDate: dueDate.toISOString(),
                amount: totalInstallment,
                paymentDate: payment ? payment.payment_date : null,
                paymentId: payment ? payment.id : null, // Tambahkan paymentId
                status: payment ? 'Lunas' : 'Belum Lunas'
            });
        }
        
        const totalPaid = Array.from(paymentsMap.values()).reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0)
        const { total: monthlyInstallmentFirst } = _getInstallmentDetails(loan, 1);

        res.json({ summary: { ...loan, memberName: loan.member_name, monthlyInstallment: monthlyInstallmentFirst, totalPaid: totalPaid }, installments: installments });

    } catch (err) {
        console.error('Error fetching loan details for admin:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail pinjaman.' });
    }
};

const getLoanById = async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                l.id,
                l.member_id,
                m.name as member_name,
                l.loan_term_id,
                l.amount
            FROM loans l
            JOIN members m ON l.member_id = m.id
            WHERE l.id = $1
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pinjaman tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching loan by id:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pinjaman.' });
    }
};

const updateLoan = async (req, res) => {
    const { id } = req.params;
    const { loan_term_id, amount } = req.body;
    const { role: userRole } = req.user;

    if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
    }

    if (!loan_term_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'Produk pinjaman dan jumlah harus diisi dengan benar.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const loanRes = await client.query('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [id]);
        if (loanRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pengajuan pinjaman tidak ditemukan.' });
        }

        if (loanRes.rows[0].status !== 'Pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Hanya pinjaman dengan status "Pending" yang dapat diubah.' });
        }

        const termResult = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loan_term_id]);
        if (termResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Produk pinjaman (tenor) tidak valid.' });
        }
        const loan_type_id = termResult.rows[0].loan_type_id;

        const updateQuery = `UPDATE loans SET loan_type_id = $1, loan_term_id = $2, amount = $3, remaining_principal = $3 WHERE id = $4 RETURNING *;`;
        const updatedLoan = await client.query(updateQuery, [loan_type_id, loan_term_id, amount, id]);

        await client.query('COMMIT');
        res.json(updatedLoan.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating loan:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui pengajuan pinjaman.' });
    } finally {
        client.release();
    }
};

const deleteLoan = async (req, res) => {
    const { id } = req.params;
    const { role: userRole } = req.user;

    if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check the loan status before deleting
        const loanRes = await client.query('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [id]);
        if (loanRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pengajuan pinjaman tidak ditemukan.' });
        }

        const currentStatus = loanRes.rows[0].status;
        if (currentStatus !== 'Pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Hanya pinjaman dengan status "Pending" yang dapat dihapus.' });
        }

        await client.query('DELETE FROM loans WHERE id = $1', [id]);
        await client.query('COMMIT');
        res.json({ message: 'Pengajuan pinjaman berhasil dihapus.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting loan:', err.message);
        res.status(500).json({ error: 'Gagal menghapus pengajuan pinjaman.' });
    } finally {
        client.release();
    }
};

const createItem = (tableName, allowedFields) => async (req, res) => {
    // Security: Ensure only whitelisted tables can be accessed.
    if (!ALLOWED_GENERIC_CRUD_TABLES.has(tableName)) {
        console.error(`Attempt to create in non-whitelisted table: ${tableName}`);
        return res.status(403).json({ error: 'Operasi tidak diizinkan untuk tabel ini.' });
    }

    const fields = [];
    const values = [];
    const valuePlaceholders = [];
    let paramIndex = 1;

    allowedFields.forEach(field => {
        // Only include fields that are actually sent in the body.
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
            fields.push(`"${field}"`); // Use quotes for field names to handle reserved words
            values.push(req.body[field] === '' ? null : req.body[field]); // Convert empty strings to null
            valuePlaceholders.push(`$${paramIndex++}`);
        }
    });

    if (fields.length === 0) {
        return res.status(400).json({ error: 'Tidak ada data valid yang dikirim.' });
    }

    const query = `INSERT INTO "${tableName}" (${fields.join(', ')}) VALUES (${valuePlaceholders.join(', ')}) RETURNING *`;

    try {
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(`Error creating item in ${tableName}:`, err.message);
        // Check for unique constraint violation (PostgreSQL error code)
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Gagal menyimpan. Data dengan nilai yang sama mungkin sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat item baru.' });
    }
};

const updateItem = (tableName, allowedFields) => async (req, res) => {
    if (!ALLOWED_GENERIC_CRUD_TABLES.has(tableName)) {
        console.error(`Attempt to update in non-whitelisted table: ${tableName}`);
        return res.status(403).json({ error: 'Operasi tidak diizinkan untuk tabel ini.' });
    }
    const { id } = req.params;
    const fieldsToUpdate = [];
    const values = [];
    let paramIndex = 1;

    allowedFields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
            fieldsToUpdate.push(`"${field}" = $${paramIndex++}`);
            values.push(req.body[field] === '' ? null : req.body[field]);
        }
    });

    if (fieldsToUpdate.length === 0) return res.status(400).json({ error: 'Tidak ada data valid untuk diperbarui.' });

    try {
        // FIX: Add the 'id' to the values array *before* executing the query.
        values.push(id);
        // FIX: Construct the query string *after* all values, including the id, have been pushed.
        const query = `UPDATE "${tableName}" SET ${fieldsToUpdate.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating item in ${tableName}:`, err.message);
        // Check for unique constraint violation (PostgreSQL error code)
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Gagal menyimpan. Data dengan nilai yang sama mungkin sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui item.' });
    }
};

// Whitelist of tables that are allowed to be modified by the generic create, update, and delete functions.
// This is a security measure to prevent unintended modifications to sensitive tables.
const ALLOWED_GENERIC_CRUD_TABLES = new Set([
    'companies',
    'positions',
    'saving_types',
    'loan_types',
    'loan_terms',
    'chart_of_accounts',
    'savings',
    'suppliers',
    'logistics_entries'
]);

const deleteItem = (tableName) => async (req, res) => {
    // Security: Ensure only whitelisted tables can be accessed to prevent SQL injection.
    if (!ALLOWED_GENERIC_CRUD_TABLES.has(tableName)) {
        console.error(`Attempt to delete from non-whitelisted table: ${tableName}`);
        return res.status(403).json({ error: 'Operasi tidak diizinkan untuk tabel ini.' });
    }

    const { id } = req.params;
    try {
        const result = await pool.query(`DELETE FROM "${tableName}" WHERE id = $1`, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Item tidak ditemukan.' });
        }
        // Return 204 No Content on successful deletion for RESTful consistency.
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting from ${tableName} with ID ${id}:`, err);

        // FIX: Improve foreign key violation handling.
        // This error code ('23503') indicates that the row is still referenced by another table.
        // This is a more robust way to handle the 500 error you're seeing.
        if (err.code === '23503') {
            // Provide a more user-friendly message.
            return res.status(400).json({ error: `Gagal menghapus. Data ini masih digunakan oleh data lain (misalnya, oleh seorang anggota). Ubah atau hapus data terkait terlebih dahulu.` });
        }
        // For any other errors, send a generic 500 status.
        res.status(500).json({ error: 'Terjadi kesalahan pada server saat menghapus item.' });
    }
};

const getAllUsers = async (req, res) => {
    const { role, status: statusFilter } = req.query;
    try {
        let query = `
            SELECT id, name, email, role, status, cooperative_number
            FROM members 
        `;
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (role) {
            conditions.push(`role = $${paramIndex++}`);
            params.push(role);
        }
        if (statusFilter) {
            conditions.push(`status = $${paramIndex++}`);
            params.push(statusFilter);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY 
            CASE role 
                WHEN 'admin' THEN 1 
                WHEN 'manager' THEN 2 
                WHEN 'akunting' THEN 3 
                ELSE 4 
            END, 
            name ASC `;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all users:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengguna.' });
    }
};

const getAllPermissions = async (req, res) => {
    try {
        const result = await pool.query('SELECT key, description FROM permissions ORDER BY description');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching permissions:', err.message);
        res.status(500).json({ error: 'Gagal mengambil daftar hak akses.' });
    }
};

const getRolePermissions = async (req, res) => {
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

const updateRolePermissions = async (req, res) => {
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

const getProducts = async (req, res) => {
    const { shop } = req.query;

    if (!shop) {
        return res.status(400).json({ error: 'Parameter "shop" diperlukan.' });
    }

    try {
        // Kueri ini aman untuk penggunaan admin.
        const query = 'SELECT id, name, description, price, stock, image_url, shop_type FROM products WHERE shop_type = $1 ORDER BY name ASC';
        const result = await pool.query(query, [shop]);
        res.json(result.rows);
    } catch (err) {
        console.error(`Error fetching products for shop [${shop}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
};

const getProductById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Produk tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching product by id [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
};

const createProduct = async (req, res) => {
    const { name, description, price, stock, shop_type } = req.body;
    let imageUrl = null;
    if (req.file) {
        imageUrl = '/' + req.file.path.replace(/\\/g, '/');
    }

    if (!name || price == null || stock == null || !shop_type) {
        return res.status(400).json({ error: 'Nama, harga, stok, dan tipe toko wajib diisi.' });
    }

    try {
        const query = `
            INSERT INTO products (name, description, price, stock, image_url, shop_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [name, description, price, stock, imageUrl, shop_type];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating product:', err.message);
        res.status(500).json({ error: 'Gagal membuat produk baru.' });
    }
};

const updateProduct = async (req, res) => {
    const { id } = req.params;
    const { name, description, price, stock, shop_type } = req.body;
    const client = await pool.connect();

    if (!name || price == null || stock == null || !shop_type) {
        return res.status(400).json({ error: 'Nama, harga, stok, dan tipe toko wajib diisi.' });
    }

    try {
        await client.query('BEGIN');

        const oldProductRes = await client.query('SELECT image_url FROM products WHERE id = $1', [id]);
        const oldImageUrl = oldProductRes.rows[0]?.image_url;
        let newImageUrl = oldImageUrl;

        if (req.file) { // Path dari multer sudah benar (contoh: uploads/products/...)
            newImageUrl = '/' + req.file.path.replace(/\\/g, '/');
        }

        const query = `
            UPDATE products
            SET name = $1, description = $2, price = $3, stock = $4, image_url = $5, shop_type = $6
            WHERE id = $7 RETURNING *;
        `;
        const values = [name, description, price, stock, newImageUrl, shop_type, id];
        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Produk tidak ditemukan.' });
        }

        // Hapus file gambar lama setelah database berhasil diperbarui
        if (req.file && oldImageUrl && oldImageUrl !== newImageUrl) {
            const oldImagePath = path.resolve(process.cwd(), oldImageUrl.startsWith('/') ? oldImageUrl.substring(1) : oldImageUrl);
            fs.unlink(oldImagePath, (err) => {
                if (err) console.error("Gagal menghapus gambar lama:", oldImagePath, err);
            });
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error updating product [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal memperbarui produk.' });
    } finally {
        client.release();
    }
};

const deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const oldProductRes = await pool.query('SELECT image_url FROM products WHERE id = $1', [id]);
        const oldImageUrl = oldProductRes.rows[0]?.image_url;
        
        await pool.query('DELETE FROM products WHERE id = $1', [id]);
        
        if (oldImageUrl) {
            const oldImagePath = path.resolve(process.cwd(), oldImageUrl.startsWith('/') ? oldImageUrl.substring(1) : oldImageUrl);
            fs.unlink(oldImagePath, (err) => { if (err) console.error("Gagal menghapus gambar produk:", oldImagePath, err); });
        }
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting product [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal menghapus produk.' });
    }
};

const getMasterProducts = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM master_products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching master products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data item produk.' });
    }
};

const createMasterProduct = async (req, res) => {
    const { item_number, name, description, default_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama item produk wajib diisi.' });
    try {
        const query = 'INSERT INTO master_products (item_number, name, description, default_unit) VALUES ($1, $2, $3, $4) RETURNING *';
        const result = await pool.query(query, [item_number || null, name, description || null, default_unit || null]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Nomor item atau nama item sudah ada.' });
        console.error('Error creating master product:', err.message);
        res.status(500).json({ error: 'Gagal membuat item produk baru.' });
    }
};

const updateMasterProduct = async (req, res) => {
    const { id } = req.params;
    const { item_number, name, description, default_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama item produk wajib diisi.' });
    try {
        const query = 'UPDATE master_products SET item_number = $1, name = $2, description = $3, default_unit = $4 WHERE id = $5 RETURNING *';
        const result = await pool.query(query, [item_number || null, name, description || null, default_unit || null, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item produk tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Nomor item atau nama item sudah ada.' });
        console.error('Error updating master product:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui item produk.' });
    }
};

const deleteMasterProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM master_products WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item produk tidak ditemukan.' });
        res.status(204).send();
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'Gagal menghapus. Item ini masih digunakan di data logistik.' });
        console.error('Error deleting master product:', err.message);
        res.status(500).json({ error: 'Gagal menghapus item produk.' });
    }
};

const getLogisticsEntries = async (req, res) => {
    try {
        const query = `
            SELECT 
                le.id,
                le.reference_number AS "referenceNumber",
                le.entry_date,
                mp.name AS "productName",
                s.name AS "supplierName",
                le.quantity,
                le.unit,
                le.purchase_price AS "purchasePrice",
                le.total_amount AS "totalAmount",
                le.status
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            LEFT JOIN master_products mp ON le.master_product_id = mp.id
            ORDER BY le.entry_date DESC, le.created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching logistics entries:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data logistik.' });
    }
};

const getAvailableLogisticsProducts = async (req, res) => {
    const { shopType } = req.params;
    try {
        const query = `
            SELECT
                mp.name AS "productName",
                mp.default_unit AS "unit",
                (SELECT COALESCE(SUM(l.quantity), 0) FROM logistics_entries l WHERE l.master_product_id = mp.id AND l.status = 'Received') AS "availableStock"
            FROM master_products mp
            WHERE NOT EXISTS (
                SELECT 1 
                FROM products p 
                WHERE p.name = mp.name AND p.shop_type = $1
            )
            ORDER BY "productName" ASC
        `;
        const result = await pool.query(query, [shopType]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching available logistics products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk dari logistik.' });
    }
};

const createLogisticsEntry = async (req, res) => {
    const { entry_date, supplier_id, products, reference_number } = req.body; // reference_number can be empty

    if (!entry_date || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'Data tidak lengkap. Tanggal dan minimal satu produk diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let finalReferenceNumber = reference_number;
        // If reference number is not provided, generate one automatically
        if (!finalReferenceNumber) {
            const date = new Date(entry_date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const prefix = `LOG-${year}${month}${day}-`;

            // Find the next sequence number for that day to avoid duplicates
            const seqResult = await client.query(
                "SELECT COUNT(DISTINCT reference_number) FROM logistics_entries WHERE reference_number LIKE $1",
                [`${prefix}%`]
            );
            const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
            finalReferenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        }

        const insertQuery = `
            INSERT INTO logistics_entries (entry_date, supplier_id, master_product_id, quantity, unit, purchase_price, reference_number) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        // Loop through each product and execute an insert query
        for (const product of products) {
            if (!product.master_product_id || !product.quantity || !product.unit || !product.purchase_price) {
                throw new Error('Setiap baris produk harus memiliki produk terpilih, qty, unit, dan harga beli.');
            }
            const values = [
                entry_date,
                supplier_id || null,
                product.master_product_id,
                product.quantity,
                product.unit,
                product.purchase_price,
                finalReferenceNumber
            ];
            await client.query(insertQuery, values);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Data logistik berhasil disimpan.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating logistics entry:', err.message);
        res.status(500).json({ error: err.message || 'Gagal menyimpan data logistik.' });
    } finally {
        client.release();
    }
};

const getLogisticsByReference = async (req, res) => {
    const { ref } = req.params;
    try {
        const query = `
            SELECT
                le.id, le.reference_number, le.entry_date, le.quantity, le.unit, le.purchase_price, le.total_amount, le.status,
                mp.name AS "productName",
                s.name AS "supplierName", s.id as "supplierId"
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            LEFT JOIN master_products mp ON le.master_product_id = mp.id
            WHERE le.reference_number = $1
            ORDER BY le.id ASC
        `;
        const result = await pool.query(query, [ref]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Data logistik tidak ditemukan.' });
        }

        // Format the response
        const firstRow = result.rows[0];
        const responseData = {
            header: {
                referenceNumber: firstRow.reference_number,
                entryDate: firstRow.entry_date,
                supplierName: firstRow.supplierName,
                supplierId: firstRow.supplierId,
                status: firstRow.status
            },
            products: result.rows.map(row => ({
                id: row.id,
                productName: row.product_name,
                quantity: row.quantity,
                unit: row.unit,
                purchasePrice: row.purchase_price,
                totalAmount: row.total_amount
            }))
        };

        res.json(responseData);
    } catch (err) {
        console.error('Error fetching logistics by reference:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail logistik.' });
    }
};

const updateLogisticsByReference = async (req, res) => {
    const { ref } = req.params;
    const { entry_date, supplier_id, products, reference_number } = req.body;

    if (!entry_date || !Array.isArray(products) || products.length === 0 || !reference_number) {
        return res.status(400).json({ error: 'Data tidak lengkap.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Delete old entries with the original reference number
        await client.query('DELETE FROM logistics_entries WHERE reference_number = $1', [ref]);

        // Insert new entries (same logic as createLogisticsEntry)
        const insertQuery = `
            INSERT INTO logistics_entries (entry_date, supplier_id, master_product_id, quantity, unit, purchase_price, reference_number) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        for (const product of products) {
            if (!product.master_product_id || !product.quantity || !product.unit || !product.purchase_price) {
                throw new Error('Setiap baris produk harus lengkap.');
            }
            const values = [entry_date, supplier_id || null, product.master_product_id, product.quantity, product.unit, product.purchase_price, reference_number];
            await client.query(insertQuery, values);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Data logistik berhasil diperbarui.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating logistics entry:', err.message);
        res.status(500).json({ error: err.message || 'Gagal memperbarui data logistik.' });
    } finally {
        client.release();
    }
};

const deleteLogisticsByReference = async (req, res) => {
    const { ref } = req.params;
    try {
        await pool.query('DELETE FROM logistics_entries WHERE reference_number = $1', [ref]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting logistics by reference:', err.message);
        res.status(500).json({ error: 'Gagal menghapus data logistik.' });
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

const getSavingTypes = async (req, res) => {
    try {
        // This query is simple and doesn't need pagination for a dropdown.
        // It's used across the admin panel, so it belongs here.
        const result = await pool.query('SELECT id, name, account_id FROM saving_types ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching saving types:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data tipe simpanan.' });
    }
};

const getEmployers = async (req, res) => {
    try {
        // This query is simple and doesn't need pagination for a dropdown.
        // It's used across the admin panel.
        const result = await pool.query('SELECT id, name FROM companies ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching employers:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data perusahaan.' });
    }
};

const getPositions = async (req, res) => {
    try {
        // This query is simple and doesn't need pagination for a dropdown.
        // It's used across the admin panel.
        const result = await pool.query('SELECT id, name FROM positions ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching positions:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data jabatan.' });
    }
};

const getLoanTypes = async (req, res) => {
    try {
        // This query is simple and doesn't need pagination for a dropdown.
        // It's used across the admin panel.
        const result = await pool.query('SELECT id, name, description, account_id FROM loan_types ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching loan types:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data tipe pinjaman.' });
    }
};

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

const getPaymentMethods = async (req, res) => {
    try {
        // Ambil semua kolom yang relevan, termasuk is_active dan account_id
        const result = await pool.query('SELECT id, name, is_active, account_id FROM payment_methods ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching payment methods:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data metode pembayaran.' });
    }
};

/**
 * @desc    Get loan type ID by its name
 * @route   GET /api/admin/loantype-id-by-name
 * @access  Private (Admin)
 */
const getLoanTypeIdByName = async (req, res) => {
    const { name } = req.query;
    if (!name) {
        return res.status(400).json({ error: 'Nama tipe pinjaman diperlukan.' });
    }
    try {
        const result = await pool.query('SELECT id FROM loan_types WHERE name = $1', [name]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Tipe pinjaman tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) { console.error('Error fetching loan type ID by name:', err.message); res.status(500).json({ error: 'Gagal mengambil ID tipe pinjaman.' }); }
};



const getSuppliers = async (req, res) => {
    try {
        // This query is simple and doesn't need pagination for a dropdown.
        // It's used across the admin panel.
        const result = await pool.query('SELECT id, name, contact_person, phone FROM suppliers ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching suppliers:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data supplier.' });
    }
};

// Testimonial Management
const getTestimonials = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM testimonials ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching testimonials:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data testimoni.' });
    }
};

const getTestimonialById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM testimonials WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Testimoni tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching testimonial by id [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data testimoni.' });
    }
};

const createTestimonial = async (req, res) => {
    const { name, division, text } = req.body;
    let photoUrl = null;
    if (req.file) { // Path dari multer sudah benar (contoh: uploads/testimonials/...)
        photoUrl = '/' + req.file.path.replace(/\\/g, '/');
    }

    if (!name || !text) {
        return res.status(400).json({ error: 'Nama dan teks testimoni wajib diisi.' });
    }

    try {
        const query = `
            INSERT INTO testimonials (name, division, text, photo_url)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const values = [name, division, text, photoUrl];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating testimonial:', err.message);
        res.status(500).json({ error: 'Gagal membuat testimoni baru.' });
    }
};

const updateTestimonial = async (req, res) => {
    const { id } = req.params;
    const { name, division, text } = req.body;

    if (!name || !text) {
        return res.status(400).json({ error: 'Nama dan teks testimoni wajib diisi.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldTestimonialRes = await client.query('SELECT photo_url FROM testimonials WHERE id = $1', [id]);
        if (oldTestimonialRes.rows.length === 0) throw new Error('Testimoni tidak ditemukan.');
        
        const oldPhotoUrl = oldTestimonialRes.rows[0].photo_url;
        let newPhotoUrl = oldPhotoUrl;

        if (req.file) { // Path dari multer sudah benar
            newPhotoUrl = '/' + req.file.path.replace(/\\/g, '/');
        }

        const query = `UPDATE testimonials SET name = $1, division = $2, text = $3, photo_url = $4 WHERE id = $5 RETURNING *;`;
        const values = [name, division, text, newPhotoUrl, id];
        const result = await client.query(query, values);
        
        if (req.file && oldPhotoUrl && oldPhotoUrl !== newPhotoUrl) {
            const oldPhotoPath = path.resolve(process.cwd(), oldPhotoUrl.startsWith('/') ? oldPhotoUrl.substring(1) : oldPhotoUrl);
            fs.unlink(oldPhotoPath, (err) => {
                if (err) console.error("Gagal menghapus foto testimoni lama:", oldPhotoPath, err);
            });
        }
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error updating testimonial [${id}]:`, err.message);
        res.status(err.message === 'Testimoni tidak ditemukan.' ? 404 : 500).json({ error: 'Gagal memperbarui testimoni.' });
    } finally {
        client.release();
    }
};

const deleteTestimonial = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldTestimonialRes = await client.query('SELECT photo_url FROM testimonials WHERE id = $1', [id]);
        if (oldTestimonialRes.rows.length === 0) throw new Error('Testimoni tidak ditemukan.');
        
        const oldPhotoUrl = oldTestimonialRes.rows[0].photo_url;
        await client.query('DELETE FROM testimonials WHERE id = $1', [id]);
        
        if (oldPhotoUrl) {
            const oldPhotoPath = path.resolve(process.cwd(), oldPhotoUrl.startsWith('/') ? oldPhotoUrl.substring(1) : oldPhotoUrl);
            fs.unlink(oldPhotoPath, (err) => { if (err) console.error("Gagal menghapus foto testimoni:", oldPhotoPath, err); });
        }
        await client.query('COMMIT');
        res.status(204).send();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error deleting testimonial [${id}]:`, err.message);
        res.status(err.message === 'Testimoni tidak ditemukan.' ? 404 : 500).json({ error: 'Gagal menghapus testimoni.' });
    } finally {
        client.release();
    }
};

const mapSavingAccount = async (req, res) => {
    const { id } = req.params;
    const { accountId } = req.body;
    try {
        const result = await pool.query('UPDATE saving_types SET account_id = $1 WHERE id = $2 RETURNING *', [accountId, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Tipe simpanan tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error mapping saving account:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan maping akun.' });
    }
};

const mapPaymentMethodAccount = async (req, res) => {
    const { id } = req.params;
    const { accountId } = req.body;
    try {
        // Update the account_id for a specific payment method
        const result = await pool.query('UPDATE payment_methods SET account_id = $1 WHERE id = $2 RETURNING *', [accountId, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Metode pembayaran tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error mapping payment method account:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan maping akun.' });
    }
};

const createPaymentMethod = async (req, res) => {
    const { name, is_active } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama metode pembayaran wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO payment_methods (name, is_active) VALUES ($1, $2) RETURNING *',
            [name.trim(), is_active]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating payment method:', err.message);
        if (err.code === '23505') { // unique_violation
            return res.status(400).json({ error: 'Nama metode pembayaran sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat metode pembayaran baru.' });
    }
};

const updatePaymentMethod = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama metode pembayaran wajib diisi.' });
    }
    // Konversi eksplisit dari string "true" atau "false" ke boolean
    const isActiveBoolean = is_active === 'true' || is_active === true;

    try {
        const result = await pool.query(
            'UPDATE payment_methods SET name = $1, is_active = $2 WHERE id = $3 RETURNING *',
            [name.trim(), isActiveBoolean, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Metode pembayaran tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating payment method:', err.message);
        if (err.code === '23505') { // unique_violation
            return res.status(400).json({ error: 'Nama metode pembayaran sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui metode pembayaran.' });
    }
};

const deletePaymentMethod = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM payment_methods WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Metode pembayaran tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting payment method:', err.message);
        if (err.code === '23503') { // foreign_key_violation
            return res.status(400).json({ error: 'Gagal menghapus. Metode pembayaran ini masih terhubung dengan data transaksi atau akun.' });
        }
        res.status(500).json({ error: 'Gagal menghapus metode pembayaran.' });
    }
};

const mapLoanAccount = async (req, res) => {
    const { id } = req.params;
    const { accountId } = req.body;
    try {
        const result = await pool.query('UPDATE loan_types SET account_id = $1 WHERE id = $2 RETURNING *', [accountId, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Tipe pinjaman tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error mapping loan account:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan maping akun.' });
    }
};

const getReceivableLogistics = async (req, res) => {
    try {
        const query = `
            SELECT 
                le.reference_number,
                MIN(le.entry_date) as entry_date,
                s.name as supplier_name,
                SUM(le.total_amount) as total_purchase
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            WHERE le.status = 'Pending'
            GROUP BY le.reference_number, s.name
            ORDER BY MIN(le.entry_date) ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching receivable logistics:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data penerimaan barang.' });
    }
};

const receiveLogisticsItems = async (req, res) => {
    const { referenceNumber } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get all items for the reference number
        const itemsRes = await client.query(`
            SELECT le.*, mp.name as product_name
            FROM logistics_entries le
            JOIN master_products mp ON le.master_product_id = mp.id
            WHERE le.reference_number = $1 AND le.status = $2 FOR UPDATE
        `, [referenceNumber, 'Pending']);
        if (itemsRes.rows.length === 0) {
            throw new Error('Tidak ada barang yang bisa diterima untuk nomor referensi ini atau sudah diterima.');
        }
        const items = itemsRes.rows;
        const supplierId = items[0].supplier_id;
        const entryDate = items[0].entry_date;
        const totalAmount = items.reduce((sum, item) => sum + parseFloat(item.total_amount), 0);

        // 2. Update stock for each product
        for (const item of items) {
            await client.query(
                'UPDATE products SET stock = stock + $1 WHERE name = $2',
                // 'quantity' dari logistics_entries adalah NUMERIC, yang oleh pg driver dikembalikan sebagai string.
                // 'stock' di tabel products adalah INTEGER. Kita harus mem-parsing string menjadi angka
                // untuk mencegah error 'invalid input syntax for type integer'.
                [parseInt(item.quantity, 10), item.product_name]
            );
        }

        // 3. Create Journal Entry (Debit Inventory, Credit Accounts Payable)
        const inventoryAccountId = 8; // ID untuk 'Persediaan Barang Dagang'
        const payableAccountId = 6;   // ID untuk 'Hutang Usaha'
        const description = `Pembelian barang dari supplier ref: ${referenceNumber}`;
        
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [entryDate, description, referenceNumber]);
        const journalId = journalHeaderRes.rows[0].id;

        const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
        await client.query(journalEntriesQuery, [journalId, inventoryAccountId, totalAmount, payableAccountId]);

        // 4. Create Accounts Payable entry
        await client.query(
            'INSERT INTO accounts_payable (supplier_id, reference_number, transaction_date, total_amount, journal_id) VALUES ($1, $2, $3, $4, $5)',
            [supplierId, referenceNumber, entryDate, totalAmount, journalId]
        );

        // 5. Update logistics entries status
        await client.query(
            "UPDATE logistics_entries SET status = 'Received' WHERE reference_number = $1",
            [referenceNumber]
        );

        await client.query('COMMIT');
        res.json({ message: `Barang dengan referensi ${referenceNumber} berhasil diterima.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error receiving logistics items:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses penerimaan barang.' });
    } finally {
        client.release();
    }
};

const getPayables = async (req, res) => {
    const { search, status, startDate, endDate, page = 1, limit = 10 } = req.query;

    try {
        let baseQuery = `
            FROM accounts_payable ap
            LEFT JOIN suppliers s ON ap.supplier_id = s.id
        `;
        
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (search) {
            conditions.push(`(s.name ILIKE $${paramIndex} OR ap.reference_number ILIKE $${paramIndex})`);
            values.push(`%${search}%`);
            paramIndex++;
        }
        if (status) {
            conditions.push(`ap.status = $${paramIndex++}`);
            values.push(status);
        }
        if (startDate) {
            conditions.push(`ap.transaction_date >= $${paramIndex++}`);
            values.push(startDate);
        }
        if (endDate) {
            conditions.push(`ap.transaction_date <= $${paramIndex++}`);
            values.push(endDate);
        }

        const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
        
        const countQuery = `SELECT COUNT(ap.id) ${baseQuery}${whereClause}`;
        const countResult = await pool.query(countQuery, values);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit) || 1;
        const offset = (page - 1) * limit;

        const dataQuery = `
            SELECT 
                ap.id,
                ap.reference_number,
                ap.transaction_date,
                ap.total_amount,
                ap.amount_paid,
                (ap.total_amount - ap.amount_paid) as remaining_amount,
                ap.status,
                s.name as supplier_name
            ${baseQuery}${whereClause}
            ORDER BY ap.status ASC, ap.transaction_date ASC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

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
        console.error('Error fetching payables:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data hutang usaha.' });
    }
};

const getPayableDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const headerQuery = `
            SELECT ap.*, s.name as supplier_name 
            FROM accounts_payable ap 
            LEFT JOIN suppliers s ON ap.supplier_id = s.id
            WHERE ap.id = $1
        `;
        const paymentsQuery = 'SELECT * FROM ap_payments WHERE payable_id = $1 ORDER BY payment_date DESC';

        const [headerRes, paymentsRes] = await Promise.all([
            pool.query(headerQuery, [id]),
            pool.query(paymentsQuery, [id])
        ]);

        if (headerRes.rows.length === 0) {
            return res.status(404).json({ error: 'Data hutang tidak ditemukan.' });
        }

        res.json({
            header: headerRes.rows[0],
            payments: paymentsRes.rows
        });
    } catch (err) {
        console.error('Error fetching payable details:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail hutang.' });
    }
};

const recordPayablePayment = async (req, res) => {
    const { payableId, paymentDate, amount, paymentMethod } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const payableRes = await client.query('SELECT * FROM accounts_payable WHERE id = $1 FOR UPDATE', [payableId]);
        if (payableRes.rows.length === 0) throw new Error('Hutang tidak ditemukan.');
        const payable = payableRes.rows[0];
        
        const amountToPay = parseFloat(amount);
        if (isNaN(amountToPay) || amountToPay <= 0) throw new Error('Jumlah pembayaran tidak valid.');

        const newAmountPaid = parseFloat(payable.amount_paid) + amountToPay;
        if (newAmountPaid > parseFloat(payable.total_amount)) {
            throw new Error('Jumlah pembayaran melebihi sisa hutang.');
        }

        const payableAccountId = 6; // Hutang Usaha
        const cashAccountId = 3;    // Kas
        const description = `Pembayaran hutang ke supplier ref: ${payable.reference_number}`;
        
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [paymentDate, description, payable.reference_number]);
        const journalId = journalHeaderRes.rows[0].id;

        const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
        await client.query(journalEntriesQuery, [journalId, payableAccountId, amountToPay, cashAccountId]);

        await client.query(
            'INSERT INTO ap_payments (payable_id, payment_date, amount, payment_method, journal_id) VALUES ($1, $2, $3, $4, $5)',
            [payableId, paymentDate, amountToPay, paymentMethod, journalId]
        );

        const newStatus = newAmountPaid >= parseFloat(payable.total_amount) ? 'Paid' : 'Partially Paid';
        await client.query(
            'UPDATE accounts_payable SET amount_paid = $1, status = $2 WHERE id = $3',
            [newAmountPaid, newStatus, payableId]
        );

        await client.query('COMMIT');
        res.json({ message: 'Pembayaran berhasil dicatat.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error recording payable payment:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mencatat pembayaran.' });
    } finally {
        client.release();
    }
};

const getStockCardHistory = async (req, res) => {
    const { productId } = req.query;

    if (!productId) {
        return res.json([]); // Return empty array if no product is selected
    }

    try {
        // Get master product ID from the shop product ID
        const productRes = await pool.query('SELECT name FROM products WHERE id = $1', [productId]);
        if (productRes.rows.length === 0) return res.status(404).json({ error: 'Produk toko tidak ditemukan.' });
        const productName = productRes.rows[0].name; // Assuming product names are unique
        const masterProductRes = await pool.query('SELECT id FROM master_products WHERE name = $1', [productName]);
        const masterProductId = masterProductRes.rows[0]?.id;

        // Query for all "IN" movements (from logistics)
        const inQuery = `
            SELECT 
                entry_date as date,
                'Penerimaan dari ' || COALESCE(s.name, 'N/A') || ' (Ref: ' || reference_number || ')' as description,
                quantity as "in_qty",
                0 as "out_qty"
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            WHERE le.master_product_id = $1 AND le.status = 'Received'
        `;

        // For now, we only have IN movements. This can be expanded later with sales data.
        const movementsQuery = `${inQuery} ORDER BY date ASC`;
        const movementsRes = masterProductId ? await pool.query(movementsQuery, [masterProductId]) : { rows: [] };
        
        // Process movements to calculate running balance
        let runningBalance = 0;
        const history = movementsRes.rows.map(mov => {
            const in_qty = parseInt(mov.in_qty, 10) || 0;
            const out_qty = parseInt(mov.out_qty, 10) || 0;
            runningBalance += in_qty - out_qty;
            return {
                date: mov.date,
                description: mov.description,
                in_qty,
                out_qty,
                balance: runningBalance
            };
        });

        res.json(history);

    } catch (err) {
        console.error('Error fetching stock card history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat kartu stok.' });
    }
};

const getAllProductsForDropdown = async (req, res) => {
     try {
        const result = await pool.query('SELECT id, name FROM products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
}

const getShuRules = async (req, res) => {
    const { year } = req.params;

    if (!year || isNaN(parseInt(year))) {
        return res.status(400).json({ error: 'Tahun yang valid diperlukan.' });
    }

    try {
        const result = await pool.query('SELECT * FROM shu_rules WHERE year = $1', [year]);

        let rules;
        if (result.rows.length > 0) {
            const dbRow = result.rows[0];
            // Map database columns to a JS object, parsing values to floats.
            rules = {
                reserve_fund_percentage: parseFloat(dbRow.reserve_fund_percentage),
                member_business_service_percentage: parseFloat(dbRow.member_business_service_percentage),
                member_capital_service_percentage: parseFloat(dbRow.member_capital_service_percentage),
                management_fund_percentage: parseFloat(dbRow.management_fund_percentage),
                education_fund_percentage: parseFloat(dbRow.education_fund_percentage),
                social_fund_percentage: parseFloat(dbRow.social_fund_percentage),
            };
        } else {
            // If no rules exist for the year, return the database's default values.
            // This ensures consistency and helps pre-fill the form on the frontend.
            rules = {
                reserve_fund_percentage: 25.00,
                member_business_service_percentage: 40.00,
                member_capital_service_percentage: 20.00,
                management_fund_percentage: 5.00,
                education_fund_percentage: 5.00,
                social_fund_percentage: 5.00,
            };
        }

        res.json(rules);
    } catch (err) {
        console.error(`Error fetching SHU rules for year ${year}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil aturan SHU.' });
    }
};

const saveShuRules = async (req, res) => {
    const { year, member_business_service_percentage, member_capital_service_percentage, reserve_fund_percentage, management_fund_percentage, education_fund_percentage, social_fund_percentage } = req.body;

    if (!year) return res.status(400).json({ error: 'Tahun diperlukan.' });

    const requiredKeys = [
        'reserve_fund_percentage', 'member_business_service_percentage', 'member_capital_service_percentage',
        'management_fund_percentage', 'education_fund_percentage', 'social_fund_percentage'
    ];

    const values = requiredKeys.map(key => parseFloat(req.body[key]));

    if (values.some(isNaN)) {
        return res.status(400).json({ error: 'Semua nilai persentase harus diisi dengan benar.' });
    }

    const totalPercentage = values.reduce((sum, value) => sum + value, 0);

    if (Math.abs(totalPercentage - 100) > 0.01) {
        return res.status(400).json({ error: `Total persentase harus 100%, saat ini: ${totalPercentage}%.` });
    }

    try {
        const query = `
            INSERT INTO shu_rules (year, reserve_fund_percentage, member_business_service_percentage, member_capital_service_percentage, management_fund_percentage, education_fund_percentage, social_fund_percentage)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (year) DO UPDATE SET
                reserve_fund_percentage = EXCLUDED.reserve_fund_percentage,
                member_business_service_percentage = EXCLUDED.member_business_service_percentage,
                member_capital_service_percentage = EXCLUDED.member_capital_service_percentage,
                management_fund_percentage = EXCLUDED.management_fund_percentage,
                education_fund_percentage = EXCLUDED.education_fund_percentage,
                social_fund_percentage = EXCLUDED.social_fund_percentage
            RETURNING *;
        `;
        
        const result = await pool.query(query, [year, reserve_fund_percentage, member_business_service_percentage, member_capital_service_percentage, management_fund_percentage, education_fund_percentage, social_fund_percentage]);
        res.json({ message: `Aturan SHU untuk tahun ${year} berhasil disimpan.`, data: result.rows[0] });
    } catch (err) {
        console.error(`Error saving SHU rules for year ${year}:`, err.message);
        res.status(500).json({ error: 'Gagal menyimpan aturan SHU. Pastikan total persentase adalah 100.' });
    }
};

const calculateShuPreview = async (req, res) => {
    const { year, totalShu } = req.body;

    if (!year || !totalShu || isNaN(parseInt(year)) || isNaN(parseFloat(totalShu)) || parseFloat(totalShu) <= 0) {
        return res.status(400).json({ error: 'Tahun dan Total SHU yang valid diperlukan.' });
    }

    const client = await pool.connect();
    try {
        // NOTE: This is a preview, so we don't commit any changes.
        // A transaction is used to ensure all reads are consistent.
        await client.query('BEGIN');

        // 1. Get SHU rules for the year
        const rulesRes = await client.query('SELECT * FROM shu_rules WHERE year = $1', [year]);
        if (rulesRes.rows.length === 0) {
            throw new Error(`Aturan SHU untuk tahun ${year} belum diatur.`);
        }
        const rules = rulesRes.rows[0];
        const businessServicePercentage = parseFloat(rules.member_business_service_percentage);
        const capitalServicePercentage = parseFloat(rules.member_capital_service_percentage);

        // 2. Calculate total SHU allocations
        const allocatedForBusiness = parseFloat(totalShu) * (businessServicePercentage / 100);
        const allocatedForCapital = parseFloat(totalShu) * (capitalServicePercentage / 100);

        // 3. Get total contributions (all member sales and savings) for the year
        const yearEndDate = `${year}-12-31`;
        const yearStartDate = `${year}-01-01`;

        // Total sales made TO members during the year.
        // This assumes the 'sales' table has a 'member_id' column that is populated
        // when a member makes a purchase.
        const totalSalesQuery = `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE member_id IS NOT NULL AND sale_date BETWEEN $1 AND $2`;
        const totalSalesRes = await client.query(totalSalesQuery, [yearStartDate, yearEndDate]);
        const totalAllMemberSales = parseFloat(totalSalesRes.rows[0].total);

        // Total savings of all members at the end of the year
        const totalSavingsQuery = `SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE status = 'Approved' AND date <= $1`;
        const totalSavingsRes = await client.query(totalSavingsQuery, [yearEndDate]);
        const totalAllMemberSavings = parseFloat(totalSavingsRes.rows[0].total);

        // 4. Get individual member contributions
        const memberContributionsQuery = `
            SELECT
                m.id,
                m.name,
                (
                    SELECT COALESCE(SUM(s.amount), 0)
                    FROM savings s
                    WHERE s.member_id = m.id AND s.status = 'Approved' AND s.date <= $1
                ) AS total_member_savings,
                (
                    SELECT COALESCE(SUM(sl.total_amount), 0)
                    FROM sales sl
                    WHERE sl.member_id = m.id AND sl.sale_date BETWEEN $2 AND $1
                ) AS total_member_sales
            FROM members m
            WHERE m.status = 'Active' AND m.role = 'member'
        `;
        const memberContributionsRes = await client.query(memberContributionsQuery, [yearEndDate, yearStartDate]);

        // 5. Calculate SHU for each member
        const distribution = memberContributionsRes.rows.map(member => {
            const memberSavings = parseFloat(member.total_member_savings);
            const memberSales = parseFloat(member.total_member_sales);

            const shuFromCapital = (totalAllMemberSavings > 0) ? (memberSavings / totalAllMemberSavings) * allocatedForCapital : 0;
            const shuFromBusiness = (totalAllMemberSales > 0) ? (memberSales / totalAllMemberSales) * allocatedForBusiness : 0;
            const totalMemberShu = shuFromCapital + shuFromBusiness;

            return { memberId: member.id, memberName: member.name, shuFromCapital: Math.round(shuFromCapital), shuFromBusiness: Math.round(shuFromBusiness), totalMemberShu: Math.round(totalMemberShu) };
        }).filter(d => d.totalMemberShu > 0);

        await client.query('ROLLBACK');

        res.json({ summary: { totalShu: parseFloat(totalShu), allocatedForBusiness, allocatedForCapital }, distribution });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error calculating SHU preview:', err.message);
        res.status(400).json({ error: err.message || 'Gagal menghitung pratinjau SHU.' });
    } finally {
        client.release();
    }
};

const postShuDistribution = async (req, res) => {
    const { year, totalShu } = req.body;

    if (!year || !totalShu || isNaN(parseInt(year)) || isNaN(parseFloat(totalShu)) || parseFloat(totalShu) <= 0) {
        return res.status(400).json({ error: 'Tahun dan Total SHU yang valid diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Validate: Check if distribution for this year has already been posted
        const existingDist = await client.query('SELECT id FROM shu_distributions WHERE year = $1 LIMIT 1', [year]);
        if (existingDist.rows.length > 0) {
            throw new Error(`Distribusi SHU untuk tahun ${year} sudah pernah dilakukan.`);
        }

        // --- Recalculate SHU distribution on the server to ensure data integrity ---
        
        // 2. Get SHU rules for the year
        const rulesRes = await client.query('SELECT * FROM shu_rules WHERE year = $1', [year]);
        if (rulesRes.rows.length === 0) throw new Error(`Aturan SHU untuk tahun ${year} belum diatur.`);
        const rules = rulesRes.rows[0];
        const businessServicePercentage = parseFloat(rules.member_business_service_percentage);
        const capitalServicePercentage = parseFloat(rules.member_capital_service_percentage);

        // 3. Calculate total SHU allocations for members
        const allocatedForBusiness = parseFloat(totalShu) * (businessServicePercentage / 100);
        const allocatedForCapital = parseFloat(totalShu) * (capitalServicePercentage / 100);
        const totalAllocatedForMembers = allocatedForBusiness + allocatedForCapital;

        // 4. Get total contributions (all member sales and savings) for the year
        const yearEndDate = `${year}-12-31`;
        const yearStartDate = `${year}-01-01`;

        // IMPORTANT: This calculation relies on sales being associated with a member_id.
        const totalSalesQuery = `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE member_id IS NOT NULL AND sale_date BETWEEN $1 AND $2`;
        const totalSalesRes = await client.query(totalSalesQuery, [yearStartDate, yearEndDate]);
        const totalAllMemberSales = parseFloat(totalSalesRes.rows[0].total);

        const totalSavingsQuery = `SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE status = 'Approved' AND date <= $1`;
        const totalSavingsRes = await client.query(totalSavingsQuery, [yearEndDate]);
        const totalAllMemberSavings = parseFloat(totalSavingsRes.rows[0].total);

        // 5. Get individual member contributions
        const memberContributionsQuery = `
            SELECT
                m.id, m.name,
                (SELECT COALESCE(SUM(s.amount), 0) FROM savings s WHERE s.member_id = m.id AND s.status = 'Approved' AND s.date <= $1) AS total_member_savings,
                (SELECT COALESCE(SUM(sl.total_amount), 0) FROM sales sl WHERE sl.member_id = m.id AND sl.sale_date BETWEEN $2 AND $1) AS total_member_sales
            FROM members m
            WHERE m.status = 'Active' AND m.role = 'member'
        `;
        const memberContributionsRes = await client.query(memberContributionsQuery, [yearEndDate, yearStartDate]);

        // 6. Calculate SHU for each member
        const distributionList = memberContributionsRes.rows.map(member => {
            const memberSavings = parseFloat(member.total_member_savings);
            const memberSales = parseFloat(member.total_member_sales);
            const shuFromCapital = (totalAllMemberSavings > 0) ? (memberSavings / totalAllMemberSavings) * allocatedForCapital : 0;
            const shuFromBusiness = (totalAllMemberSales > 0) ? (memberSales / totalAllMemberSales) * allocatedForBusiness : 0;
            const totalMemberShu = shuFromCapital + shuFromBusiness;
            return { memberId: member.id, memberName: member.name, shuFromCapital: Math.round(shuFromCapital), shuFromBusiness: Math.round(shuFromBusiness), totalMemberShu: Math.round(totalMemberShu) };
        }).filter(d => d.totalMemberShu > 0);

        if (distributionList.length === 0) throw new Error('Tidak ada anggota yang memenuhi syarat untuk menerima SHU.');

        // 7. Get required IDs for savings and journaling
        const savingTypeRes = await client.query("SELECT id, account_id FROM saving_types WHERE name = 'Simpanan SHU' LIMIT 1");
        if (savingTypeRes.rows.length === 0) throw new Error("Tipe simpanan 'Simpanan SHU' tidak ditemukan. Harap buat terlebih dahulu di pengaturan.");
        const shuSavingTypeId = savingTypeRes.rows[0].id;
        const shuSavingAccountId = savingTypeRes.rows[0].account_id;
        if (!shuSavingAccountId) throw new Error("Tipe simpanan 'Simpanan SHU' belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.");

        // 8. Create Journal Entry for the entire SHU distribution
        const journalDescription = `Distribusi SHU Tahun ${year}`;
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [journalDescription, `SHU-${year}`]);
        const journalId = journalHeaderRes.rows[0].id;

        // Improvement: Fetch account IDs dynamically instead of hardcoding them.
        const getAccountId = async (accountNumber) => {
            const res = await client.query('SELECT id FROM chart_of_accounts WHERE account_number = $1', [accountNumber]);
            if (res.rows.length === 0) throw new Error(`Akun COA dengan nomor ${accountNumber} tidak ditemukan.`);
            return res.rows[0].id;
        };

        const [
            shuAccountId,
            reserveFundAccountId,
            managementFundAccountId,
            educationFundAccountId,
            socialFundAccountId
        ] = await Promise.all([
            getAccountId('3-2120'), // SHU Tahun Berjalan
            getAccountId('3-1110'), // Dana Cadangan
            getAccountId('3-1120'), // Dana Pengurus & Karyawan
            getAccountId('3-1130'), // Dana Pendidikan
            getAccountId('3-1140')  // Dana Sosial
        ]);

        // Calculate fund allocations
        const allocatedForReserve = parseFloat(totalShu) * (parseFloat(rules.reserve_fund_percentage) / 100);
        const allocatedForManagement = parseFloat(totalShu) * (parseFloat(rules.management_fund_percentage) / 100);
        const allocatedForEducation = parseFloat(totalShu) * (parseFloat(rules.education_fund_percentage) / 100);
        const allocatedForSocial = parseFloat(totalShu) * (parseFloat(rules.social_fund_percentage) / 100);
        
        const journalEntries = [
            { account_id: shuAccountId, debit: totalShu, credit: 0 }, // Debit SHU
            { account_id: reserveFundAccountId, debit: 0, credit: allocatedForReserve },
            { account_id: managementFundAccountId, debit: 0, credit: allocatedForManagement },
            { account_id: educationFundAccountId, debit: 0, credit: allocatedForEducation },
            { account_id: socialFundAccountId, debit: 0, credit: allocatedForSocial },
            { account_id: shuSavingAccountId, debit: 0, credit: totalAllocatedForMembers } // Credit total member savings liability
        ];

        const journalQueryParts = journalEntries.map((_, i) => `($1, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4})`);
        const journalValues = [journalId, ...journalEntries.flatMap(e => [e.account_id, e.debit, e.credit])];
        const journalQuery = `INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ${journalQueryParts.join(', ')}`;
        await client.query(journalQuery, journalValues);

        // 9. Bulk insert into shu_distributions and savings tables
        const shuDistQuery = `INSERT INTO shu_distributions (member_id, year, total_shu_amount, shu_from_capital, shu_from_services) VALUES ${distributionList.map((_, i) => `($${i*5+1}, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5})`).join(', ')}`;
        await client.query(shuDistQuery, distributionList.flatMap(d => [d.memberId, year, d.totalMemberShu, d.shuFromCapital, d.shuFromBusiness]));

        const savingsQuery = `INSERT INTO savings (member_id, saving_type_id, amount, date, status, description) VALUES ${distributionList.map((_, i) => `($${i*5+1}, $${i*5+2}, $${i*5+3}, NOW(), 'Approved', $${i*5+4})`).join(', ')}`;
        await client.query(savingsQuery, distributionList.flatMap(d => [d.memberId, shuSavingTypeId, d.totalMemberShu, `SHU Tahun ${year}`]));

        // 10. Create notifications for members
        for (const memberDist of distributionList) {
            createNotification(
                memberDist.memberId,
                `Selamat! Anda menerima SHU tahun ${year} sebesar ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(memberDist.totalMemberShu)}.`,
                'shu-history' // Target page in frontend
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ message: `Distribusi SHU untuk tahun ${year} berhasil diposting.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error posting SHU distribution:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memposting distribusi SHU.' });
    } finally {
        client.release();
    }
};

const getIncomeStatement = async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Tanggal mulai dan tanggal akhir diperlukan.' });
    }

    try {
        const query = `
            SELECT
                coa.account_type,
                coa.account_name,
                coa.account_number,
                CASE
                    WHEN coa.account_type = 'Pendapatan' THEN SUM(je.credit - je.debit)
                    ELSE SUM(je.debit - je.credit)
                END as total
            FROM journal_entries je
            JOIN chart_of_accounts coa ON je.account_id = coa.id
            JOIN general_journal gj ON je.journal_id = gj.id
            WHERE gj.entry_date BETWEEN $1 AND $2
              AND coa.account_type IN ('Pendapatan', 'HPP', 'Biaya')
            GROUP BY coa.account_type, coa.account_name, coa.account_number
            HAVING SUM(je.credit - je.debit) != 0 OR SUM(je.debit - je.credit) != 0
            ORDER BY coa.account_type, coa.account_number;
        `;

        const result = await pool.query(query, [startDate, endDate]);

        // Structure the data for the frontend
        const report = {
            revenue: { items: [], total: 0 },
            cogs: { items: [], total: 0 },
            expense: { items: [], total: 0 },
            grossProfit: 0,
            netIncome: 0
        };

        result.rows.forEach(row => {
            const total = parseFloat(row.total);
            const item = { name: row.account_name, number: row.account_number, total };

            if (row.account_type === 'Pendapatan') {
                report.revenue.items.push(item);
                report.revenue.total += total;
            } else if (row.account_type === 'HPP') {
                report.cogs.items.push(item);
                report.cogs.total += total;
            } else if (row.account_type === 'Biaya') {
                report.expense.items.push(item);
                report.expense.total += total;
            }
        });

        report.grossProfit = report.revenue.total - report.cogs.total;
        report.netIncome = report.grossProfit - report.expense.total;

        res.json(report);

    } catch (err) {
        console.error('Error generating income statement:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan laba rugi.' });
    }
};

const getSalesReport = async (req, res) => {
    const { startDate, endDate, shopType } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Tanggal mulai dan tanggal akhir diperlukan.' });
    }

    try {
        const params = [startDate, endDate];
        let shopTypeCondition = '';
        if (shopType) {
            params.push(shopType);
            // The parameter index will be $3
            shopTypeCondition = ` AND s.shop_type = $${params.length}`;
        }

        const summaryQuery = `
            SELECT
                COUNT(id) as "transactionCount",
                COALESCE(SUM(total_amount), 0) as "totalRevenue",
                (SELECT COALESCE(SUM(quantity), 0) FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE s.sale_date BETWEEN $1 AND $2 AND s.status = 'Selesai' ${shopTypeCondition}) as "totalItemsSold"
            FROM sales
            WHERE sale_date BETWEEN $1 AND $2 AND status = 'Selesai' ${shopTypeCondition};
        `;

        const byProductQuery = `
            SELECT
                p.name,
                SUM(si.quantity) as total_quantity,
                SUM(si.subtotal) as total_revenue,
                SUM(si.quantity * si.cost_per_item) as total_cogs
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            WHERE s.sale_date BETWEEN $1 AND $2 AND s.status = 'Selesai' ${shopTypeCondition}
            GROUP BY p.name
            ORDER BY total_revenue DESC;
        `;

        const byMemberQuery = `
            SELECT
                m.name,
                m.cooperative_number,
                COUNT(s.id) as transaction_count,
                SUM(s.total_amount) as total_spent
            FROM sales s
            JOIN members m ON s.member_id = m.id
            WHERE s.sale_date BETWEEN $1 AND $2 AND s.member_id IS NOT NULL AND s.status = 'Selesai' ${shopTypeCondition}
            GROUP BY m.name, m.cooperative_number
            ORDER BY total_spent DESC;
        `;

        const [summaryRes, byProductRes, byMemberRes] = await Promise.all([
            pool.query(summaryQuery, params),
            pool.query(byProductQuery, params),
            pool.query(byMemberQuery, params),
        ]);

        const byProductWithProfit = byProductRes.rows.map(p => ({
            ...p,
            gross_profit: parseFloat(p.total_revenue) - parseFloat(p.total_cogs || 0)
        }));

        const totalGrossProfit = byProductWithProfit.reduce((sum, p) => sum + p.gross_profit, 0);

        const summary = {
            transactionCount: parseInt(summaryRes.rows[0].transactionCount, 10),
            totalRevenue: parseFloat(summaryRes.rows[0].totalRevenue),
            totalItemsSold: parseInt(summaryRes.rows[0].totalItemsSold, 10),
            totalGrossProfit: totalGrossProfit
        };

        res.json({
            summary,
            byProduct: byProductWithProfit,
            byMember: byMemberRes.rows,
        });

    } catch (err) {
        console.error('Error generating sales report:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan penjualan.' });
    }
};

const createSale = async (req, res) => {
    // Jika request datang dari anggota (tanpa token admin), req.user akan undefined.
    // Jika dari admin, kita gunakan ID admin. Jika dari anggota, kita gunakan memberId dari body.
    const { items, paymentMethod, memberId, shopType } = req.body;
    const createdByUserId = req.user.id; // Selalu ambil dari token karena rute ini dilindungi.
    const saleMemberId = req.user.role === 'member' ? req.user.id : (memberId || null); // Jika member, ID-nya sendiri. Jika kasir, ambil dari body.
    // Jika role adalah 'member', statusnya 'Menunggu Pengambilan'. Jika bukan (admin/kasir), statusnya 'Selesai'.
    const status = req.user.role === 'member' ? 'Menunggu Pengambilan' : 'Selesai'; 

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Keranjang belanja kosong.' });
    }

    if (!shopType) {
        return res.status(400).json({ error: 'Tipe toko (shopType) diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // If a member is associated with the sale (either as buyer or creator), validate them.
        if (saleMemberId) {
            const memberRes = await client.query('SELECT id FROM members WHERE id = $1 AND status = \'Active\'', [saleMemberId]);
            if (memberRes.rows.length === 0) {
                throw new Error(`Anggota dengan ID ${memberId} tidak ditemukan atau tidak aktif.`);
            }
        }

        let totalSaleAmount = 0;
        let totalCostOfGoodsSold = 0;
        const processedItems = [];

        for (const item of items) {
            // 1. Get product details and lock the row for update
            const productRes = await client.query('SELECT name, price, stock, shop_type FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
            if (productRes.rows.length === 0) throw new Error(`Produk dengan ID ${item.productId} tidak ditemukan.`);
            
            const product = productRes.rows[0];
            const requestedQty = parseInt(item.quantity, 10);

            // 2. Check stock
            if (product.stock < requestedQty) throw new Error(`Stok tidak mencukupi untuk produk "${product.name}". Sisa stok: ${product.stock}.`);

            // 3. Get latest purchase price as COGS
            const cogsRes = await client.query(
                `SELECT le.purchase_price 
                 FROM logistics_entries le
                 JOIN master_products mp ON le.master_product_id = mp.id
                 WHERE mp.name = $1 AND le.status = 'Received' 
                 ORDER BY le.entry_date DESC, le.id DESC LIMIT 1`,
                 [product.name]
            );
            // If no purchase history, we can't calculate COGS. Use 0 as a fallback.
            const costPerItem = cogsRes.rows.length > 0 ? parseFloat(cogsRes.rows[0].purchase_price) : 0;

            // 4. Update stock
            await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [requestedQty, item.productId]);

            const pricePerItem = parseFloat(product.price);
            totalSaleAmount += pricePerItem * requestedQty;
            totalCostOfGoodsSold += costPerItem * requestedQty;

            processedItems.push({
                ...item,
                pricePerItem,
                costPerItem
            });
        }

        // 5. Create sales header
        const orderId = `KOP-${Date.now()}`;
        const saleRes = await client.query(
            'INSERT INTO sales (order_id, total_amount, payment_method, created_by_user_id, member_id, sale_date, status, shop_type) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7) RETURNING id, order_id',
            [orderId, totalSaleAmount, paymentMethod, createdByUserId, saleMemberId, status, shopType]
        );
        const saleId = saleRes.rows[0].id;

        // 6. Create sale items
        const saleItemsQueryParts = processedItems.map((_, i) => 
            `($1, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4}, $${i*4 + 5})`
        ).join(', ');
        
        const saleItemsValues = [saleId, ...processedItems.flatMap(p => 
            [p.productId, p.quantity, p.pricePerItem, p.costPerItem]
        )];

        const saleItemsQuery = `INSERT INTO sale_items (sale_id, product_id, quantity, price, cost_per_item) VALUES ${saleItemsQueryParts}`;
        await client.query(saleItemsQuery, saleItemsValues);

        // 7. Create journal entries ONLY if the sale is completed by a cashier/admin
        if (status === 'Selesai') {
            const paymentMethodRes = await client.query('SELECT account_id FROM payment_methods WHERE name = $1', [paymentMethod]);
            if (!paymentMethod || paymentMethodRes.rows.length === 0 || !paymentMethodRes.rows[0].account_id) {
                throw new Error(`Metode pembayaran "${paymentMethod}" tidak valid atau belum terhubung ke akun COA.`);
            }
            const debitAccountId = paymentMethodRes.rows[0].account_id;

            const inventoryAccountId = 8; // Persediaan Barang Dagang
            const salesRevenueAccountId = 12; // Pendapatan Penjualan
            const cogsAccountId = 13; // HPP
            const description = `Penjualan Toko Struk #${saleId}`;

            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, `SALE-${saleId}`]);
            const journalId = journalHeaderRes.rows[0].id;

            const journalEntriesQuery = `INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3), ($1, $5, $6, 0), ($1, $7, 0, $6)`;
            await client.query(journalEntriesQuery, [journalId, debitAccountId, totalSaleAmount, salesRevenueAccountId, cogsAccountId, totalCostOfGoodsSold, inventoryAccountId]);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Penjualan berhasil dicatat.', saleId: saleId, orderId: saleRes.rows[0].order_id });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating sale:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses penjualan.' });
    } finally {
        client.release();
    }
};

const completeOrder = async (req, res) => {
    const { orderId, paymentMethod, memberId, loanTermId } = req.body;
    const { id: cashierId } = req.user;

    if (!orderId || !paymentMethod) {
        return res.status(400).json({ error: 'ID Pesanan dan metode pembayaran diperlukan.' });
    }
    const isLedgerPayment = paymentMethod.toLowerCase().includes('gaji') || paymentMethod.toLowerCase().includes('ledger');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get sale details and lock the row
        const saleRes = await client.query("SELECT * FROM sales WHERE order_id = $1 AND status = 'Menunggu Pengambilan' FOR UPDATE", [orderId]);
        if (saleRes.rows.length === 0) {
            throw new Error('Pesanan tidak ditemukan atau sudah diproses.');
        }
        const sale = saleRes.rows[0];

        let journalId;
        if (isLedgerPayment) {
            // --- LOGIKA BARU: Buat Pinjaman Otomatis ---
            if (!memberId) throw new Error('ID Anggota diperlukan untuk pembayaran Potong Gaji.');
            if (!loanTermId) throw new Error('Tenor pinjaman wajib dipilih untuk pembayaran potong gaji.');

            const termRes = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loanTermId]);
            if (termRes.rows.length === 0) throw new Error('Tenor pinjaman tidak valid.');
            const loanTypeId = termRes.rows[0].loan_type_id;

            const loanInsertQuery = `
                INSERT INTO loans (member_id, loan_type_id, loan_term_id, amount, date, status, remaining_principal)
                VALUES ($1, $2, $3, $4, NOW(), 'Approved', $4) RETURNING id
            `;
            const newLoanRes = await client.query(loanInsertQuery, [memberId, loanTypeId, loanTermId, sale.total_amount]);
            const newLoanId = newLoanRes.rows[0].id;

            // Kaitkan penjualan dengan pinjaman yang baru dibuat
            await client.query('UPDATE sales SET loan_id = $1 WHERE id = $2', [newLoanId, sale.id]);

        } else {
            // --- LOGIKA LAMA: Buat Jurnal Penjualan Tunai/Transfer ---
            const paymentMethodRes = await client.query('SELECT account_id FROM payment_methods WHERE name = $1', [paymentMethod]);
            if (paymentMethodRes.rows.length === 0 || !paymentMethodRes.rows[0].account_id) {
                throw new Error(`Metode pembayaran "${paymentMethod}" tidak valid atau belum terhubung ke akun COA.`);
            }
            const debitAccountId = paymentMethodRes.rows[0].account_id;

            const itemsRes = await client.query('SELECT SUM(cost_per_item * quantity) as total_cogs FROM sale_items WHERE sale_id = $1', [sale.id]);
            const totalCostOfGoodsSold = parseFloat(itemsRes.rows[0].total_cogs || 0);

            const inventoryAccountId = 8; const salesRevenueAccountId = 12; const cogsAccountId = 13;
            const description = `Penyelesaian pesanan #${orderId}`;
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, `SALE-${sale.id}`]);
            journalId = journalHeaderRes.rows[0].id;

            const journalEntriesQuery = `
                INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
                ($1, $2, $3, 0), ($1, $4, 0, $3), ($1, $5, $6, 0), ($1, $7, 0, $6)
            `;
            await client.query(journalEntriesQuery, [journalId, debitAccountId, sale.total_amount, salesRevenueAccountId, cogsAccountId, totalCostOfGoodsSold, inventoryAccountId]);
        }

        // Update the sale record
        await client.query(
            "UPDATE sales SET status = 'Selesai', payment_method = $1, created_by_user_id = $2, journal_id = $3 WHERE id = $4",
            [paymentMethod, cashierId, journalId, sale.id]
        );

        // Notify the member
        if (sale.member_id) {
            createNotification(
                sale.member_id,
                `Pesanan Anda #${orderId} telah selesai diproses di kasir.`,
                'transactions'
            ).catch(err => console.error(`Gagal membuat notifikasi penyelesaian pesanan untuk user ${sale.member_id}:`, err));
        }

        await client.query('COMMIT');
        res.json({ message: 'Transaksi berhasil diselesaikan.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error completing order:', err.message);
        res.status(400).json({ error: err.message || 'Gagal menyelesaikan transaksi.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Delete a pending sale order. This is used when moving an order to the general cashier.
 *          It does NOT affect stock, as the new sale from the cashier will handle stock reduction.
 * @route   DELETE /api/admin/sales/:id
 * @access  Private (Kasir, Akunting, Admin)
 */
const deleteSale = async (req, res) => {
    const { id: saleId } = req.params;
    const { role: userRole } = req.user;

    if (!['admin', 'akunting', 'kasir'].includes(userRole)) {
        return res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get sale details to ensure it's in a deletable state
        const saleRes = await client.query("SELECT id, status FROM sales WHERE id = $1 FOR UPDATE", [saleId]);
        if (saleRes.rows.length === 0) {
            throw new Error('Pesanan tidak ditemukan.');
        }
        if (saleRes.rows[0].status !== 'Menunggu Pengambilan') {
            throw new Error(`Hanya pesanan dengan status "Menunggu Pengambilan" yang dapat dihapus.`);
        }

        // 2. Delete the sale. The 'ON DELETE CASCADE' on sale_items will handle the items.
        await client.query('DELETE FROM sales WHERE id = $1', [saleId]);

        await client.query('COMMIT');
        res.status(204).send(); // 204 No Content for successful deletion
    } catch (err) { await client.query('ROLLBACK'); console.error('Error deleting sale:', err.message); res.status(400).json({ error: err.message || 'Gagal menghapus pesanan.' }); } finally { client.release(); }
};

const createManualSaving = async (req, res) => {
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
            throw new Error(`Tipe simpanan "${details.saving_type_name}" belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.`);
        }

        // 3. Create Journal Entry
        const cashAccountId = 3; // Asumsi ID Akun Kas adalah 3
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
        // Berikan pesan error yang spesifik untuk kesalahan yang diketahui
        if (err.message.includes('belum terhubung ke akun COA') || err.message.includes('tidak ditemukan')) {
            return res.status(400).json({ error: err.message });
        }
        // Untuk error lain, berikan pesan generik
        res.status(500).json({ error: 'Terjadi kesalahan internal saat mencatat simpanan.' });
    } finally {
        client.release();
    }
};

const getBalanceSheetSummary = async (req, res) => {
    // For simplicity, we'll calculate as of today.
    const endDate = new Date().toISOString().split('T')[0];

    try {
        // Query for asset, liability, and equity balances (excluding income statement accounts)
        const balanceQuery = `
            SELECT
                coa.account_type,
                COALESCE(SUM(
                    CASE
                        WHEN coa.account_type = 'Aset' THEN je.debit - je.credit
                        ELSE je.credit - je.debit
                    END
                ), 0) as total
            FROM chart_of_accounts coa
            LEFT JOIN journal_entries je ON je.account_id = coa.id
            LEFT JOIN general_journal gj ON je.journal_id = gj.id AND gj.entry_date <= $1
            WHERE coa.account_type IN ('Aset', 'Kewajiban', 'Ekuitas')
            GROUP BY coa.account_type;
        `;

        // Query for net income (retained earnings + current year income)
        const netIncomeQuery = `
            SELECT COALESCE(SUM(
                CASE
                    WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit
                    WHEN coa.account_type IN ('HPP', 'Biaya') THEN je.debit - je.credit
                    ELSE 0
                END
            ), 0) as total
            FROM journal_entries je
            JOIN chart_of_accounts coa ON je.account_id = coa.id
            JOIN general_journal gj ON je.journal_id = gj.id
            WHERE gj.entry_date <= $1 AND coa.account_type IN ('Pendapatan', 'HPP', 'Biaya');
        `;

        const [balanceResult, netIncomeResult] = await Promise.all([
            pool.query(balanceQuery, [endDate]),
            pool.query(netIncomeQuery, [endDate])
        ]);

        const summary = { assets: 0, liabilities: 0, equity: 0 };

        balanceResult.rows.forEach(row => {
            const total = parseFloat(row.total);
            if (row.account_type === 'Aset') summary.assets += total;
            else if (row.account_type === 'Kewajiban') summary.liabilities += total;
            else if (row.account_type === 'Ekuitas') summary.equity += total;
        });

        summary.equity += parseFloat(netIncomeResult.rows[0].total);
        res.json(summary);
    } catch (err) {
        console.error('Error generating balance sheet summary:', err.message);
        res.status(500).json({ error: 'Gagal membuat ringkasan neraca.' });
    }
};

const getBalanceSheet = async (req, res) => {
    const { asOfDate: endDate } = req.query;

    if (!endDate) {
        return res.status(400).json({ error: 'Tanggal laporan diperlukan.' });
    }

    const year = new Date(endDate).getFullYear();
    const yearStartDate = `${year}-01-01`;
    const prevYearEndDate = `${year - 1}-12-31`;

    try {
        // Query for balances. This gets both beginning and ending balances in one go.
        const balanceQuery = `
            SELECT
                coa.account_type,
                coa.account_name,
                coa.account_number,
                -- Beginning Balance (as of end of last year)
                COALESCE(SUM(CASE WHEN gj.entry_date <= $2 THEN
                    CASE WHEN coa.account_type = 'Aset' THEN je.debit - je.credit ELSE je.credit - je.debit END
                ELSE 0 END), 0) as beginning_balance,
                -- Ending Balance (as of asOfDate)
                COALESCE(SUM(CASE WHEN gj.entry_date <= $1 THEN
                    CASE WHEN coa.account_type = 'Aset' THEN je.debit - je.credit ELSE je.credit - je.debit END
                ELSE 0 END), 0) as ending_balance
            FROM chart_of_accounts coa
            LEFT JOIN journal_entries je ON je.account_id = coa.id
            LEFT JOIN general_journal gj ON je.journal_id = gj.id AND gj.entry_date <= $1
            WHERE coa.account_type IN ('Aset', 'Kewajiban', 'Ekuitas')
            GROUP BY coa.id
            ORDER BY coa.account_number;
        `;

        // Query for Retained Earnings (net income from all previous years)
        const retainedEarningsQuery = `
            SELECT COALESCE(SUM(
                CASE
                    WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit
                    WHEN coa.account_type IN ('HPP', 'Biaya') THEN je.debit - je.credit
                    ELSE 0
                END
            ), 0) as amount
            FROM journal_entries je
            JOIN chart_of_accounts coa ON je.account_id = coa.id
            JOIN general_journal gj ON je.journal_id = gj.id
            WHERE gj.entry_date <= $1; -- up to prevYearEndDate
        `;

        // Query for Current Period's Net Income
        const currentNetIncomeQuery = `
            SELECT COALESCE(SUM(
                CASE
                    WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit
                    WHEN coa.account_type IN ('HPP', 'Biaya') THEN je.debit - je.credit
                    ELSE 0
                END
            ), 0) as amount
            FROM journal_entries je
            JOIN chart_of_accounts coa ON je.account_id = coa.id
            JOIN general_journal gj ON je.journal_id = gj.id
            WHERE gj.entry_date BETWEEN $1 AND $2; -- between yearStartDate and endDate
        `;

        const [balanceResult, retainedEarningsResult, currentNetIncomeResult] = await Promise.all([
            pool.query(balanceQuery, [endDate, prevYearEndDate]),
            pool.query(retainedEarningsQuery, [prevYearEndDate]),
            pool.query(currentNetIncomeQuery, [yearStartDate, endDate])
        ]);

        const retainedEarnings = parseFloat(retainedEarningsResult.rows[0].amount);
        const currentNetIncome = parseFloat(currentNetIncomeResult.rows[0].amount);

        const report = {
            assets: { items: [], beginning_total: 0, ending_total: 0 },
            liabilities: { items: [], beginning_total: 0, ending_total: 0 },
            equity: { items: [], beginning_total: 0, ending_total: 0 },
        };

        balanceResult.rows.forEach(row => {
            const beginning_balance = parseFloat(row.beginning_balance);
            const ending_balance = parseFloat(row.ending_balance);

            if (beginning_balance === 0 && ending_balance === 0) return;

            const item = { name: row.account_name, number: row.account_number, beginning_balance, ending_balance };

            if (row.account_type === 'Aset') {
                report.assets.items.push(item);
                report.assets.beginning_total += beginning_balance;
                report.assets.ending_total += ending_balance;
            } else if (row.account_type === 'Kewajiban') {
                report.liabilities.items.push(item);
                report.liabilities.beginning_total += beginning_balance;
                report.liabilities.ending_total += ending_balance;
            } else if (row.account_type === 'Ekuitas') {
                report.equity.items.push(item);
                report.equity.beginning_total += beginning_balance;
                report.equity.ending_total += ending_balance;
            }
        });

        if (retainedEarnings !== 0) {
            report.equity.items.push({ name: 'Laba Ditahan', number: '3-9998', beginning_balance: retainedEarnings, ending_balance: retainedEarnings });
            report.equity.beginning_total += retainedEarnings;
            report.equity.ending_total += retainedEarnings;
        }

        if (currentNetIncome !== 0) {
            report.equity.items.push({ name: 'Laba/Rugi Tahun Berjalan', number: '3-9999', beginning_balance: 0, ending_balance: currentNetIncome });
            report.equity.ending_total += currentNetIncome;
        }

        res.json(report);
    } catch (err) {
        console.error('Error generating balance sheet:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan neraca.' });
    }
};

const getCashFlowStatement = async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Tanggal mulai dan tanggal akhir diperlukan.' });
    }

    const client = await pool.connect();
    try {
        const cashAccountId = 3; // Asumsi ID Akun Kas adalah 3

        // --- Helper function to run queries ---
        const runQuery = (query, params) => client.query(query, params).then(res => parseFloat(res.rows[0].total || 0));

        // --- Beginning & Ending Cash Balance ---
        const beginningCashQuery = `SELECT COALESCE(SUM(debit - credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date < $2`;
        const endingCashQuery = `SELECT COALESCE(SUM(debit - credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date <= $2`;

        // --- Operating Activities ---
        const salesInflowQuery = `SELECT COALESCE(SUM(debit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3 AND gj.description LIKE 'Penjualan Tunai Toko%'`;
        const interestInflowQuery = `SELECT COALESCE(SUM(credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = 7 AND gj.entry_date BETWEEN $1 AND $2`; // Account 7 = Pendapatan Jasa Simpan Pinjam
        const supplierOutflowQuery = `SELECT COALESCE(SUM(credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3 AND gj.description LIKE 'Pembayaran hutang ke supplier%'`;
        const expenseOutflowQuery = `SELECT COALESCE(SUM(debit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id JOIN chart_of_accounts coa ON je.account_id = coa.id WHERE coa.account_type = 'Biaya' AND gj.entry_date BETWEEN $1 AND $2`;

        // --- Financing Activities ---
        const savingsInflowQuery = `SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE status = 'Approved' AND date BETWEEN $1 AND $2`;
        const loanPrincipalRepaidQuery = `SELECT COALESCE(SUM(je.credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id IN (SELECT account_id FROM loan_types WHERE account_id IS NOT NULL) AND gj.entry_date BETWEEN $1 AND $2 AND gj.description LIKE 'Pembayaran angsuran%'`;
        const loanDisbursementOutflowQuery = `SELECT COALESCE(SUM(credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3 AND gj.description LIKE 'Pencairan pinjaman%'`;
        const resignationOutflowQuery = `SELECT COALESCE(SUM(credit), 0) as total FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3 AND gj.description LIKE '%karena mengundurkan diri%'`;

        const [
            beginningCash,
            endingCash,
            cashFromSales,
            cashFromInterest,
            cashToSuppliers,
            cashForExpenses,
            cashFromSavings,
            cashFromLoanRepayments,
            cashForLoanDisbursements,
            cashForResignations
        ] = await Promise.all([
            runQuery(beginningCashQuery, [cashAccountId, startDate]),
            runQuery(endingCashQuery, [cashAccountId, endDate]),
            runQuery(salesInflowQuery, [cashAccountId, startDate, endDate]),
            runQuery(interestInflowQuery, [startDate, endDate]),
            runQuery(supplierOutflowQuery, [cashAccountId, startDate, endDate]),
            runQuery(expenseOutflowQuery, [startDate, endDate]),
            runQuery(savingsInflowQuery, [startDate, endDate]),
            runQuery(loanPrincipalRepaidQuery, [startDate, endDate]),
            runQuery(loanDisbursementOutflowQuery, [cashAccountId, startDate, endDate]),
            runQuery(resignationOutflowQuery, [cashAccountId, startDate, endDate])
        ]);

        const operating = {
            inflows: {
                fromSales: cashFromSales,
                fromInterest: cashFromInterest,
                total: cashFromSales + cashFromInterest
            },
            outflows: {
                toSuppliers: cashToSuppliers,
                forExpenses: cashForExpenses,
                total: cashToSuppliers + cashForExpenses
            },
            net: (cashFromSales + cashFromInterest) - (cashToSuppliers + cashForExpenses)
        };

        const financing = {
            inflows: {
                fromSavings: cashFromSavings,
                fromLoanRepayments: cashFromLoanRepayments,
                total: cashFromSavings + cashFromLoanRepayments
            },
            outflows: {
                forLoanDisbursements: cashForLoanDisbursements,
                forResignations: cashForResignations,
                total: cashForLoanDisbursements + cashForResignations
            },
            net: (cashFromSavings + cashFromLoanRepayments) - (cashForLoanDisbursements + cashForResignations)
        };

        const netCashFlow = operating.net + financing.net;

        res.json({
            summary: {
                beginningCash,
                endingCash,
                netCashFlow
            },
            operating,
            financing
        });

    } catch (err) {
        console.error('Error generating cash flow statement:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan arus kas.' });
    } finally {
        if (client) client.release();
    }
};

/**
 * @desc    Cancel a completed sale, restore stock, and delete associated journal entries.
 * @route   POST /api/admin/sales/:id/cancel
 * @access  Private (Admin, Akunting)
 */
const cancelSale = async (req, res) => {
    const { id: saleId } = req.params;
    const { role: userRole } = req.user;

    // Hanya admin dan akunting yang boleh membatalkan
    if (!['admin', 'akunting'].includes(userRole)) {
        return res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Dapatkan detail penjualan dan pastikan statusnya 'Selesai'
        const saleRes = await client.query("SELECT id, status, journal_id FROM sales WHERE id = $1 FOR UPDATE", [saleId]);
        if (saleRes.rows.length === 0) throw new Error('Transaksi penjualan tidak ditemukan.');
        const sale = saleRes.rows[0];
        if (sale.status !== 'Selesai') throw new Error(`Hanya transaksi dengan status "Selesai" yang dapat dibatalkan. Status saat ini: ${sale.status}.`);

        // 2. Dapatkan item yang terjual untuk mengembalikan stok
        const itemsRes = await client.query('SELECT product_id, quantity FROM sale_items WHERE sale_id = $1', [saleId]);
        if (itemsRes.rows.length === 0) throw new Error('Item penjualan tidak ditemukan untuk transaksi ini.');

        for (const item of itemsRes.rows) {
            await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
        }

        // 3. Hapus jurnal akuntansi yang terkait
        if (sale.journal_id) {
            // Menghapus dari general_journal akan otomatis menghapus entri terkait di journal_entries karena ON DELETE CASCADE
            await client.query('DELETE FROM general_journal WHERE id = $1', [sale.journal_id]);
        }

        // 4. Ubah status penjualan menjadi 'Dibatalkan'
        await client.query("UPDATE sales SET status = 'Dibatalkan' WHERE id = $1", [saleId]);

        await client.query('COMMIT');
        res.json({ message: 'Transaksi berhasil dibatalkan. Stok telah dikembalikan dan jurnal telah dihapus.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cancelling sale:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membatalkan transaksi.' });
    } finally {
        client.release();
    }
};

const createCashSale = async (req, res) => {
    const { items, paymentMethod, memberId, loanTermId } = req.body; // Tambahkan loanTermId
    const createdByUserId = req.user.id;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Keranjang belanja kosong.' });
    }
    const isLedgerPayment = paymentMethod.toLowerCase().includes('gaji') || paymentMethod.toLowerCase().includes('ledger');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Jika pembayaran adalah Employee Ledger, validasi memberId
        if (paymentMethod === 'Employee Ledger') {
            if (!memberId) throw new Error('ID Anggota diperlukan untuk pembayaran Potong Gaji.');
            const memberRes = await client.query('SELECT id FROM members WHERE id = $1 AND status = \'Active\'', [memberId]);
            if (memberRes.rows.length === 0) throw new Error(`Anggota dengan ID ${memberId} tidak ditemukan atau tidak aktif.`);
        }


        let totalSaleAmount = 0;
        let totalCostOfGoodsSold = 0;
        const processedItems = [];
        let shopType = null;

        for (const item of items) {
            const productRes = await client.query('SELECT name, price, stock, shop_type FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
            if (productRes.rows.length === 0) throw new Error(`Produk dengan ID ${item.productId} tidak ditemukan.`);
            
            const product = productRes.rows[0];
            const requestedQty = parseInt(item.quantity, 10);

            if (!shopType) {
                shopType = product.shop_type;
            }

            if (product.stock < requestedQty) throw new Error(`Stok tidak mencukupi untuk produk "${product.name}". Sisa stok: ${product.stock}.`);

            const cogsRes = await client.query(
                `SELECT le.purchase_price 
                 FROM logistics_entries le
                 JOIN master_products mp ON le.master_product_id = mp.id
                 WHERE mp.name = $1 AND le.status = 'Received' 
                 ORDER BY le.entry_date DESC, le.id DESC LIMIT 1`,
                 [product.name]
            );
            const costPerItem = cogsRes.rows.length > 0 ? parseFloat(cogsRes.rows[0].purchase_price) : 0;

            await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [requestedQty, item.productId]);

            const pricePerItem = parseFloat(product.price);
            totalSaleAmount += pricePerItem * requestedQty;
            totalCostOfGoodsSold += costPerItem * requestedQty;

            processedItems.push({ ...item, pricePerItem, costPerItem });
        }

        const orderId = `CASH-${Date.now()}`;

        const saleRes = await client.query(
            'INSERT INTO sales (order_id, total_amount, payment_method, created_by_user_id, member_id, sale_date, status, shop_type) VALUES ($1, $2, $3, $4, $5, NOW(), \'Selesai\', $6) RETURNING id, order_id, sale_date',
            [orderId, totalSaleAmount, paymentMethod, createdByUserId, memberId || null, shopType]
        );
        const saleId = saleRes.rows[0].id;

        const saleItemsQueryParts = processedItems.map((_, i) => 
            `($1, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4}, $${i*4 + 5})`
        ).join(', ');

        const saleItemsValues = [saleId, ...processedItems.flatMap(p => [p.productId, p.quantity, p.pricePerItem, p.costPerItem])];
        
        await client.query(`INSERT INTO sale_items (sale_id, product_id, quantity, price, cost_per_item) VALUES ${saleItemsQueryParts}`, saleItemsValues);

        let journalId = null; // Initialize as null
        if (isLedgerPayment) {
            // --- LOGIKA BARU: Buat Pinjaman Otomatis ---
            if (!loanTermId) throw new Error('Tenor pinjaman wajib dipilih untuk pembayaran Potong Gaji.');

            const termRes = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loanTermId]);
            if (termRes.rows.length === 0) throw new Error('Tenor pinjaman tidak valid.');
            const loanTypeId = termRes.rows[0].loan_type_id;

            const loanInsertQuery = ` 
                INSERT INTO loans (member_id, loan_type_id, loan_term_id, amount, date, status, remaining_principal)
                VALUES ($1, $2, $3, $4, NOW(), 'Approved', $4) RETURNING id
            `;
            const newLoanRes = await client.query(loanInsertQuery, [memberId, loanTypeId, loanTermId, totalSaleAmount]);
            const newLoanId = newLoanRes.rows[0].id;

            // Kaitkan penjualan dengan pinjaman yang baru dibuat
            await client.query('UPDATE sales SET loan_id = $1 WHERE id = $2', [newLoanId, saleId]);

        } else {
            // --- LOGIKA UNTUK PEMBAYARAN NON-GAJI (Cash, Transfer, dll) ---
            const paymentMethodRes = await client.query('SELECT account_id FROM payment_methods WHERE name = $1', [paymentMethod]);
            if (paymentMethodRes.rows.length === 0 || !paymentMethodRes.rows[0].account_id) {
                throw new Error(`Metode pembayaran "${paymentMethod}" tidak valid atau belum terhubung ke akun COA.`);
            } 
            const debitAccountId = paymentMethodRes.rows[0].account_id;

            const inventoryAccountId = 8; const salesRevenueAccountId = 12; const cogsAccountId = 13;
            const description = `Penjualan Tunai Toko (Kasir Umum) Struk #${saleId}`;
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, `CASH-SALE-${saleId}`]);
            journalId = journalHeaderRes.rows[0].id;

            const journalEntriesQuery = `
                INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
                ($1, $2, $3, 0), ($1, $4, 0, $3), ($1, $5, $6, 0), ($1, $7, 0, $6)
            `;
            await client.query(journalEntriesQuery, [journalId, debitAccountId, totalSaleAmount, salesRevenueAccountId, cogsAccountId, totalCostOfGoodsSold, inventoryAccountId]);
        }

        // Simpan journal_id ke tabel sales untuk referensi pembatalan, jika ada.
        if (journalId) {
            await client.query('UPDATE sales SET journal_id = $1 WHERE id = $2', [journalId, saleId]);
        }

        await client.query('COMMIT');
        
        // Siapkan data untuk struk
        const receiptData = {
            saleId: saleId,
            orderId: saleRes.rows[0].order_id,
            saleDate: saleRes.rows[0].sale_date,
            totalAmount: totalSaleAmount,
            paymentMethod: paymentMethod,
            items: processedItems.map(p => ({ name: p.name, quantity: p.quantity, price: p.pricePerItem, subtotal: p.quantity * p.pricePerItem })),
            cashierName: req.user.name
        };

        res.status(201).json({ 
            message: 'Penjualan tunai berhasil dicatat.', 
            receiptData: receiptData 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating cash sale:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses penjualan tunai.' });
    } finally {
        client.release();
    }
};

const getGeneralLedger = async (req, res) => {
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

const getMemberLoanHistory = async (req, res) => {
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

const getPendingSales = async (req, res) => {
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
const getPendingResignations = async (req, res) => {
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
const processResignation = async (req, res) => {
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

            // Improvement: Fetch cash account ID dynamically
            const cashAccountRes = await client.query("SELECT id FROM chart_of_accounts WHERE account_number = '1-1110'"); // Assuming '1-1110' is Kas
            if (cashAccountRes.rows.length === 0) throw new Error("Akun 'Kas' (1-1110) tidak ditemukan di COA.");
            const cashAccountId = cashAccountRes.rows[0].id;

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

        // 7. Create notification for the member
        createNotification(member.id, 'Pengunduran diri Anda telah selesai diproses. Keanggotaan Anda sekarang tidak aktif.', 'profile').catch(err => console.error(`Failed to create resignation processed notification for user ${member.id}:`, err));

        await client.query('COMMIT');
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
const getMonthlyClosings = async (req, res) => {
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
const processMonthlyClosing = async (req, res) => {
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
const reopenMonthlyClosing = async (req, res) => {
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
const getMonthlyClosingStatus = async (req, res) => {
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

const updateUser = async (req, res) => {
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

const deleteUser = async (req, res) => {
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
const getAnnouncements = async (req, res) => {
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
const getAnnouncementById = async (req, res) => {
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
const createAnnouncement = async (req, res) => {
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
const updateAnnouncement = async (req, res) => {
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
const deleteAnnouncement = async (req, res) => {
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
const getSaleItemsByOrderId = async (req, res) => {
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
const getSaleDetailsByOrderId = async (req, res) => {
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

/**
 * @desc    Get loan interest income report within a date range.
 * @route   GET /api/admin/reports/loan-interest
 * @access  Private (Admin, Akunting)
 */
const getLoanInterestReport = async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Tanggal mulai dan tanggal akhir diperlukan.' });
    }

    try {
        // Query untuk mendapatkan detail setiap pembayaran angsuran yang disetujui dalam rentang tanggal
        const detailsQuery = `
            SELECT 
                lp.id,
                lp.loan_id,
                lp.installment_number,
                lp.payment_date,
                l.amount as loan_amount,
                lt.tenor_months,
                lt.interest_rate,
                m.name as member_name
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.id
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            JOIN members m ON l.member_id = m.id
            WHERE lp.status = 'Approved' AND lp.payment_date BETWEEN $1 AND $2
            ORDER BY lp.payment_date ASC;
        `;

        const result = await pool.query(detailsQuery, [startDate, endDate]);

        let totalInterestIncome = 0;
        const details = result.rows.map(payment => {
            // Gunakan helper _getInstallmentDetails untuk menghitung porsi bunga
            const { interestComponent } = _getInstallmentDetails({
                amount: payment.loan_amount,
                tenor_months: payment.tenor_months,
                interest_rate: payment.interest_rate
            }, parseInt(payment.installment_number, 10));

            totalInterestIncome += interestComponent;

            return {
                member_name: payment.member_name,
                loan_id: payment.loan_id,
                installment_number: payment.installment_number,
                payment_date: payment.payment_date,
                interest_amount: interestComponent
            };
        });

        res.json({ summary: { totalInterestIncome, totalPaymentsCount: details.length }, details });
    } catch (err) {
        console.error('Error generating loan interest report:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan jasa pinjaman.' });
    }
};

/**
 * @desc    Get cashier sales report
 * @route   GET /api/admin/reports/cashier
 * @access  Private (Admin, Akunting)
 */
const getCashierReport = async (req, res) => {
    const { startDate, endDate, userId, paymentMethod } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Tanggal mulai dan tanggal akhir diperlukan.' });
    }

    try {
        // --- Base Query ---
        const params = [startDate, endDate];
        const conditions = [];
        let baseQuery = `
            FROM sales s
            LEFT JOIN members m ON s.created_by_user_id = m.id
            WHERE s.sale_date::date BETWEEN $1 AND $2
        `;
        
        if (userId) {
            params.push(userId);
            conditions.push(`s.created_by_user_id = $${params.length}`);
        }
        if (paymentMethod) {
            params.push(paymentMethod);
            conditions.push(`s.payment_method = $${params.length}`);
        }

        if (conditions.length > 0) {
            baseQuery += ` AND ${conditions.join(' AND ')}`;
        }

        // --- Data Query ---
        const query = `
            SELECT
                s.id,
                s.sale_date,
                s.total_amount,
                s.payment_method,
                s.status,
                COALESCE(m.name, 'Kasir Umum') as cashier_name,
                (SELECT m2.name FROM members m2 WHERE m2.id = s.member_id) as member_name
            ${baseQuery}
            ORDER BY s.sale_date DESC;
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error generating cashier report:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan kasir.' });
    } 
};

const getPartners = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM partners ORDER BY display_order ASC, name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching partners:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data mitra.' });
    }
};

const createPartner = async (req, res) => {
    const { name, website_url } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Logo mitra wajib diunggah.' });
    if (!name) return res.status(400).json({ error: 'Nama mitra wajib diisi.' });

    const logoUrl = '/' + req.file.path.replace(/\\/g, '/');
    try {
        const query = 'INSERT INTO partners (name, logo_url, website_url) VALUES ($1, $2, $3) RETURNING *';
        const result = await pool.query(query, [name, logoUrl, website_url || null]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating partner:', err.message);
        res.status(500).json({ error: 'Gagal membuat mitra baru.' });
    }
};

const updatePartner = async (req, res) => {
    const { id } = req.params;
    const { name, website_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama mitra wajib diisi.' });

    try {
        const oldPartnerRes = await pool.query('SELECT logo_url FROM partners WHERE id = $1', [id]);
        let logoUrl = oldPartnerRes.rows[0]?.logo_url;
        if (req.file) {
            logoUrl = '/' + req.file.path.replace(/\\/g, '/');
        }
        const query = 'UPDATE partners SET name = $1, website_url = $2, logo_url = $3 WHERE id = $4 RETURNING *';
        const result = await pool.query(query, [name, website_url || null, logoUrl, id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating partner:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui mitra.' });
    }
};

const deletePartner = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM partners WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) { console.error('Error deleting partner:', err.message); res.status(500).json({ error: 'Gagal menghapus mitra.' }); }
};

module.exports = {
    getDashboardStats,
    getMemberGrowth,
    getCashFlowSummary,
    getPendingLoansForAdmin,
    getPendingLoans,
    updateLoanStatus,
    recordLoanPayment,
    getLoanDetailsForAdmin,    
    getCompanyInfo, // Menggunakan fungsi lokal
    updateCompanyInfo, // Menggunakan fungsi lokal
    getAccounts: require('./account.controller').getAccounts, // Menggunakan require langsung
    getLoanById,
    updateLoan,
    getApprovalCounts,
    createItem,
    updateItem,
    updateUser,
    deleteLoan,
    deleteUser,
    deleteItem,
    getAllUsers,
    getAllPermissions,
    getRolePermissions,
    updateRolePermissions,
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getLogisticsEntries,
    getAvailableLogisticsProducts,
    createLogisticsEntry,
    getLogisticsByReference,
    updateLogisticsByReference,
    deleteLogisticsByReference,
    getTestimonials,
    getTestimonialById,
    createTestimonial,
    updateTestimonial,
    deleteTestimonial,
    mapSavingAccount,
    mapPaymentMethodAccount,
    mapLoanAccount,
    getReceivableLogistics,
    receiveLogisticsItems,
    getPayables,
    getPayableDetails,
    recordPayablePayment,
    getStockCardHistory,
    getSavingTypes,
    getPositions,
    getLoanTypes,
    getSuppliers,
    getEmployers,
    getAllProductsForDropdown,
    getIncomeStatement,
    getIncomeStatementSummary,
    getSalesReport,
    createSale,
    getShuRules,
    saveShuRules,
    calculateShuPreview,
    postShuDistribution,
    getBalanceSheet,
    getBalanceSheetSummary,
    createCashSale,
    getCashFlowStatement,
    getGeneralLedger,
    getMemberLoanHistory,
    getPendingSales,
    getSaleDetailsByOrderId,
    getSaleItemsByOrderId,
    getPendingResignations,
    processResignation,    
    getLoanTerms,
    getMonthlyClosingStatus,
    getMonthlyClosings,
    reopenMonthlyClosing,
    processMonthlyClosing,    
    getAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    getMasterProducts,
    createMasterProduct,
    updateMasterProduct,
    deleteMasterProduct,
    getPendingLoanPayments,
    updateLoanPaymentStatus,
    createManualSaving,
    getLoanInterestReport,
    getCashierReport,
    cancelLoanPayment,
    createPaymentMethod,
    updatePaymentMethod,
    mapPaymentMethodAccount,
    saveLoanCommitment,
    getPaymentMethods,
    getLoanTypeIdByName,
    deletePaymentMethod,
    cancelSale, // Tetap di sini karena ini adalah aksi admin
    getPartners,
    createPartner,
    updatePartner,
    deletePartner,
    completeOrder, // Tetap di sini karena ini adalah aksi admin
    deleteSale,
    // Account Type CRUD
    getAccountTypes: accountTypeController.getAccountTypes,
    createAccountType: accountTypeController.createAccountType,
    updateAccountType: accountTypeController.updateAccountType,
    deleteAccountType: accountTypeController.deleteAccountType
};