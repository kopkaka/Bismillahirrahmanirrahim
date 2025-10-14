const express = require('express');
const router = express.Router();
const {
    getAccountTypes,
    createAccountType,
    updateAccountType,
    deleteAccountType
} = require('../controllers/accounttype.controller');

router.route('/').get(getAccountTypes).post(createAccountType);
router.route('/:id').put(updateAccountType).delete(deleteAccountType);

module.exports = router;