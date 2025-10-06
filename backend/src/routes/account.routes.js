const { Router } = require('express');
const { getAccounts, createAccount, updateAccount, deleteAccount } = require('../controllers/account.controller.js');

const router = Router();

router.get('/', getAccounts);
router.post('/', createAccount);
router.put('/:id', updateAccount);
router.delete('/:id', deleteAccount);

module.exports = router;