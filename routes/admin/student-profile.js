// routes/admin/student-profile.js
//
// Student 360° Profile — the full single-student deep-dive view (personal
// + parent details, fees history, attendance %, test results, class rank,
// weak subjects, private admin notes, documents, unified activity
// timeline), profile editing, and document upload/download/delete.
// Distinct from routes/admin/students.js (the lightweight list used for
// dropdowns). Extracted out of routes/adminRoutes.js (refactor, 2026-07).
// Mounted at '/' by routes/adminRoutes.js, so the final URLs
// (/api/admin/reports/student/:studentId, /api/admin/students/:id/profile,
// etc.) are unchanged.

const express = require('express');
const router = express.Router();
const path = require('path');

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { uploadStudentDocument, studentDocumentMimeGuard, STUDENT_DOCS_DIR } = require('../../middleware/upload');
const r2Service = require('../../services/r2Service');
const studentReportService = require('../../services/studentReport');
const { sendPdf, sendCsv } = require('../../utils/reportGenerator');
const { buildStudentTimeline } = require('../../utils/studentTimeline');
const { isClassAllowedForUser } = require('../../config/permissions');

// Downloadable Student Report (PDF/CSV) — the consolidated report card
// (attendance + results + fees + homework + engagement) for
// printing/sharing. See the profile endpoint below for the inline
// 360° profile view used by the admin UI itself.
router.get('/reports/student/:studentId', requirePermission('students:view'), async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        const { studentId } = req.params;

        const studentForScope = db.findById('users', studentId);
        if (!studentForScope || studentForScope.role !== 'student') {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (!isClassAllowedForUser(req.userData, studentForScope.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }

        if (format === 'pdf') {
            const buffer = await studentReportService.toPdfBuffer(studentId);
            return sendPdf(res, buffer, `student-report-${studentId}.pdf`);
        }
        if (format === 'csv' || format === 'excel') {
            const csv = await studentReportService.toCsv(studentId);
            return sendCsv(res, csv, `student-report-${studentId}.csv`);
        }

        const data = await studentReportService.getReportData(studentId);
        res.json({ success: true, data });
    } catch (error) {
        logger.error(`Report generation failed: ${error.message}`, { stack: error.stack });
        res.status(error.status || 500).json({
            success: false,
            // error.status being set means this is a controlled/expected error
            // from studentReportService (e.g. "Invalid format") whose message
            // is meant to be shown; an unset status means a genuine
            // unexpected failure, so don't leak its raw message.
            message: error.status ? error.message : 'Something went wrong. Please try again.'
        });
    }
});

// Full profile aggregation: personal + parent details, fees history,
// attendance %, test results, class rank, weak subjects, notes,
// documents, and a unified activity log — all from real data.
router.get('/students/:id/profile', requirePermission('students:view'), async (req, res) => {
    try {
        const student = db.findById('users', req.params.id);
        if (!student || student.role !== 'student') {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (!isClassAllowedForUser(req.userData, student.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }

        const classData = student.classId ? db.findById('classes', student.classId) : null;

        // Fees history
        const feesHistory = db.find('fees-v2', { studentId: student._id })
            .slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Attendance (legacy schema, keyed by email)
        const attendanceRecords = db.find('attendance', { email: student.email });
        const presentCount = attendanceRecords.filter(a => (a.status || '').toLowerCase() === 'present').length;
        const attendance = {
            percentage: attendanceRecords.length > 0 ? Math.round((presentCount / attendanceRecords.length) * 100) : null,
            totalDays: attendanceRecords.length,
            presentDays: presentCount,
            records: attendanceRecords.slice(-30).sort((a, b) => new Date(b.date) - new Date(a.date))
        };

        // Test results (current system only — see other endpoints for why
        // legacy email/score rows are excluded)
        const results = db.find('results', { studentId: student._id }).filter(r => r.testId);
        const testResults = results
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(r => {
                const test = db.findById('tests', r.testId);
                return {
                    testTitle: test ? test.title : 'Unknown Test',
                    percentage: r.percentage || 0,
                    isPassed: r.isPassed || false,
                    date: r.createdAt
                };
            });
        const averagePercentage = results.length > 0
            ? Math.round(results.reduce((s, r) => s + (r.percentage || 0), 0) / results.length)
            : null;

        // Class rank — by average test percentage among classmates who have
        // at least one result (distinct from gamification XP rank, which
        // measures engagement, not test performance)
        let rank = null;
        let classSize = null;
        if (student.classId && averagePercentage !== null) {
            const classmates = db.find('users', { role: 'student', classId: student.classId });
            const withAverages = classmates.map(c => {
                const cResults = db.find('results', { studentId: c._id }).filter(r => r.testId);
                if (cResults.length === 0) return null;
                return { id: c._id, avg: cResults.reduce((s, r) => s + (r.percentage || 0), 0) / cResults.length };
            }).filter(Boolean).sort((a, b) => b.avg - a.avg);
            classSize = withAverages.length;
            rank = withAverages.findIndex(c => c.id === student._id) + 1;
            if (rank === 0) rank = null;
        }

        // Weak subjects — average % per subject, lowest first
        const bySubject = {};
        results.forEach(r => {
            const test = db.findById('tests', r.testId);
            if (!test) return;
            const subject = db.findById('subjects', test.subjectId);
            const name = subject ? subject.name : 'Unknown';
            if (!bySubject[name]) bySubject[name] = [];
            bySubject[name].push(r.percentage || 0);
        });
        const weakSubjects = Object.entries(bySubject)
            .map(([subject, percentages]) => ({
                subject,
                averageScore: Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
            }))
            .filter(s => s.averageScore < 60)
            .sort((a, b) => a.averageScore - b.averageScore);

        // Notes (private admin remarks about this student)
        const notes = db.find('student-notes', { studentId: student._id })
            .slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Documents (metadata only — file itself is served through the
        // authenticated download route below, never a public static path)
        const documents = db.find('student-documents', { studentId: student._id })
            .slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(d => ({ _id: d._id, name: d.name, originalName: d.originalName, createdAt: d.createdAt }));

        // Full chronological timeline — admission, attendance, fees,
        // tests, results, notifications (certificates: see
        // utils/studentTimeline.js header note — no real data source yet).
        const timeline = buildStudentTimeline(student);

        res.json({
            success: true,
            data: {
                personalDetails: {
                    _id: student._id,
                    name: student.name,
                    email: student.email,
                    phone: student.phone || '',
                    dob: student.dob || '',
                    rollNumber: student.rollNumber || '',
                    address: student.address || '',
                    class: classData ? (classData.displayName || classData.name) : 'Not assigned',
                    batch: student.batch || '',
                    isActive: student.isActive !== false,
                    joinedDate: student.createdAt
                },
                parentDetails: {
                    parentName: student.parentName || '',
                    parentPhone: student.parentPhone || '',
                    parentEmail: student.parentEmail || '',
                    parentOccupation: student.parentOccupation || ''
                },
                feesHistory,
                attendance,
                testResults,
                averagePercentage,
                rank,
                classSize,
                weakSubjects,
                notes,
                documents,
                timeline
            }
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Update personal + parent details
router.put('/students/:id/profile', requirePermission('students:edit'), validators.updateStudentProfile, validate, (req, res) => {
    try {
        const student = db.findById('users', req.params.id);
        if (!student || student.role !== 'student') {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (!isClassAllowedForUser(req.userData, student.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }
        const { phone, dob, rollNumber, address, parentName, parentPhone, parentEmail, parentOccupation, batch } = req.body;
        const updated = db.updateById('users', req.params.id, {
            ...(phone !== undefined ? { phone } : {}),
            ...(dob !== undefined ? { dob } : {}),
            ...(rollNumber !== undefined ? { rollNumber } : {}),
            ...(address !== undefined ? { address } : {}),
            ...(parentName !== undefined ? { parentName } : {}),
            ...(parentPhone !== undefined ? { parentPhone } : {}),
            ...(parentEmail !== undefined ? { parentEmail } : {}),
            ...(parentOccupation !== undefined ? { parentOccupation } : {}),
            ...(batch !== undefined ? { batch } : {})
        });
        logAudit(req, 'edit', 'student', req.params.id, `Updated profile for ${student.name}`);
        res.json({ success: true, data: { ...updated, password: undefined }, message: 'Profile updated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Add a private admin note about a student
router.post('/students/:id/notes', requirePermission('students:notes'), (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ success: false, message: 'Note text is required' });
        }
        const student = db.findById('users', req.params.id);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (!isClassAllowedForUser(req.userData, student.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }
        const saved = db.insertOne('student-notes', {
            studentId: req.params.id,
            note: note.trim(),
            createdBy: req.user?.id || 'admin'
        });
        logAudit(req, 'create', 'student', req.params.id, `Added note for ${student.name}`);
        res.json({ success: true, data: saved, message: 'Note added' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Upload a document for a student (ID proof, certificate, etc.)
router.post('/students/:id/documents', requirePermission('students:edit'), uploadStudentDocument.single('document'), studentDocumentMimeGuard, async (req, res) => {
    try {
        const student = db.findById('users', req.params.id);
        if (!student) {
            if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (!isClassAllowedForUser(req.userData, student.classId)) {
            if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const saved = db.insertOne('student-documents', {
            studentId: req.params.id,
            name: req.body.name || req.file.originalname,
            originalName: req.file.originalname,
            key: req.file.r2Key,
            filename: req.file.filename, // display-only, derived from the R2 key
            uploadedBy: req.user?.id || 'admin',
            uploadedAt: new Date().toISOString()
        });
        logAudit(req, 'create', 'student', req.params.id, `Uploaded document "${saved.name}" for ${student.name}`);
        res.json({ success: true, data: saved, message: 'Document uploaded' });
    } catch (error) {
        if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key);
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Download a student's document — the ONLY way to read the file back;
// it is never reachable via a public static path. Streamed straight from
// R2 through this authenticated route, so R2's bucket never needs to be
// public. Falls back to local disk only for a PRE-MIGRATION record that
// has no `key` yet (see migration guidance).
router.get('/students/:id/documents/:docId/download', requirePermission('students:view'), async (req, res) => {
    try {
        const doc = db.findById('student-documents', req.params.docId);
        if (!doc || doc.studentId !== req.params.id) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        const docStudent = db.findById('users', req.params.id);
        if (docStudent && !isClassAllowedForUser(req.userData, docStudent.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }
        if (doc.key) {
            return r2Service.streamToResponse(doc.key, res, { downloadName: doc.originalName });
        }
        // Legacy record (uploaded before the R2 migration) — no key on file.
        const filePath = path.join(STUDENT_DOCS_DIR, doc.filename);
        res.download(filePath, doc.originalName);
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Delete a student's document
router.delete('/students/:id/documents/:docId', requirePermission('students:edit'), async (req, res) => {
    try {
        const doc = db.findById('student-documents', req.params.docId);
        if (!doc || doc.studentId !== req.params.id) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        const docStudent = db.findById('users', req.params.id);
        if (docStudent && !isClassAllowedForUser(req.userData, docStudent.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }
        if (doc.key) {
            await r2Service.deleteObject(doc.key);
        } else {
            // Legacy local file (pre-migration record)
            const fs = require('fs');
            try { fs.unlinkSync(path.join(STUDENT_DOCS_DIR, doc.filename)); } catch (_) {}
        }
        db.deleteById('student-documents', req.params.docId);
        logAudit(req, 'delete', 'student', req.params.id, `Deleted document "${doc.name}"`);
        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;