const express = require('express');
const router = express.Router();
const {
    getPublicTestimonials,
    getPublicPartners,
    getPublicProducts,
    getPublicEmployers,
    getPublicPositions,
    getPublicLoanTerms,
    getPublicAnnouncements,
    createSaleOrder,
    getPublicSaleDetailsByOrderId
} = require('../controllers/public.controller');
const { validateMemberByCoopNumber } = require('../controllers/auth.controller');
const { cancelSaleOrder } = require('../controllers/member.controller');
const { getElectronicLoanTerms } = require('../controllers/loanterms.controller');

// Rute untuk Toko dan Checkout
router.get('/products', getPublicProducts);
router.post('/validate-member', validateMemberByCoopNumber);
router.post('/sales', createSaleOrder);
router.get('/sales/:orderId', getPublicSaleDetailsByOrderId);
router.post('/sales/:orderId/cancel', protect, cancelSaleOrder); // Added protect middleware

// Rute baru untuk tenor elektronik
router.get('/loan-terms/elektronik', getElectronicLoanTerms);


// Rute untuk Halaman Utama (Landing Page) & Registrasi
router.get('/testimonials', getTestimonials);
router.get('/partners', getPublicPartners);
router.get('/loan-terms', getPublicLoanTerms);
router.get('/employers', getPublicEmployers);
router.get('/positions', getPublicPositions);
router.get('/announcements', getPublicAnnouncements);

module.exports = router;