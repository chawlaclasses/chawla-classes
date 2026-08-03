/**
 * routes/apiAuth.js
 *
 * Authentication routes for the new test system.
 */

"use strict";

const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// FIX (security, audit 2026-07): use the one canonical JWT_SECRET from
// services/auth.js (env var -> persisted random secret -> auto-generated)
// instead of a locally hardcoded fallback string — see middleware/apiAuth.js
// for the full explanation.
const { JWT_SECRET } = require('../services/auth');
const { logAudit } = require('../utils/auditLog');
const { STAFF_ROLES } = require('../config/permissions');
const { isAccountLocked, minutesUntilUnlock, registerFailedAttempt, clearFailedAttempts } = require('../utils/accountLock');
const { recordLogin } = require('../utils/loginHistory');
const { createSession, revokeSession, revokeOtherSessions, listActiveSessionsForUser, isSessionValid, touchSession, getSession } = require('../utils/sessionManager');
const { requireApiAuth } = require('../middleware/apiAuth');
const { createAuthRateLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');
// Phase 4: rotate the session's CSRF token on successful login (middleware/
// csrfProtection.js's regenerateCsrfToken, part of the original incoming
// patch — copied in during the merge but never actually called from here).
// Session fixation defense: this app authenticates with a JWT Bearer token,
// so verifyCsrfToken skips essentially all authenticated traffic (see the
// "authenticated traffic exempted" comment in csrfProtection.js) — but
// initializeCsrfProtection still hands out a session-scoped CSRF token to
// EVERY /api request, authenticated or not (app.js mounts it globally on
// /api, before routes run). Without this, a token issued before login stays
// valid after login, on the same req.session — rotating it here closes that
// gap for the cookie-session surface even though it's not this app's
// primary auth mechanism.
const { regenerateCsrfToken } = require('../middleware/csrfProtection');

// SECURITY: applied to both login routes below — see middleware/rateLimit.js
// for why this existed as unused config but was never actually wired in.
const authRateLimiter = createAuthRateLimiter();

// ============================================================
// Admin Login (any staff role — super_admin, admin, teacher,
// reception, accountant — all sign in through this one endpoint and
// land on the same admin panel; what they can see/do there is gated by
// their role, not by which login form they used.)
// ============================================================
router.post('/api/admin/login', authRateLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // SECURITY: email/password must be plain strings. Without this, a
        // JSON body like {"email": {"$ne": "x"}} reaches db.findOne() as an
        // object — services/jsonDb.js's matchesQuery() interprets object
        // values as Mongo-style query operators ($ne, $gt, $regex, etc.),
        // so {"$ne": "x"} matches "any user whose email isn't x" — i.e.
        // effectively any real account. Verified against this app's own
        // data: that payload returns the actual admin account without ever
        // knowing its email. bcrypt.compare() still requires the real
        // password, so this alone isn't a full bypass, but it defeats the
        // "no such account" enumeration protection below and is exactly the
        // kind of input that must never reach a query unvalidated. Rejecting
        // non-strings here closes it at the one place user input enters
        // this route, without touching matchesQuery()'s behavior for the
        // many legitimate internal callers elsewhere that rely on it.
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const user = db.findOne('users', { email });
        if (!user || !STAFF_ROLES.includes(user.role)) {
            logAudit(req, 'login_failed', 'admin', null, `Failed login attempt for ${email} (no such staff account)`);
            recordLogin(req, { status: 'failed', email, reason: 'No such staff account' });
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (user.isActive === false) {
            logAudit(req, 'login_failed', 'admin', user._id, `Login attempt for deactivated staff account ${email}`);
            recordLogin(req, { status: 'failed', userId: user._id, name: user.name, email, role: user.role, reason: 'Account deactivated' });
            return res.status(403).json({
                success: false,
                message: 'Your account has been deactivated. Contact a super admin.'
            });
        }

        if (isAccountLocked(user)) {
            const minutesLeft = minutesUntilUnlock(user);
            logAudit(req, 'login_failed', 'admin', user._id, `Login attempt on temporarily locked account ${email}`);
            recordLogin(req, { status: 'locked', userId: user._id, name: user.name, email, role: user.role, reason: `Too many failed attempts — locked for ${minutesLeft} more minute(s)` });
            return res.status(423).json({
                success: false,
                message: `Too many failed attempts. This account is temporarily locked — please try again in ${minutesLeft} minute(s).`
            });
        }
        
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            const updatedUser = registerFailedAttempt(user);
            const nowLocked = isAccountLocked(updatedUser);
            logAudit(req, 'login_failed', 'admin', user._id, `Failed login attempt for ${email} (wrong password)${nowLocked ? ' — account now locked' : ''}`);
            recordLogin(req, {
                status: 'failed',
                userId: user._id,
                name: user.name,
                email,
                role: user.role,
                reason: nowLocked ? `Wrong password — account now locked for ${minutesUntilUnlock(updatedUser)} minute(s)` : 'Wrong password',
            });
            if (nowLocked) {
                return res.status(423).json({
                    success: false,
                    message: `Too many failed attempts. This account is temporarily locked — please try again in ${minutesUntilUnlock(updatedUser)} minute(s).`
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        clearFailedAttempts(user);

        const session = createSession(req, user);
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role, sid: session._id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        req.user = { id: user._id, name: user.name };
        logAudit(req, 'login', 'admin', user._id, `${user.name} logged in (${user.role})`);
        recordLogin(req, { status: 'success', userId: user._id, name: user.name, email, role: user.role });

        // Phase 4: rotate the CSRF token now that this session is
        // authenticated — see the require() above for why.
        regenerateCsrfToken(req, res, () => {});

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            },
            message: 'Admin login successful'
        });
    } catch (error) {
        // SECURITY: was console.error + `error: error.message` sent straight
        // to the client — leaking raw internal error text (stack traces,
        // file paths, DB internals) on an unauthenticated, attacker-facing
        // endpoint. Now logged server-side only via the shared logger (same
        // as middleware/errors.js's globalErrorHandler), generic message to
        // the client.
        logger.error(`Admin login error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({
            success: false,
            message: 'Login failed'
        });
    }
});

// ============================================================
// Student Login
// ============================================================
router.post('/api/student/login', authRateLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // SECURITY: same operator-injection guard as /api/admin/login above.
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const user = db.findOne('users', { email, role: 'student' });
        if (!user) {
            recordLogin(req, { status: 'failed', email, role: 'student', reason: 'No such student account' });
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (user.isActive === false) {
            recordLogin(req, { status: 'failed', userId: user._id, name: user.name, email, role: 'student', reason: 'Account deactivated' });
            return res.status(403).json({
                success: false,
                message: 'Your account has been deactivated. Contact the institute.'
            });
        }

        if (isAccountLocked(user)) {
            const minutesLeft = minutesUntilUnlock(user);
            recordLogin(req, { status: 'locked', userId: user._id, name: user.name, email, role: 'student', reason: `Too many failed attempts — locked for ${minutesLeft} more minute(s)` });
            return res.status(423).json({
                success: false,
                message: `Too many failed attempts. This account is temporarily locked — please try again in ${minutesLeft} minute(s).`
            });
        }
        
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            const updatedUser = registerFailedAttempt(user);
            const nowLocked = isAccountLocked(updatedUser);
            recordLogin(req, {
                status: 'failed',
                userId: user._id,
                name: user.name,
                email,
                role: 'student',
                reason: nowLocked ? `Wrong password — account now locked for ${minutesUntilUnlock(updatedUser)} minute(s)` : 'Wrong password',
            });
            if (nowLocked) {
                return res.status(423).json({
                    success: false,
                    message: `Too many failed attempts. This account is temporarily locked — please try again in ${minutesUntilUnlock(updatedUser)} minute(s).`
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        clearFailedAttempts(user);
        
        const classData = db.findById('classes', user.classId);

        // Track login activity for the "Daily Active Students" analytics widget
        db.updateById('users', user._id, { lastLoginAt: new Date().toISOString() });
        recordLogin(req, { status: 'success', userId: user._id, name: user.name, email, role: 'student' });

        const session = createSession(req, user);
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role, sid: session._id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Phase 4: rotate the CSRF token now that this session is
        // authenticated — see the require() above for why.
        regenerateCsrfToken(req, res, () => {});

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    class: classData ? classData.displayName : null
                }
            },
            message: 'Student login successful'
        });
    } catch (error) {
        logger.error(`Student login error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({
            success: false,
            message: 'Login failed'
        });
    }
});

// ============================================================
// Verify Token
// ============================================================
router.get('/api/auth/verify', (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.findById('users', decoded.id);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!isSessionValid(decoded.sid)) {
            return res.status(401).json({
                success: false,
                message: 'This session has been ended. Please log in again.'
            });
        }
        touchSession(decoded.sid);
        
        res.json({
            success: true,
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
});

// ============================================================
// Session Management (any logged-in user — admin/staff or student)
// A "session" here is one login (one device/browser), independent of the
// generic account lockout above. Ending a session here takes effect
// immediately, even though the JWT itself is technically still valid for
// up to 24h — see middleware/apiAuth.js, which checks this on every request.
// ============================================================

// Logout — ends *this* session specifically (as opposed to just discarding
// the token client-side, which would leave the session showing as "active"
// in the list below until it naturally expired).
router.post('/api/auth/logout', requireApiAuth, (req, res) => {
    try {
        if (req.user?.sid) revokeSession(req.user.sid);
        res.json({ success: true, message: 'Logged out' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// List this user's own active sessions/devices
router.get('/api/auth/sessions', requireApiAuth, (req, res) => {
    try {
        const sessions = listActiveSessionsForUser(req.userData._id, req.user?.sid);
        res.json({ success: true, data: sessions });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// End one specific session — e.g. "that's not me, log that device out"
router.delete('/api/auth/sessions/:sessionId', requireApiAuth, (req, res) => {
    try {
        const session = getSession(req.params.sessionId);
        if (!session || session.userId !== req.userData._id) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        revokeSession(req.params.sessionId);
        res.json({ success: true, message: 'Session ended' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// "Log out all other devices" — keeps the session making this request active
router.post('/api/auth/sessions/revoke-others', requireApiAuth, (req, res) => {
    try {
        const count = revokeOtherSessions(req.userData._id, req.user?.sid);
        res.json({ success: true, message: `Logged out ${count} other session(s)`, data: { count } });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;