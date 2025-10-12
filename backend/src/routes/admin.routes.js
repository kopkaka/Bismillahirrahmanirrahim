const express = require('express');
const router = express.Router();
const multer = require('multer');
const excelUpload = multer({ storage: multer.memoryStorage() }); // Define multer for Excel in-memory processing
const upload = require('../middleware/upload.middleware');
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware'); // Now checks permissions

// --- Import Controllers ---
const membersController = require('../controllers/members.controller');
const adminController = require('../controllers/admin.controller');
const loanController = require('../controllers/loan.controller');
const dashboardController = require('../controllers/dashboard.controller');
const savingController = require('../controllers/saving.controller');
const accountingController = require('../controllers/accounting.controller');
const logisticsController = require('../controllers/logistics.controller');
const shuController = require('../controllers/shu.controller');
const testimonialController = require('../controllers/testimonial.controller');
const savingTypeController = require('../controllers/savingtype.controller');

const journalController = require('../controllers/journal.controller.js');
const reportController = require('../controllers/report.controller.js');
const reportRoutes = require('./report.routes.js'); // Impor rute laporan yang baru

const { getApprovalCounts } = require('../controllers/approval.controller');
// --- Sub-routers for specific admin resources ---
const announcementRoutes = require('./announcement.routes.js');
const companyRoutes = require('./company.routes.js');
const partnerRoutes = require('./partner.routes');
const positionRoutes = require('./position.routes.js');
const savingTypeRoutes = require('./savingtype.routes.js');
const loanTypeRoutes = require('./loantype.routes.js');
const loanTermRoutes = require('./loanterms.routes.js');
const userRoutes = require('./user.routes.js');
const accountRoutes = require('./account.routes.js');
const productRoutes = require('./product.routes.js'); // Impor rute produk yang baru
const supplierRoutes = require('./supplier.routes.js');

// Dashboard
router.get('/stats', protect, authorize(['viewDashboard']), dashboardController.getDashboardStats);
router.get('/cashflow-summary', protect, authorize(['viewDashboard']), dashboardController.getCashFlowSummary);
router.get('/member-growth', protect, authorize(['viewDashboard']), dashboardController.getMemberGrowth);
router.get('/balance-sheet-summary', protect, authorize(['viewDashboard']), dashboardController.getBalanceSheetSummary);
router.get('/income-statement-summary', protect, authorize(['viewDashboard']), dashboardController.getIncomeStatementSummary);

// Approvals
router.get('/pending-loans', protect, authorize(['viewApprovals']), loanController.getPendingLoans);
router.get('/pending-loan-payments', protect, authorize(['approveLoanAccounting']), loanController.getPendingLoanPayments);
router.get('/approval-counts', protect, authorize(['viewApprovals']), getApprovalCounts);
// This route can be accessed by accounting (for first approval) or manager (for final approval)
router.put('/loans/:id/status', protect, authorize(['approveLoanAccounting', 'approveLoanManager']), loanController.updateLoanStatus);

// Savings Management
router.get('/savings', protect, authorize(['viewSavings']), savingController.getSavings);
router.post('/savings', protect, authorize(['approveSaving']), savingController.createSaving);
router.put('/savings/:id/status', protect, authorize(['approveSaving']), savingController.updateSavingStatus);
router.put('/savings/:id', protect, authorize(['manageSavings']), savingController.updateSaving);
router.delete('/savings/:id', protect, authorize(['manageSavings']), savingController.deleteSaving);

// Loan Management (for admin)
router.get('/loans', protect, authorize(['viewLoans']), loanController.getLoans);
router.get('/loans/:id/details', protect, authorize(['viewLoans']), loanController.getLoanDetailsForAdmin);
router.post('/loans/payment', protect, authorize(['manageLoanPayments']), loanController.recordLoanPayment);
router.put('/loan-payments/:id/status', protect, authorize(['approveLoanAccounting']), loanController.updateLoanPaymentStatus);
router.delete('/loan-payments/:id', protect, authorize(['manageLoanPayments']), loanController.cancelLoanPayment);
router.post('/loans/:id/commitment', protect, authorize(['approveLoanAccounting']), upload.single('signature'), loanController.saveLoanCommitment);
router.get('/members/:id/loans', protect, authorize(['viewLoans']), loanController.getMemberLoanHistory);

// Member Management (for Admin views like Approvals, Member List)
router.get('/members', protect, authorize(['viewMembers', 'viewApprovals']), membersController.getAllMembers);
router.get('/members/:id', protect, authorize(['viewMembers', 'viewApprovals']), membersController.getMemberById);
router.put('/members/:id/status', protect, authorize(['approveMember']), membersController.updateMemberStatus);
router.put('/members/:id',
    protect,
    authorize(['admin']),
    upload.fields([
        { name: 'ktp_photo', maxCount: 1 },
        { name: 'selfie_photo', maxCount: 1 },
        { name: 'kk_photo', maxCount: 1 }
    ]),
    membersController.updateMemberByAdmin
);

// Role & Permission Management
router.get('/permissions', protect, authorize(['viewSettings']), adminController.getAllPermissions);
router.get('/roles/:roleName/permissions', protect, authorize(['viewSettings']), adminController.getRolePermissions);
router.put('/roles/:roleName/permissions', protect, authorize(['viewSettings']), adminController.updateRolePermissions);

// Rute baru untuk mengambil permintaan pengunduran diri
router.get('/pending-resignations', protect, authorize(['admin']), adminController.getPendingResignations);
router.post('/process-resignation', protect, authorize(['admin']), adminController.processResignation);

// Logistics Card View
// Menggunakan permission 'approveLoanAccounting' karena fitur ini adalah bagian dari akunting
// dan permission ini sudah dimiliki oleh role 'admin' dan 'akunting'.
router.get('/logistics-view', protect, authorize(['approveLoanAccounting']), logisticsController.getLogisticsEntries);

// Logistics Card CRUD
const logisticsPermission = ['approveLoanAccounting']; // Reuse permission
router.post('/logistics_entries', protect, authorize(logisticsPermission), logisticsController.createLogisticsEntry);
router.get('/logistics-by-ref/:ref', protect, authorize(logisticsPermission), logisticsController.getLogisticsByReference);
router.put('/logistics-by-ref/:ref', protect, authorize(logisticsPermission), logisticsController.updateLogisticsByReference);
router.delete('/logistics-by-ref/:ref', protect, authorize(logisticsPermission), logisticsController.deleteLogisticsByReference);
// Hapus rute lama untuk delete per item, karena sekarang kita kelola per referensi
// router.delete('/logistics_entries/:id', authMiddleware, authorize(logisticsPermission), deleteItem('logistics_entries'));

// Company Profile Management
// Endpoint ini dibuat lebih permisif agar semua role staf (admin, akunting, manager) bisa memuat info header.
// Otorisasi spesifik (viewSettings) hanya diperlukan untuk mengubah data (PUT).
router.get('/company-info', protect, adminController.getCompanyInfo); // Menggunakan adminController yang sudah di-refactor
router.put('/company-info', protect, authorize(['manageCooperativeProfile']), upload.single('logo'), adminController.updateCompanyInfo); // Izin sudah benar untuk admin

// Testimonial Management
const testimonialPermission = ['manageTestimonials']; // Izin untuk testimoni
router.get('/testimonials', protect, authorize(testimonialPermission), testimonialController.getTestimonials);
router.get('/testimonials/:id', protect, authorize(testimonialPermission), testimonialController.getTestimonialById);
router.post('/testimonials', protect, authorize(testimonialPermission), upload.single('testimonialPhoto'), testimonialController.createTestimonial);
router.put('/testimonials/:id', protect, authorize(testimonialPermission), upload.single('testimonialPhoto'), testimonialController.updateTestimonial);
router.delete('/testimonials/:id', protect, authorize(testimonialPermission), testimonialController.deleteTestimonial);

// Account Mapping
router.put('/map-saving-account/:id', protect, authorize(['viewSettings']), savingTypeController.mapSavingAccount);
router.put('/map-loan-account/:id', protect, authorize(['viewSettings']), loanController.mapLoanAccount);

// Route specific for account mapping
router.put('/map-payment-method-account/:id', protect, authorize(['viewSettings']), adminController.mapPaymentMethodAccount);

// This route is for the member-facing side, but the controller logic is general, so it can stay in adminController.
router.get('/member/payment-methods', protect, adminController.getPaymentMethods);
// Goods Receipt & Accounts Payable
const accountingPermission = ['viewAccounting'];
router.get('/logistics/receivable', protect, authorize(accountingPermission), accountingController.getReceivableLogistics);
router.post('/logistics/receive', protect, authorize(accountingPermission), accountingController.receiveLogisticsItems);
router.get('/payables', protect, authorize(accountingPermission), accountingController.getPayables);
router.get('/payables/:id', protect, authorize(accountingPermission), accountingController.getPayableDetails);
router.post('/payables/payment', protect, authorize(accountingPermission), accountingController.recordPayablePayment);
router.get('/stock-card', protect, authorize(accountingPermission), accountingController.getStockCardHistory);
// Reports
router.use('/reports', reportRoutes); // Gunakan sub-router untuk semua rute laporan

// SHU Rules Management
router.get('/shu-rules/:year', protect, authorize(['manageShuRules', 'postSHU']), shuController.getShuRules);
router.post('/shu-rules', protect, authorize(['manageShuRules']), shuController.saveShuRules);

// SHU Posting
router.post('/shu/calculate-preview', protect, authorize(['postSHU']), shuController.calculateShuPreview);
router.post('/shu/post-distribution', protect, authorize(['postSHU']), shuController.postDistribution);

// Monthly Closing Process
router.get('/accounting/closings', protect, authorize(['processClosing']), accountingController.getMonthlyClosings);
router.post('/accounting/close-month', protect, authorize(['processClosing']), accountingController.processMonthlyClosing);
router.post('/accounting/reopen-month', protect, authorize(['processClosing']), accountingController.reopenMonthlyClosing);

// General Journal Management
router.get('/journals', protect, authorize(accountingPermission), journalController.getJournals);
router.post('/journals', protect, authorize(accountingPermission), journalController.createJournal);
router.get('/journals/:id', protect, authorize(accountingPermission), journalController.getJournalById);
router.put('/journals/:id', protect, authorize(accountingPermission), journalController.updateJournal);
router.delete('/journals/:id', protect, authorize(accountingPermission), journalController.deleteJournal);

// Rute baru untuk jurnal, hanya mengembalikan akun yang bukan akun induk.
router.get('/journal-accounts', protect, authorize(['viewAccounting']), require('../controllers/account.controller').getJournalableAccounts);

// Suppliers
router.use('/suppliers', supplierRoutes);

// Bulk Savings Management
// FIX: Moved from saving.routes.js to here as it's an admin-only feature.
router.get('/savings/export-template', protect, authorize(['approveSaving']), savingController.exportSavingsTemplate);
router.post('/savings/bulk-upload', protect, authorize(['approveSaving']), excelUpload.single('savingsFile'), savingController.uploadBulkSavings);
// Manual Saving Input
router.post('/savings/manual', protect, authorize(['approveSaving']), adminController.createManualSaving);

// --- Sub-routers (MUST be at the end) ---
// These handle specific CRUD operations for settings pages
// FIX: Gunakan izin yang benar untuk pengumuman
router.use('/announcements', protect, authorize(['manageAnnouncements']), announcementRoutes);
router.use('/companies', protect, authorize(['viewSettings']), companyRoutes);
router.use('/partners', protect, authorize(['viewSettings']), partnerRoutes);
router.use('/positions', positionRoutes);
router.use('/savingtypes', savingTypeRoutes);
router.use('/users', protect, authorize(['manageUsers']), userRoutes);
router.use('/loantypes', loanTypeRoutes);
router.use('/loanterms', loanTermRoutes);
router.use('/accounts', accountRoutes);
// --- Product & Sales Management ---
const productManagementPermission = ['viewDashboard', 'viewUsahaKoperasi']; // Kasir perlu akses ini
router.use('/products', protect, authorize(productManagementPermission), productRoutes);
router.post('/cash-sale', protect, authorize(['viewUsahaKoperasi', 'approveLoanAccounting']), accountingController.createCashSale);
router.get('/logistics-products/:shopType', protect, authorize(productManagementPermission), logisticsController.getAvailableLogisticsProducts);

// --- Payment Method Management ---
const paymentMethodRoutes = require('./paymentmethod.routes.js');
router.use('/payment-methods', protect, authorize(['viewSettings']), paymentMethodRoutes);
// This route is for the member-facing side, but the controller logic is general, so it can stay in adminController.
router.get('/member/payment-methods', protect, adminController.getPaymentMethods);

// Master Products
router.get('/master-products', protect, authorize(['viewSettings']), logisticsController.getMasterProducts);
router.post('/master-products', protect, authorize(['viewSettings']), logisticsController.createMasterProduct);
router.put('/master-products/:id', protect, authorize(['viewSettings']), logisticsController.updateMasterProduct);
router.delete('/master-products/:id', protect, authorize(['viewSettings']), logisticsController.deleteMasterProduct);

module.exports = router;