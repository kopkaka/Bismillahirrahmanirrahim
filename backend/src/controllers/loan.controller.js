const pool = require('../../db');

// Helper function to calculate monthly installment (Annuity formula)
const calculateMonthlyInstallment = (principal, monthlyInterestRate, tenorMonths) => {
    if (monthlyInterestRate === 0) {
        return principal / tenorMonths;
    }
    const i = monthlyInterestRate / 100;
    const installment = principal * (i * Math.pow(1 + i, tenorMonths)) / (Math.pow(1 + i, tenorMonths) - 1);
    return installment;
};

// GET all loans with joined data
const getLoans = async (req, res) => {
    try {
        const { status, startDate, endDate, search, page = 1, limit = 10 } = req.query;
        // This query joins multiple tables to get comprehensive loan data
        let baseQuery = `
            FROM loans l
            JOIN members m ON l.member_id = m.id
            JOIN loan_types lt ON l.loan_type_id = lt.id
            JOIN loan_terms ltm ON l.loan_term_id = ltm.id
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
                l.remaining_principal AS "remainingPrincipal",
                ltm.tenor_months AS "tenorMonths",
                ltm.interest_rate AS "interestRate"
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

        // Calculate monthly installment and total payment for each loan
        const loansWithCalculations = result.rows.map(loan => {
            const monthlyInstallment = calculateMonthlyInstallment(parseFloat(loan.amount), parseFloat(loan.interestRate), loan.tenorMonths);
            const totalPayment = monthlyInstallment * loan.tenorMonths;
            return {
                ...loan,
                monthlyInstallment: Math.round(monthlyInstallment),
                totalPayment: Math.round(totalPayment)
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

module.exports = {
    getLoans,
};