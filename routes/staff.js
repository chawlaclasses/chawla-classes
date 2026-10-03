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
const { appDownloadUrl, sendCredentialsSms } = require('../utils/credentialMessages');
const { parseOptionalEmail, parseOptionalText, parseOptionalPhone, parseOptionalDate } = require('../utils/profileFields');
const { uploadProfilePhoto, profilePhotoMimeGuard, handleUpload } = require('../middleware/upload');
const r2Service = require('../services/r2Service');

// ------------------------------------------------------------
// Login ID helpers
// A staff member now has TWO separate identifiers:
//   loginId -> custom username the admin chooses; used to sign in.
//   email   -> where the credentials (and later notifications) are sent.
// ------------------------------------------------------------
// 3-50 chars; letters, numbers and . _ - @ + (so email-style IDs also work); no spaces.
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._@+-]{2,49}$/;
const LOGIN_ID_MSG = 'Login ID must be 3-50 characters using letters, numbers and . _ - @ + only (no spaces)';

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


// Optional profile fields shared by create + edit. Every one is optional; a
// blank value clears the field. Returns { update } or { error }.
function parseStaffProfileFields(body) {
    const update = {};
    for (const [key, label, max] of [
        ['designation', 'Designation', 100], ['qualification', 'Qualification', 200],
        ['address', 'Address', 500], ['notes', 'Notes', 2000],
    ]) {
        const t = parseOptionalText(body[key], label, max);
        if (t.error) return { error: t.error };
        if (t.provided) update[key] = t.value;
    }
    const phone = parseOptionalPhone(body.phone, 'Mobile number');
    if (phone.error) return { error: phone.error };
    if (phone.provided) update.phone = phone.value;
    const jd = parseOptionalDate(body.joiningDate, 'Joining date');
    if (jd.error) return { error: jd.error };
    if (jd.provided) update.joiningDate = jd.value;
    return { update };
}

function stripSensitive(u) {
    const { password, refreshToken, photoKey, ...rest } = u;
    return { ...rest, hasPhoto: !!photoKey };
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
            <p style="margin-top:8px;">Get the app: <a href="${escapeHtmlServer(appDownloadUrl(req))}" style="color:#4f6ef7;font-weight:bold;">Download the Chawla Classes app</a></p>
            <p style="color:#888;font-size:12px;">Please keep these details private. Sign in with your Login ID (not your email address).</p>
        </div>`;
    try {
        return await sendMail({ to: email, subject, html });
    } catch (err) {
        logger.error(`Staff credentials email failed for ${email}: ${err.message}`);
        return { sent: false, reason: err.message };
    }
}

// Sends the same details as a text message (SMS) to the staff member's phone.
async function sendStaffSms(req, { name, loginId, password, phone, isUpdate }) {
    try {
        return await sendCredentialsSms({
            name, loginId, password, isUpdate,
            loginLink: `${req.protocol}://${req.get('host')}/admin/login.html`,
            appLink: appDownloadUrl(req),
        }, phone);
    } catch (err) {
        logger.error(`Staff credentials SMS failed: ${err.message}`);
        return { sent: false, reason: err.message };
    }
}

// ============================================================
// List staff accounts
// ============================================================
router.get('/', requirePermission('staff:view'), (req, res) => {
    try {
        const staff = db.find('users', {}).filter(u => STAFF_ROLES.includes(u.role));
        const safe = staff.map(stripSensitive);
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
        const { name, email, loginId: rawLoginId, password, role, assignedClasses, assignedSubjects, sendEmail, sendSms } = req.body;

        if (!name || typeof name !== 'string' || !name.trim() || !rawLoginId || !password || !role) {
            return res.status(400).json({ success: false, message: 'Name, login ID, password and role are required' });
        }
        // Email is OPTIONAL: blank is fine, non-blank must be well-formed + unique.
        const emailP = parseOptionalEmail(email);
        if (emailP.error) return res.status(400).json({ success: false, message: emailP.error });
        const normalizedEmail = emailP.value || '';
        const loginId = normalizeLoginId(rawLoginId);
        if (!LOGIN_ID_RE.test(loginId)) {
            return res.status(400).json({ success: false, message: LOGIN_ID_MSG });
        }
        if (!STAFF_ROLES.includes(role)) {
            return res.status(400).json({ success: false, message: `Role must be one of: ${STAFF_ROLES.join(', ')}` });
        }
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        }
        const profile = parseStaffProfileFields(req.body);
        if (profile.error) return res.status(400).json({ success: false, message: profile.error });
        const phone = profile.update.phone || '';

        const actingRole = req.userData.role;
        if (!canAssignRole(actingRole, role)) {
            return res.status(403).json({
                success: false,
                message: `Your role (${actingRole}) isn't allowed to create a ${role} account. Only a super admin can do that.`
            });
        }

        // Duplicate-email check runs ONLY when an email was actually entered.
        if (normalizedEmail && db.findOne('users', { email: normalizedEmail })) {
            return res.status(409).json({ success: false, message: 'A user with this email already exists' });
        }
        if (loginIdTaken(loginId, null)) {
            return res.status(409).json({ success: false, message: 'This Login ID is already taken. Please choose another.' });
        }

        // BCRYPT_ROUNDS is centralised in config (see services/auth.js).
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const newStaff = db.insertOne('users', {
            name: name.trim(),
            loginId,
            email: normalizedEmail,
            password: hashedPassword,
            role,
            ...profile.update,
            phone,
            // Empty array/omitted = unrestricted (sees every class). Only
            // meaningful for 'teacher' today.
            assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : [],
            assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [],
            isActive: true,
            createdBy: req.user?.id || null,
        });

        logAudit(req, 'create', 'staff', newStaff._id, `Added ${role} account for ${name.trim()} (login: ${loginId}, email: ${normalizedEmail || 'none'})`);

        // Credentials go to the email address (sendEmail defaults to true).
        let emailResult = { sent: false, reason: 'Email not requested' };
        const emailRequested = sendEmail !== false && !!normalizedEmail;
        if (emailRequested) {
            emailResult = await sendCredentialsEmail(req, { name, email: normalizedEmail, loginId, password, role, isReset: false });
        }

        let smsResult = null;
        if (sendSms === true) {
            smsResult = await sendStaffSms(req, { name, loginId, password, phone, isUpdate: false });
        }

        const safeStaff = stripSensitive(newStaff);
        const parts = ['Staff account created.'];
        if (sendEmail !== false && !normalizedEmail) parts.push('No email entered, so login details were not emailed — please share the Login ID and password manually.');
        if (emailRequested) parts.push(emailResult.sent ? `Login details emailed to ${normalizedEmail}.` : `Email could not be sent${emailResult.reason ? ` (${emailResult.reason})` : ''}.`);
        if (smsResult) parts.push(smsResult.sent ? 'Text message sent.' : `Text message not sent${smsResult.reason ? ` (${smsResult.reason})` : ''}.`);
        const anyFailed = (emailRequested && !emailResult.sent) || (smsResult && !smsResult.sent);
        if (anyFailed) parts.push('Please share the Login ID and password manually where needed.');
        res.status(201).json({
            success: true,
            data: safeStaff,
            emailSent: emailRequested ? !!emailResult.sent : undefined,
            smsSent: smsResult ? !!smsResult.sent : undefined,
            message: parts.join(' ')
        });
    } catch (error) {
        logger.error(`Create staff error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to create staff account' });
    }
});

// ============================================================
// Update a staff account. PUT and PATCH are both partial updates: any field
// left out of the body is untouched.
//
//   name         — required whenever sent (cannot be blanked)
//   role         — required-ness unchanged; must be a valid staff role
//   isActive     — Status (Active / Inactive), same guard rails as toggle-active
//   email        — OPTIONAL. Blank clears it (valid). Non-blank must be
//                  well-formed and unique; duplicate checking is skipped for blank.
//   phone, designation, qualification, address, joiningDate, notes
//                — optional; blank clears them
// ============================================================
async function updateStaffHandler(req, res) {
    try {
        const { id } = req.params;
        const { role, isActive, assignedClasses, assignedSubjects, password, loginId: rawLoginId, email: rawEmail, sendEmail, sendSms } = req.body;

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
        if (role !== undefined && !STAFF_ROLES.includes(role)) {
            return res.status(400).json({ success: false, message: `Role must be one of: ${STAFF_ROLES.join(', ')}` });
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

        // ── Plain profile fields ───────────────────────────────────────
        const profile = parseStaffProfileFields(req.body);
        if (profile.error) return res.status(400).json({ success: false, message: profile.error });
        const nameP = parseOptionalText(req.body.name, 'Name', 100);
        if (nameP.error) return res.status(400).json({ success: false, message: nameP.error });
        if (nameP.provided && !nameP.value) return res.status(400).json({ success: false, message: 'Name is required' });
        const fieldUpdate = { ...profile.update };
        if (nameP.provided) fieldUpdate.name = nameP.value;
        // Mobile number is a required field: once set it can't be blanked (older accounts without one still save).
        if (fieldUpdate.phone === '' && existing.phone) return res.status(400).json({ success: false, message: 'Mobile number is required' });

        // ── Status (Active / Inactive) ─────────────────────────────────
        if (isActive !== undefined) {
            if (typeof isActive !== 'boolean') return res.status(400).json({ success: false, message: 'Status must be Active or Inactive' });
            const wasActive = existing.isActive !== false;
            if (wasActive && !isActive) {
                if (id === req.user.id) return res.status(400).json({ success: false, message: "You can't deactivate your own account." });
                if (existing.role === 'super_admin') {
                    const activeSuperAdmins = db.find('users', { role: 'super_admin' }).filter(u => u.isActive !== false);
                    if (activeSuperAdmins.length <= 1) return res.status(400).json({ success: false, message: 'Cannot deactivate the last active super admin.' });
                }
            }
            fieldUpdate.isActive = isActive;
        }

        // ── Login ID / email change (kept separate from each other) ────
        const identityChange = {};
        let newLoginId = existing.loginId || '';
        let newEmail = existing.email || '';
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
        const emailP = parseOptionalEmail(rawEmail);
        if (emailP.error) return res.status(400).json({ success: false, message: emailP.error });
        if (emailP.provided && emailP.value !== (existing.email || '')) {
            if (emailP.value !== '') {
                // Duplicate check ONLY for a non-blank email.
                const clash = db.findOne('users', { email: emailP.value });
                if (clash && clash._id !== id) {
                    return res.status(409).json({ success: false, message: 'A user with this email already exists' });
                }
            } else if (!newLoginId) {
                // Old account that signs in with its email — clearing it would lock the person out.
                return res.status(400).json({ success: false, message: 'This account signs in with its email. Set a Login ID first, then the email can be removed.' });
            }
            identityChange.email = emailP.value;
            newEmail = emailP.value;
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
            ...fieldUpdate,
            role: role || existing.role,
            assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : (existing.assignedClasses || []),
            assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : (existing.assignedSubjects || []),
            ...identityChange,
            ...passwordChange,
        });

        logAudit(req, 'edit', 'staff', id, `Updated staff account for ${updated.name}${wantsNewPassword ? ' (password reset)' : ''}${identityChange.loginId ? ' (login ID changed)' : ''}${identityChange.email !== undefined ? (identityChange.email ? ' (email changed)' : ' (email removed)') : ''}${fieldUpdate.isActive !== undefined && fieldUpdate.isActive !== (existing.isActive !== false) ? (fieldUpdate.isActive ? ' (activated)' : ' (deactivated)') : ''}`);

        // Re-send login details only when asked (checkbox in the UI). Needs an email address.
        let emailResult = null;
        let emailSkipped = false;
        if (sendEmail === true && newLoginId) {
            if (!newEmail) {
                emailSkipped = true;
            } else if (wantsNewPassword) {
                emailResult = await sendCredentialsEmail(req, { name: updated.name, email: newEmail, loginId: newLoginId, password, role: updated.role, isReset: true });
            } else {
                // We never store plain passwords, so without a new password we
                // can only tell them their (new) Login ID.
                emailResult = await sendCredentialsEmail(req, { name: updated.name, email: newEmail, loginId: newLoginId, password: '(unchanged — use your existing password)', role: updated.role, isReset: true });
            }
        }

        let smsResult = null;
        if (sendSms === true && newLoginId) {
            smsResult = await sendStaffSms(req, { name: updated.name, loginId: newLoginId, password: wantsNewPassword ? password : '', phone: updated.phone, isUpdate: true });
        }

        const safeStaff = stripSensitive(updated);
        const baseMsg = wantsNewPassword ? 'Staff account updated and password changed' : 'Staff account updated';
        const parts = [baseMsg + '.'];
        if (emailSkipped) parts.push('No email on file, so login details were not emailed.');
        if (emailResult) parts.push(emailResult.sent ? `Login details emailed to ${newEmail}.` : `Email could not be sent${emailResult.reason ? ` (${emailResult.reason})` : ''}.`);
        if (smsResult) parts.push(smsResult.sent ? 'Text message sent.' : `Text message not sent${smsResult.reason ? ` (${smsResult.reason})` : ''}.`);
        res.json({
            success: true,
            data: safeStaff,
            emailSent: emailResult ? !!emailResult.sent : undefined,
            smsSent: smsResult ? !!smsResult.sent : undefined,
            message: parts.join(' ')
        });
    } catch (error) {
        logger.error(`Update staff error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to update staff account' });
    }
}
router.put('/:id', requirePermission('staff:edit'), updateStaffHandler);
router.patch('/:id', requirePermission('staff:edit'), updateStaffHandler);

// ============================================================
// Profile photo (private, R2 profile-photos/, streamed through this route).
// ============================================================
function loadManageableStaff(req, res) {
    const existing = db.findById('users', req.params.id);
    if (!existing || !STAFF_ROLES.includes(existing.role)) {
        res.status(404).json({ success: false, message: 'Staff account not found' });
        return null;
    }
    return existing;
}

router.post('/:id/photo', requirePermission('staff:edit'), handleUpload(uploadProfilePhoto.single('photo')), profilePhotoMimeGuard, async (req, res) => {
    try {
        const existing = loadManageableStaff(req, res);
        const cleanup = () => (req.file?.r2Key ? r2Service.deleteObject(req.file.r2Key).catch(() => {}) : null);
        if (!existing) { await cleanup(); return; }
        if (!canAssignRole(req.userData.role, existing.role)) {
            await cleanup();
            return res.status(403).json({ success: false, message: `Your role (${req.userData.role}) can't manage a ${existing.role} account.` });
        }
        if (!req.file?.r2Key) return res.status(400).json({ success: false, message: 'No photo uploaded' });
        const oldKey = existing.photoKey;
        db.findByIdAndUpdate('users', existing._id, { photoKey: req.file.r2Key, photoUpdatedAt: new Date().toISOString() });
        if (oldKey) await r2Service.deleteObject(oldKey).catch(() => {});
        logAudit(req, 'edit', 'staff', existing._id, `Updated profile photo for ${existing.name}`);
        res.json({ success: true, message: 'Profile photo updated' });
    } catch (error) {
        if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key).catch(() => {});
        logger.error(`Staff photo upload error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to upload photo' });
    }
});

router.get('/:id/photo', requirePermission('staff:view'), async (req, res) => {
    try {
        const existing = loadManageableStaff(req, res);
        if (!existing) return;
        if (!existing.photoKey) return res.status(404).json({ success: false, message: 'No photo' });
        res.setHeader('Cache-Control', 'private, max-age=300');
        return r2Service.streamToResponse(existing.photoKey, res, { downloadName: 'photo', inline: true });
    } catch (error) {
        logger.error(`Staff photo read error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to load photo' });
    }
});

router.delete('/:id/photo', requirePermission('staff:edit'), async (req, res) => {
    try {
        const existing = loadManageableStaff(req, res);
        if (!existing) return;
        if (!canAssignRole(req.userData.role, existing.role)) {
            return res.status(403).json({ success: false, message: `Your role (${req.userData.role}) can't manage a ${existing.role} account.` });
        }
        if (existing.photoKey) await r2Service.deleteObject(existing.photoKey).catch(() => {});
        db.findByIdAndUpdate('users', existing._id, { photoKey: null, photoUpdatedAt: null });
        logAudit(req, 'edit', 'staff', existing._id, `Removed profile photo for ${existing.name}`);
        res.json({ success: true, message: 'Profile photo removed' });
    } catch (error) {
        logger.error(`Staff photo delete error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to remove photo' });
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

        const safeStaff = stripSensitive(updated);
        res.json({ success: true, data: safeStaff, message: `Staff account ${newStatus ? 'reactivated' : 'deactivated'}` });
    } catch (error) {
        logger.error(`Toggle staff active error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to update staff account status' });
    }
});

module.exports = router;
