const pool = require('../../db');

/**
 * Mengambil jumlah semua item yang menunggu persetujuan dari berbagai tabel.
 * Ini mengoptimalkan pengambilan data dengan hanya satu panggilan API dari frontend.
 */
const getApprovalCounts = async (req, res) => {
    const client = await pool.connect();
    try {
        const counts = {};

        // 1. Pendaftaran Anggota Baru (status 'Pending')
        const membersRes = await client.query("SELECT COUNT(*) FROM members WHERE status = 'Pending'");
        counts.members = parseInt(membersRes.rows[0].count, 10);

        // 2. Setoran Simpanan (status 'Pending' dan bukan penarikan)
        const savingsRes = await client.query("SELECT COUNT(*) FROM savings s JOIN saving_types st ON s.saving_type_id = st.id WHERE s.status = 'Pending' AND st.name <> 'Penarikan Simpanan Sukarela'");
        counts.savings = parseInt(savingsRes.rows[0].count, 10);

        // 3. Penarikan Simpanan (status 'Pending' dan merupakan penarikan)
        const withdrawalsRes = await client.query("SELECT COUNT(*) FROM savings s JOIN saving_types st ON s.saving_type_id = st.id WHERE s.status = 'Pending' AND st.name = 'Penarikan Simpanan Sukarela'");
        counts.withdrawals = parseInt(withdrawalsRes.rows[0].count, 10);

        // 4. Pengajuan Pinjaman (status 'Pending' atau 'Approved by Accounting')
        const loansRes = await client.query("SELECT COUNT(*) FROM loans WHERE status IN ('Pending', 'Approved by Accounting')");
        counts.loans = parseInt(loansRes.rows[0].count, 10);

        // 5. Pembayaran Angsuran (status 'Pending')
        const loanPaymentsRes = await client.query("SELECT COUNT(*) FROM loan_payments WHERE status = 'Pending'");
        counts.loanPayments = parseInt(loanPaymentsRes.rows[0].count, 10);

        // 6. Pengunduran Diri (status 'Pending Resignation')
        const resignationsRes = await client.query("SELECT COUNT(*) FROM members WHERE status = 'Pending Resignation'");
        counts.resignations = parseInt(resignationsRes.rows[0].count, 10);

        res.json(counts);
    } catch (error) {
        console.error('Error fetching approval counts:', error);
        res.status(500).json({ error: 'Gagal mengambil data persetujuan.' });
    } finally {
        client.release();
    }
};

module.exports = {
    getApprovalCounts
};