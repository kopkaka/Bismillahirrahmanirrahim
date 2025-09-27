const { Router } = require('express');
const { getCompanyInfo, updateCompanyInfo } = require('../controllers/company.controller');

const router = Router();

router.get('/company', getCompanyInfo);
router.put('/company', updateCompanyInfo);

module.exports = router;