const express = require('express');
const router = express.Router();
// This file is being refactored to correctly point to the controller functions,
// which were previously scattered across different files.
const productController = require('../controllers/product.controller');
const adminController = require('../controllers/admin.controller');
const memberController = require('../controllers/member.controller');
const employerController = require('../controllers/employer.controller');

// Rute publik untuk mendapatkan produk, digunakan oleh toko-sembako.html dll.
// FIX: Path changed to /public/products and uses the correct controller
router.get('/public/products', productController.getPublicProducts);

// Rute publik untuk data registrasi
// FIX: Pointing to the correct controller functions
router.get('/public/testimonials', adminController.getTestimonials);
router.get('/public/employers', employerController.getEmployers);
router.get('/public/positions', adminController.getPositions);
router.get('/public/loan-terms', adminController.getLoanTerms);

// Rute publik untuk pengumuman
// FIX: Pointing to the correct controller function
router.get('/public/announcements', memberController.getAnnouncements);

// Rute publik untuk validasi anggota dan checkout
router.post('/public/validate-member', productController.validateMemberByCoopNumber);
router.post('/public/sales', productController.createSaleOrder);

module.exports = router;