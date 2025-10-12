const pool = require('../../db');

/**
 * A reusable utility function to get an account ID from the chart_of_accounts table by its name.
 * This helps avoid duplicating the same query across multiple controllers.
 * @param {string} accountName - The name of the account to find (e.g., 'Kas', 'Piutang Usaha').
 * @param {object} [client=pool] - Optional. A specific database client to use, for transactions. Defaults to the main pool.
 * @returns {Promise<number>} The ID of the account.
 * @throws {Error} If the account is not found in the database.
 */
const getAccountId = async (accountName, client = pool) => {
    const result = await client.query('SELECT id FROM chart_of_accounts WHERE account_name = $1', [accountName]);
    if (result.rows.length === 0) {
        throw new Error(`Akun "${accountName}" tidak ditemukan di Chart of Accounts.`);
    }
    return result.rows[0].id;
};

module.exports = { getAccountId };