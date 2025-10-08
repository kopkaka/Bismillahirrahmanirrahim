const express = require('express');
const router = express.Router();
const multer = require('multer');
const excelUpload = multer({ storage: multer.memoryStorage() }); // Define multer for Excel in-memory processing
const upload = require('../middleware/upload.middleware');
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware'); // Now checks permissions

const membersController = require('../controllers/members.controller');
const userController = require('../controllers/user.controller');
const adminController = require('../controllers/admin.controller');
const savingController = require('../controllers/saving.controller');
const loanController = require('../controllers/loan.controller');
const accounttypeController = require('../controllers/accounttype.controller'); // Import accounttypeController
const journalController = require('../controllers/journal.controller.js');

const { getApprovalCounts } = require('../controllers/approval.controller');
// --- Sub-routers for specific admin resources ---
const announcementRoutes = require('./announcement.routes.js');
const employerRoutes = require('./employer.routes.js');
const partnerRoutes = require('./partner.routes.js');
const positionRoutes = require('./position.routes.js');
const savingTypeRoutes = require('./savingtype.routes.js');
const loanTypeRoutes = require('./loantype.routes.js');
const loanTermRoutes = require('./loanterms.routes.js');
const accountRoutes = require('./account.routes.js');
const supplierRoutes = require('./supplier.routes.js');

// Dashboard
router.get('/stats', protect, authorize(['viewDashboard']), adminController.getDashboardStats);
router.get('/cashflow-summary', protect, authorize(['viewDashboard']), adminController.getCashFlowSummary);
router.get('/member-growth', protect, authorize(['viewDashboard']), adminController.getMemberGrowth);
router.get('/balance-sheet-summary', protect, authorize(['viewDashboard']), adminController.getBalanceSheetSummary);
router.get('/income-statement-summary', protect, authorize(['viewDashboard']), adminController.getIncomeStatementSummary);

// Explicit GET routes for dropdowns and tables to resolve 404s
// These use functions exported from adminController or specific controllers.
router.get('/loantypes', protect, authorize(['viewSettings']), adminController.getLoanTypes);
router.get('/loanterms', protect, authorize(['viewSettings']), adminController.getLoanTerms);
router.get('/accounts', protect, authorize(['viewSettings']), adminController.getAccounts);
router.get('/employers', protect, authorize(['viewSettings']), adminController.getEmployers);
router.get('/positions', protect, authorize(['viewSettings']), adminController.getPositions);
router.get('/savingtypes', protect, authorize(['viewSettings']), adminController.getSavingTypes);
router.get('/suppliers', protect, authorize(['viewSettings']), adminController.getSuppliers);
router.get('/accounttypes', protect, authorize(['viewSettings']), accounttypeController.getAccountTypes); // Using specific controller

// Approvals
router.get('/pending-loans', protect, authorize(['viewApprovals']), adminController.getPendingLoans);
router.get('/pending-loan-payments', protect, authorize(['approveLoanAccounting']), adminController.getPendingLoanPayments);
router.get('/approval-counts', protect, authorize(['viewApprovals']), getApprovalCounts);
// This route can be accessed by accounting (for first approval) or manager (for final approval)
router.put('/loans/:id/status', protect, authorize(['approveLoanAccounting', 'approveLoanManager']), adminController.updateLoanStatus);

// Savings Management
router.get('/savings', protect, authorize(['viewSavings']), savingController.getSavings);
router.get('/savings/member/:memberId', protect, authorize(['viewSavings']), savingController.getSavingsByMember);
router.post('/savings', protect, authorize(['approveSaving']), savingController.createSaving);
router.put('/savings/:id/status', protect, authorize(['approveSaving']), savingController.updateSavingStatus);
router.put('/savings/:id', protect, authorize(['deleteData']), savingController.updateSaving);
router.delete('/savings/:id', protect, authorize(['deleteData']), savingController.deleteSaving);

// Manual Saving Input
router.post('/savings/manual', protect, authorize(['approveSaving']), adminController.createManualSaving);


// Loan Management (for admin)
router.get('/loans', protect, authorize(['viewLoans']), loanController.getLoans);
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
router.post('/sales', protect, authorize(productManagementPermission), adminController.createSale);
// Rute baru untuk checkout dari toko anggota (keranjang.js)
router.post('/member/sales', protect, adminController.createSale);
router.get('/sales/:orderId/items', protect, authorize(['viewUsahaKoperasi']), adminController.getSaleItemsByOrderId);
router.post('/sales/:id/cancel', protect, authorize(['admin', 'akunting']), adminController.cancelSale);
// Rute baru untuk halaman checkout.html
router.get('/public/sales/:orderId', adminController.getSaleDetailsByOrderId);
// Rute baru untuk verifikasi pesanan oleh kasir
router.get('/sales/order/:orderId', protect, authorize(['viewUsahaKoperasi']), adminController.getSaleDetailsByOrderId);
router.post('/sales/complete', protect, authorize(['viewUsahaKoperasi']), adminController.completeOrder);


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

// --- Payment Method Management ---
// CRUD for payment method types
router.get('/payment-methods', protect, authorize(['viewSettings']), adminController.getPaymentMethods);
router.post('/payment-methods', protect, authorize(['viewSettings']), adminController.createPaymentMethod);
router.put('/payment-methods/:id', protect, authorize(['viewSettings']), adminController.updatePaymentMethod);
router.delete('/payment-methods/:id', protect, authorize(['viewSettings']), adminController.deletePaymentMethod);
// Route specific for account mapping
router.put('/map-payment-method-account/:id', protect, authorize(['viewSettings']), adminController.mapPaymentMethodAccount);

// Rute baru untuk anggota (hanya perlu login)
router.get('/member/payment-methods', protect, adminController.getPaymentMethods);
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
router.get('/reports/cashier', protect, authorize(['viewUsahaKoperasi', 'viewReports']), adminController.getCashierReport);

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
router.use('/suppliers', supplierRoutes);

// Bulk Savings Management
router.get('/savings/export-template', protect, authorize(['approveSaving']), savingController.exportSavingsTemplate);
router.post('/savings/bulk-upload', protect, authorize(['approveSaving']), excelUpload.single('savingsFile'), savingController.uploadBulkSavings);

// --- Sub-routers (MUST be at the end) ---
// These handle specific CRUD operations for settings pages
router.use('/announcements', announcementRoutes);
router.use('/employers', employerRoutes);
router.use('/partners', partnerRoutes);
router.use('/positions', positionRoutes);
router.use('/savingtypes', savingTypeRoutes);
router.use('/loantypes', loanTypeRoutes);
router.use('/loanterms', loanTermRoutes);
router.use('/accounts', accountRoutes);

// FIX: Add routes for master products
router.get('/master-products', protect, authorize(['viewSettings']), adminController.getMasterProducts);
router.post('/master-products', protect, authorize(['viewSettings']), adminController.createMasterProduct);
router.put('/master-products/:id', protect, authorize(['viewSettings']), adminController.updateMasterProduct);
router.delete('/master-products/:id', protect, authorize(['viewSettings']), adminController.deleteMasterProduct);

module.exports = router;