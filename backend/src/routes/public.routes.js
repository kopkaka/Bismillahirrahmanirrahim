const express = require('express');
const router = express.Router();

const publicController = require('../controllers/public.controller'); // No change here, just for context
const memberController = require('../controllers/member.controller');
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');

// This router handles all public-facing endpoints that do not require authentication.
// It is mounted at /api/public in the main router.

// Routes for the public-facing shop (toko.html, etc.)
router.get('/products', publicController.getPublicProducts);

// Routes for the registration page (registrasi.html)
router.get('/testimonials', publicController.getPublicTestimonials);
router.get('/employers', publicController.getPublicEmployers);
router.get('/positions', publicController.getPublicPositions);
router.get('/loan-terms', publicController.getPublicLoanTerms);
router.get('/announcements', publicController.getPublicAnnouncements);
router.get('/partners', publicController.getPublicPartners);

// Routes for shop checkout logic
router.get('/sales/:orderId', publicController.getPublicSaleDetailsByOrderId);
router.post('/sales', publicController.createSaleOrder);
// Route for cancelling an order. Requires authentication.
// It can be cancelled by the member who made it, or by an admin/accounting staff.
router.post('/sales/:orderId/cancel', protect, memberController.cancelSaleOrder);

module.exports = router;