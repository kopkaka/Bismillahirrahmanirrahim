const express = require('express');
const router = express.Router();
const {
    getPublicProducts, // Pindahkan dari product.controller
    validateMemberByCoopNumber, // Pindahkan dari product.controller
    createSaleOrder, // Pindahkan dari product.controller
    getSaleDetailsForMember, // Sudah ada di public.controller
    cancelSaleByMember // Sudah ada di public.controller
} = require('../controllers/product.controller'); // Ubah ke product.controller

// Import fungsi yang kita butuhkan dari admin controller
const {
    getTestimonials,
    getPartners,
    getElectronicLoanTerms,
    getPositions
} = require('../controllers/admin.controller');
const { getEmployers } = require('../controllers/employer.controller');
const { getAnnouncements } = require('../controllers/member.controller');
const { getLoanTerms } = require('../controllers/loanterms.controller');

// Rute untuk Toko dan Checkout
router.get('/products', getPublicProducts);
router.post('/validate-member', validateMemberByCoopNumber);
router.post('/sales', createSaleOrder);
router.get('/sales/:orderId', getSaleDetailsForMember);
router.post('/sales/:orderId/cancel', cancelSaleByMember);

// Rute baru untuk tenor elektronik
router.get('/loan-terms/elektronik', getElectronicLoanTerms);


// Rute untuk Halaman Utama (Landing Page) & Registrasi
router.get('/testimonials', getTestimonials);
router.get('/partners', getPartners);
router.get('/loan-terms', getLoanTerms);
router.get('/employers', getEmployers);
router.get('/positions', getPositions);
router.get('/announcements', getAnnouncements);

module.exports = router;