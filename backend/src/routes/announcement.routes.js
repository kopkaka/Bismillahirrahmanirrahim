const express = require('express');
const router = express.Router();
const {
    getAllAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
} = require('../controllers/announcement.controller'); // FIX: Import directly from the correct controller

// Middleware `protect` dan `authorize` sudah diterapkan di `admin.routes.js`
// untuk semua rute di dalam file ini.

// Rute untuk admin mengelola SEMUA pengumuman (termasuk draft)
router.route('/all').get(getAllAnnouncements);

// Rute untuk membuat pengumuman baru
router.route('/').post(createAnnouncement);

router.route('/:id')
    .put(updateAnnouncement)
    .delete(deleteAnnouncement);

module.exports = router;