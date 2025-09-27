const pool = require('../../db');

/**
 * @desc    Mendapatkan ringkasan arus kas untuk periode tertentu.
 * @param {string} [startDate] - Tanggal mulai (YYYY-MM-DD).
 * @param {string} [endDate] - Tanggal akhir (YYYY-MM-DD).
 * @returns {Promise<object>} - Objek berisi inflow dan outflow.
 */
const getCashFlowSummary = async (startDate, endDate) => {
    const cashAccountId = 3; // Asumsi ID Akun Kas adalah 3
    let queryText = `
        SELECT
            COALESCE(SUM(CASE WHEN je.account_id = $1 THEN je.debit ELSE 0 END), 0) as total_inflow,
            COALESCE(SUM(CASE WHEN je.account_id = $1 THEN je.credit ELSE 0 END), 0) as total_outflow
        FROM journal_entries je
        JOIN general_journal gj ON je.journal_id = gj.id
    `;
    const queryParams = [cashAccountId];
    let paramIndex = 2;

    if (startDate && endDate) {
        queryText += ` WHERE gj.entry_date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        queryParams.push(startDate, endDate);
    } else {
        queryText += ` WHERE gj.entry_date >= NOW() - INTERVAL '30 days'`;
    }

    const result = await pool.query(queryText, queryParams);
    return {
        inflow: parseFloat(result.rows[0].total_inflow),
        outflow: parseFloat(result.rows[0].total_outflow),
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

// ... (Fungsi getBalanceSheetSummary juga bisa dipindahkan ke sini)

module.exports = {
    getCashFlowSummary,
    getMemberGrowth,
    getIncomeStatementSummary,
};