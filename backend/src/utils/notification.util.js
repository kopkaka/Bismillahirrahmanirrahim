const pool = require('../../db');

/**
 * Creates a notification for a specific member.
 * This is a "fire and forget" function; it logs errors but doesn't throw them
 * to avoid interrupting the main business logic flow (e.g., loan approval).
 * @param {number} memberId - The ID of the member to notify.
 * @param {string} message - The notification message.
 * @param {string|null} link - An optional link for frontend navigation (e.g., 'loans', 'savings').
 */
const createNotification = async (memberId, message, link = null) => {
    try {
        const query = `INSERT INTO notifications (member_id, message, link) VALUES ($1, $2, $3)`;
        await pool.query(query, [memberId, message, link]);
    } catch (error) {
        console.error(`Failed to create notification for member ${memberId}:`, error);
    }
};

module.exports = { createNotification };