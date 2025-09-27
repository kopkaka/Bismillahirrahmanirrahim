const pool = require('../../db');

const getDashboardStats = async (req, res) => {
    try {
        // Performance: Combine multiple queries into a single database round-trip using subqueries.
        const statsQuery = `
            SELECT
                (SELECT COUNT(*) FROM members WHERE status = 'Active') AS total_members,
                (SELECT COALESCE(SUM(amount), 0) FROM savings WHERE status = 'Approved') AS total_savings,
                (SELECT COALESCE(SUM(amount), 0) FROM loans WHERE status = 'Approved') AS total_active_loans,
                (SELECT COUNT(*) FROM members WHERE status = 'Pending') AS pending_members
        `;
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];

        res.json({
            totalMembers: parseInt(stats.total_members, 10),
            totalSavings: parseFloat(stats.total_savings),
            totalActiveLoans: parseFloat(stats.total_active_loans),
            pendingMembers: parseInt(stats.pending_members, 10)
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server Error' });
    }
};

module.exports = {
    getDashboardStats,
};