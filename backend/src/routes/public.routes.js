const express = require('express');
const router = express.Router();
const {
    getPublicTestimonials,
    getPublicPartners,
    getPublicLoanTerms,
    getPublicProducts,
    getSaleDetailsForMember,
    cancelSaleByMember
} = require('../controllers/public.controller');

// Import fungsi yang kita butuhkan dari admin controller
const { getElectronicLoanTerms } = require('../controllers/admin.controller');

// Rute yang sudah ada (diasumsikan)
router.get('/testimonials', getPublicTestimonials);
router.get('/partners', getPublicPartners);
router.get('/loan-terms', getPublicLoanTerms);
router.get('/products', getPublicProducts);
router.get('/sales/:orderId', getSaleDetailsForMember);
router.post('/sales/:orderId/cancel', cancelSaleByMember);

// Rute baru untuk tenor elektronik
router.get('/loan-terms/elektronik', getElectronicLoanTerms);


module.exports = router;