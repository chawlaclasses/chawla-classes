/**
 * middleware/apiAuth.js
 *
 * Authentication middleware for API routes.
 * Uses JWT tokens and JSON database.
 */

"use strict";

const jwt = require('jsonwebtoken');
const db = require('../services/jsonDb');
const { STAFF_ROLES } = require('../config/permissions');
const { isSessionValid, touchSession } = require('../utils/sessionManager');

// FIX (security, audit 2026-07): this used to hardcode its own fallback
// secret ('chawla-classes-secret-key-change-this'), independently from
// services/auth.js which already has a proper secret-loading strategy
// (env var -> persisted random 32-byte secret file -> auto-generate +
// persist). Different files hardcoding different fallback strings meant
// tokens could, in a misconfigured deployment, be signed with a
// publicly-known string instead of the persisted random one. Now importing
// the one canonical secret instead of redefining it.
const { JWT_SECRET } = require('../services/auth');

// ============================================================
// Require Admin (any staff role: super_admin, admin, teacher,
// reception, accountant — NOT student. Fine-grained "who can do what
// within the staff roles" is a separate check — see
// middleware/permissions.js's requirePermission(), used on top of this.)
// ============================================================
const requireApiAdmin = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    try {
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
        
        if (!STAFF_ROLES.includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Staff access required'
            });
        }

        if (user.isActive === false) {
            return res.status(403).json({
                success: false,
                message: 'Account is deactivated'
            });
        }
        
        req.user = decoded;
        req.userData = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

// ============================================================
// Require Student
// ============================================================
const requireApiStudent = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    try {
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
        
        if (user.role !== 'student' && !STAFF_ROLES.includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Student access required'
            });
        }

        // FIX (security, audit 2026-07): requireApiAdmin and requireApiAuth
        // both reject deactivated accounts; this one didn't. A deactivated
        // student's existing JWT (valid up to 24h) kept working on every
        // student-only endpoint until it naturally expired. Same check as
        // requireApiAdmin, so an old token stops working the moment the
        // account is deactivated, not just at token expiry.
        if (user.isActive === false) {
            return res.status(403).json({
                success: false,
                message: 'Account is deactivated'
            });
        }
        
        req.user = decoded;
        req.userData = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

// ============================================================
// Require Any Authenticated User
// ============================================================
const requireApiAuth = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    try {
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
        
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Account is deactivated'
            });
        }
        
        req.user = decoded;
        req.userData = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

module.exports = {
    requireApiAdmin,
    requireApiStudent,
    requireApiAuth
};