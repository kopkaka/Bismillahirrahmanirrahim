const jwt = require('jsonwebtoken');
const pool = require('../../db');
require('dotenv').config();

const authMiddleware = async (req, res, next) => {
    // Mengambil token dari header Authorization
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        // Sesuai RFC 7235, respons 401 sebaiknya menyertakan header WWW-Authenticate.
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({ error: 'Akses ditolak. Token autentikasi tidak diberikan.' });
    }

    // Memeriksa format "Bearer <token>"
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Format token tidak valid. Harap gunakan format "Bearer <token>".' });
    }

    const token = authHeader.substring(7);

    try {
        // Verifikasi token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Validasi payload: pastikan token berisi informasi user yang diharapkan
        if (!decoded || !decoded.user || !decoded.user.id || !decoded.user.role || !Array.isArray(decoded.user.permissions)) {
            return res.status(401).json({ error: 'Token tidak valid atau malformed (informasi otorisasi tidak lengkap).' });
        }

        // Tambahan: Periksa status user di database untuk memastikan token masih valid
        // untuk pengguna yang aktif. Ini mencegah penggunaan token dari user yang sudah
        // dinonaktifkan atau dihapus.
        const { rows } = await pool.query("SELECT role, status FROM members WHERE id = $1", [decoded.user.id]);
        const userFromDb = rows[0];

        if (!userFromDb || userFromDb.status !== 'Active') {
            return res.status(401).json({ error: 'Pengguna tidak lagi aktif atau tidak ditemukan.' });
        }

        // Sinkronkan role dari DB. Ini penting jika role pengguna bisa berubah.
        // Ini juga memastikan req.user memiliki data terbaru dari database.
        // Permissions diambil dari token untuk performa, karena perubahan role akan
        // memaksa login ulang dan token baru akan dibuat.
        req.user = {
            id: decoded.user.id,
            role: userFromDb.role,
            permissions: decoded.user.permissions
        };
        next();

    } catch (err) {
        // Memberikan feedback error yang lebih spesifik
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token telah kedaluwarsa. Silakan login kembali.' });
        }
        return res.status(401).json({ error: 'Token tidak valid.' });
    }
};

module.exports = authMiddleware;