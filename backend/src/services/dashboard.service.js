const pool = require('../../db');

const getDashboardStats = async () => {
    const client = await pool.connect();
    try {
        // Optimization: Run all statistic queries concurrently using Promise.all
        const statsQueries = [
            client.query("SELECT COUNT(*) FROM members WHERE status = 'Active' AND role = 'member'"),
            client.query(`
                SELECT COALESCE(SUM(CASE 
                                    WHEN st.name = 'Penarikan Simpanan Sukarela' THEN -s.amount 
                                    ELSE s.amount 
                                END), 0) as total 
                FROM savings s 
                JOIN saving_types st ON s.saving_type_id = st.id 
                WHERE s.status = 'Approved'
            `),
            client.query("SELECT COALESCE(SUM(remaining_principal), 0) as total FROM loans WHERE status = 'Approved'"),
            client.query("SELECT COUNT(*) FROM members WHERE status = 'Pending'")
        ];

        const [
            totalMembersRes,
            totalSavingsRes,
            totalActiveLoansRes,
            pendingMembersRes
        ] = await Promise.all(statsQueries);

        return {
            totalMembers: parseInt(totalMembersRes.rows[0].count, 10),
            totalSavings: parseFloat(totalSavingsRes.rows[0].total),
            totalActiveLoans: parseFloat(totalActiveLoansRes.rows[0].total),
            pendingMembers: parseInt(pendingMembersRes.rows[0].count, 10),
        };
    } finally {
        client.release();
    }
};

/**
 * @desc    Mendapatkan ringkasan arus kas untuk periode tertentu.
 * @param {string} [startDate] - Tanggal mulai (YYYY-MM-DD).
 * @param {string} [endDate] - Tanggal akhir (YYYY-MM-DD).
 * @returns {Promise<object>} - Objek berisi inflow dan outflow.
 */
const getCashFlowSummary = async (startDate, endDate) => {
    const cashAccountId = 3; // Asumsi ID Akun Kas adalah 3
    const queryParams = [cashAccountId];
    let queryText = `
        SELECT
            COALESCE(SUM(CASE WHEN je.account_id = $1 THEN je.debit ELSE 0 END), 0) as "total_inflow",
            COALESCE(SUM(CASE WHEN je.account_id = $1 THEN je.credit ELSE 0 END), 0) as "total_outflow"
        FROM journal_entries je
        JOIN general_journal gj ON je.journal_id = gj.id
    `;

    if (startDate && endDate) {
        // Parameter index dimulai dari $2 karena $1 adalah cashAccountId
        queryText += ` WHERE gj.entry_date BETWEEN $2 AND $3`;
        queryParams.push(startDate, endDate);
    } else {
        // Jika tidak ada filter, ambil data 30 hari terakhir
        queryText += ` WHERE gj.entry_date >= NOW() - INTERVAL '30 days'`;
    }

    const result = await pool.query(queryText, queryParams);
    return {
        inflow: parseFloat(result.rows[0].total_inflow || 0),
        outflow: parseFloat(result.rows[0].total_outflow || 0),
    };
};

/**
 * @desc    Mendapatkan data pertumbuhan anggota baru selama 12 bulan terakhir.
 * @returns {Promise<object[]>} - Array data pertumbuhan anggota.
 */
const getMemberGrowth = async () => {
    const query = `
        SELECT
            to_char(date_trunc('month', approval_date), 'YYYY-MM') AS month,
            COUNT(id) AS new_members
        FROM members
        WHERE role = 'member' AND approval_date IS NOT NULL
          AND approval_date >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY date_trunc('month', approval_date)
        ORDER BY month ASC;
    `;
    const result = await pool.query(query);
    return result.rows;
};

/**
 * @desc    Mendapatkan ringkasan laporan laba rugi per bulan.
 * @param {string} [year] - Tahun yang akan difilter.
 * @returns {Promise<object[]>} - Array data laba rugi.
 */
const getIncomeStatementSummary = async (year) => {
    let dateCondition;
    const params = [];

    if (year && !isNaN(parseInt(year))) {
        dateCondition = `AND EXTRACT(YEAR FROM gj.entry_date) = $1`;
        params.push(year);
    } else {
        dateCondition = `AND gj.entry_date >= date_trunc('month', NOW() - INTERVAL '11 months')`;
    }

    const query = `
        SELECT
            to_char(date_trunc('month', gj.entry_date), 'YYYY-MM') AS month,
            COALESCE(SUM(CASE WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit ELSE 0 END), 0) as total_revenue,
            COALESCE(SUM(CASE WHEN coa.account_type = 'HPP' THEN je.debit - je.credit ELSE 0 END), 0) as total_cogs,
            COALESCE(SUM(CASE WHEN coa.account_type = 'Biaya' THEN je.debit - je.credit ELSE 0 END), 0) as total_expense
        FROM journal_entries je
        JOIN chart_of_accounts coa ON je.account_id = coa.id
        JOIN general_journal gj ON je.journal_id = gj.id
        WHERE coa.account_type IN ('Pendapatan', 'HPP', 'Biaya') ${dateCondition}
        GROUP BY date_trunc('month', gj.entry_date)
        ORDER BY month ASC;
    `;
    const result = await pool.query(query, params);

    return result.rows.map(row => {
        const total_revenue = parseFloat(row.total_revenue);
        const total_cogs = parseFloat(row.total_cogs);
        const total_expense = parseFloat(row.total_expense);
        const gross_profit = total_revenue - total_cogs;
        const net_income = gross_profit - total_expense;
        return { ...row, total_revenue, total_cogs, total_expense, net_income };
    });
};

/**
 * @desc    Mendapatkan ringkasan neraca (total aset, kewajiban, ekuitas).
 * @returns {Promise<object>} - Objek berisi total aset, kewajiban, dan ekuitas.
 */
const getBalanceSheetSummary = async () => {
    const query = `
        SELECT
            account_type,
            COALESCE(SUM(
                CASE
                    WHEN account_type IN ('Aset', 'HPP', 'Biaya') THEN je.debit - je.credit
                    ELSE je.credit - je.debit
                END
            ), 0) as total
        FROM chart_of_accounts coa
        LEFT JOIN journal_entries je ON je.account_id = coa.id
        LEFT JOIN general_journal gj ON je.journal_id = gj.id
        WHERE coa.account_type IN ('Aset', 'Kewajiban', 'Ekuitas', 'Pendapatan', 'HPP', 'Biaya')
        GROUP BY coa.account_type;
    `;

    const result = await pool.query(query);

    const summary = {
        assets: 0,
        liabilities: 0,
        equity: 0,
    };

    let netIncome = 0;

    result.rows.forEach(row => {
        const total = parseFloat(row.total);
        if (row.account_type === 'Aset') summary.assets += total;
        else if (row.account_type === 'Kewajiban') summary.liabilities += total;
        else if (row.account_type === 'Ekuitas') summary.equity += total;
        else if (['Pendapatan', 'HPP', 'Biaya'].includes(row.account_type)) netIncome += total;
    });

    summary.equity += netIncome; // Add retained earnings (net income) to equity

    return summary;
};

module.exports = {
    getCashFlowSummary,
    getMemberGrowth,
    getIncomeStatementSummary,
    getBalanceSheetSummary,
    getDashboardStats,
};