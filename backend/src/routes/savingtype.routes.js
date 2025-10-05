const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const {
    getSavingTypes,
    createSavingType,
    updateSavingType,
    deleteSavingType
} = require('../controllers/savingtype.controller');

const readPermissions = ['viewSettings', 'viewUsahaKoperasi'];
const writePermissions = ['viewSettings'];

router.get('/', authMiddleware, authorize(readPermissions), getSavingTypes);
router.post('/', authMiddleware, authorize(writePermissions), createSavingType);
router.put('/:id', authMiddleware, authorize(writePermissions), updateSavingType);
router.delete('/:id', authMiddleware, authorize(['deleteData']), deleteSavingType);

module.exports = router;