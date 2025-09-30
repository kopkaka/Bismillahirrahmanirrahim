const pool = require('../../db');

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