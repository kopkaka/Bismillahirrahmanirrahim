const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const memberController = require('../controllers/member.controller');
const companyController = require('../controllers/company.controller');
const positionController = require('../controllers/position.controller');
const loanTermsController = require('../controllers/loanterms.controller');
const testimonialController = require('../controllers/testimonial.controller');

// Rute publik untuk mendapatkan produk, digunakan oleh toko-sembako.html dll.
router.get('/products', productController.getPublicProducts);

// Rute publik untuk data registrasi
router.get('/testimonials', testimonialController.getPublicTestimonials);
router.get('/companies', companyController.getCompanies);
router.get('/positions', positionController.getPositions);
router.get('/loan-terms', loanTermsController.getPublicLoanTerms);

// Rute publik untuk pengumuman
router.get('/announcements', memberController.getAnnouncements);

// Rute publik untuk validasi anggota dan checkout
router.post('/validate-member', productController.validateMemberByCoopNumber);
router.post('/sales', productController.createSaleOrder);
// Rute publik untuk melihat detail pesanan (misalnya dari email)
router.get('/sales/:orderId', productController.getSaleDetailsByOrderId);

module.exports = router;