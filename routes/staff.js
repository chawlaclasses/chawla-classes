/**
 * routes/staff.js
 *
 * CRUD for staff accounts (super_admin, admin, teacher, reception,
 * accountant) — separate from routes/students.js (students are a
 * different kind of user entirely). Mounted at /api/admin/staff behind
 * requireApiAdmin, with requirePermission('staff:*') on top for the
 * actual create/edit/deactivate actions.
 *
 * Role-assignment is deliberately restricted beyond a simple permission
 * check: see canAssignRole() in config/permissions.js. An 'admin' can
 * create/manage teacher, reception, and accountant accounts, but only a
 * 'super_admin' can create or edit another super_admin or admin account.
 * This stops one admin from quietly promoting themselves (or a friend)
 * to super_admin.
 */

"use strict";

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../services/jsonDb');
const { BCRYPT_ROUNDS } = require('../config');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/auditLog');
const { requirePermission } = require('../middleware/permissions');
const { STAFF_ROLES, canAssignRole } = require('../config/permissions');
const { sendMail } = require('../utils/mailer');

// ------------------------------------------------------------
// Login ID helpers
// A staff member now has TWO separate identifiers:
//   loginId -> custom username the admin chooses; used to sign in.
//   email   -> where the credentials (and later notifications) are sent.
// ------------------------------------------------------------
// 3-50 chars; letters, numbers and . _ - @ + (so email-style IDs also work); no spaces.
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._@+-]{2,49}$/;
const LOGIN_ID_MSG = 'Login ID must be 3-50 characters using letters, numbers and . _ - @ + only (no spaces)';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeLoginId(v) {
    return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// Login ID must be unique across ALL users (case-insensitive) and must not
// equal anyone's email, otherwise a login identifier could match two accounts.
function loginIdTaken(loginId, excludeId) {
    return db.find('users', {}).some(u =>
        u._id !== excludeId &&
        ((u.loginId && String(u.loginId).toLowerCase() === loginId) ||
         (u.email && String(u.email).toLowerCase() === loginId))
    );
}

function escapeHtmlServer(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendCredentialsEmail(req, { name, email, loginId, password, role, isReset }) {
    const loginUrl = `${req.protocol}://${req.get('host')}/admin/login.html`;
    const subject = isReset ? 'Your Chawla Classes login details have been updated' : 'Your Chawla Classes staff account';
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222;">
            <h2 style="color:#4f6ef7;">Chawla Classes</h2>
            <p>Hello ${escapeHtmlServer(name)},</p>
            <p>${isReset ? 'Your login details were updated.' : `Your <strong>${escapeHtmlServer(role)}</strong> account has been created.`} Use the details below to sign in:</p>
            <table style="border-collapse:collapse;margin:14px 0;">
                <tr><td style="padding:6px 14px 6px 0;color:#666;">Login ID</td><td style="padding:6px 0;"><strong>${escapeHtmlServer(loginId)}</strong></td></tr>
                <tr><td style="padding:6px 14px 6px 0;color:#666;">Password</td><td style="padding:6px 0;"><strong>${escapeHtmlServer(password)}</strong></td></tr>
            </table>
            <p><a href="${escapeHtmlServer(loginUrl)}" style="background:#4f6ef7;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Open Admin Login</a></p>
            <p style="color:#888;font-size:12px;">Please keep these details private. Sign in with your Login ID (not your email address).</p>
        </div>`;
    try {
        return await sendMail({ to: email, subject, html });
    } catch (err) {
        logger.error(`Staff credentials email failed for ${email}: ${err.message}`);
        return { sent: false, reason: err.message };
    }
}

// ============================================================
// List staff accounts
// ============================================================
router.get('/', requirePermission('staff:view'), (req, res) => {
    try {
        const staff = db.find('users', {}).filter(u => STAFF_ROLES.includes(u.role));
        const safe = staff.map(({ password, ...rest }) => rest);
        res.json({ success: true, data: safe });
    } catch (error) {
        logger.error(`List staff error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to load staff accounts' });
    }
});

// ============================================================
// Create a staff account
// ============================================================
router.post('/', requirePermission('staff:create'), async (req, res) => {
    try {
        const { name, email, loginId: rawLoginId, password, role, phone, assignedClasses, assignedSubjects, sendEmail } = req.body;

        if (!name || !email || !rawLoginId || !password || !role) {
            return res.status(400).json({ success: false, message: 'Name, login ID, email, password and role are required' });
        }
        if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
            return res.status(400).json({ success: false, message: 'Enter a valid email address' });
        }
        const loginId = normalizeLoginId(rawLoginId);
        if (!LOGIN_ID_RE.test(loginId)) {
            return res.status(400).json({ success: false, message: LOGIN_ID_MSG });
        }
        if (!STAFF_ROLES.includes(role)) {
            return res.status(400).json({ success: false, message: `Role must be one of: ${STAFF_ROLES.join(', ')}` });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        }

        const actingRole = req.userData.role;
        if (!canAssignRole(actingRole, role)) {
            return res.status(403).json({
                success: false,
                message: `Your role (${actingRole}) isn't allowed to create a ${role} account. Only a super admin can do that.`
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        if (db.findOne('users', { email: normalizedEmail })) {
            return res.status(409).json({ success: false, message: 'A user with this email already exists' });
        }
        if (loginIdTaken(loginId, null)) {
            return res.status(409).json({ success: false, message: 'This Login ID is already taken. Please choose another.' });
        }

        // BCRYPT_ROUNDS is centralised in config (see services/auth.js).
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const newStaff = db.insertOne('users', {
            name,
            loginId,
            email: normalizedEmail,
            password: hashedPassword,
            role,
            phone: phone || '',
            // Empty array/omitted = unrestricted (sees every class). Only
            // meaningful for 'teacher' today.
            assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : [],
            assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [],
            isActive: true,
            createdBy: req.user?.id || null,
        });

        logAudit(req, 'create', 'staff', newStaff._id, `Added ${role} account for ${name} (login: ${loginId}, email: ${normalizedEmail})`);

        // Credentials go to the email address (sendEmail defaults to true).
        let emailResult = { sent: false, reason: 'Email not requested' };
        if (sendEmail !== false) {
            emailResult = await sendCredentialsEmail(req, { name, email: normalizedEmail, loginId, password, role, isReset: false });
        }

        const { password: _pw, ...safeStaff } = newStaff;
        res.status(201).json({
            success: true,
            data: safeStaff,
            emailSent: !!emailResult.sent,
            message: emailResult.sent
                ? `Staff account created. Login details emailed to ${normalizedEmail}`
                : `Staff account created, but the email could not be sent${emailResult.reason ? ` (${emailResult.reason})` : ''}. Please share the Login ID and password manually.`
        });
    } catch (error) {
        logger.error(`Create staff error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to create staff account' });
    }
});

// ============================================================
// Update a staff account (name, phone, role, isActive)
// ============================================================
router.put('/:id', requirePermission('staff:edit'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, role, isActive, assignedClasses, assignedSubjects, password, loginId: rawLoginId, email: rawEmail, sendEmail } = req.body;

        const existing = db.findById('users', id);
        if (!existing || !STAFF_ROLES.includes(existing.role)) {
            return res.status(404).json({ success: false, message: 'Staff account not found' });
        }

        const actingRole = req.userData.role;

        // Changing a staff member's OWN role, or editing a role you're not
        // allowed to assign, requires the higher bar.
        if (!canAssignRole(actingRole, existing.role)) {
            return res.status(403).json({
                success: false,
                message: `Your role (${actingRole}) can't manage a ${existing.role} account.`
            });
        }
        if (role && role !== existing.role && !canAssignRole(actingRole, role)) {
            return res.status(403).json({
                success: false,
                message: `Your role (${actingRole}) isn't allowed to assign the ${role} role.`
            });
        }
        if (id === req.user.id && role && role !== existing.role) {
            return res.status(400).json({ success: false, message: "You can't change your own role. Ask another super admin to do it." });
        }

        // Optional Login ID / email change (kept separate from each other).
        const identityChange = {};
        let newLoginId = existing.loginId || '';
        let newEmail = existing.email;
        if (rawLoginId !== undefined && rawLoginId !== null && String(rawLoginId).trim() !== '') {
            const loginId = normalizeLoginId(rawLoginId);
            if (!LOGIN_ID_RE.test(loginId)) {
                return res.status(400).json({ success: false, message: LOGIN_ID_MSG });
            }
            if (loginId !== (existing.loginId || '') ) {
                if (loginIdTaken(loginId, id)) {
                    return res.status(409).json({ success: false, message: 'This Login ID is already taken. Please choose another.' });
                }
                identityChange.loginId = loginId;
                newLoginId = loginId;
                // Old sessions stay valid until expiry; drop refresh token so they can't renew.
                identityChange.refreshToken = null;
            }
        }
        if (typeof rawEmail === 'string' && rawEmail.trim() !== '') {
            const email = rawEmail.toLowerCase().trim();
            if (!EMAIL_RE.test(email)) {
                return res.status(400).json({ success: false, message: 'Enter a valid email address' });
            }
            if (email !== existing.email) {
                const clash = db.findOne('users', { email });
                if (clash && clash._id !== id) {
                    return res.status(409).json({ success: false, message: 'A user with this email already exists' });
                }
                identityChange.email = email;
                newEmail = email;
            }
        }

        // Optional password reset. Blank / missing = keep the current password.
        // Same minimum length as account creation. (canAssignRole above already
        // stops an admin from resetting a super_admin / admin password.)
        const passwordChange = {};
        const wantsNewPassword = typeof password === 'string' && password.length > 0;
        if (wantsNewPassword) {
            if (password.length < 8) {
                return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
            }
            passwordChange.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
            passwordChange.passwordChangedAt = new Date().toISOString();
            // Drop the stored refresh token so any session still open on the old
            // password can't silently renew itself.
            passwordChange.refreshToken = null;
        }

        const updated = db.findByIdAndUpdate('users', id, {
            name: name || existing.name,
            phone: phone !== undefined ? phone : existing.phone,
            role: role || existing.role,
            isActive: isActive !== undefined ? isActive : existing.isActive,
            assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : (existing.assignedClasses || []),
            assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : (existing.assignedSubjects || []),
            ...identityChange,
            ...passwordChange,
        });

        logAudit(req, 'edit', 'staff', id, `Updated staff account for ${updated.name}${wantsNewPassword ? ' (password reset)' : ''}${identityChange.loginId ? ' (login ID changed)' : ''}${identityChange.email ? ' (email changed)' : ''}`);

        // Re-send login details when asked (checkbox in the UI), or whenever the
        // password was just reset / the Login ID or email changed and the
        // admin didn't opt out.
        let emailResult = null;
        const credsChanged = wantsNewPassword || identityChange.loginId || identityChange.email;
        if (sendEmail === true && newLoginId) {
            if (wantsNewPassword) {
                emailResult = await sendCredentialsEmail(req, { name: updated.name, email: newEmail, loginId: newLoginId, password, role: updated.role, isReset: true });
            } else {
                // We never store plain passwords, so without a new password we
                // can only tell them their (new) Login ID.
                emailResult = await sendCredentialsEmail(req, { name: updated.name, email: newEmail, loginId: newLoginId, password: '(unchanged — use your existing password)', role: updated.role, isReset: true });
            }
        }

        const { password: _pw, ...safeStaff } = updated;
        const baseMsg = wantsNewPassword ? 'Staff account updated and password changed' : 'Staff account updated';
        res.json({
            success: true,
            data: safeStaff,
            emailSent: emailResult ? !!emailResult.sent : undefined,
            message: emailResult
                ? (emailResult.sent ? `${baseMsg}. Login details emailed to ${newEmail}` : `${baseMsg}, but the email could not be sent${emailResult.reason ? ` (${emailResult.reason})` : ''}`)
                : baseMsg
        });
    } catch (error) {
        logger.error(`Update staff error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to update staff account' });
    }
});

// ============================================================
// Deactivate / reactivate a staff account (soft — never hard-delete a
// staff account, so past audit log entries still resolve to a name).
// ============================================================
router.put('/:id/toggle-active', requirePermission('staff:deactivate'), (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.findById('users', id);
        if (!existing || !STAFF_ROLES.includes(existing.role)) {
            return res.status(404).json({ success: false, message: 'Staff account not found' });
        }
        if (id === req.user.id) {
            return res.status(400).json({ success: false, message: "You can't deactivate your own account." });
        }
        const actingRole = req.userData.role;
        if (!canAssignRole(actingRole, existing.role)) {
            return res.status(403).json({
                success: false,
                message: `Your role (${actingRole}) can't manage a ${existing.role} account.`
            });
        }

        // Guard rail: never leave the institute with zero active super
        // admins able to log in.
        if (existing.role === 'super_admin' && existing.isActive !== false) {
            const activeSuperAdmins = db.find('users', { role: 'super_admin' }).filter(u => u.isActive !== false);
            if (activeSuperAdmins.length <= 1) {
                return res.status(400).json({ success: false, message: 'Cannot deactivate the last active super admin.' });
            }
        }

        const newStatus = existing.isActive === false ? true : false;
        const updated = db.findByIdAndUpdate('users', id, { isActive: newStatus });

        logAudit(req, 'edit', 'staff', id, `${newStatus ? 'Reactivated' : 'Deactivated'} staff account for ${existing.name}`);

        const { password: _pw, ...safeStaff } = updated;
        res.json({ success: true, data: safeStaff, message: `Staff account ${newStatus ? 'reactivated' : 'deactivated'}` });
    } catch (error) {
        logger.error(`Toggle staff active error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to update staff account status' });
    }
});

module.exports = router;
