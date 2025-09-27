const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
    getSavings,
    getSavingsByMember,
    createSaving,
    updateSavingStatus,
    updateSaving,
    deleteSaving,
    uploadBulkSavings,
    exportSavingsTemplate
} = require('../controllers/saving.controller');

// Memperbaiki path dan nama middleware agar konsisten dengan file rute lain (misal: members.routes.js)
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');

// Rute-rute di bawah ini sekarang dilindungi dan diasumsikan di-mount di bawah /api/admin/savings
router.get('/', authMiddleware, authorize(['admin', 'akunting', 'manager']), getSavings);
router.get('/member/:memberId', authMiddleware, authorize(['admin', 'akunting', 'manager']), getSavingsByMember);
router.post('/', authMiddleware, authorize(['admin', 'akunting']), createSaving);

router.put('/:id/status', authMiddleware, authorize(['admin', 'akunting']), updateSavingStatus);
router.put('/:id', authMiddleware, authorize(['admin']), updateSaving);
router.delete('/:id', authMiddleware, authorize(['admin']), deleteSaving);

// Rute untuk Bulk Savings Management (dipindahkan dari admin.routes.js)
const excelUpload = multer({ storage: multer.memoryStorage() });
router.get('/export-template', authMiddleware, authorize(['approveSaving']), exportSavingsTemplate);
router.post('/bulk-upload', authMiddleware, authorize(['approveSaving']), excelUpload.single('savingsFile'), uploadBulkSavings);


module.exports = router;