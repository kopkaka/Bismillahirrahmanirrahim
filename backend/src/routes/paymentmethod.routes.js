const express = require('express');
const router = express.Router();
const {
    getPaymentMethods,
    createPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod
} = require('../controllers/paymentmethod.controller');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.

router.get('/', getPaymentMethods);
router.post('/', createPaymentMethod);
router.put('/:id', updatePaymentMethod);
router.delete('/:id', deletePaymentMethod);

module.exports = router;