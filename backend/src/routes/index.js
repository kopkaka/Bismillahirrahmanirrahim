const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const memberRoutes = require('./member.routes');
const adminRoutes = require('./admin.routes'); // Assuming this exists
const publicRoutes = require('./public.routes'); // FIX: Use the new public routes file
const passwordRoutes = require('./password.routes.js'); // Import password routes

// This main router delegates traffic to the specialized routers.
// This keeps server.js clean and centralizes routing logic.

// Public-facing routes (e.g., for registration page data, public shop)
router.use('/public', publicRoutes);

// Authentication routes
router.use('/auth', authRoutes);
router.use('/auth', passwordRoutes); // Mount password routes under /auth

// Member-specific routes (requires member login)
router.use('/member', memberRoutes);

// Admin/staff routes (requires staff login)
router.use('/admin', adminRoutes);

module.exports = router;