const authorize = (requiredPermissions) => {
    // The middleware is no longer async as it doesn't query the DB.
    return (req, res, next) => {
        // Ensure req.user exists and has the necessary properties set by auth.middleware.js
        if (!req.user || !req.user.role || !req.user.permissions) {
            return res.status(403).json({ error: 'Akses ditolak. Informasi otorisasi tidak lengkap.' });
        }

        const { role, permissions: userPermissions } = req.user;

        // --- Improvement: Input validation for the middleware itself ---
        // This helps catch configuration errors during development.
        if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) {
            // This is a server configuration error, not a client error.
            console.error('Authorization error: requiredPermissions must be a non-empty array.');
            return res.status(500).json({ error: 'Kesalahan konfigurasi otorisasi server.' });
        }

        // --- Improvement: Check against cached permissions from the JWT ---
        // This is much faster as it avoids a database query on every request.
        // It checks if the user's permissions array has at least one of the required permissions (OR logic).
        const hasPermission = requiredPermissions.some(permission => userPermissions.includes(permission));

        if (hasPermission) {
            next(); // Permission found, proceed.
        } else {
            res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki izin untuk melakukan tindakan ini.' });
        }
    };
};

module.exports = authorize;