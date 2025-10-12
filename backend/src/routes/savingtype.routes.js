const express = require('express');
const router = express.Router();
const {
    getSavingTypes,
    createSavingType,
    updateSavingType,
    deleteSavingType
} = require('../controllers/savingtype.controller');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.

router.get('/', getSavingTypes);
router.post('/', createSavingType);
router.put('/:id', updateSavingType);
router.delete('/:id', deleteSavingType);

module.exports = router;