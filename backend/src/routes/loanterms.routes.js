const express = require('express');
const router = express.Router();
const {
    getLoanTerms,
    createLoanTerm,
    updateLoanTerm,
    deleteLoanTerm
} = require('../controllers/loanterms.controller');

router.get('/', getLoanTerms);
router.post('/', createLoanTerm);
router.put('/:id', updateLoanTerm);
router.delete('/:id', deleteLoanTerm);

module.exports = router;