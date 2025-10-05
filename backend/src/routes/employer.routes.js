const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const {
    getEmployers,
    getEmployerById,
    createEmployer,
    updateEmployer,
    deleteEmployer
} = require('../controllers/employer.controller');

// Permissions
const viewPermission = ['viewSettings', 'viewMembers', 'viewUsahaKoperasi'];
const managePermission = ['viewSettings'];
const deletePermission = ['deleteData'];

// Routes
router.get('/', authMiddleware, authorize(viewPermission), getEmployers);
router.get('/:id', authMiddleware, authorize(viewPermission), getEmployerById);
router.post('/', authMiddleware, authorize(managePermission), createEmployer);
router.put('/:id', authMiddleware, authorize(managePermission), updateEmployer);
router.delete('/:id', authMiddleware, authorize(deletePermission), deleteEmployer);

module.exports = router;