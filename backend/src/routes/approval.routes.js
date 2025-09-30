const { Router } = require('express');
const { getApprovalCounts } = require('../controllers/approval.controller');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');

const router = Router();

// Endpoint untuk mengambil semua hitungan persetujuan
// Dapat diakses oleh semua peran staf
router.get('/approvals/counts', authMiddleware, authorize(['admin', 'manager', 'akunting']), getApprovalCounts);

module.exports = router;