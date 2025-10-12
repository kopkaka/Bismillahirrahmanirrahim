const express = require('express');
const router = express.Router();
// Middleware tidak perlu diimpor lagi di sini karena sudah diterapkan di admin.routes.js
// FIX: Import dari controller yang benar
const {
    getAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
} = require('../controllers/announcement.controller');

// Middleware (protect, authorize) sudah diterapkan di admin.routes.js sebelum router ini digunakan.
router.get('/', getAnnouncements);
router.get('/:id', getAnnouncementById);
router.post('/', createAnnouncement);
router.put('/:id', updateAnnouncement);
router.delete('/:id', deleteAnnouncement);

module.exports = router;