const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth.middleware'); // Correct: protect is the default export
const authorize = require('../middleware/role.middleware'); // Correct: authorize is the default export
const upload = require('../middleware/upload.middleware'); // Assuming this is correct
const {
    getMemberStats,
    getMemberProfile,
    updateProfilePhoto,
    changePassword,
    getMyPermissions,
    getMemberSavings,
    createSavingApplication,
    getVoluntarySavingsBalance,
    createWithdrawalApplication,
    createMandatorySavingApplication,
    getMemberLoans,
    createLoanApplication,
    getLoanDetails,
    getActiveLoanForPayment,
    submitLoanPayment,
    getMemberApplications,
    cancelLoanApplication,
    getNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
    createResignationRequest,
    cancelResignationRequest,
    getMemberSalesHistory,
    getSaleDetailsByOrderIdForMember,
    cancelSaleOrder,
    getMemberCashFlowSummary,
    getMemberBalanceSheetSummary,
    getMemberIncomeStatementSummary,
    getSavingsChartData,
    getLoansChartData,
    getTransactionsChartData,
    getShuChartData,
    getAnnouncements, // Impor fungsi untuk pengumuman
} = require('../controllers/member.controller');
const { getMemberShuHistory } = require('../controllers/shu.controller');

// FIX: Apply only 'protect' middleware globally for this router.
// This ensures the user is logged in, but doesn't restrict access to ONLY members.
// This allows an admin to view their own member page. Authorization for specific actions is handled in controllers.
router.use(protect);

// --- Dashboard & Profile ---
router.get('/stats', getMemberStats);
router.get('/profile', getMemberProfile);
router.put('/profile/photo', upload.single('selfie_photo'), updateProfilePhoto);
router.put('/change-password', changePassword);

// --- Permissions ---
router.get('/permissions', getMyPermissions);

// --- Savings ---
router.get('/savings', getMemberSavings);
router.post('/savings', upload.single('proof_photo'), createSavingApplication);
router.get('/savings/voluntary-balance', getVoluntarySavingsBalance);
router.post('/savings/withdrawal', createWithdrawalApplication);

// --- Mandatory Savings ---
router.post('/mandatory-saving', upload.single('proof_photo'), createMandatorySavingApplication);

// --- Loans ---
router.get('/loans', getMemberLoans);
router.post('/loans', upload.single('commitment_signature'), createLoanApplication);
router.get('/loans/:id/details', getLoanDetails);
router.get('/active-loan-for-payment', getActiveLoanForPayment);
router.post('/loan-payment', upload.single('payment_proof'), submitLoanPayment);

// --- Applications (Pending Items) ---
router.get('/applications', getMemberApplications);
router.post('/loans/:id/cancel', cancelLoanApplication);

// --- SHU History ---
router.get('/shu-history', getMemberShuHistory);

// --- Notifications ---
router.get('/notifications', getNotifications);
router.get('/notifications/unread-count', getUnreadNotificationCount);
router.put('/notifications/:id/read', markNotificationAsRead);

// --- Resignation ---
router.post('/request-resignation', createResignationRequest);
router.post('/cancel-resignation', cancelResignationRequest);

// --- Sales History ---
router.get('/sales', getMemberSalesHistory);
router.get('/sales/:orderId', getSaleDetailsByOrderIdForMember);
router.post('/sales/:orderId/cancel', cancelSaleOrder);

// --- Chart Data ---
router.get('/chart-data/savings', getSavingsChartData);
router.get('/chart-data/loans', getLoansChartData);
router.get('/chart-data/transactions', getTransactionsChartData);
router.get('/chart-data/shu', getShuChartData);

// --- Dashboard Financial Reports ---
router.get('/dashboard/cashflow-summary', getMemberCashFlowSummary);
router.get('/dashboard/balance-sheet-summary', getMemberBalanceSheetSummary);
router.get('/dashboard/income-statement-summary', getMemberIncomeStatementSummary);

// --- Announcements (for member dashboard) ---
router.get('/announcements', getAnnouncements);


module.exports = router;