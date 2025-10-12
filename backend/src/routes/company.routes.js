const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller'); // Use the correct controller
const upload = require('../middleware/upload.middleware');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.
// Izin spesifik akan diperiksa di dalam controller jika diperlukan, atau bisa ditambahkan di sini jika ada rute dengan izin berbeda.

// Routes
router.get('/', companyController.getCompanies);
router.get('/:id', companyController.getCompanyById);
router.post('/', upload.single('document'), companyController.createCompany);
router.put('/:id', upload.single('document'), companyController.updateCompany);
router.delete('/:id', companyController.deleteCompany);

module.exports = router;