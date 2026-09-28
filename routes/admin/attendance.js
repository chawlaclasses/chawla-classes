// routes/admin/attendance.js
//
// Attendance — admin marks daily attendance per class. Records are kept
// in the 'attendance' jsonDb collection — NOT via services/attendance.js,
// which writes straight to disk through services/storage.js and would go
// stale against jsonDb's in-memory cache until a server restart. Fields
// (email, class, status, date as M/D/YYYY) match what dashboard-overview
// and the student 360° profile already read. Extracted out of
// routes/adminRoutes.js (refactor, 2026-07). Mounted at '/attendance' by
// routes/adminRoutes.js, so the final URLs (/api/admin/attendance,
// /api/admin/attendance/mark) are unchanged.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { isClassAllowedForUser } = require('../../config/permissions');

// Get a class's student list with today's (or a given date's) attendance
// status pre-filled, so the marking UI can show who's already marked.
router.get('/', requirePermission('attendance:view'), (req, res) => {
    try {
        const { classId, date } = req.query;
        if (!classId) {
            return res.status(400).json({ success: false, message: 'classId is required' });
        }
        if (!isClassAllowedForUser(req.userData, classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class." });
        }
        const cls = db.findById('classes', classId);
        if (!cls) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }

        const targetDate = date || new Date().toLocaleDateString('en-US');
        const students = db.find('users', { role: 'student', classId }).filter(s => s.isActive !== false);
        const attendanceRecords = db.find('attendance', { date: targetDate });

        const roster = students.map(s => {
            const record = attendanceRecords.find(a => a.email === s.email);
            return {
                studentId: s._id,
                name: s.name,
                email: s.email,
                rollNumber: s.rollNumber || '',
                status: record ? record.status : null
            };
        });

        res.json({
            success: true,
            data: {
                classId,
                className: cls.displayName || cls.name,
                date: targetDate,
                students: roster
            }
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Bulk-mark attendance for a class on a given date. Upserts one record
// per student (matched by email + date), same shape the rest of the app
// already reads.
router.post('/mark', requirePermission('attendance:create'), (req, res) => {
    try {
        const { classId, date, records } = req.body;
        if (!classId || !Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, message: 'classId and records[] are required' });
        }
        if (!isClassAllowedForUser(req.userData, classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class." });
        }
        const cls = db.findById('classes', classId);
        if (!cls) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }

        const targetDate = date || new Date().toLocaleDateString('en-US');
        const className = cls.displayName || cls.name;
        let marked = 0;
        let presentCount = 0;

        for (const rec of records) {
            const { studentId, status } = rec;
            if (!studentId || !['Present', 'Absent'].includes(status)) continue;

            const student = db.findById('users', studentId);
            if (!student || student.role !== 'student') continue;

            const existing = db.findOne('attendance', { email: student.email, date: targetDate });
            if (existing) {
                db.findByIdAndUpdate('attendance', existing._id, { name: student.name, class: className, status });
            } else {
                db.insertOne('attendance', {
                    studentId: student._id,
                    name: student.name,
                    email: student.email,
                    class: className,
                    status,
                    date: targetDate
                });
            }
            marked++;
            if (status === 'Present') presentCount++;
        }

        logAudit(req, 'create', 'attendance', classId, `Marked attendance for ${className} on ${targetDate}: ${presentCount}/${marked} present`);

        res.json({
            success: true,
            data: { marked, present: presentCount, date: targetDate },
            message: `Attendance marked for ${marked} student(s)`
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;