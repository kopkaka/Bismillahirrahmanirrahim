const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware'); // Now checks permissions

const membersController = require('../controllers/members.controller');
const userController = require('../controllers/user.controller');
const adminController = require('../controllers/admin.controller');
const journalController = require('../controllers/journal.controller.js');

const { getApprovalCounts } = require('../controllers/approval.controller');
// --- Sub-routers for specific admin resources ---
const announcementRoutes = require('./announcement.routes.js');
const employerRoutes = require('./employer.routes.js');
const partnerRoutes = require('./partner.routes.js');

// Dashboard
router.get('/stats', protect, authorize(['viewDashboard']), adminController.getDashboardStats);
router.get('/cashflow-summary', protect, authorize(['viewDashboard']), adminController.getCashFlowSummary);
router.get('/member-growth', protect, authorize(['viewDashboard']), adminController.getMemberGrowth);
router.get('/balance-sheet-summary', protect, authorize(['viewDashboard']), adminController.getBalanceSheetSummary);
router.get('/income-statement-summary', protect, authorize(['viewDashboard']), adminController.getIncomeStatementSummary);

// Approvals
router.get('/pending-loans', protect, authorize(['viewApprovals']), adminController.getPendingLoans);
router.get('/pending-loan-payments', protect, authorize(['approveLoanAccounting']), adminController.getPendingLoanPayments);
router.get('/approval-counts', protect, authorize(['viewApprovals']), getApprovalCounts);
// This route can be accessed by accounting (for first approval) or manager (for final approval)
router.put('/loans/:id/status', protect, authorize(['approveLoanAccounting', 'approveLoanManager']), adminController.updateLoanStatus);

// Manual Saving Input
router.post('/savings/manual', protect, authorize(['approveSaving']), adminController.createManualSaving);


// Loan Management (for admin)
router.get('/loans/:id/details', protect, authorize(['viewLoans']), adminController.getLoanDetailsForAdmin);
router.post('/loans/payment', protect, authorize(['approveLoanAccounting']), adminController.recordLoanPayment);
router.put('/loan-payments/:id/status', protect, authorize(['approveLoanAccounting']), adminController.updateLoanPaymentStatus);
router.delete('/loan-payments/:id', protect, authorize(['admin']), adminController.cancelLoanPayment); // Rute baru untuk pembatalan
router.post('/loans/:id/commitment', protect, authorize(['approveLoanAccounting']), upload.single('signature'), adminController.saveLoanCommitment);
router.put('/loans/:id', protect, authorize(['manageUsers']), adminController.updateLoan);
router.delete('/loans/:id', protect, authorize(['deleteData']), adminController.deleteLoan);
router.get('/members/:id/loans', protect, authorize(['viewLoans']), adminController.getMemberLoanHistory);
// User Management
router.get('/users', protect, authorize(['manageUsers']), userController.getUsers);
router.post('/users', protect, authorize(['manageUsers']), userController.createUser);
router.put('/users/:id', protect, authorize(['manageUsers']), userController.updateUser);
router.delete('/users/:id', protect, authorize(['manageUsers']), userController.deleteUser);

// Member Management (for Admin views like Approvals, Member List)
router.get('/members', protect, authorize(['viewMembers', 'viewApprovals']), membersController.getAllMembers);
router.get('/members/:id', protect, authorize(['viewMembers', 'viewApprovals']), membersController.getMemberById);
router.put('/members/:id/status', protect, authorize(['admin']), membersController.updateMemberStatus);
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

// Product Management
const productManagementPermission = ['viewDashboard', 'viewUsahaKoperasi']; // Kasir perlu akses ini
router.get('/products', protect, authorize(productManagementPermission), adminController.getProducts);
router.get('/products/:id', protect, authorize(productManagementPermission), adminController.getProductById);
router.post('/sales', protect, authorize(productManagementPermission), adminController.createSale);
router.post('/products', protect, authorize(productManagementPermission), upload.single('productImage'), adminController.createProduct);
router.put('/products/:id', protect, authorize(productManagementPermission), upload.single('productImage'), adminController.updateProduct);
router.delete('/products/:id', protect, authorize(productManagementPermission), adminController.deleteProduct);
router.post('/cash-sale', protect, authorize(['viewUsahaKoperasi', 'approveLoanAccounting']), adminController.createCashSale);
router.get('/logistics-products/:shopType', protect, authorize(productManagementPermission), adminController.getAvailableLogisticsProducts);
// Rute baru untuk mengambil pesanan yang menunggu pengambilan
router.get('/sales/pending', protect, authorize(['viewUsahaKoperasi']), adminController.getPendingSales);
// Rute baru untuk mengambil detail item dari sebuah pesanan
router.get('/sales/:orderId/items', protect, authorize(['viewUsahaKoperasi']), adminController.getSaleItemsByOrderId);
// Rute baru untuk verifikasi pesanan oleh kasir
router.get('/sales/order/:orderId', protect, authorize(['viewUsahaKoperasi']), adminController.getSaleDetailsByOrderId);

// Rute baru untuk mengambil permintaan pengunduran diri
router.get('/pending-resignations', protect, authorize(['admin']), adminController.getPendingResignations);
router.post('/process-resignation', protect, authorize(['admin']), adminController.processResignation);

// Logistics Card View
// Menggunakan permission 'approveLoanAccounting' karena fitur ini adalah bagian dari akunting
// dan permission ini sudah dimiliki oleh role 'admin' dan 'akunting'.
router.get('/logistics-view', protect, authorize(['approveLoanAccounting']), adminController.getLogisticsEntries);

// Logistics Card CRUD
const logisticsPermission = ['approveLoanAccounting']; // Reuse permission
router.post('/logistics_entries', protect, authorize(logisticsPermission), adminController.createLogisticsEntry);
router.get('/logistics-by-ref/:ref', protect, authorize(logisticsPermission), adminController.getLogisticsByReference);
router.put('/logistics-by-ref/:ref', protect, authorize(logisticsPermission), adminController.updateLogisticsByReference);
router.delete('/logistics-by-ref/:ref', protect, authorize(logisticsPermission), adminController.deleteLogisticsByReference);
// Hapus rute lama untuk delete per item, karena sekarang kita kelola per referensi
// router.delete('/logistics_entries/:id', authMiddleware, authorize(logisticsPermission), deleteItem('logistics_entries'));

// Company Profile Management
// Endpoint ini dibuat lebih permisif agar semua role staf (admin, akunting, manager) bisa memuat info header.
// Otorisasi spesifik (viewSettings) hanya diperlukan untuk mengubah data.
router.get('/company-info', protect, adminController.getCompanyInfo);
router.put('/company-info', protect, authorize(['viewSettings']), upload.single('logo'), adminController.updateCompanyInfo);

// Testimonial Management
const testimonialPermission = ['viewSettings'];
router.get('/testimonials', protect, authorize(testimonialPermission), adminController.getTestimonials);
router.get('/testimonials/:id', protect, authorize(testimonialPermission), adminController.getTestimonialById);
router.post('/testimonials', protect, authorize(testimonialPermission), upload.single('testimonialPhoto'), adminController.createTestimonial);
router.put('/testimonials/:id', protect, authorize(testimonialPermission), upload.single('testimonialPhoto'), adminController.updateTestimonial);
router.delete('/testimonials/:id', protect, authorize(testimonialPermission), adminController.deleteTestimonial);

// Account Mapping
router.put('/map-saving-account/:id', protect, authorize(['viewSettings']), adminController.mapSavingAccount);
router.put('/map-loan-account/:id', protect, authorize(['viewSettings']), adminController.mapLoanAccount);

// Goods Receipt & Accounts Payable
const accountingPermission = ['viewAccounting'];
router.get('/logistics/receivable', protect, authorize(accountingPermission), adminController.getReceivableLogistics);
router.post('/logistics/receive', protect, authorize(accountingPermission), adminController.receiveLogisticsItems);
router.get('/payables', protect, authorize(accountingPermission), adminController.getPayables);
router.get('/payables/:id', protect, authorize(accountingPermission), adminController.getPayableDetails);
router.post('/payables/payment', protect, authorize(accountingPermission), adminController.recordPayablePayment);
router.get('/stock-card', protect, authorize(accountingPermission), adminController.getStockCardHistory);
router.get('/all-products', protect, authorize(accountingPermission), adminController.getAllProductsForDropdown);

// Reports
router.get('/reports/income-statement', protect, authorize(['viewReports']), adminController.getIncomeStatement);
router.get('/reports/balance-sheet', protect, authorize(['viewReports']), adminController.getBalanceSheet);
router.get('/reports/general-ledger', protect, authorize(['viewReports']), adminController.getGeneralLedger);
router.get('/reports/cash-flow', protect, authorize(['viewReports']), adminController.getCashFlowStatement);
router.get('/sales-report', protect, authorize(['viewReports']), adminController.getSalesReport);
router.get('/reports/loan-interest', protect, authorize(['viewReports']), adminController.getLoanInterestReport);
router.get('/reports/monthly-closing-status', protect, authorize(['viewReports']), adminController.getMonthlyClosingStatus);
router.get('/reports/cashier', protect, authorize(['viewUsahaKoperasi']), adminController.getCashierReport);

// SHU Rules Management
router.get('/shu-rules/:year', protect, authorize(['viewSettings']), adminController.getShuRules);
router.post('/shu-rules', protect, authorize(['viewSettings']), adminController.saveShuRules);

// SHU Posting
router.post('/shu/calculate-preview', protect, authorize(['postSHU']), adminController.calculateShuPreview);
router.post('/shu/post-distribution', protect, authorize(['postSHU']), adminController.postShuDistribution);

// Monthly Closing Process
router.get('/accounting/closings', protect, authorize(['processClosing']), adminController.getMonthlyClosings);
router.post('/accounting/close-month', protect, authorize(['processClosing']), adminController.processMonthlyClosing);
router.post('/accounting/reopen-month', protect, authorize(['processClosing']), adminController.reopenMonthlyClosing);

// General Journal Management
router.get('/journals', protect, authorize(accountingPermission), journalController.getJournals);
router.post('/journals', protect, authorize(accountingPermission), journalController.createJournal);
router.get('/journals/:id', protect, authorize(accountingPermission), journalController.getJournalById);
router.put('/journals/:id', protect, authorize(accountingPermission), journalController.updateJournal);
router.delete('/journals/:id', protect, authorize(accountingPermission), journalController.deleteJournal);

// Rute baru untuk jurnal, hanya mengembalikan akun yang bukan akun induk.
router.get('/journal-accounts', protect, authorize(['viewAccounting']), adminController.getAccounts);

// Suppliers
router.get('/suppliers', protect, authorize(['viewSettings', 'viewAccounting']), adminController.getSuppliers);
router.get('/employers', protect, authorize(['viewSettings', 'viewMembers']), adminController.getEmployers);
// Note: Supplier creation/update/delete logic is not fully implemented in a dedicated controller yet.
// This part might need a separate controller in the future.

// Master Products CRUD
router.get('/master-products', protect, authorize(['viewSettings']), adminController.getMasterProducts);
router.post('/master-products', protect, authorize(['viewSettings']), adminController.createMasterProduct);
router.put('/master-products/:id', protect, authorize(['viewSettings']), adminController.updateMasterProduct);
router.delete('/master-products/:id', protect, authorize(['deleteData']), adminController.deleteMasterProduct);

// Rute untuk mendapatkan ID tipe pinjaman berdasarkan nama, digunakan di panel admin
router.get('/loantype-id-by-name', protect, authorize(['viewSettings']), adminController.getLoanTypeIdByName);
router.get('/positions', protect, authorize(['viewSettings', 'viewMembers']), adminController.getPositions);
router.get('/savingtypes', protect, authorize(['viewSettings', 'viewSavings']), adminController.getSavingTypes);
router.get('/loantypes', protect, authorize(['viewSettings']), adminController.getLoanTypes);
router.get('/loanterms', protect, authorize(['viewSettings']), adminController.getLoanTerms);
router.get('/accounts', protect, authorize(['viewSettings']), adminController.getAccounts);


module.exports = router;

// --- Sub-routers (MUST be at the end) ---
// These are now mostly handled by the main index.js router
router.use('/announcements', announcementRoutes);
router.use('/employers', employerRoutes);
router.use('/partners', partnerRoutes);