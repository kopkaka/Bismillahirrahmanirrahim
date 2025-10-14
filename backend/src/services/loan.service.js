const { getAccountIds } = require('../utils/getAccountIds.util');

/**
 * Creates a new loan from a transaction (e.g., a store purchase).
 * This function is designed to be called within an existing database transaction.
 * @param {object} client - The database client from an active transaction.
 * @param {object} loanDetails - Details for creating the loan.
 * @param {number} loanDetails.memberId - The ID of the member taking the loan.
 * @param {number} loanDetails.loanTermId - The ID of the selected loan term.
 * @param {number} loanDetails.amount - The total amount of the loan.
 * @param {number} loanDetails.saleId - The ID of the sale that generated this loan.
 * @returns {Promise<number>} The ID of the newly created loan.
 */
const createLoanFromTransaction = async (client, { memberId, loanTermId, amount, saleId }) => {
    if (!memberId || !loanTermId || !amount || !saleId) {
        throw new Error('Data untuk membuat pinjaman dari transaksi tidak lengkap.');
    }

    const termRes = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loanTermId]);
    if (termRes.rows.length === 0) throw new Error('Tenor pinjaman tidak valid.');
    const loanTypeId = termRes.rows[0].loan_type_id;

    const loanInsertQuery = `
        INSERT INTO loans (member_id, loan_type_id, loan_term_id, amount, date, status, remaining_principal)
        VALUES ($1, $2, $3, $4, NOW(), 'Approved', $4) RETURNING id
    `;
    const newLoanRes = await client.query(loanInsertQuery, [memberId, loanTypeId, loanTermId, amount]);
    return newLoanRes.rows[0].id;
};

module.exports = { createLoanFromTransaction };