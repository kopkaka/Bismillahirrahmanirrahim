const pool = require('../../db');
const dashboardService = require('../services/dashboard.service');
const { getAccountIds } = require('../utils/getAccountIds.util');

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
                COALESCE(SUM(total_amount), 0) as "totalRevenue"
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
        // Calculate totalItemsSold from the byProduct query result for better efficiency
        const totalItemsSold = byProductRes.rows.reduce((sum, p) => sum + parseInt(p.total_quantity, 10), 0);

        const summary = {
            transactionCount: parseInt(summaryRes.rows[0].transactionCount, 10),
            totalRevenue: parseFloat(summaryRes.rows[0].totalRevenue),
            totalItemsSold: totalItemsSold,
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

const getBalanceSheet = async (req, res) => {
    const { asOfDate: endDate } = req.query;

    if (!endDate) {
        return res.status(400).json({ error: 'Tanggal laporan diperlukan.' });
    }

    const year = new Date(endDate).getFullYear();
    const prevYearEndDate = `${year - 1}-12-31`;

    try {        
        const reportQuery = `
            SELECT
                coa.account_type,
                coa.account_name,
                coa.account_number,
                COALESCE(SUM(CASE WHEN gj.entry_date <= $2 THEN
                    (CASE
                        WHEN coa.account_type IN ('Aset', 'HPP', 'Biaya') THEN je.debit - je.credit
                        ELSE je.credit - je.debit
                    END)
                ELSE 0 END), 0) as beginning_balance,
                COALESCE(SUM(CASE WHEN gj.entry_date <= $1 THEN
                    (CASE
                        WHEN coa.account_type IN ('Aset', 'HPP', 'Biaya') THEN je.debit - je.credit
                        ELSE je.credit - je.debit
                    END)
                ELSE 0 END), 0) as ending_balance
            FROM chart_of_accounts coa
            LEFT JOIN journal_entries je ON je.account_id = coa.id
            LEFT JOIN general_journal gj ON je.journal_id = gj.id AND gj.entry_date <= $1
            GROUP BY coa.id
            ORDER BY coa.account_number;
        `;

        const result = await pool.query(reportQuery, [endDate, prevYearEndDate]);

        const report = {
            assets: { items: [], beginning_total: 0, ending_total: 0 },
            liabilities: { items: [], beginning_total: 0, ending_total: 0 },
            equity: { items: [], beginning_total: 0, ending_total: 0 },
        };
        
        let beginningNetIncome = 0;
        let endingNetIncome = 0;

        result.rows.forEach(row => {
            const beginning_balance = parseFloat(row.beginning_balance);
            const ending_balance = parseFloat(row.ending_balance);

            if (beginning_balance === 0 && ending_balance === 0) return;

            const item = { name: row.account_name, number: row.account_number, beginning_balance, ending_balance };

            if (row.account_type === 'Aset') {
                report.assets.items.push(item);
            } else if (row.account_type === 'Kewajiban') {
                report.liabilities.items.push(item);
            } else if (row.account_type === 'Ekuitas') {
                report.equity.items.push(item);
            } else if (['Pendapatan', 'HPP', 'Biaya'].includes(row.account_type)) {
                beginningNetIncome += beginning_balance;
                endingNetIncome += ending_balance;
            }
        });

        report.equity.items.push({
            name: 'Laba/Rugi (Akumulasi)',
            number: '3-9999',
            beginning_balance: beginningNetIncome,
            ending_balance: endingNetIncome
        });

        report.assets.beginning_total = report.assets.items.reduce((sum, item) => sum + item.beginning_balance, 0);
        report.assets.ending_total = report.assets.items.reduce((sum, item) => sum + item.ending_balance, 0);
        report.liabilities.beginning_total = report.liabilities.items.reduce((sum, item) => sum + item.beginning_balance, 0);
        report.liabilities.ending_total = report.liabilities.items.reduce((sum, item) => sum + item.ending_balance, 0);
        report.equity.beginning_total = report.equity.items.reduce((sum, item) => sum + item.beginning_balance, 0);
        report.equity.ending_total = report.equity.items.reduce((sum, item) => sum + item.ending_balance, 0);

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

    try {
        // --- Refactoring: Use a single, powerful query to get all cash movements ---
        const cashFlowQuery = `
            WITH cash_transactions AS (
                -- Select all transactions involving any 'Kas' account
                SELECT
                    gj.entry_date,
                    je.debit,
                    je.credit,
                    -- Find the opposing account in the same journal entry
                    (SELECT account_id FROM journal_entries WHERE journal_id = je.journal_id AND id != je.id LIMIT 1) as opposing_account_id
                FROM journal_entries je
                JOIN general_journal gj ON je.journal_id = gj.id
                WHERE je.account_id IN (SELECT id FROM chart_of_accounts WHERE account_name ILIKE 'Kas%')
            )
            SELECT
                -- Beginning Balance
                (SELECT COALESCE(SUM(debit - credit), 0) FROM cash_transactions WHERE entry_date < $1) as "beginningCash",
                -- Operating Inflows
                (SELECT COALESCE(SUM(debit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Pendapatan') as "fromSalesAndInterest",
                -- Operating Outflows
                (SELECT COALESCE(SUM(credit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Hutang Usaha') as "toSuppliers",
                (SELECT COALESCE(SUM(credit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Biaya') as "forExpenses",
                -- Financing Inflows
                (SELECT COALESCE(SUM(debit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Kewajiban' AND coa.account_name ILIKE 'Simpanan%') as "fromSavings",
                (SELECT COALESCE(SUM(debit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Aset' AND coa.account_name ILIKE 'Piutang%') as "fromLoanRepayments",
                -- Financing Outflows
                (SELECT COALESCE(SUM(credit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Aset' AND coa.account_name ILIKE 'Piutang%') as "forLoanDisbursements",
                (SELECT COALESCE(SUM(credit), 0) FROM cash_transactions ct JOIN chart_of_accounts coa ON ct.opposing_account_id = coa.id WHERE entry_date BETWEEN $1 AND $2 AND coa.account_type = 'Kewajiban' AND coa.account_name ILIKE 'Simpanan%') as "forResignations"
        `;

        const result = await pool.query(cashFlowQuery, [startDate, endDate]);
        const data = result.rows[0];

        const operating = {
            inflows: {
                fromSalesAndInterest: parseFloat(data.fromSalesAndInterest),
                total: parseFloat(data.fromSalesAndInterest)
            },
            outflows: {
                toSuppliers: parseFloat(data.toSuppliers),
                forExpenses: parseFloat(data.forExpenses),
                total: parseFloat(data.toSuppliers) + parseFloat(data.forExpenses)
            },
            net: parseFloat(data.fromSalesAndInterest) - (parseFloat(data.toSuppliers) + parseFloat(data.forExpenses))
        };

        const financing = {
            inflows: {
                fromSavings: parseFloat(data.fromSavings),
                fromLoanRepayments: parseFloat(data.fromLoanRepayments),
                total: parseFloat(data.fromSavings) + parseFloat(data.fromLoanRepayments)
            },
            outflows: {
                forLoanDisbursements: parseFloat(data.forLoanDisbursements),
                forResignations: parseFloat(data.forResignations),
                total: parseFloat(data.forLoanDisbursements) + parseFloat(data.forResignations)
            },
            net: (parseFloat(data.fromSavings) + parseFloat(data.fromLoanRepayments)) - (parseFloat(data.forLoanDisbursements) + parseFloat(data.forResignations))
        };

        const beginningCash = parseFloat(data.beginningCash);
        const netCashFlow = operating.net + financing.net;
        const endingCash = beginningCash + netCashFlow;

        res.json({
            summary: { beginningCash, endingCash, netCashFlow },
            operating,
            financing
        });
    } catch (err) {
        console.error('Error generating cash flow statement:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan arus kas.' });
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

const getGeneralLedger = async (req, res) => {
    const { startAccountId, endAccountId, startDate, endDate } = req.query;

    if (!startAccountId || !endAccountId || !startDate || !endDate) {
        return res.status(400).json({ error: 'Rentang akun, tanggal mulai, dan tanggal akhir diperlukan.' });
    }

    const client = await pool.connect();
    try {
        const startAccountRes = await client.query('SELECT account_number FROM chart_of_accounts WHERE id = $1', [startAccountId]);
        const endAccountRes = await client.query('SELECT account_number FROM chart_of_accounts WHERE id = $1', [endAccountId]);

        if (startAccountRes.rows.length === 0) throw new Error('Akun awal tidak ditemukan.');
        if (endAccountRes.rows.length === 0) throw new Error('Akun akhir tidak ditemukan.');

        const startAccountNumber = startAccountRes.rows[0].account_number;
        const endAccountNumber = endAccountRes.rows[0].account_number;

        const [finalStart, finalEnd] = startAccountNumber <= endAccountNumber ? [startAccountNumber, endAccountNumber] : [endAccountNumber, startAccountNumber];

        const accountsToProcessRes = await client.query(
            `SELECT id, account_number, account_name, account_type FROM chart_of_accounts WHERE account_number >= $1 AND account_number <= $2 ORDER BY account_number ASC`,
            [finalStart, finalEnd]
        );
        const accountsToProcess = accountsToProcessRes.rows;

        if (accountsToProcess.length === 0) return res.json([]);

        const allLedgers = [];

        for (const account of accountsToProcess) {
            const isDebitNormalBalance = ['Aset', 'HPP', 'Biaya'].includes(account.account_type);

            const beginningBalanceQuery = `SELECT COALESCE(SUM(CASE WHEN $1 THEN je.debit - je.credit ELSE je.credit - je.debit END), 0) as balance FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $2 AND gj.entry_date < $3`;
            const transactionsQuery = `SELECT gj.entry_date, gj.description, gj.reference_number, je.debit, je.credit FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3 ORDER BY gj.entry_date ASC, gj.id ASC`;

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

            if (transactions.length > 0 || Math.abs(beginningBalance) > 0.001) {
                allLedgers.push({ account: { id: account.id, account_number: account.account_number, account_name: account.account_name }, summary: { beginningBalance, endingBalance: runningBalance }, transactions });
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

module.exports = {
    getSalesReport,
    getIncomeStatement,
    getBalanceSheet,
    getCashFlowStatement,
    getMonthlyClosingStatus,
    getGeneralLedger,
};