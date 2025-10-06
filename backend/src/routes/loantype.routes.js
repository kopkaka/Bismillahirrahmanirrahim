const express = require('express');
const router = express.Router();
const {
    getLoanTypes,
    createLoanType,
    updateLoanType,
    deleteLoanType
} = require('../controllers/loantype.controller');

router.get('/', getLoanTypes);
router.post('/', createLoanType);
router.put('/:id', updateLoanType);
router.delete('/:id', deleteLoanType);

module.exports = router;