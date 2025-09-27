const { Router } = require('express');
const { getAccounts, createAccount, updateAccount, deleteAccount } = require('../controllers/account.controller.js');

const router = Router();

router.get('/accounts', getAccounts);
router.post('/accounts', createAccount);
router.put('/accounts/:id', updateAccount);
router.delete('/accounts/:id', deleteAccount);

module.exports = router;