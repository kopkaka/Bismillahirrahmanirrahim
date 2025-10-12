const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const memberController = require('../controllers/member.controller');
const shuController = require('../controllers/shu.controller');

// Middleware 'protect' akan memastikan semua rute di bawah ini hanya bisa diakses oleh pengguna yang sudah login.
router.use(protect);

// --- Dashboard & Profile ---
router.get('/stats', memberController.getMemberStats);
router.get('/profile', memberController.getMemberProfile);
router.put('/profile/photo', upload.single('selfie_photo'), memberController.updateProfilePhoto);
router.put('/change-password', memberController.changePassword);

// --- Permissions ---
router.get('/permissions', memberController.getMyPermissions);

// --- Savings ---
router.get('/savings', memberController.getMemberSavings);
router.post('/savings', upload.single('proofPhoto'), memberController.createSavingApplication);
router.get('/savings/voluntary-balance', memberController.getVoluntarySavingsBalance);
router.post('/savings/withdrawal', memberController.createWithdrawalApplication);

// --- Mandatory Savings ---
router.post('/mandatory-saving', upload.single('proofPhoto'), memberController.createMandatorySavingApplication);

// --- Loans ---
router.get('/loans', memberController.getMemberLoans);
router.post('/loans', upload.single('commitment_signature'), memberController.createLoanApplication);
router.get('/loans/:id/details', memberController.getLoanDetails);
router.get('/active-loan-for-payment', memberController.getActiveLoanForPayment);
router.post('/loan-payment', upload.single('paymentProof'), memberController.submitLoanPayment);

// --- Applications (Pending Items) ---
router.get('/applications', memberController.getMemberApplications);
router.delete('/applications/:id/cancel', memberController.cancelLoanApplication); // Endpoint untuk membatalkan pinjaman

// --- SHU History ---
router.get('/shu-history', shuController.getMemberShuHistory);

// --- Notifications ---
router.get('/notifications', memberController.getNotifications);
router.get('/notifications/unread-count', memberController.getUnreadNotificationCount);
router.put('/notifications/:id/read', memberController.markNotificationAsRead);

// --- Resignation ---
router.post('/request-resignation', memberController.createResignationRequest);
router.post('/cancel-resignation', memberController.cancelResignationRequest);

// --- Sales History ---
router.get('/sales', memberController.getMemberSalesHistory);
router.get('/sales/:orderId', memberController.getSaleDetailsByOrderIdForMember);


module.exports = router;