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
const { resolveStudentStream, resolveStudentSubjects } = require('../../utils/streams');
const bcrypt = require('bcryptjs');
const { sendStudentCredentials, sendStudentSms } = require('../../utils/studentMail');
const { uploadStudentDocument, studentDocumentMimeGuard, uploadProfilePhoto, profilePhotoMimeGuard, handleUpload, STUDENT_DOCS_DIR } = require('../../middleware/upload');
const { EMAIL_RE, parseOptionalEmail, parseOptionalText, parseOptionalPhone, parseOptionalDate, attendanceRecordsFor, pinAttendanceToStudent } = require('../../utils/profileFields');
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
        const attendanceRecords = attendanceRecordsFor(student);
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
                    section: student.section || '',
                    notes: student.notes || '',
                    hasPhoto: !!student.photoKey,
                    photoVersion: student.photoUpdatedAt || '',
                    address: student.address || '',
                    class: classData ? (classData.displayName || classData.name) : 'Not assigned',
                    stream: student.stream || '',
                    classStreams: (classData && classData.streams) || [],
                    classId: student.classId || '',
                    subjectIds: Array.isArray(student.subjectIds) ? student.subjectIds : [],
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

// ============================================================
// Update a student (personal + parent details, class, status, optional
// email, photo-less fields). Mounted for both PUT and PATCH — it is a
// partial update either way: any field left out of the body is untouched.
//
// Rules:
//   * name           — required whenever sent (cannot be blanked)
//   * email          — OPTIONAL. Blank clears it (valid); non-blank must be a
//                      well-formed address and unique across users. Duplicate
//                      checking is skipped entirely for a blank email.
//   * phone, dob, rollNumber, section, address, parent*, batch, notes —
//                      optional free fields; blank clears them
//   * classId        — optional; changing it re-validates stream/subjects
//   * isActive       — Active / Inactive
// ============================================================
async function updateStudentHandler(req, res) {
    try {
        const student = db.findById('users', req.params.id);
        if (!student || student.role !== 'student') {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (!isClassAllowedForUser(req.userData, student.classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        }
        const body = req.body || {};
        const { stream, subjectIds, password, sendEmail, sendToParent, sendSms } = body;

        // ── Plain fields ───────────────────────────────────────────────
        const fieldUpdate = {};
        const nameP = parseOptionalText(body.name, 'Name', 100);
        if (nameP.error) return res.status(400).json({ success: false, message: nameP.error });
        if (nameP.provided) {
            if (!nameP.value) return res.status(400).json({ success: false, message: 'Name is required' });
            fieldUpdate.name = nameP.value;
        }
        for (const [key, label, max] of [
            ['rollNumber', 'Roll number', 30], ['section', 'Section', 20], ['address', 'Address', 500],
            ['parentName', 'Parent name', 100], ['parentOccupation', 'Parent occupation', 100],
            ['batch', 'Batch', 50], ['notes', 'Notes', 2000],
        ]) {
            const t = parseOptionalText(body[key], label, max);
            if (t.error) return res.status(400).json({ success: false, message: t.error });
            if (t.provided) fieldUpdate[key] = t.value;
        }
        for (const [key, label] of [['phone', 'Mobile number'], ['parentPhone', 'Parent mobile number']]) {
            const p = parseOptionalPhone(body[key], label);
            if (p.error) return res.status(400).json({ success: false, message: p.error });
            if (p.provided) fieldUpdate[key] = p.value;
        }
        // Mobile number is a required field: once a student has one it can't be blanked
        // (older records that never had one still save fine).
        if (fieldUpdate.phone === '' && student.phone) return res.status(400).json({ success: false, message: 'Mobile number is required' });
        const dobP = parseOptionalDate(body.dob, 'Date of birth');
        if (dobP.error) return res.status(400).json({ success: false, message: dobP.error });
        if (dobP.provided) fieldUpdate.dob = dobP.value;

        const parentEmailP = parseOptionalEmail(body.parentEmail);
        if (parentEmailP.error) return res.status(400).json({ success: false, message: 'Parent email must be a valid email address' });
        if (parentEmailP.provided) fieldUpdate.parentEmail = parentEmailP.value;

        if (body.isActive !== undefined) {
            if (typeof body.isActive !== 'boolean') return res.status(400).json({ success: false, message: 'Status must be Active or Inactive' });
            fieldUpdate.isActive = body.isActive;
        }

        // ── Login email (OPTIONAL) / password ──────────────────────────
        let credUpdate = {};
        const emailP = parseOptionalEmail(body.email);
        if (emailP.error) return res.status(400).json({ success: false, message: emailP.error });
        if (emailP.provided && emailP.value !== (student.email || '')) {
            if (emailP.value !== '') {
                // Duplicate check ONLY for a non-blank email.
                const clash = db.find('users', {}).some(u => u._id !== student._id && ((u.email && u.email.toLowerCase() === emailP.value) || (u.loginId && String(u.loginId).toLowerCase() === emailP.value)));
                if (clash) return res.status(409).json({ success: false, message: 'A user with this email already exists' });
            }
            credUpdate.email = emailP.value;
            // Changing/clearing the login email invalidates any open session's renewal.
            credUpdate.refreshToken = null;
        }
        const effectiveEmail = credUpdate.email !== undefined ? credUpdate.email : (student.email || '');

        const wantsNewPassword = typeof password === 'string' && password !== '';
        if (wantsNewPassword) {
            if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
            if (!effectiveEmail) return res.status(400).json({ success: false, message: 'Add an email address first — students sign in with their email, so a password needs one.' });
            credUpdate.password = await bcrypt.hash(password, 10);
            credUpdate.refreshToken = null;
        }

        // ── Class (optional change) ────────────────────────────────────
        let classUpdate = {};
        let effectiveClassId = student.classId || null;
        let effectiveCls = student.classId ? db.findById('classes', student.classId) : null;
        let classChanged = false;
        if (body.classId !== undefined) {
            const newClassId = body.classId || null;
            if (newClassId !== (student.classId || null)) {
                if (newClassId) {
                    const cls = db.findById('classes', newClassId);
                    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
                    if (!isClassAllowedForUser(req.userData, newClassId)) {
                        return res.status(403).json({ success: false, message: "You're not assigned to that class." });
                    }
                    effectiveCls = cls;
                } else {
                    // Class is a required field: an assigned student can't be un-assigned via edit.
                    return res.status(400).json({ success: false, message: 'Class is required' });
                }
                effectiveClassId = newClassId;
                classUpdate = { classId: newClassId };
                classChanged = true;
            }
        }

        // ── Stream (required only for classes that have streams) ───────
        let streamUpdate = {};
        if (stream !== undefined || classChanged) {
            // Moving classes without picking a stream: keep the current one if the new class offers it.
            const streamInput = stream !== undefined ? stream : student.stream;
            const streamCheck = resolveStudentStream(effectiveCls, streamInput);
            if (!streamCheck.ok) return res.status(400).json({ success: false, message: streamCheck.message });
            streamUpdate = { stream: streamCheck.stream };
        }

        // ── Subject enrollment (empty array = all subjects of the class) ─
        let subjectUpdate = {};
        const effectiveStream = streamUpdate.stream !== undefined ? streamUpdate.stream : (student.stream || '');
        if (subjectIds !== undefined) {
            const classSubjects = effectiveClassId ? db.find('subjects', { classId: effectiveClassId, isActive: true }) : [];
            const subjCheck = resolveStudentSubjects(classSubjects, { stream: effectiveStream }, subjectIds);
            if (!subjCheck.ok) return res.status(400).json({ success: false, message: subjCheck.message });
            subjectUpdate = { subjectIds: subjCheck.subjectIds };
        } else if ((classChanged || (streamUpdate.stream !== undefined && streamUpdate.stream !== (student.stream || ''))) && Array.isArray(student.subjectIds) && student.subjectIds.length) {
            // Class or stream changed without re-picking subjects: drop selections so a
            // stale subject from the old class/stream can't linger.
            subjectUpdate = { subjectIds: [] };
        }

        // Keep old email-keyed attendance attached to the student before the email moves.
        if (credUpdate.email !== undefined) pinAttendanceToStudent(student);

        const updated = db.updateById('users', req.params.id, {
            ...fieldUpdate,
            ...credUpdate,
            ...classUpdate,
            ...streamUpdate,
            ...subjectUpdate,
        });
        logAudit(req, 'edit', 'student', req.params.id,
            `Updated profile for ${student.name}${wantsNewPassword ? ' (password reset)' : ''}${credUpdate.email !== undefined ? (credUpdate.email ? ' (email changed)' : ' (email removed)') : ''}${classChanged ? ' (class changed)' : ''}${fieldUpdate.isActive !== undefined && fieldUpdate.isActive !== (student.isActive !== false) ? (fieldUpdate.isActive ? ' (activated)' : ' (deactivated)') : ''}`);

        // Optionally email the login details (student's email, and parent's if asked).
        let emailNote = '';
        let emailSent;
        if (sendEmail === true) {
            const loginEmail = updated.email;
            if (!loginEmail) {
                emailNote = ' No email on file, so login details were not emailed.';
            } else {
                const recipients = [loginEmail];
                const pe = String(updated.parentEmail || '').trim().toLowerCase();
                if (sendToParent === true && EMAIL_RE.test(pe) && pe !== loginEmail) recipients.push(pe);
                const results = await sendStudentCredentials(req, { name: updated.name, loginEmail, password: wantsNewPassword ? password : '', recipients, isUpdate: true });
                const ok = results.filter(r => r.sent).map(r => r.to);
                emailSent = ok.length > 0;
                emailNote = ok.length ? ` Login details emailed to ${ok.join(', ')}.` : ' But the email could not be sent.';
            }
        }
        let smsSent;
        if (sendSms === true) {
            const sms = await sendStudentSms(req, { name: updated.name, loginEmail: updated.email, password: wantsNewPassword ? password : '', phone: updated.phone, isUpdate: true });
            smsSent = !!sms.sent;
            emailNote += sms.sent ? ' Text message sent.' : ` Text message not sent${sms.reason ? ` (${sms.reason})` : ''}.`;
        }
        const { password: _pw, refreshToken: _rt, ...safeStudent } = updated;
        res.json({ success: true, data: safeStudent, emailSent, smsSent, message: `Student updated successfully.${emailNote}` });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
}
router.put('/students/:id/profile', requirePermission('students:edit'), validators.updateStudentProfile, validate, updateStudentHandler);
router.patch('/students/:id/profile', requirePermission('students:edit'), validators.updateStudentProfile, validate, updateStudentHandler);

// ============================================================
// Profile photo (private, stored in R2 under profile-photos/, streamed back
// through an authenticated route — never a public URL).
// ============================================================
function loadScopedStudent(req, res) {
    const student = db.findById('users', req.params.id);
    if (!student || student.role !== 'student') {
        res.status(404).json({ success: false, message: 'Student not found' });
        return null;
    }
    if (!isClassAllowedForUser(req.userData, student.classId)) {
        res.status(403).json({ success: false, message: "You're not assigned to this student's class." });
        return null;
    }
    return student;
}

router.post('/students/:id/photo', requirePermission('students:edit'), handleUpload(uploadProfilePhoto.single('photo')), profilePhotoMimeGuard, async (req, res) => {
    try {
        const student = loadScopedStudent(req, res);
        if (!student) { if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key).catch(() => {}); return; }
        if (!req.file?.r2Key) return res.status(400).json({ success: false, message: 'No photo uploaded' });
        const oldKey = student.photoKey;
        db.updateById('users', student._id, { photoKey: req.file.r2Key, photoUpdatedAt: new Date().toISOString() });
        if (oldKey) await r2Service.deleteObject(oldKey).catch(() => {});
        logAudit(req, 'edit', 'student', student._id, `Updated profile photo for ${student.name}`);
        res.json({ success: true, message: 'Profile photo updated' });
    } catch (error) {
        if (req.file?.r2Key) await r2Service.deleteObject(req.file.r2Key).catch(() => {});
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.get('/students/:id/photo', requirePermission('students:view'), async (req, res) => {
    try {
        const student = loadScopedStudent(req, res);
        if (!student) return;
        if (!student.photoKey) return res.status(404).json({ success: false, message: 'No photo' });
        res.setHeader('Cache-Control', 'private, max-age=300');
        return r2Service.streamToResponse(student.photoKey, res, { downloadName: 'photo', inline: true });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.delete('/students/:id/photo', requirePermission('students:edit'), async (req, res) => {
    try {
        const student = loadScopedStudent(req, res);
        if (!student) return;
        if (student.photoKey) await r2Service.deleteObject(student.photoKey).catch(() => {});
        db.updateById('users', student._id, { photoKey: null, photoUpdatedAt: null });
        logAudit(req, 'edit', 'student', student._id, `Removed profile photo for ${student.name}`);
        res.json({ success: true, message: 'Profile photo removed' });
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
