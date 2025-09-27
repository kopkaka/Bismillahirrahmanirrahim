const { Router } = require('express');
const { getDashboardStats } = require('../controllers/dashboard.controller');

const router = Router();

router.get('/dashboard/stats', getDashboardStats);

module.exports = router;