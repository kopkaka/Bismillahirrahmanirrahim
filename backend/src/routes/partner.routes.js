const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const partnerController = require('../controllers/partner.controller');
const upload = require('../middleware/upload.middleware'); // Menggunakan middleware utama

// This permission will be used for admin-only routes.
// The `authorize` middleware allows the 'admin' role to pass any check.
const permission = ['viewSettings'];

// Admin routes
router.route('/')
    .get(authMiddleware, authorize(permission), partnerController.getPartners)
    .post(authMiddleware, authorize(permission), upload.single('partnerLogo'), partnerController.createPartner);

router.route('/:id')
    .get(authMiddleware, authorize(permission), partnerController.getPartnerById)
    .put(authMiddleware, authorize(permission), upload.single('partnerLogo'), partnerController.updatePartner)
    .delete(authMiddleware, authorize(permission), partnerController.deletePartner);

module.exports = router;