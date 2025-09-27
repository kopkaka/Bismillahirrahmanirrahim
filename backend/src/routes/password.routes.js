const express = require('express');
const router = express.Router();
const { forgotPassword, resetPassword, validateResetToken } = require('../controllers/password.controller');

// Rute untuk mengirim email reset
router.post('/forgot-password', forgotPassword);

// Rute untuk memvalidasi token saat halaman reset-password dimuat
router.get('/reset/:token', validateResetToken);

// Rute untuk mengirim password baru
router.post('/reset/:token', resetPassword);

module.exports = router;