const { Router } = require('express');
const { getLoans } = require('../controllers/loan.controller');

const router = Router();

router.get('/loans', getLoans);

module.exports = router;