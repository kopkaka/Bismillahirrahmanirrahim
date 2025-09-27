const express = require('express');
const router = express.Router();
const {
    getLoanTerms,
    createLoanTerm,
    updateLoanTerm,
    deleteLoanTerm
} = require('../controllers/loanterms.controller');

router.get('/loanterms', getLoanTerms);
router.post('/loanterms', createLoanTerm);
router.put('/loanterms/:id', updateLoanTerm);
router.delete('/loanterms/:id', deleteLoanTerm);

module.exports = router;