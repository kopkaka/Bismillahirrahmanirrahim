const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const productController = require('../controllers/product.controller');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.
// Base path: /api/admin/products

// --- Product Management ---
router.route('/')
    .get(productController.getProducts)
    .post(upload.single('productImage'), productController.createProduct);

router.route('/:id')
    .get(productController.getProductById)
    .put(upload.single('productImage'), productController.updateProduct)
    .delete(productController.deleteProduct);

// --- Sales & Order Management ---
// Rute untuk mengambil pesanan yang menunggu pengambilan
router.get('/sales/pending', productController.getPendingSales);
// Rute untuk verifikasi pesanan oleh kasir
router.get('/sales/order/:orderId', productController.getSaleDetailsByOrderId);
// Rute untuk menyelesaikan pesanan
router.post('/sales/:orderId/complete', productController.completeOrder);
router.get('/sales/:orderId/items', productController.getSaleItemsByOrderId);

module.exports = router;