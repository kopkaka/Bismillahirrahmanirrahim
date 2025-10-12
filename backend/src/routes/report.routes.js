const express = require('express');
const router = express.Router();

// Middleware
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');

// Controllers
const reportController = require('../controllers/report.controller');
const journalController = require('../controllers/journal.controller');
const loanController = require('../controllers/loan.controller');
const accountingController = require('../controllers/accounting.controller');

// --- Report Routes ---
// Izin 'viewReports' akan diterapkan pada semua rute di bawah ini
router.use(protect, authorize(['viewReports']));

router.get('/income-statement', reportController.getIncomeStatement);
router.get('/balance-sheet', reportController.getBalanceSheet);
router.get('/general-ledger', reportController.getGeneralLedger); // This is now correct
router.get('/cash-flow', reportController.getCashFlowStatement);
router.get('/sales-report', reportController.getSalesReport); // Renamed for clarity
router.get('/loan-interest', loanController.getLoanInterestReport);
router.get('/monthly-closing-status', reportController.getMonthlyClosingStatus);

module.exports = router;