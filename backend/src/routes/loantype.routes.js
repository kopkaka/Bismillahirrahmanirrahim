const express = require('express');
const router = express.Router();
const {
    getLoanTypes,
    createLoanType,
    updateLoanType,
    deleteLoanType
} = require('../controllers/loantype.controller');

router.get('/loantypes', getLoanTypes);
router.post('/loantypes', createLoanType);
router.put('/loantypes/:id', updateLoanType);
router.delete('/loantypes/:id', deleteLoanType);

module.exports = router;