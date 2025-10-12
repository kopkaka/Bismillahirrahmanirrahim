const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.
// Base path: /api/admin/users

router.get('/', userController.getUsers);
router.post('/', userController.createUser); // Endpoint untuk menambah user baru
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;