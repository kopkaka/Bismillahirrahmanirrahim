const express = require('express');
const router = express.Router();
const { forgotPassword, resetPassword, validateResetToken } = require('../controllers/password.controller');

// Rute untuk mengirim email reset. Path lengkapnya akan menjadi /api/auth/forgot-password
router.post('/forgot-password', forgotPassword);

// Rute untuk memvalidasi token. Path lengkapnya akan menjadi /api/auth/reset/:token
router.get('/reset/:token', validateResetToken);

// Rute untuk mengirim password baru. Path lengkapnya akan menjadi /api/auth/reset/:token
router.post('/reset/:token', resetPassword);

module.exports = router;