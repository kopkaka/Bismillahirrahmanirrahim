const express = require('express');
const router = express.Router();
const {
    getSavingTypes,
    createSavingType,
    updateSavingType,
    deleteSavingType
} = require('../controllers/savingtype.controller');

router.get('/savingtypes', getSavingTypes);
router.post('/savingtypes', createSavingType);
router.put('/savingtypes/:id', updateSavingType);
router.delete('/savingtypes/:id', deleteSavingType);

module.exports = router;