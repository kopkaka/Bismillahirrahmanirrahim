const rateLimit = require('express-rate-limit');

// Rate limiter for login attempts to prevent brute-force attacks
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Terlalu banyak percobaan login dari IP ini, silakan coba lagi setelah 15 menit.' },
});

// Rate limiter for registration attempts to prevent spam
const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Limit each IP to 20 registration requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan pendaftaran dari IP ini, silakan coba lagi setelah satu jam.' },
});

module.exports = {
    loginLimiter,
    registrationLimiter,
};