const { Router } = require('express');
const { getSuppliers, getSupplierById, createSupplier } = require('../controllers/supplier.controller.js');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');

const router = Router();

// Rute ini diperlukan untuk mengambil data di halaman "Kelola Supplier" (Admin)
// dan untuk mengisi dropdown di modal "Kartu Logistik" (Akunting).
const allowedRoles = ['admin', 'akunting'];

router.get('/', authMiddleware, authorize(allowedRoles), getSuppliers);
router.get('/:id', authMiddleware, authorize(allowedRoles), getSupplierById);

// Tambahkan baris ini untuk menangani permintaan POST
router.post('/', authMiddleware, authorize(['admin']), createSupplier);

module.exports = router;