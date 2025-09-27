const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const { getJournals, createJournal, getJournalById, updateJournal, deleteJournal } = require('../controllers/journal.controller.js');

const accountingPermission = ['admin', 'akunting'];

router.get('/journals', authMiddleware, authorize(accountingPermission), getJournals);
router.post('/journals', authMiddleware, authorize(accountingPermission), createJournal);
router.get('/journals/:id', authMiddleware, authorize(accountingPermission), getJournalById);
router.put('/journals/:id', authMiddleware, authorize(accountingPermission), updateJournal);
router.delete('/journals/:id', authMiddleware, authorize(accountingPermission), deleteJournal);

module.exports = router;