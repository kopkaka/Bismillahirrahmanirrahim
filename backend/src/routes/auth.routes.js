const express = require('express');
const router = express.Router();
const { registerMember, login, validateMemberByCoopNumber } = require('../controllers/auth.controller');
const upload = require('../middleware/upload.middleware');
const { loginLimiter, registrationLimiter } = require('../middleware/rateLimit.middleware');

// @route   POST api/auth/register
// @desc    Mendaftarkan anggota baru
// @access  Public
router.post('/register', registrationLimiter, upload.fields([
    { name: 'ktp_photo', maxCount: 1 },
    { name: 'selfie_photo', maxCount: 1 },
    { name: 'kk_photo', maxCount: 1 }
]), registerMember);

// @route   POST api/auth/login
// @desc    Login user (member/admin/etc)
// @access  Public
router.post('/login', loginLimiter, login);

// @route   POST api/auth/validate-coop-number
// @desc    Validates a member's cooperative number for shop transactions
// @access  Public
router.post('/validate-coop-number', validateMemberByCoopNumber);

module.exports = router;