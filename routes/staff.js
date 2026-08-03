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
        const { name, email, password, role, phone, assignedClasses, assignedSubjects } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ success: false, message: 'Name, email, password and role are required' });
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

        const existing = db.findOne('users', { email: email.toLowerCase().trim() });
        if (existing) {
            return res.status(409).json({ success: false, message: 'A user with this email already exists' });
        }

        // SECURITY: was a hardcoded bcrypt.hash(password, 10) — the rest of
        // the app (services/auth.js) already centralizes this as
        // BCRYPT_ROUNDS (default 12, env-overridable), specifically so cost
        // can be tuned in one place. This was the one place still hardcoding
        // its own weaker value.
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const newStaff = db.insertOne('users', {
            name,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role,
            phone: phone || '',
            // Empty array/omitted = unrestricted (sees every class). Only
            // meaningful for 'teacher' today; other roles ignore it since
            // their permissions already aren't class-scoped.
            assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : [],
            assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : [],
            isActive: true,
            createdBy: req.user?.id || null,
        });

        logAudit(req, 'create', 'staff', newStaff._id, `Added ${role} account for ${name} (${email})`);

        const { password: _pw, ...safeStaff } = newStaff;
        res.status(201).json({ success: true, data: safeStaff, message: 'Staff account created' });
    } catch (error) {
        logger.error(`Create staff error: ${error.message}`, { stack: error.stack, path: req.path });
        res.status(500).json({ success: false, message: 'Failed to create staff account' });
    }
});

// ============================================================
// Update a staff account (name, phone, role, isActive)
// ============================================================
router.put('/:id', requirePermission('staff:edit'), (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, role, isActive, assignedClasses, assignedSubjects } = req.body;

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

        const updated = db.findByIdAndUpdate('users', id, {
            name: name || existing.name,
            phone: phone !== undefined ? phone : existing.phone,
            role: role || existing.role,
            isActive: isActive !== undefined ? isActive : existing.isActive,
            assignedClasses: Array.isArray(assignedClasses) ? assignedClasses : (existing.assignedClasses || []),
            assignedSubjects: Array.isArray(assignedSubjects) ? assignedSubjects : (existing.assignedSubjects || []),
        });

        logAudit(req, 'edit', 'staff', id, `Updated staff account for ${updated.name}`);

        const { password: _pw, ...safeStaff } = updated;
        res.json({ success: true, data: safeStaff, message: 'Staff account updated' });
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