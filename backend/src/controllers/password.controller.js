const pool = require('../config/db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendPasswordResetEmail, sendPasswordResetConfirmationEmail } = require('../utils/email.util');

const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        // 1. Cari pengguna berdasarkan email
        const userResult = await pool.query('SELECT * FROM members WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            // Untuk keamanan, jangan beri tahu jika email tidak ada.
            // Cukup kirim respons sukses generik.
            console.log(`Password reset attempt for non-existent email: ${email}`);
            return res.status(200).json({ message: 'Jika email terdaftar, tautan reset password telah dikirim.' });
        }
        const user = userResult.rows[0];

        // 2. Buat token reset
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

        // 3. Set masa berlaku token (misal: 10 menit)
        const passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000);

        // 4. Simpan token dan masa berlakunya ke database
        await pool.query(
            'UPDATE members SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
            [hashedToken, passwordResetExpires, user.id]
        );

        // 5. Kirim email ke pengguna
        // URL harus sesuai dengan struktur frontend Anda
        // Gunakan Environment Variable yang sudah kita atur sebelumnya
        const frontendBaseUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
        const resetUrl = `${frontendBaseUrl}/reset-password.html?token=${resetToken}`;
        
        await sendPasswordResetEmail(user.email, user.name, resetUrl);

        res.status(200).json({ message: 'Jika email terdaftar, tautan reset password telah dikirim.' });

    } catch (error) {
        console.error('Error in forgotPassword controller:', error);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
};

const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    try {
        // 1. Hash token dari URL untuk dicocokkan dengan yang di DB
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // 2. Cari pengguna dengan token yang valid dan belum kedaluwarsa
        const userResult = await pool.query(
            'SELECT * FROM members WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
            [hashedToken]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: 'Token tidak valid atau telah kedaluwarsa.' });
        }
        const user = userResult.rows[0];

        // 3. Validasi password baru
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password harus minimal 8 karakter.' });
        }

        // 4. Hash password baru
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 5. Update password pengguna dan hapus token reset
        await pool.query(
            'UPDATE members SET password = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = NOW() WHERE id = $2',
            [hashedPassword, user.id]
        );

        // 6. Kirim email konfirmasi bahwa password telah diubah
        await sendPasswordResetConfirmationEmail(user.email, user.name);

        res.status(200).json({ message: 'Password berhasil diubah. Silakan masuk dengan password baru Anda.' });

    } catch (error) {
        console.error('Error in resetPassword controller:', error);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
};

const validateResetToken = async (req, res) => {
    const { token } = req.params;
    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const result = await pool.query(
            'SELECT id FROM members WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
            [hashedToken]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ valid: false, message: 'Token tidak valid atau telah kedaluwarsa.' });
        }

        res.status(200).json({ valid: true });
    } catch (error) {
        console.error('Error validating token:', error);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
};


module.exports = {
    forgotPassword,
    resetPassword,
    validateResetToken,
};