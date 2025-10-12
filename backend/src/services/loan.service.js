const pool = require('../../db');

/**
 * Helper function to calculate installment details for a flat-principal loan model.
 * Interest is calculated on the remaining principal at the start of each period.
 * @param {object} loan - The loan object containing amount, tenor_months, and interest_rate.
 * @param {number} installmentNumber - The installment number to calculate.
 * @returns {object} - An object with principalComponent, interestComponent, and total.
 */
const _getInstallmentDetails = (loan, installmentNumber) => {
    const principal = parseFloat(loan.amount);
    const tenor = parseInt(loan.tenor_months, 10);
    const monthlyInterestRate = (parseFloat(loan.interest_rate) / 100) / 12;

    if (tenor <= 0) {
        return { principalComponent: 0, interestComponent: 0, total: 0 };
    }

    const principalComponent = principal / tenor;
    const remainingPrincipalAtStart = principal - ((installmentNumber - 1) * principalComponent);
    const interestComponent = remainingPrincipalAtStart * monthlyInterestRate;
    const total = principalComponent + interestComponent;

    return { principalComponent, interestComponent, total };
};

/**
 * @desc    A reusable service to get detailed loan information including amortization schedule.
 * @param   {number} loanId - The ID of the loan.
 * @param   {number|null} memberId - The ID of the member (optional, for authorization).
 * @returns {Promise<object>} - An object containing loan summary and installment schedule.
 * @throws  Will throw an error if the loan is not found or not accessible by the member.
 */
const getLoanDetailsService = async (loanId, memberId = null) => {
    // 1. Build the main query with optional memberId check
    let loanQuery = `
        SELECT 
            l.id, l.amount, l.commitment_signature_path, l.date AS start_date, l.status,
            l.member_id, m.name as "memberName", m.cooperative_number as "cooperativeNumber",
            ltp.name as "loanTypeName", lt.tenor_months, lt.interest_rate
        FROM loans l
        JOIN loan_terms lt ON l.loan_term_id = lt.id
        JOIN loan_types ltp ON l.loan_type_id = ltp.id
        JOIN members m ON l.member_id = m.id
        WHERE l.id = $1
    `;
    const queryParams = [loanId];
    if (memberId) {
        loanQuery += ' AND l.member_id = $2';
        queryParams.push(memberId);
    }

    const loanResult = await pool.query(loanQuery, queryParams);

    if (loanResult.rows.length === 0) {
        throw new Error('Pinjaman tidak ditemukan atau Anda tidak berhak mengaksesnya.');
    }
    const loan = loanResult.rows[0];

    // 2. Get all approved payments for this loan in one go
    const paymentsQuery = "SELECT id, installment_number, payment_date, amount_paid FROM loan_payments WHERE loan_id = $1 AND status = 'Approved'";
    const paymentsResult = await pool.query(paymentsQuery, [loanId]);
    const paymentsMap = new Map(paymentsResult.rows.map(p => [p.installment_number, p]));

    // 3. Generate the full amortization schedule
    const installments = [];
    for (let i = 1; i <= loan.tenor_months; i++) {
        const { total: totalInstallment } = _getInstallmentDetails(loan, i);
        const dueDate = new Date(loan.start_date);
        dueDate.setMonth(dueDate.getMonth() + i);
        const payment = paymentsMap.get(i);

        installments.push({
            installmentNumber: i,
            dueDate: dueDate.toISOString(),
            amount: totalInstallment,
            paymentDate: payment ? payment.payment_date : null,
            paymentId: payment ? payment.id : null,
            status: payment ? 'Lunas' : 'Belum Lunas'
        });
    }

    // 4. Calculate summary figures
    const totalPaid = Array.from(paymentsMap.values()).reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0);
    const { total: monthlyInstallmentFirst } = _getInstallmentDetails(loan, 1);

    return {
        summary: { ...loan, monthlyInstallment: monthlyInstallmentFirst, totalPaid },
        installments
    };
};

module.exports = {
    getLoanDetailsService,
    _getInstallmentDetails,
};