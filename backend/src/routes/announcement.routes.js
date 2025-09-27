const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const {
    getAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
} = require('../controllers/admin.controller'); // Sementara masih memakai admin.controller

const announcementPermission = ['viewSettings']; // Hanya admin yang bisa kelola

router.get('/', authMiddleware, authorize(announcementPermission), getAnnouncements);
router.get('/:id', authMiddleware, authorize(announcementPermission), getAnnouncementById);
router.post('/', authMiddleware, authorize(announcementPermission), createAnnouncement);
router.put('/:id', authMiddleware, authorize(announcementPermission), updateAnnouncement);
router.delete('/:id', authMiddleware, authorize(announcementPermission), deleteAnnouncement);

module.exports = router;