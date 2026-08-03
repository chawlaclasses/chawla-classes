// controllers/student/authController.js

// ─── DEPRECATED (moved 2026-07-21) ─────────────────────────────────────────
// Confirmed orphaned during Auth & Security audit: not required by any
// route, controller, script, or test in this codebase. The live auth
// system is routes/apiAuth.js + middleware/apiAuth.js + services/auth.js.
// This file also has stale require paths (would not even load if required)
// and a stub verifyOTP()/generateQRCode() that are not real TOTP — do not
// wire this back in as-is. Kept here for reference only; safe to delete
// once Version 1 is confirmed stable.
// ─────────────────────────────────────────────────────────────────────────
"use strict";

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../services/jsonDb');
const { asyncHandler } = require('../../middleware/error');
const { AppError } = require('../../middleware/error');
const logger = require('../../utils/logger');
const crypto = require('crypto');

// FIX (security, audit 2026-07): this file previously hardcoded its own
// fallback secret ('chawla-classes-jwt-secret') — a *different* string from
// the one used elsewhere in the app (see middleware/apiAuth.js), which
// would have meant tokens weren't even cross-compatible if this path were
// ever hit. Now importing the one canonical JWT_SECRET from services/auth.js.
const { JWT_SECRET } = require('../services/auth');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// ─── Login ──────────────────────────────────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    // Find user
    const user = await db.findOne('users', { username });
    if (!user) {
        throw new AppError('Invalid credentials', 401);
    }

    // Check if user is active
    if (user.status === 'suspended') {
        throw new AppError('Account suspended. Please contact admin.', 403);
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        // Log failed attempt
        await logFailedAttempt(username, req.ip);
        throw new AppError('Invalid credentials', 401);
    }

    // Check if 2FA is required
    if (user.twoFactorEnabled) {
        const otp = generateOTP();
        await storeOTP(user.id, otp);
        await sendOTP(user.email, otp);
        
        return res.json({
            success: true,
            requires2FA: true,
            userId: user.id,
            message: 'OTP sent to your email'
        });
    }

    // Generate tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Update last login
    await db.updateById('users', user.id, {
        lastLogin: new Date().toISOString(),
        refreshToken,
        lastIP: req.ip,
        loginCount: (user.loginCount || 0) + 1
    });

    // Remove sensitive data
    const { password: _, ...userData } = user;

    res.json({
        success: true,
        data: {
            user: userData,
            token,
            refreshToken,
            expiresIn: JWT_EXPIRY
        }
    });
});

// ─── Verify 2FA ────────────────────────────────────────────────────────────
exports.verify2FA = asyncHandler(async (req, res) => {
    const { userId, otp } = req.body;

    const user = await db.findById('users', userId);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Verify OTP
    const storedOTP = await getOTP(userId);
    if (!storedOTP || storedOTP !== otp || Date.now() > storedOTP.expiresAt) {
        throw new AppError('Invalid or expired OTP', 401);
    }

    // Clear OTP
    await clearOTP(userId);

    // Generate tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Update last login
    await db.updateById('users', user.id, {
        lastLogin: new Date().toISOString(),
        refreshToken,
        lastIP: req.ip,
        loginCount: (user.loginCount || 0) + 1
    });

    const { password: _, ...userData } = user;

    res.json({
        success: true,
        data: {
            user: userData,
            token,
            refreshToken,
            expiresIn: JWT_EXPIRY
        }
    });
});

// ─── Refresh Token ──────────────────────────────────────────────────────────
exports.refresh = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        throw new AppError('Refresh token required', 400);
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const user = await db.findById('users', decoded.id);

    if (!user || user.refreshToken !== refreshToken) {
        throw new AppError('Invalid refresh token', 401);
    }

    // Generate new tokens
    const token = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    await db.updateById('users', user.id, {
        refreshToken: newRefreshToken
    });

    res.json({
        success: true,
        data: {
            token,
            refreshToken: newRefreshToken,
            expiresIn: JWT_EXPIRY
        }
    });
});

// ─── Logout ──────────────────────────────────────────────────────────────────
exports.logout = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Clear refresh token
    await db.updateById('users', userId, {
        refreshToken: null
    });

    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// ─── Change Password ──────────────────────────────────────────────────────
exports.changePassword = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { oldPassword, newPassword } = req.body;

    const user = await db.findById('users', userId);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Verify old password
    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
        throw new AppError('Invalid current password', 401);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.updateById('users', userId, {
        password: hashedPassword,
        passwordChangedAt: new Date().toISOString()
    });

    res.json({
        success: true,
        message: 'Password changed successfully'
    });
});

// ─── Forgot Password ──────────────────────────────────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;

    const user = await db.findOne('users', { email });
    if (!user) {
        // Don't reveal if user exists
        return res.json({
            success: true,
            message: 'If an account exists, a reset link has been sent'
        });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 hour

    await db.updateById('users', user.id, {
        resetToken,
        resetExpires
    });

    // Send reset email
    await sendResetEmail(email, resetToken);

    res.json({
        success: true,
        message: 'Password reset link sent to your email'
    });
});

// ─── Reset Password ────────────────────────────────────────────────────────
exports.resetPassword = asyncHandler(async (req, res) => {
    const { token, password } = req.body;

    const user = await db.findOne('users', {
        resetToken: token,
        resetExpires: { $gt: Date.now() }
    });

    if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.updateById('users', user.id, {
        password: hashedPassword,
        resetToken: null,
        resetExpires: null,
        passwordChangedAt: new Date().toISOString()
    });

    res.json({
        success: true,
        message: 'Password reset successfully'
    });
});

// ─── Setup 2FA ─────────────────────────────────────────────────────────────
exports.setup2FA = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Generate 2FA secret
    const secret = crypto.randomBytes(20).toString('hex');
    const qrCode = await generateQRCode(secret, req.user.email);

    await db.updateById('users', userId, {
        twoFactorSecret: secret,
        twoFactorPending: true
    });

    res.json({
        success: true,
        data: {
            secret,
            qrCode,
            message: 'Scan QR code with authenticator app'
        }
    });
});

// ─── Enable 2FA ────────────────────────────────────────────────────────────
exports.enable2FA = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { code } = req.body;

    const user = await db.findById('users', userId);
    if (!user || !user.twoFactorPending) {
        throw new AppError('2FA setup not initiated', 400);
    }

    // Verify code
    const isValid = verifyOTP(user.twoFactorSecret, code);
    if (!isValid) {
        throw new AppError('Invalid code', 400);
    }

    await db.updateById('users', userId, {
        twoFactorEnabled: true,
        twoFactorPending: false
    });

    res.json({
        success: true,
        message: '2FA enabled successfully'
    });
});

// ─── Disable 2FA ───────────────────────────────────────────────────────────
exports.disable2FA = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { password } = req.body;

    const user = await db.findById('users', userId);
    if (!user) {
        throw new AppError('User not found', 404);
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        throw new AppError('Invalid password', 401);
    }

    await db.updateById('users', userId, {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorPending: false
    });

    res.json({
        success: true,
        message: '2FA disabled successfully'
    });
});

// ─── Get Sessions ──────────────────────────────────────────────────────────
exports.getSessions = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const sessions = await db.find('sessions', {
        userId,
        isActive: true
    }, { sort: 'createdAt:desc' });

    res.json({
        success: true,
        data: sessions.data
    });
});

// ─── Revoke Session ────────────────────────────────────────────────────────
exports.revokeSession = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const session = await db.findOne('sessions', {
        id: sessionId,
        userId
    });

    if (!session) {
        throw new AppError('Session not found', 404);
    }

    await db.updateById('sessions', sessionId, {
        isActive: false,
        revokedAt: new Date().toISOString()
    });

    res.json({
        success: true,
        message: 'Session revoked successfully'
    });
});

// ─── Revoke All Sessions ──────────────────────────────────────────────────
exports.revokeAllSessions = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const sessions = await db.find('sessions', {
        userId,
        isActive: true
    });

    for (const session of sessions.data) {
        await db.updateById('sessions', session.id, {
            isActive: false,
            revokedAt: new Date().toISOString()
        });
    }

    res.json({
        success: true,
        message: 'All sessions revoked successfully'
    });
});

// ─── Helper Functions ─────────────────────────────────────────────────────

function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role,
            class: user.class,
            batch: user.batch
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );
}

function generateRefreshToken(user) {
    return jwt.sign(
        { id: user.id },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function storeOTP(userId, otp) {
    await db.insert('otps', {
        userId,
        otp,
        expiresAt: Date.now() + 300000 // 5 minutes
    });
}

async function getOTP(userId) {
    const otp = await db.findOne('otps', { userId });
    return otp;
}

async function clearOTP(userId) {
    await db.delete('otps', { userId });
}

async function logFailedAttempt(username, ip) {
    await db.insert('login_attempts', {
        username,
        ip,
        timestamp: new Date().toISOString()
    });
}

async function sendOTP(email, otp) {
    // Implement email sending
    logger.info(`OTP sent to ${email}: ${otp}`);
    return true;
}

async function sendResetEmail(email, token) {
    // Implement email sending
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    logger.info(`Reset link sent to ${email}: ${resetLink}`);
    return true;
}

async function generateQRCode(secret, email) {
    // Generate QR code for 2FA
    return `data:image/png;base64,${Buffer.from(secret).toString('base64')}`;
}

function verifyOTP(secret, code) {
    // Verify TOTP
    return true; // Simplified
}