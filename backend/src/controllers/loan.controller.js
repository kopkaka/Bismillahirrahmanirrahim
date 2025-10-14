const pool = require('../../db');
const fs = require('fs');
const path = require('path');
const { createNotification } = require('../utils/notification.util');
const { getAccountIds } = require('../utils/getAccountIds.util'); // FIX: Ensure correct import
const { getLoanDetailsService, _getInstallmentDetails } = require('../services/loan.service');

// GET all loans with joined data
const getLoans = async (req, res) => {
    try {
        const { status, startDate, endDate, search, page = 1, limit = 10 } = req.query;
        // This query joins multiple tables to get comprehensive loan data.
        let baseQuery = `
            FROM loans l 
            JOIN members m ON l.member_id = m.id 
            JOIN loan_types lt ON l.loan_type_id = lt.id 
            JOIN loan_terms ltm ON l.loan_term_id = ltm.id 
            LEFT JOIN (
                SELECT 
                    loan_id, 
                    SUM(CASE WHEN status = 'Approved' THEN amount_paid ELSE 0 END) as total_payment
                FROM loan_payments 
                GROUP BY loan_id
            ) lp ON l.id = lp.loan_id 
        `;
 
        const params = [];
        const whereClauses = [];
        let paramIndex = 1;

        if (status) {
            whereClauses.push(`l.status = $${paramIndex++}`);
            params.push(status);
        }
        if (startDate) {
            whereClauses.push(`l.date::date >= $${paramIndex++}`);
            params.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`l.date::date <= $${paramIndex++}`);
            params.push(endDate);
        }
        if (search) {
            whereClauses.push(`m.name ILIKE $${paramIndex++}`);
            params.push(`%${search}%`);
        }

        let countQuery = `SELECT COUNT(l.id) ${baseQuery}`;
        let dataQuery = `
            SELECT 
                l.id,
                l.member_id AS "memberId",
                m.name AS "memberName",
                m.cooperative_number AS "cooperativeNumber",
                l.loan_type_id AS "loanTypeId",
                lt.name AS "loanTypeName", 
                l.loan_term_id AS "loanTermId",
                l.amount,
                l.date,
                l.status,
                ltm.tenor_months,
                ltm.interest_rate,
                COALESCE(lp.total_payment, 0) as "totalPayment",
                l.remaining_principal 
            ${baseQuery}
        `;

        if (whereClauses.length > 0) {
            const whereString = ` WHERE ${whereClauses.join(' AND ')}`;
            countQuery += whereString;
            dataQuery += whereString;
        }

        const countResult = await pool.query(countQuery, params);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit) || 1;
        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        dataQuery += ` ORDER BY l.date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        const queryParams = [...params, parseInt(limit, 10), offset];

        const result = await pool.query(dataQuery, queryParams);

        // Calculate monthly installment for each loan
        const loansWithCalculations = result.rows.map(loan => {
            const { total: monthlyInstallment } = _getInstallmentDetails(loan, 1);
            return {
                ...loan, // Spread the original loan properties
                monthlyInstallment,
                totalPayment: parseFloat(loan.totalPayment)
            };
        });

        res.json({
            data: loansWithCalculations,
            pagination: { 
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            }
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Gagal mengambil data pinjaman.' });
    }
};

const getPendingLoans = async (req, res) => {
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
                m.name as "memberName",
                m.cooperative_number as "cooperativeNumber",
                lt.tenor_months,
                l_types.name as "loanTypeName"
            FROM loans l
            JOIN members m ON l.member_id = m.id
            JOIN loan_terms lt ON l.loan_term_id = lt.id
            JOIN loan_types l_types ON lt.loan_type_id = l_types.id
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
                m.name as member_name,
                m.cooperative_number
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

const updateLoanPaymentStatus = async (req, res) => { // NOSONAR
    const { id: paymentId } = req.params;
    const { status: newStatus } = req.body;

    if (!['Approved', 'Rejected'].includes(newStatus)) {
        return res.status(400).json({ error: 'Status tidak valid.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // NOSONAR
 
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

            // 3. Calculate principal and interest components for this installment.
            const { principalComponent, interestComponent } = _getInstallmentDetails({
                amount: payment.loan_amount,
                tenor_months: payment.tenor_months,
                interest_rate: payment.interest_rate
            }, parseInt(payment.installment_number, 10));
 
            // 4. Update remaining principal on the main loan
            await client.query('UPDATE loans SET remaining_principal = remaining_principal - $1 WHERE id = $2', [principalComponent, payment.loan_id]);

            // 5. Check if the loan is fully paid
            if ((parseFloat(payment.remaining_principal) - principalComponent) <= 1) { // Use a small threshold for floating point inaccuracies
                await client.query("UPDATE loans SET status = 'Lunas' WHERE id = $1", [payment.loan_id]);
            }

            // 6. Create Journal Entries
            if (!payment.loan_account_id) throw new Error(`Tipe pinjaman "${payment.loan_type_name}" belum terhubung ke akun COA Piutang.`);
            
            // Maintainability: Fetch account IDs dynamically instead of using hardcoded values.
            const accountIds = await getAccountIds(['Kas', 'Pendapatan Jasa Pinjaman'], client); // FIX: Use the plural function
            const cashAccountId = accountIds['Kas'];
            const interestIncomeAccountId = accountIds['Pendapatan Jasa Pinjaman'];
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

            // Link the journal entry to the payment record for traceability
            await client.query('UPDATE loan_payments SET journal_id = $1 WHERE id = $2', [journalId, paymentId]);

            // 7. Send notification
            createNotification(payment.member_id, `Pembayaran angsuran ke-${payment.installment_number} Anda telah dikonfirmasi.`, 'loans');

        } else { // newStatus is 'Rejected'
            createNotification(payment.member_id, `Pembayaran angsuran ke-${payment.installment_number} Anda ditolak. Silakan hubungi admin.`, 'application');
        }
 
        await client.query('COMMIT');
        res.json({ message: `Status pembayaran berhasil diubah menjadi ${newStatus}.` });

    } catch (err) {
        await client.query('ROLLBACK'); // NOSONAR
        console.error('Error updating loan payment status:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memperbarui status pembayaran.' });
    } finally {
        client.release();
    }
};

const handleFinalLoanApproval = async (client, loanDetails) => {
    const { id: loanId, member_id, amount, loan_type_name, member_name, account_id } = loanDetails;

    if (!account_id) {
        throw new Error(`Tipe pinjaman "${loan_type_name}" belum terhubung ke akun COA. Harap lakukan maping di Pengaturan.`);
    }

    // Maintainability: Fetch account ID dynamically instead of using a hardcoded value.
    const accountIds = await getAccountIds(['Kas'], client); // FIX: Use the plural function
    const cashAccountId = accountIds['Kas'];
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

const getLoanDetailsForAdmin = async (req, res) => {
    try {
        const { id: loanId } = req.params;
        // Use the centralized service. No memberId is passed, so it acts as an admin fetch.
        const loanDetails = await getLoanDetailsService(loanId);
        res.json(loanDetails);
    } catch (err) {
        console.error('Error fetching loan details for admin:', err.message);
        res.status(err.message.includes('ditemukan') ? 404 : 500).json({ error: err.message });
    }
};

const getMemberLoanHistory = async (req, res) => {
    const { id: memberId } = req.params;

    try {
        const query = `
            SELECT 
                l.id,
                l.amount,
                l.date,
                l.status, 
                l.remaining_principal,
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

        if (loanResult.rows.length === 0) throw new Error('Pinjaman tidak ditemukan.');
        const loan = loanResult.rows[0];

        if (loan.status !== 'Approved') throw new Error(`Hanya pinjaman dengan status "Approved" yang bisa dibayar. Status saat ini: ${loan.status}.`);

        const paidInstallmentsCountResult = await client.query('SELECT COUNT(*) FROM loan_payments WHERE loan_id = $1', [loanId]);
        const paidInstallmentsCount = parseInt(paidInstallmentsCountResult.rows[0].count, 10);

        if (requestedInstallmentNumber !== paidInstallmentsCount + 1) throw new Error(`Pembayaran harus berurutan. Angsuran berikutnya yang harus dibayar adalah ke-${paidInstallmentsCount + 1}.`);

        const existingPayment = await client.query('SELECT id FROM loan_payments WHERE loan_id = $1 AND installment_number = $2', [loanId, requestedInstallmentNumber]);
        if (existingPayment.rows.length > 0) throw new Error(`Angsuran ke-${requestedInstallmentNumber} sudah pernah dibayar.`);

        const { principalComponent, interestComponent, total: totalInstallmentAmount } = _getInstallmentDetails(loan, requestedInstallmentNumber);

        await client.query("INSERT INTO loan_payments (loan_id, payment_date, amount_paid, installment_number, notes, status, payment_method) VALUES ($1, NOW(), $2, $3, $4, 'Approved', 'Potong Gaji')", [loanId, totalInstallmentAmount, requestedInstallmentNumber, `Dicatat manual oleh ${userRole} ID: ${userId}`]);

        const newRemainingPrincipal = parseFloat(loan.amount) - (paidInstallmentsCount + 1) * principalComponent;
        await client.query('UPDATE loans SET remaining_principal = $1 WHERE id = $2', [Math.max(0, newRemainingPrincipal), loanId]);

        const totalPaidCount = paidInstallmentsCount + 1;
        let finalStatus = 'Approved';
        if (totalPaidCount >= parseInt(loan.tenor_months, 10)) {
            await client.query("UPDATE loans SET status = 'Lunas', remaining_principal = 0 WHERE id = $1", [loanId]);
            finalStatus = 'Lunas';
        }

        if (!loan.loan_account_id) throw new Error(`Tipe pinjaman "${loan.loan_type_name}" belum terhubung ke akun COA Piutang. Harap lakukan maping di Pengaturan.`);

        // Maintainability: Fetch account IDs dynamically.
        const accountIds = await getAccountIds(['Kas', 'Pendapatan Jasa Pinjaman'], client); // FIX: Use the plural function
        const cashAccountId = accountIds['Kas'];
        const interestIncomeAccountId = accountIds['Pendapatan Jasa Pinjaman'];
        const description = `Pembayaran angsuran ke-${requestedInstallmentNumber} pinjaman ${loan.loan_type_name} a/n ${loan.member_name}`;

        const entryDate = new Date();
        const year = entryDate.getFullYear();
        const month = String(entryDate.getMonth() + 1).padStart(2, '0');
        const day = String(entryDate.getDate()).padStart(2, '0');
        const prefix = `JRNL-${year}${month}${day}-`;

        const seqResult = await client.query("SELECT COUNT(*) FROM general_journal WHERE reference_number LIKE $1", [`${prefix}%`]);
        const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
        const referenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, referenceNumber]);
        const journalId = journalHeaderRes.rows[0].id;

        const journalEntriesQuery = `INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $5), ($1, $6, 0, $7)`;
        await client.query(journalEntriesQuery, [journalId, cashAccountId, totalInstallmentAmount, loan.loan_account_id, principalComponent, interestIncomeAccountId, interestComponent]);

        await client.query('COMMIT');
        res.json({ message: `Pembayaran angsuran ke-${requestedInstallmentNumber} berhasil dicatat.`, loanStatus: finalStatus });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error recording loan payment:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mencatat pembayaran.' });
    } finally {
        client.release();
    }
};

const cancelLoanPayment = async (req, res) => {
    const { id: paymentId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const paymentRes = await client.query(`
            SELECT lp.loan_id, lp.status, lp.installment_number, lp.journal_id, l.member_id, l.status as loan_status, l.amount as loan_amount, lt.tenor_months, lt.interest_rate
            FROM loan_payments lp JOIN loans l ON lp.loan_id = l.id JOIN loan_terms lt ON l.loan_term_id = lt.id
            WHERE lp.id = $1 FOR UPDATE
        `, [paymentId]);

        if (paymentRes.rows.length === 0) throw new Error('Data pembayaran tidak ditemukan.');
        const payment = paymentRes.rows[0];

        if (payment.status !== 'Approved') throw new Error(`Hanya pembayaran dengan status "Approved" yang dapat dibatalkan. Status saat ini: ${payment.status}.`);

        const { principalComponent } = _getInstallmentDetails({ amount: payment.loan_amount, tenor_months: payment.tenor_months, interest_rate: payment.interest_rate }, parseInt(payment.installment_number, 10));

        await client.query('UPDATE loans SET remaining_principal = remaining_principal + $1 WHERE id = $2', [principalComponent, payment.loan_id]);
        if (payment.loan_status === 'Lunas') await client.query("UPDATE loans SET status = 'Approved' WHERE id = $1", [payment.loan_id]);
        if (payment.journal_id) await client.query('DELETE FROM general_journal WHERE id = $1', [payment.journal_id]);
        await client.query('DELETE FROM loan_payments WHERE id = $1', [paymentId]);

        createNotification(payment.member_id, `Pembayaran angsuran ke-${payment.installment_number} Anda telah dibatalkan oleh admin.`, 'loans').catch(err => console.error(`Gagal membuat notifikasi pembatalan untuk user ${payment.member_id}:`, err));

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

const saveLoanCommitment = async (req, res) => {
    const { id: loanId } = req.params;
    const signatureFile = req.file;
    if (!signatureFile) return res.status(400).json({ error: 'File tanda tangan tidak ditemukan.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldSignatureRes = await client.query('SELECT commitment_signature_path FROM loans WHERE id = $1', [loanId]);
        if (oldSignatureRes.rows.length === 0) throw new Error('Pinjaman tidak ditemukan.');
        const oldSignaturePath = oldSignatureRes.rows[0]?.commitment_signature_path;

        const newSignaturePath = signatureFile.path.replace(/\\/g, '/');
        await client.query('UPDATE loans SET commitment_signature_path = $1 WHERE id = $2', [newSignaturePath, loanId]);

        if (oldSignaturePath) {
            const fullOldPath = path.resolve(process.cwd(), oldSignaturePath);
            fs.unlink(fullOldPath, (err) => { if (err) console.error(`Gagal menghapus file tanda tangan lama: ${fullOldPath}`, err); });
        }

        await client.query('COMMIT');
        res.json({ message: 'Tanda tangan berhasil disimpan.', path: newSignaturePath });
    } catch (err) { await client.query('ROLLBACK'); console.error('Error saving loan commitment:', err.message); res.status(500).json({ error: 'Gagal menyimpan tanda tangan.' }); } finally { client.release(); }
};

const updateLoan = async (req, res) => {
    const { id } = req.params;
    const { loan_term_id, amount } = req.body;
    if (!loan_term_id || !amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Produk pinjaman dan jumlah harus diisi dengan benar.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const loanRes = await client.query('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [id]);
        if (loanRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pengajuan pinjaman tidak ditemukan.' }); }
        if (loanRes.rows[0].status !== 'Pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Hanya pinjaman dengan status "Pending" yang dapat diubah.' }); }

        const termResult = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loan_term_id]);
        if (termResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Produk pinjaman (tenor) tidak valid.' }); }
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const loanRes = await client.query('SELECT status FROM loans WHERE id = $1 FOR UPDATE', [id]);
        if (loanRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pengajuan pinjaman tidak ditemukan.' }); }
        if (loanRes.rows[0].status !== 'Pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Hanya pinjaman dengan status "Pending" yang dapat dihapus.' }); }
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

const getLoanTypeIdByName = async (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'Nama tipe pinjaman diperlukan.' });
    try {
        const result = await pool.query('SELECT id FROM loan_types WHERE name = $1', [name]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Tipe pinjaman tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) { console.error('Error fetching loan type ID by name:', err.message); res.status(500).json({ error: 'Gagal mengambil ID tipe pinjaman.' }); }
};

const getLoanInterestReport = async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'Tanggal mulai dan tanggal akhir diperlukan.' });

    try {
        // Performance Improvement: Calculate interest component directly in SQL instead of in a JavaScript loop.
        const detailsQuery = `
            WITH payment_details AS (
                SELECT 
                    lp.id, 
                    lp.loan_id,
                    lp.installment_number,
                    lp.payment_date,
                    m.name as member_name,
                    -- Calculate interest component for each payment using the same logic as _getInstallmentDetails
                    (l.amount - ((lp.installment_number - 1) * (l.amount / lt.tenor_months))) * ((lt.interest_rate / 100) / 12) as interest_amount
                FROM loan_payments lp
                JOIN loans l ON lp.loan_id = l.id
                JOIN loan_terms lt ON l.loan_term_id = lt.id
                JOIN members m ON l.member_id = m.id
                WHERE lp.status = 'Approved' AND lp.payment_date BETWEEN $1 AND $2
            )
            SELECT *, (SELECT SUM(pd.interest_amount) FROM payment_details pd) as total_interest
            FROM payment_details
            ORDER BY payment_date ASC;
        `;
        const result = await pool.query(detailsQuery, [startDate, endDate]);
        const totalInterestIncome = result.rows.length > 0 ? parseFloat(result.rows[0].total_interest) : 0;
        res.json({ summary: { totalInterestIncome, totalPaymentsCount: result.rows.length }, details: result.rows });
    } catch (err) {
        console.error('Error generating loan interest report:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan jasa pinjaman.' });
    }
};

module.exports = {
    getLoans,
    getPendingLoans,
    getPendingLoanPayments,
    updateLoanPaymentStatus,
    updateLoanStatus,
    getLoanDetailsForAdmin,
    getMemberLoanHistory,
    recordLoanPayment,
    cancelLoanPayment,
    saveLoanCommitment,
    updateLoan,
    deleteLoan,
    mapLoanAccount,
    getLoanTypeIdByName,
    getLoanInterestReport
};