const express = require('express');
const router = express.Router();
const savingController = require('../controllers/saving.controller');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.

router.get('/', savingController.getSavings);
router.get('/member/:memberId', savingController.getSavingsByMember);
router.post('/', savingController.createSaving);
router.put('/:id/status', savingController.updateSavingStatus);
router.put('/:id', savingController.updateSaving);
router.delete('/:id', savingController.deleteSaving);

module.exports = router;