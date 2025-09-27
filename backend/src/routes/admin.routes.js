const express = require('express');
const router = express.Router();
const multer = require('multer');
const excelUpload = multer({ storage: multer.memoryStorage() }); // Define multer for Excel in-memory processing
const upload = require('../middleware/upload.middleware');
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware'); // Now checks permissions

const positionController = require('../controllers/position.controller');
const savingTypeController = require('../controllers/savingtype.controller');
const loanTypeController = require('../controllers/loantype.controller');
const loanTermController = require('../controllers/loanterms.controller');
const accountController = require('../controllers/account.controller'); // Diperbarui untuk menyertakan fungsi ekspor
const membersController = require('../controllers/members.controller');
const userController = require('../controllers/user.controller');
const publicController = require('../controllers/public.controller');
const adminController = require('../controllers/admin.controller');
const savingController = require('../controllers/saving.controller');
const loanController = require('../controllers/loan.controller');
const journalController = require('../controllers/journal.controller.js');

// --- Sub-routers for specific admin resources ---
const announcementRoutes = require('./announcement.routes.js');
const employerRoutes = require('./employer.routes.js');
const partnerRoutes = require('./partner.routes.js');
const supplierRoutes = require('./supplier.routes.js'); // 1. Impor router supplier
const accountTypeController = require('../controllers/accounttype.controller');
const supplierController = require('../controllers/supplier.controller');

// Dashboard
router.get('/stats', protect, authorize(['viewDashboard']), adminController.getDashboardStats);
router.get('/cashflow-summary', protect, authorize(['viewDashboard']), adminController.getCashFlowSummary);
router.get('/member-growth', protect, authorize(['viewDashboard']), adminController.getMemberGrowth);
router.get('/balance-sheet-summary', protect, authorize(['viewDashboard']), adminController.getBalanceSheetSummary);
router.get('/income-statement-summary', protect, authorize(['viewDashboard']), adminController.getIncomeStatementSummary);

// Approvals
router.get('/pending-loans', protect, authorize(['viewApprovals']), adminController.getPendingLoans);
router.get('/pending-loan-payments', protect, authorize(['approveLoanAccounting']), adminController.getPendingLoanPayments);
// This route can be accessed by accounting (for first approval) or manager (for final approval)
router.put('/loans/:id/status', protect, authorize(['approveLoanAccounting', 'approveLoanManager']), adminController.updateLoanStatus);

// Savings Management
router.get('/savings', protect, authorize(['viewSavings']), savingController.getSavings);
router.get('/savings/member/:memberId', protect, authorize(['viewSavings']), savingController.getSavingsByMember);
router.post('/savings', protect, authorize(['approveSaving']), savingController.createSaving);
router.put('/savings/:id/status', protect, authorize(['approveSaving']), savingController.updateSavingStatus);
router.put('/savings/:id', protect, authorize(['deleteData']), savingController.updateSaving);
router.delete('/savings/:id', protect, authorize(['deleteData']), savingController.deleteSaving);

// Bulk Savings Management
router.get('/savings/export-template', protect, authorize(['approveSaving']), savingController.exportSavingsTemplate);
router.post('/savings/bulk-upload', protect, authorize(['approveSaving']), excelUpload.single('savingsFile'), savingController.uploadBulkSavings);
// Manual Saving Input
router.post('/savings/manual', protect, authorize(['approveSaving']), adminController.createManualSaving);


// Loan Management (for admin)
router.get('/loans', protect, authorize(['viewLoans']), loanController.getLoans);
router.get('/loans/:id/details', protect, authorize(['viewLoans']), adminController.getLoanDetailsForAdmin);
router.post('/loans/payment', protect, authorize(['approveLoanAccounting']), adminController.recordLoanPayment);
router.get('/loans/:id', protect, authorize(['manageUsers']), adminController.getLoanById);
router.put('/loan-payments/:id/status', protect, authorize(['approveLoanAccounting']), adminController.updateLoanPaymentStatus);
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

// Role & Permission Management
router.get('/permissions', protect, authorize(['viewSettings']), adminController.getAllPermissions);
router.get('/roles/:roleName/permissions', protect, authorize(['viewSettings']), adminController.getRolePermissions);
router.put('/roles/:roleName/permissions', protect, authorize(['viewSettings']), adminController.updateRolePermissions);

// Product Management
const productManagementPermission = ['viewDashboard']; // Gunakan permission yang sudah ada untuk simpel
router.get('/products', protect, authorize(productManagementPermission), adminController.getProducts);
router.get('/products/:id', protect, authorize(productManagementPermission), adminController.getProductById);
router.post('/sales', protect, authorize(productManagementPermission), adminController.createSale);
router.post('/products', protect, authorize(productManagementPermission), upload.single('productImage'), adminController.createProduct);
router.put('/products/:id', protect, authorize(productManagementPermission), upload.single('productImage'), adminController.updateProduct);
router.delete('/products/:id', protect, authorize(productManagementPermission), adminController.deleteProduct);
router.post('/cash-sale', protect, authorize(['viewUsahaKoperasi']), adminController.createCashSale);
router.get('/logistics-products/:shopType', protect, authorize(productManagementPermission), adminController.getAvailableLogisticsProducts);
// Rute baru untuk mengambil pesanan yang menunggu pengambilan
router.get('/sales/pending', protect, authorize(['approveLoanAccounting']), adminController.getPendingSales);
// Rute baru untuk mengambil detail item dari sebuah pesanan
router.get('/sales/:orderId/items', protect, authorize(['approveLoanAccounting']), adminController.getSaleItemsByOrderId);
// Rute baru untuk verifikasi pesanan oleh kasir
router.get('/sales/order/:orderId', protect, authorize(['approveLoanAccounting']), adminController.getSaleDetailsByOrderId);

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
router.get('/reports/monthly-closing-status', protect, authorize(['viewReports']), adminController.getMonthlyClosingStatus);

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

// --- Settings Routes ---

// Positions
router.get('/positions', protect, authorize(['viewSettings', 'viewMembers']), positionController.getPositions);
router.post('/positions', protect, authorize(['viewSettings']), positionController.createPosition);
router.put('/positions/:id', protect, authorize(['viewSettings']), positionController.updatePosition);
router.delete('/positions/:id', protect, authorize(['deleteData']), positionController.deletePosition);

// Saving Types
router.get('/savingtypes', protect, authorize(['viewSettings', 'viewSavings']), savingTypeController.getSavingTypes);
router.post('/savingtypes', protect, authorize(['viewSettings']), savingTypeController.createSavingType);
router.put('/savingtypes/:id', protect, authorize(['viewSettings']), savingTypeController.updateSavingType);
router.delete('/savingtypes/:id', protect, authorize(['deleteData']), savingTypeController.deleteSavingType);

// Loan Types
router.get('/loantypes', protect, authorize(['viewSettings']), loanTypeController.getLoanTypes);
router.post('/loantypes', protect, authorize(['viewSettings']), loanTypeController.createLoanType);
router.put('/loantypes/:id', protect, authorize(['viewSettings']), loanTypeController.updateLoanType);
router.delete('/loantypes/:id', protect, authorize(['deleteData']), loanTypeController.deleteLoanType);

// Loan Terms
router.get('/loanterms', protect, authorize(['viewSettings']), loanTermController.getLoanTerms);
router.post('/loanterms', protect, authorize(['viewSettings']), loanTermController.createLoanTerm);
router.put('/loanterms/:id', protect, authorize(['viewSettings']), loanTermController.updateLoanTerm);
router.delete('/loanterms/:id', protect, authorize(['deleteData']), loanTermController.deleteLoanTerm);

// Chart of Accounts (COA)
router.get('/accounts', protect, authorize(['viewSettings']), accountController.getAccounts);
router.post('/accounts/import', protect, authorize(['viewSettings']), excelUpload.single('accountsFile'), accountController.importAccountsFromExcel);
router.get('/accounts/export', protect, authorize(['viewSettings']), accountController.exportAccountsToExcel);
router.post('/accounts', protect, authorize(['viewSettings']), accountController.createAccount);
router.put('/accounts/:id', protect, authorize(['viewSettings']), accountController.updateAccount);
router.delete('/accounts/:id', protect, authorize(['deleteData']), accountController.deleteAccount);
// Rute baru untuk jurnal, hanya mengembalikan akun yang bukan akun induk.
router.get('/journal-accounts', protect, authorize(['viewAccounting']), accountController.getJournalableAccounts);
// Account Types (for COA)
router.get('/accounttypes', protect, authorize(['viewSettings']), accountTypeController.getAccountTypes);
router.post('/accounttypes', protect, authorize(['viewSettings']), accountTypeController.createAccountType);
router.put('/accounttypes/:id', protect, authorize(['viewSettings']), accountTypeController.updateAccountType);
router.delete('/accounttypes/:id', protect, authorize(['deleteData']), accountTypeController.deleteAccountType);


// Suppliers
router.get('/suppliers', protect, authorize(['viewSettings', 'viewAccounting']), adminController.getSuppliers);
// Note: Supplier creation/update/delete logic is not fully implemented in a dedicated controller yet.
// This part might need a separate controller in the future.

// Master Products CRUD
router.get('/master-products', protect, authorize(['viewSettings']), adminController.getMasterProducts);
router.post('/master-products', protect, authorize(['viewSettings']), adminController.createMasterProduct);
router.put('/master-products/:id', protect, authorize(['viewSettings']), adminController.updateMasterProduct);
router.delete('/master-products/:id', protect, authorize(['deleteData']), adminController.deleteMasterProduct);


module.exports = router;

// --- Sub-routers (MUST be at the end) ---
router.use('/announcements', announcementRoutes);
router.use('/employers', employerRoutes);
router.use('/partners', partnerRoutes);
router.use('/', supplierRoutes); // 2. Gunakan router supplier