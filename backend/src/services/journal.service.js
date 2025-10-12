const { getAccountIds } = require('../utils/getAccountIds.util');

/**
 * Creates a journal entry for a saving transaction within a database transaction.
 * @param {object} client - The database client from an active transaction.
 * @param {object} savingDetails - An object containing details about the saving.
 * @param {number} savingDetails.amount - The amount of the saving.
 * @param {string} savingDetails.saving_type_name - The name of the saving type.
 * @param {number} savingDetails.account_id - The liability account ID for the saving type.
 * @param {string} savingDetails.member_name - The name of the member.
 * @param {Date} savingDetails.date - The date of the transaction.
 * @returns {Promise<number>} The ID of the newly created journal header.
 */
const createSavingJournal = async (client, savingDetails) => {
    const { amount, saving_type_name, account_id, member_name, date } = savingDetails;

    if (!account_id) {
        throw new Error(`Tipe simpanan "${saving_type_name}" belum terhubung ke akun COA.`);
    }

    const isWithdrawal = saving_type_name === 'Penarikan Simpanan Sukarela';

    // Fetch required account IDs in one go
    const accountIds = await getAccountIds(['Kas'], client);
    const cashAccountId = accountIds['Kas'];

    const description = isWithdrawal
        ? `Penarikan simpanan sukarela a/n ${member_name}`
        : `Setoran ${saving_type_name} a/n ${member_name}`;

    // --- Generate Automatic Journal Reference Number ---
    const entryDate = new Date(date);
    const year = entryDate.getFullYear();
    const month = String(entryDate.getMonth() + 1).padStart(2, '0');
    const day = String(entryDate.getDate()).padStart(2, '0');
    const prefix = `JRNL-${year}${month}${day}-`;
    const seqResult = await client.query("SELECT COUNT(*) FROM general_journal WHERE reference_number LIKE $1", [`${prefix}%`]);
    const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
    const referenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

    const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [date, description, referenceNumber]);
    const journalId = journalHeaderRes.rows[0].id;

    const debitAccountId = isWithdrawal ? account_id : cashAccountId;
    const creditAccountId = isWithdrawal ? cashAccountId : account_id;
    const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
    await client.query(journalEntriesQuery, [journalId, debitAccountId, amount, creditAccountId]);

    return journalId;
};

module.exports = { createSavingJournal };