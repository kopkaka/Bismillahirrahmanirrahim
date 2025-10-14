const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const upload = require('../middleware/upload.middleware'); // Keep upload for product creation
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');

// These routes are mounted under /api/admin/products, so the base path is '/'
router.route('/')
    .get(productController.getProducts) // Matches GET /api/admin/products
    .post(upload.single('productImage'), productController.createProduct); // Matches POST /api/admin/products

router.route('/:id')
    .get(productController.getProductById) // Matches GET /api/admin/products/:id
    .put(upload.single('productImage'), productController.updateProduct) // Matches PUT /api/admin/products/:id
    .delete(productController.deleteProduct); // Matches DELETE /api/admin/products/:id

// Rute yang terkait dengan pesanan online (pending sales) telah dihapus karena tidak digunakan lagi.
router.post('/sales/:id/cancel', protect, authorize(['admin', 'akunting']), productController.cancelSale);

// --- RUTE BARU UNTUK VALIDASI ANGGOTA DI KASIR ---
router.get(
    '/validate-member/:cooperativeNumber', 
    protect, 
    authorize(['admin', 'kasir', 'akunting']), 
    productController.validateMemberForCashier
);

module.exports = router;