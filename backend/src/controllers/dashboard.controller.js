const pool = require('../../db');

/**
 * @desc    Get main dashboard statistics (total members, savings, loans)
 * @route   GET /api/admin/stats
 * @access  Private (Admin, Manager, Akunting)
 */
const getDashboardStats = async (req, res) => {
    const client = await pool.connect();
    try {
        // --- PERFORMANCE OPTIMIZATION ---
        // Combine all statistic queries into a single database round-trip using subqueries.
        const statsQuery = `
            SELECT
                (SELECT COUNT(*) FROM members WHERE status = 'Active' AND role = 'member') AS total_members,
                (
                    SELECT COALESCE(SUM(CASE 
                                        WHEN st.name = 'Penarikan Simpanan Sukarela' THEN -s.amount 
                                        ELSE s.amount 
                                      END), 0)
                    FROM savings s
                    JOIN saving_types st ON s.saving_type_id = st.id
                    WHERE s.status = 'Approved'
                ) AS total_savings,
                (SELECT COALESCE(SUM(remaining_principal), 0) FROM loans WHERE status = 'Approved') AS total_active_loans,
                (SELECT COUNT(*) FROM members WHERE status = 'Pending') AS pending_members
        `;
        const statsResult = await client.query(statsQuery);
        const stats = statsResult.rows[0];

        res.json({
            totalMembers: parseInt(stats.total_members, 10),
            totalSavings: parseFloat(stats.total_savings),
            totalActiveLoans: parseFloat(stats.total_active_loans),
            pendingMembers: parseInt(stats.pending_members, 10),
        });
    } catch (err) {
        console.error('Error fetching dashboard stats:', err.message);
        res.status(500).json({ error: 'Gagal mengambil statistik dasbor.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get cash flow summary for a date range
 * @route   GET /api/admin/cashflow-summary
 * @access  Private (Admin, Manager, Akunting)
 */
const getCashFlowSummary = async (req, res) => {
    const client = await pool.connect();
    try {
        // Default to last 30 days if no dates are provided
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(endDate.getDate() - 30));

        // FIX: The query was using a non-existent table 'savings_transactions'.
        // This is corrected to use the 'savings' table and join with 'saving_types'
        // to differentiate between deposits (inflow) and withdrawals (outflow).
        const query = `
            SELECT
                COALESCE(SUM(CASE WHEN st.name <> 'Penarikan Simpanan Sukarela' THEN s.amount ELSE 0 END), 0) as inflow,
                COALESCE(SUM(CASE WHEN st.name = 'Penarikan Simpanan Sukarela' THEN s.amount ELSE 0 END), 0) as outflow
            FROM savings s
            JOIN saving_types st ON s.saving_type_id = st.id
            WHERE s.status = 'Approved' AND s.date BETWEEN $1 AND $2;
        `;
        const { rows } = await client.query(query, [startDate, endDate]);

        // The chart expects a single object with inflow and outflow properties.
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching cash flow summary:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan arus kas.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get member growth for the last 12 months
 * @route   GET /api/admin/member-growth
 * @access  Private (Admin, Manager, Akunting)
 */
const getMemberGrowth = async (req, res) => {
    try {
        const query = `
            SELECT 
                to_char(approval_date, 'YYYY-MM') as month,
                COUNT(*) as new_members
            FROM members
            WHERE status = 'Active' AND approval_date >= date_trunc('month', current_date - interval '11 months')
            GROUP BY month
            ORDER BY month;
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching member growth:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pertumbuhan anggota.' });
    }
};

/**
 * @desc    Get balance sheet summary (Assets vs Liabilities + Equity)
 * @route   GET /api/admin/balance-sheet-summary
 * @access  Private (Admin, Manager, Akunting)
 */
const getBalanceSheetSummary = async (req, res) => {
    // This is a simplified version. A real implementation would query the chart of accounts.
    const client = await pool.connect();
    try {
        // FIX: Combine queries for performance and correct the liabilities calculation.
        // Liabilities (total savings) should be deposits minus withdrawals.
        const query = `
            SELECT
                (SELECT COALESCE(SUM(remaining_principal), 0) FROM loans WHERE status = 'Approved') AS total_assets,
                (SELECT COALESCE(SUM(CASE WHEN st.name = 'Penarikan Simpanan Sukarela' THEN -s.amount ELSE s.amount END), 0)
                 FROM savings s
                 JOIN saving_types st ON s.saving_type_id = st.id
                 WHERE s.status = 'Approved') AS total_liabilities
        `;
        const result = await client.query(query);
        const { total_assets, total_liabilities } = result.rows[0];
        
        res.json({
            assets: parseFloat(total_assets),
            liabilities: parseFloat(total_liabilities),
            equity: 0 // Placeholder
        });
    } catch (err) {
        console.error('Error fetching balance sheet summary:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan neraca.' });
    } finally {
        client.release();
    }
};

const getIncomeStatementSummary = async (req, res) => {
    // Placeholder for income statement data
    res.json([]);
};

/**
 * @desc    Get counts for all pending approvals for the dashboard.
 * @route   GET /api/admin/approval-counts
 * @access  Private (Admin, Manager, Akunting)
 */
const getApprovalCounts = async (req, res) => {
    const client = await pool.connect();
    try {
        // FIX: The queries for pendingSavingsRes and pendingWithdrawalsRes were incorrect.
        // - 'savings_transactions' table does not exist.
        // - 'withdrawal_requests' table does not exist.
        // Both are now handled by querying the 'savings' table with the correct saving_type_id.

        // Jalankan semua query count secara paralel untuk efisiensi
        const [
            pendingMembersRes,
            pendingSavingsRes,
            pendingWithdrawalsRes,
            pendingLoansRes,
            pendingLoanPaymentsRes,
            pendingResignationsRes
        ] = await Promise.all([
            client.query("SELECT COUNT(*) FROM members WHERE status = 'Pending'"),
            client.query("SELECT COUNT(*) FROM savings s JOIN saving_types st ON s.saving_type_id = st.id WHERE s.status = 'Pending' AND st.name <> 'Penarikan Simpanan Sukarela'"),
            client.query("SELECT COUNT(*) FROM savings s JOIN saving_types st ON s.saving_type_id = st.id WHERE s.status = 'Pending' AND st.name = 'Penarikan Simpanan Sukarela'"),
            client.query("SELECT COUNT(*) FROM loans WHERE status IN ('Pending', 'Approved by Accounting')"),
            client.query("SELECT COUNT(*) FROM loan_payments WHERE status = 'Pending'"),
            client.query("SELECT COUNT(*) FROM members WHERE status = 'Pending Resignation'")
        ]);

        // Susun hasil dalam format JSON
        const counts = {
            members: parseInt(pendingMembersRes.rows[0].count, 10),
            savings: parseInt(pendingSavingsRes.rows[0].count, 10),
            withdrawals: parseInt(pendingWithdrawalsRes.rows[0].count, 10),
            loans: parseInt(pendingLoansRes.rows[0].count, 10),
            loanPayments: parseInt(pendingLoanPaymentsRes.rows[0].count, 10),
            resignations: parseInt(pendingResignationsRes.rows[0].count, 10),
        };

        res.json(counts);

    } catch (err) {
        console.error('Error fetching approval counts:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data persetujuan.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get cash flow summary for member dashboard.
 * @route   GET /api/member/dashboard/cashflow-summary
 * @access  Private (Member)
 */
const getMemberCashFlowSummary = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        // Memanggil service yang sudah ada
        const summary = await getCashFlowSummary(startDate, endDate);
        res.json(summary);
    } catch (err) {
        console.error('Error fetching cash flow summary for member:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan arus kas.' });
    }
};

module.exports = { 
    getApprovalCounts,
    getDashboardStats,
    getCashFlowSummary,
    getMemberGrowth,
    getBalanceSheetSummary,
    getIncomeStatementSummary,
    getMemberCashFlowSummary,
};