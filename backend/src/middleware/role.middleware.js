const authorize = (requiredItems) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role || !req.user.permissions) {
            return res.status(403).json({ error: 'Akses ditolak. Informasi otorisasi tidak lengkap.' });
        }

        const { role: userRole, permissions: userPermissions } = req.user;

        if (!Array.isArray(requiredItems) || requiredItems.length === 0) {
            console.error('Authorization error: requiredPermissions must be a non-empty array.');
            return res.status(500).json({ error: 'Kesalahan konfigurasi otorisasi server.' });
        }

        // --- LOGIKA BARU ---
        // Cek apakah peran pengguna termasuk dalam item yang diperlukan.
        const hasRequiredRole = requiredItems.includes(userRole);

        // Cek apakah pengguna memiliki setidaknya salah satu izin yang diperlukan.
        const hasRequiredPermission = requiredItems.some(permission => userPermissions.includes(permission));

        // Izinkan akses jika pengguna memiliki peran yang diperlukan ATAU izin yang diperlukan.
        if (hasRequiredRole || hasRequiredPermission) {
            next();
        } else {
            res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki izin yang diperlukan.' });
        }
    };
};

module.exports = authorize;