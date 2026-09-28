// routes/admin/system.js
//
// System/security administration for logged-in staff — active session
// management (view/force-logout any session across all roles),
// self-service password change, login history, and audit logs.
// Extracted out of routes/adminRoutes.js (refactor, 2026-07). Mounted at
// '/' by routes/adminRoutes.js, so the final URLs (/api/admin/sessions,
// /api/admin/change-password, /api/admin/login-history,
// /api/admin/audit-logs) are unchanged.

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const { BCRYPT_ROUNDS } = require('../../config');
const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { getSession, revokeSession, revokeOtherSessions } = require('../../utils/sessionManager');

// Active Sessions — every currently-logged-in session across every role
// (not just this admin's own), with the ability to force-logout any of
// them. Useful for "this student's account looks compromised, kick them
// out" or "an ex-staff member is still logged in somewhere".
router.get('/sessions', requirePermission('audit:view'), (req, res) => {
    try {
        const sessions = db.find('sessions', { revoked: false })
            .slice()
            .sort((a, b) => new Date(b.lastSeenAt || b.createdAt) - new Date(a.lastSeenAt || a.createdAt))
            .map(s => ({ ...s, current: s._id === req.user?.sid }));
        res.json({ success: true, data: sessions });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.delete('/sessions/:sessionId', requirePermission('audit:view'), (req, res) => {
    try {
        const session = getSession(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        revokeSession(req.params.sessionId);
        res.json({ success: true, message: `Ended session for ${session.name || session.email}` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Change own password — any logged-in staff member (any role) changing
// their own password. Deliberately separate from staff.js's admin-creates-
// staff-account flow: this only ever touches req.userData's own record,
// never anyone else's, so no requirePermission() gate is needed beyond the
// requireApiAdmin already applied to this whole router in app.js — being
// logged in as yourself is the only permission this needs.
router.post('/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required'
            });
        }

        // SECURITY: same string-type guard as the login routes — see
        // routes/apiAuth.js for the full explanation of why object-shaped
        // input must never reach a query/compare unvalidated.
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        }

        // Matches the minimum staff.js already enforces when an admin
        // creates a new staff account — same significance level, same rule.
        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 8 characters long'
            });
        }

        const isCurrentCorrect = await bcrypt.compare(currentPassword, req.userData.password);
        if (!isCurrentCorrect) {
            // NOTE: intentionally 400, not 401 — public/admin/js/api.js's
            // apiCall() treats any 401 as "session invalid" and force-logs
            // the admin out immediately (clears their token, redirects to
            // login). A wrong *current password* here is a validation
            // failure, not an authentication/session failure, and must not
            // trigger that global logout behavior.
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ success: false, message: 'New password must be different from the current password' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        db.updateById('users', req.userData._id, { password: hashedPassword });

        // Security best practice after any credential change: end every
        // other active session for this account, keeping only the one that
        // just made this change. Exact same call the existing "log out
        // other sessions" admin route already uses.
        revokeOtherSessions(req.userData._id, req.user?.sid);

        logAudit(req, 'update', 'user', req.userData._id, 'Changed own password');

        res.json({ success: true, message: 'Password changed successfully. You have been logged out of your other sessions.' });
    } catch (error) {
        logger.error(`Change password error: ${error.message}`, { stack: error.stack, path: req.path, userId: req.userData?._id });
        res.status(500).json({ success: false, message: 'Failed to change password' });
    }
});

// Login history (all roles — admin/staff and students) — separate from
// /audit-logs below, which only ever covered admin actions. Powers the
// admin "Login History" page.
router.get('/login-history', requirePermission('audit:view'), (req, res) => {
    try {
        const { status, role, userId, limit = 200 } = req.query;
        let logs = db.find('login-history', {});
        if (status) logs = logs.filter(l => l.status === status);
        if (role) logs = logs.filter(l => l.role === role);
        if (userId) logs = logs.filter(l => l.userId === userId);
        logs = logs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, parseInt(limit, 10) || 200);
        res.json({ success: true, data: logs });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Audit logs
router.get('/audit-logs', requirePermission('audit:view'), (req, res) => {
    try {
        const { action, adminId, limit = 100 } = req.query;
        let logs = db.find('audit-logs', {});
        if (action) logs = logs.filter(l => l.action === action);
        if (adminId) logs = logs.filter(l => l.adminId === adminId);
        logs = logs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, parseInt(limit, 10) || 100);
        res.json({ success: true, data: logs });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;