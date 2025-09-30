const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth.middleware'); // FIX: Import the middleware directly
const authorize = require('../middleware/role.middleware');
const {
    getMemberStats,
    getMemberProfile,
    getMemberSavings,
    getMemberLoans,
    getMemberApplications,
    createLoanApplication,
    createSavingApplication,
    getLoanDetails,
    getMemberShuHistory,
    getNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
    createResignationRequest,
    cancelResignationRequest,
    getMyPermissions,
    changePassword,
    updateProfilePhoto,
    getSavingsChartData,
    getLoansChartData,
    getTransactionsChartData,
    getShuChartData,
    getAnnouncements,
    getMemberSalesHistory,
    getSaleDetailsByOrderIdForMember,
    getVoluntarySavingsBalance,
    createWithdrawalApplication,
    getActiveLoanForPayment,
    submitLoanPayment,
} = require('../controllers/member.controller');
const upload = require('../middleware/upload.middleware');

// All routes in this file are protected and start with /api/member

// Dashboard & Profile
router.get('/stats', protect, authorize(['viewDashboard']), getMemberStats);
router.get('/profile', protect, getMemberProfile);
router.put('/profile/photo', protect, upload.single('selfie_photo'), updateProfilePhoto);
router.put('/change-password', protect, changePassword);

// Savings
router.get('/savings', protect, authorize(['viewDashboard']), getMemberSavings);
router.post('/savings', protect, authorize(['viewDashboard']), upload.single('proof'), createSavingApplication);
router.get('/savings/voluntary-balance', protect, authorize(['viewDashboard']), getVoluntarySavingsBalance);
router.post('/savings/withdrawal', protect, authorize(['viewDashboard']), createWithdrawalApplication);

// Loans
router.get('/loans', protect, authorize(['viewDashboard']), getMemberLoans);
router.post('/loans', protect, authorize(['viewDashboard']), upload.single('commitment_signature'), createLoanApplication);
router.get('/loans/:id/details', protect, authorize(['viewDashboard']), getLoanDetails);
router.get('/active-loan-for-payment', protect, authorize(['viewDashboard']), getActiveLoanForPayment);
router.post('/loan-payment', protect, authorize(['viewDashboard']), upload.single('proof'), submitLoanPayment);

// Other Features
router.get('/applications', protect, authorize(['viewDashboard']), getMemberApplications);
router.get('/shu-history', protect, authorize(['viewDashboard']), getMemberShuHistory);
router.get('/sales', protect, authorize(['viewDashboard']), getMemberSalesHistory);
router.get('/sales/:orderId', protect, authorize(['viewDashboard']), getSaleDetailsByOrderIdForMember);

// Notifications
router.get('/notifications', protect, getNotifications);
router.get('/notifications/unread-count', protect, getUnreadNotificationCount);
router.put('/notifications/:id/read', protect, markNotificationAsRead);

// Resignation
router.post('/request-resignation', protect, authorize(['viewDashboard']), createResignationRequest);
router.post('/cancel-resignation', protect, authorize(['viewDashboard']), cancelResignationRequest);

// Permissions & Announcements
router.get('/permissions', protect, getMyPermissions);
router.get('/announcements', protect, getAnnouncements);

// Chart Data
router.get('/chart-data/savings', protect, getSavingsChartData);
router.get('/chart-data/loans', protect, getLoansChartData);
router.get('/chart-data/transactions', protect, getTransactionsChartData);
router.get('/chart-data/shu', protect, getShuChartData);

module.exports = router;