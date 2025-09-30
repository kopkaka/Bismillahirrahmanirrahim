const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes.js');
const memberRoutes = require('./member.routes.js');
const adminRoutes = require('./admin.routes.js');
const passwordRoutes = require('./password.routes.js');
const publicRoutes = require('./public.routes.js');

// Public-facing routes (e.g., for registration page data, public shop)
router.use('/public', publicRoutes); // FIX: Register public routes

// Authentication routes
router.use('/auth', authRoutes);

// Password reset routes
router.use('/auth', passwordRoutes);

// Member-specific routes (requires member login)
router.use('/member', memberRoutes); // FIX: Register member routes

// Admin/staff routes (requires staff login)
router.use('/admin', adminRoutes);

module.exports = router;