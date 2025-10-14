const db = require('../../db.js');
const crypto = require('crypto');
const { sendPasswordResetEmail, sendPasswordResetConfirmationEmail } = require('../utils/email.util.js');
const bcrypt = require('bcryptjs');

/**
 * Handles the "forgot password" request.
 * Generates a reset token, saves it to the database, and sends a reset email.
 */
exports.forgotPassword = async (req, res) => {
    // Use a try...catch block to handle any potential errors gracefully.
    try {
        const { email } = req.body;

        // 1. Find the user by email
        const { rows: users } = await db.query('SELECT id, name FROM members WHERE email = $1', [email]);

        if (users.length === 0) {
            // SECURITY: Send a generic success message even if the email is not found.
            // This prevents attackers from guessing which emails are registered.
            return res.status(200).json({ message: 'Permintaan terkirim. Silakan periksa email Anda untuk tautan penggantian password.' });
        }
        const user = users[0];

        // 2. Generate a secure random token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        // 3. Set token expiration (e.g., 10 minutes from now)
        const tokenExpiry = new Date(Date.now() + 10 * 60 * 1000);

        // 4. Save the hashed token and expiry date to the database
        await db.query('UPDATE members SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3', [hashedToken, tokenExpiry, user.id]);

        // 5. Create the reset URL for the email
        // IMPORTANT: Use your actual frontend URL here.
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

        // 6. Send the styled password reset email using the dedicated utility
        await sendPasswordResetEmail(email, user.name, resetUrl);

        // 8. Send the final success response
        res.status(200).json({ message: 'Permintaan terkirim. Silakan periksa email Anda untuk tautan penggantian password.' });

    } catch (error) {
        console.error('FORGOT PASSWORD ERROR:', error);

        // If an error occurs (e.g., database or email server issue),
        // send a generic 500 Internal Server Error response.
        res.status(500).json({ message: 'Terjadi kesalahan di server. Gagal mengirim email reset.' });
    }
};

// --- Placeholder functions for other routes ---

/**
 * Validates the reset token from the URL.
 */
exports.validateResetToken = async (req, res) => {
    try {
        // 1. Get the token from the URL params and hash it
        const { token } = req.params;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // 2. Find a user with this token and ensure it has not expired
        const { rows: users } = await db.query(
            'SELECT id FROM members WHERE reset_password_token = $1 AND reset_password_expires > $2',
            [hashedToken, new Date()]
        );

        if (users.length === 0) {
            return res.status(400).json({ error: 'Token tidak valid atau telah kedaluwarsa.' });
        }

        // 3. If token is valid, send a success response
        res.status(200).json({ message: 'Token valid.' });
    } catch (error) {
        console.error('VALIDATE TOKEN ERROR:', error);
        res.status(500).json({ error: 'Terjadi kesalahan di server.' });
    }
};

/**
 * Resets the user's password.
 */
exports.resetPassword = async (req, res) => {
    try {
        // 1. Get token from params and new password from body
        const { token } = req.params;
        const { password } = req.body;

        // 2. Find the user with a valid, non-expired token
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const { rows: users } = await db.query(
            'SELECT id, name, email FROM members WHERE reset_password_token = $1 AND reset_password_expires > $2',
            [hashedToken, new Date()]
        );

        if (users.length === 0) {
            return res.status(400).json({ message: 'Token tidak valid atau telah kedaluwarsa. Silakan minta tautan baru.' });
        }
        const user = users[0];

        // 3. Hash the new password and update the user's record
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.query('UPDATE members SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2', [hashedPassword, user.id]);

        // 4. Send a confirmation email (fire and forget, don't need to await if not critical)
        sendPasswordResetConfirmationEmail(user.email, user.name).catch(err => {
            console.error('Failed to send password reset confirmation email:', err);
        });

        res.status(200).json({ message: 'Password Anda telah berhasil diatur ulang. Anda sekarang dapat masuk dengan password baru.' });
    } catch (error) {
        console.error('RESET PASSWORD ERROR:', error);
        res.status(500).json({ message: 'Gagal mengatur ulang password. Terjadi kesalahan di server.' });
    }
};