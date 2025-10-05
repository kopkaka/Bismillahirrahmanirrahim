const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const memberRoutes = require('./member.routes');
const adminRoutes = require('./admin.routes');
const publicRoutes = require('./public.routes.js');
const savingRoutes = require('./saving.routes.js');
const loanRoutes = require('./loan.routes.js');
const positionRoutes = require('./position.routes.js');
const savingTypeRoutes = require('./savingtype.routes.js');
const loanTypeRoutes = require('./loantype.routes.js');
const loanTermRoutes = require('./loanterms.routes.js');
const accountRoutes = require('./account.routes.js');
const supplierRoutes = require('./supplier.routes.js');
const journalRoutes = require('./journal.routes.js');
const approvalRoutes = require('./approval.routes.js');

// This main router delegates traffic to the specialized routers.
// This keeps server.js clean and centralizes routing logic.

// Public-facing routes (e.g., for registration page data, public shop)
router.use('/public', publicRoutes); // FIX: Register public routes

// Authentication routes
router.use('/auth', authRoutes); // auth.routes.js already includes password routes

// Member-specific routes (requires member login)
router.use('/member', memberRoutes);

// Admin/staff routes (requires staff login)
router.use('/admin', adminRoutes);
router.use('/admin', savingRoutes);
router.use('/admin', loanRoutes);
router.use('/admin', positionRoutes);
router.use('/admin', savingTypeRoutes);
router.use('/admin', loanTypeRoutes);
router.use('/admin', loanTermRoutes);
router.use('/admin', accountRoutes);
router.use('/admin', supplierRoutes);
router.use('/admin', journalRoutes);
router.use('/admin', approvalRoutes);

module.exports = router;