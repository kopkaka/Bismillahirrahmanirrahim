const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const adminController = require('../controllers/admin.controller');
const upload = require('../middleware/upload.middleware');

// Permissions
const viewPermission = ['viewSettings', 'viewMembers'];
const managePermission = ['viewSettings'];
const deletePermission = ['deleteData'];

// Routes
router.get('/', authMiddleware, authorize(viewPermission), adminController.getEmployers);
router.get('/:id', authMiddleware, authorize(viewPermission), adminController.getItemById('companies'));
router.post('/', authMiddleware, authorize(managePermission), upload.single('document'), adminController.createItem('companies', ['name', 'address', 'phone', 'contract_number']));
router.put('/:id', authMiddleware, authorize(managePermission), upload.single('document'), adminController.updateItem('companies', ['name', 'address', 'phone', 'contract_number']));
router.delete('/:id', authMiddleware, authorize(deletePermission), adminController.deleteItem('companies'));

module.exports = router;