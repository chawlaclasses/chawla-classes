// routes/admin/students.js
//
// Lightweight student list + bulk actions + CSV export — used for things
// like dropdowns in the Add Fee modal. The full Student 360° Profile
// module (single-student deep-dive view) is a separate file
// (routes/admin/student-profile.js). Extracted out of routes/adminRoutes.js
// (refactor, 2026-07). Mounted at '/' by routes/adminRoutes.js at the
// point where these routes used to live, so the final URLs
// (/api/admin/students-list, /api/admin/students/bulk,
// /api/admin/students/export) are unchanged.
//
// Reorganization note: in the original file, session management,
// change-password, login-history, and audit-logs were all crammed into
// this same "STUDENTS" banner even though none of them are actually about
// students — those moved to routes/admin/system.js instead.

const express = require('express');
const router = express.Router();

const bcrypt = require('bcryptjs');
const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { normalizeEmail } = require('../../utils/helpers');
const { isClassAllowedForUser } = require('../../config/permissions');

// Create a new student — this was previously only possible via
// scripts/create-student.js (a CLI script, run once for the demo
// account). Same shape/conventions as that script: bcrypt(10) hashed
// password, role:'student', isActive:true. Mirrors the field set the
// list/export routes below already expect (name, email, phone,
// rollNumber, classId, batch), so a student created here shows up
// correctly everywhere else in the admin panel immediately.
router.post('/students', requirePermission('students:create'), async (req, res) => {
    try {
        const { name, email, password, phone, rollNumber, classId, batch } = req.body;

        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
        if (!email || !email.trim()) return res.status(400).json({ success: false, message: 'Email is required' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ success: false, message: 'Enter a valid email address' });
        if (!password || password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

        const normalizedEmail = normalizeEmail(email);
        const existing = db.findOne('users', { email: normalizedEmail });
        if (existing) return res.status(409).json({ success: false, message: 'A user with this email already exists' });

        let cls = null;
        if (classId) {
            cls = db.findById('classes', classId);
            if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const student = db.insertOne('users', {
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            role: 'student',
            phone: phone ? phone.trim() : '',
            rollNumber: rollNumber ? rollNumber.trim() : '',
            classId: classId || null,
            batch: batch || '',
            isActive: true,
            createdBy: req.user?.id || 'admin',
        });

        logAudit(req, 'create', 'student', student._id, `Created student "${student.name}" (${student.email})${cls ? ` in ${cls.displayName || cls.name}` : ''}`);

        // Never echo the password hash back to the client.
        const { password: _omit, ...safeStudent } = student;
        res.status(201).json({ success: true, data: safeStudent, message: `Student "${student.name}" created successfully` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong while creating the student. Please try again.' });
    }
});

router.get('/students-list', requirePermission('students:view'), (req, res) => {
    try {
        // Coarse paid/due status only — no amounts, no due dates, no
        // installment detail. Full fee detail stays behind fees:view (the
        // Fees module), which teachers don't have; this is just enough for
        // a teacher to answer "is this student's fee due?" without that.
        const feeStatusByStudent = new Map();
        for (const fee of db.find('fees-v2', {})) {
            if (!fee.studentId) continue;
            const isPaid = fee.status === 'Paid';
            const current = feeStatusByStudent.get(fee.studentId);
            if (!isPaid) feeStatusByStudent.set(fee.studentId, 'due');
            else if (!current) feeStatusByStudent.set(fee.studentId, 'paid');
        }

        const students = db.find('users', { role: 'student' })
            .filter(s => isClassAllowedForUser(req.userData, s.classId))
            .map(s => {
            const cls = s.classId ? db.findById('classes', s.classId) : null;
            return {
                _id: s._id,
                name: s.name,
                email: s.email,
                phone: s.phone || '',
                rollNumber: s.rollNumber || '',
                classId: s.classId || '',
                class: cls ? (cls.displayName || cls.name) : 'Not assigned',
                batch: s.batch || '',
                isActive: s.isActive !== false,
                feeStatus: feeStatusByStudent.get(s._id) || 'no_record',
            };
        });
        res.json({ success: true, data: students });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Bulk actions on students
router.post('/students/bulk', requirePermission('students:edit'), (req, res) => {
    try {
        const { action, studentIds, classId, notificationTitle, notificationMessage } = req.body;
        if (!action || !Array.isArray(studentIds) || studentIds.length === 0) {
            return res.status(400).json({ success: false, message: 'action and studentIds[] are required' });
        }

        let affected = 0;
        if (action === 'deactivate') {
            studentIds.forEach(id => {
                if (db.updateById('users', id, { isActive: false })) affected++;
            });
            logAudit(req, 'delete', 'student', null, `Bulk-deactivated ${affected} student(s)`);
        } else if (action === 'activate') {
            studentIds.forEach(id => {
                if (db.updateById('users', id, { isActive: true })) affected++;
            });
            logAudit(req, 'edit', 'student', null, `Bulk-activated ${affected} student(s)`);
        } else if (action === 'change-class') {
            if (!classId) return res.status(400).json({ success: false, message: 'classId is required for change-class' });
            const cls = db.findById('classes', classId);
            if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
            studentIds.forEach(id => {
                if (db.updateById('users', id, { classId })) affected++;
            });
            logAudit(req, 'edit', 'student', null, `Bulk-moved ${affected} student(s) to ${cls.displayName || cls.name}`);
        } else if (action === 'notify') {
            if (!notificationMessage) return res.status(400).json({ success: false, message: 'notificationMessage is required' });
            studentIds.forEach(id => {
                db.insertOne('notifications', {
                    userId: id,
                    type: 'admin_broadcast',
                    title: notificationTitle || 'Message from Chawla Classes',
                    message: notificationMessage,
                    read: false,
                    data: null
                });
                affected++;
            });
            logAudit(req, 'edit', 'student', null, `Sent notification to ${affected} student(s)`);
        } else {
            return res.status(400).json({ success: false, message: `Unknown bulk action: ${action}` });
        }

        res.json({ success: true, data: { affected }, message: `Bulk action applied to ${affected} student(s)` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Export students as CSV
router.get('/students/export', requirePermission('students:view'), (req, res) => {
    try {
        const { ids } = req.query;
        let students = db.find('users', { role: 'student' });
        if (ids) {
            const idSet = new Set(ids.split(','));
            students = students.filter(s => idSet.has(s._id));
        }
        const rows = students.map(s => {
            const cls = s.classId ? db.findById('classes', s.classId) : null;
            return [s.name, s.email, s.phone || '', s.rollNumber || '', cls ? (cls.displayName || cls.name) : '', s.isActive !== false ? 'Active' : 'Inactive'];
        });
        const header = ['Name', 'Email', 'Phone', 'Roll Number', 'Class', 'Status'];
        const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        logAudit(req, 'export', 'student', null, `Exported ${students.length} student record(s) as CSV`);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="students-export.csv"');
        res.send(csv);
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;