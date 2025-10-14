const express = require('express');
const router = express.Router();
const { getPublicTestimonials } = require('../controllers/testimonial.controller');
const { getPublicPartners } = require('../controllers/partner.controller');
const { getPublicLoanTerms } = require('../controllers/loanterms.controller');
const { getPublicCompanies } = require('../controllers/company.controller'); // Impor controller perusahaan
const { getPositions } = require('../controllers/position.controller'); // Impor controller jabatan
const { getProducts } = require('../controllers/product.controller'); // Impor controller produk

// @route   GET /api/public/companies
// @desc    Get all companies for registration dropdown
// @access  Public
router.get('/companies', getPublicCompanies);

// @route   GET /api/public/positions
// @desc    Get all positions for registration dropdown
// @access  Public
router.get('/positions', getPositions);

// @route   GET /api/public/loan-terms
// @desc    Get all active loan terms for dropdowns
// @access  Public
router.get('/loan-terms', getPublicLoanTerms);

// @route   GET /api/public/testimonials
// @desc    Get all testimonials for the public landing page
// @access  Public
router.get('/testimonials', getPublicTestimonials);

// @route   GET /api/public/partners
// @desc    Get all active partners for public view
// @access  Public
router.get('/partners', getPublicPartners);

// @route   GET /api/public/products
// @desc    Get all products for public shop pages (only shows items with stock > 0)
// @access  Public
router.get('/products', getProducts);

module.exports = router;