const pool = require('../../db');

/**
 * A reusable utility function to get multiple account IDs from the chart_of_accounts table by their names.
 * This is more efficient than calling getAccountId multiple times as it uses a single query.
 * @param {string[]} accountNames - An array of account names to find (e.g., ['Kas', 'Piutang Usaha']).
 * @param {object} [client=pool] - Optional. A specific database client to use, for transactions. Defaults to the main pool.
 * @returns {Promise<Object<string, number>>} A promise that resolves to an object mapping account names to their IDs.
 * @throws {Error} If any of the requested accounts are not found in the database.
 */
const getAccountIds = async (accountNames, client = pool) => {
    const query = 'SELECT id, account_name FROM chart_of_accounts WHERE account_name = ANY($1::text[])';
    const result = await client.query(query, [accountNames]);

    if (result.rows.length !== accountNames.length) {
        const foundNames = new Set(result.rows.map(r => r.account_name));
        const missingNames = accountNames.filter(name => !foundNames.has(name));
        throw new Error(`Akun berikut tidak ditemukan di Chart of Accounts: ${missingNames.join(', ')}`);
    }

    return result.rows.reduce((acc, row) => ({ ...acc, [row.account_name]: row.id }), {});
};

module.exports = { getAccountIds };