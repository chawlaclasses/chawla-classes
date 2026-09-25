/**
 * routes/teacherRoutes.js
 *
 * Mobile (JWT Bearer) API for the Teacher role inside the single
 * Chawla Classes app. Mounted at /api/teacher, behind requireApiTeacher
 * (middleware/apiAuth.js) — see app.js.
 *
 * Login is NOT in this file. Teachers are staff (role: 'teacher' in the
 * 'users' collection, created via Admin -> Staff Management, the same
 * flow as any other staff account — see routes/staff.js), and
 * POST /api/admin/login (routes/apiAuth.js) already authenticates any
 * staff role and returns the exact same {success, data:{token, user:
 * {id,name,email,role}}} shape the student app's AuthRepository already
 * parses. The Flutter app calls that existing endpoint for a teacher
 * login too — no new login endpoint, no new password/lockout system to
 * maintain in parallel. See the Flutter side for how `role` picks the
 * post-login destination.
 *
 * Every route below reuses collections and permission helpers the admin
 * panel already writes to/reads from (see config/permissions.js,
 * routes/admin/attendance.js, routes/admin/homework.js) so a teacher's
 * data is identical whether they use the admin panel or this app — no
 * duplicated/forked data model.
 */

"use strict";

const express = require('express');
const router = express.Router();
const db = require('../services/jsonDb');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { isClassAllowedForUser, isSubjectAllowedForUser } = require('../config/permissions');
const notificationService = require('../services/notifications');

function classDisplayName(cls) {
    return cls ? (cls.displayName || cls.name) : null;
}

function subjectDisplayName(subj) {
    return subj ? (subj.displayName || subj.name) : null;
}

// Every class/subject this teacher may touch. Empty array on the user
// record means "unrestricted" (see isClassAllowedForUser's own doc
// comment) — resolved here once per request rather than re-deriving it
// in every route.
function resolveScope(teacher) {
    const allClasses = db.findAll('classes');
    const allSubjects = db.findAll('subjects');
    const classes = allClasses.filter(c => isClassAllowedForUser(teacher, c._id));
    const subjects = allSubjects.filter(s => isSubjectAllowedForUser(teacher, s._id));
    return { classes, subjects };
}

// ============================================================
// Dashboard
// ============================================================
router.get('/dashboard', (req, res) => {
    try {
        const teacher = req.userData;
        const { classes, subjects } = resolveScope(teacher);
        const classIds = classes.map(c => c._id);

        const students = db.findAll('users').filter(
            u => u.role === 'student' && classIds.includes(u.classId)
        );

        const homework = db.findAll('homework').filter(
            h => h.isActive && classIds.includes(h.classId)
        );
        const pendingHomework = homework.filter(h => new Date(h.dueDate) >= new Date());

        const today = new Date().toLocaleDateString('en-US');
        const todaysAttendance = db.findAll('attendance').filter(
            a => a.date === today && students.some(s => s.email === a.email)
        );

        res.json({
            success: true,
            data: {
                teacherName: teacher.name,
                totalStudents: students.length,
                classesAssigned: classes.map(c => ({ id: c._id, name: classDisplayName(c) })),
                subjectsAssigned: subjects.map(s => ({ id: s._id, name: subjectDisplayName(s) })),
                pendingHomeworkCount: pendingHomework.length,
                attendanceMarkedToday: todaysAttendance.length,
                attendanceTotalToday: students.length
            }
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Classes & Subjects assigned to this teacher
// ============================================================
router.get('/classes', (req, res) => {
    try {
        const { classes } = resolveScope(req.userData);
        res.json({ success: true, data: classes.map(c => ({ id: c._id, name: classDisplayName(c) })) });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.get('/subjects', (req, res) => {
    try {
        const { subjects } = resolveScope(req.userData);
        res.json({ success: true, data: subjects.map(s => ({ id: s._id, name: subjectDisplayName(s) })) });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Students List (optionally filtered to one class)
// ============================================================
router.get('/students', (req, res) => {
    try {
        const teacher = req.userData;
        const { classId } = req.query;

        if (classId && !isClassAllowedForUser(teacher, classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class." });
        }

        const { classes } = resolveScope(teacher);
        const classIds = classId ? [classId] : classes.map(c => c._id);
        const classNameById = Object.fromEntries(classes.map(c => [c._id, classDisplayName(c)]));

        const students = db.findAll('users')
            .filter(u => u.role === 'student' && classIds.includes(u.classId))
            .map(s => ({
                id: s._id,
                name: s.name,
                email: s.email,
                rollNumber: s.rollNumber || null,
                classId: s.classId,
                className: classNameById[s.classId] || null,
                photoUrl: s.photoUrl || null
            }));

        res.json({ success: true, data: students });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Attendance — mark a class's attendance for a date
// Mirrors routes/admin/attendance.js's POST /mark exactly (same
// collection, same field names) so records are identical either way.
// ============================================================
router.post('/attendance', (req, res) => {
    try {
        const teacher = req.userData;
        const { classId, date, records } = req.body;

        if (!classId || !Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, message: 'classId and records[] are required' });
        }
        if (!isClassAllowedForUser(teacher, classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class." });
        }
        const cls = db.findById('classes', classId);
        if (!cls) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }

        const targetDate = date || new Date().toLocaleDateString('en-US');
        const className = classDisplayName(cls);
        let marked = 0;
        let presentCount = 0;

        for (const rec of records) {
            const { studentId, status } = rec;
            if (!studentId || !['Present', 'Absent'].includes(status)) continue;

            const student = db.findById('users', studentId);
            if (!student || student.role !== 'student' || student.classId !== classId) continue;

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
                    date: targetDate,
                    markedBy: teacher._id
                });
            }
            marked++;
            if (status === 'Present') presentCount++;
        }

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

// Attendance already marked for a class on a given date (to prefill the
// marking screen instead of always starting blank).
router.get('/attendance', (req, res) => {
    try {
        const teacher = req.userData;
        const { classId, date } = req.query;
        if (!classId) {
            return res.status(400).json({ success: false, message: 'classId is required' });
        }
        if (!isClassAllowedForUser(teacher, classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class." });
        }

        const targetDate = date || new Date().toLocaleDateString('en-US');
        const students = db.findAll('users').filter(u => u.role === 'student' && u.classId === classId);
        const existing = db.findAll('attendance').filter(a => a.date === targetDate);
        const statusByEmail = Object.fromEntries(existing.map(a => [a.email, a.status]));

        const data = students.map(s => ({
            studentId: s._id,
            name: s.name,
            rollNumber: s.rollNumber || null,
            status: statusByEmail[s.email] || null
        }));

        res.json({ success: true, data: { date: targetDate, students: data } });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Homework — CRUD, scoped to the teacher's assigned classes/subjects.
// No file-attachment handling here (unlike routes/admin/homework.js)
// to keep this endpoint simple; wire in uploadHomeworkAttachment +
// r2Service the same way admin/homework.js does if attachments turn
// out to be needed from the app too.
// ============================================================
router.get('/homework', (req, res) => {
    try {
        const teacher = req.userData;
        const { classId, subjectId } = req.query;
        const { classes } = resolveScope(teacher);
        const classIds = classId ? [classId] : classes.map(c => c._id);

        let homework = db.findAll('homework').filter(h => h.isActive && classIds.includes(h.classId));
        if (subjectId) homework = homework.filter(h => h.subjectId === subjectId);

        const withCounts = homework.map(hw => {
            const submissions = db.find('homeworkSubmissions', { homeworkId: hw._id });
            return {
                ...hw,
                submissionCount: submissions.length,
                gradedCount: submissions.filter(s => s.status === 'graded').length
            };
        });

        res.json({ success: true, data: withCounts });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.post('/homework', (req, res) => {
    try {
        const teacher = req.userData;
        const { title, description, classId, subjectId, dueDate, marks } = req.body;

        if (!title || !classId || !subjectId || !dueDate || !marks) {
            return res.status(400).json({ success: false, message: 'title, classId, subjectId, dueDate and marks are required' });
        }
        if (!isClassAllowedForUser(teacher, classId) || !isSubjectAllowedForUser(teacher, subjectId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
        }
        const cls = db.findById('classes', classId);
        if (!cls) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }

        const newHomework = db.insertOne('homework', {
            title,
            description: description || '',
            classId,
            subjectId,
            dueDate,
            marks: Number(marks),
            attachmentKey: null,
            attachmentUrl: null,
            attachmentOriginalName: null,
            isPublished: true,
            isActive: true,
            createdBy: teacher._id
        });

        res.status(201).json({ success: true, data: newHomework, message: 'Homework created' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.put('/homework/:id', (req, res) => {
    try {
        const teacher = req.userData;
        const homework = db.findById('homework', req.params.id);
        if (!homework || !homework.isActive) {
            return res.status(404).json({ success: false, message: 'Homework not found' });
        }
        if (!isClassAllowedForUser(teacher, homework.classId) || !isSubjectAllowedForUser(teacher, homework.subjectId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
        }

        const { title, description, dueDate, marks } = req.body;
        const updated = db.findByIdAndUpdate('homework', homework._id, {
            title: title ?? homework.title,
            description: description ?? homework.description,
            dueDate: dueDate ?? homework.dueDate,
            marks: marks !== undefined ? Number(marks) : homework.marks
        });

        res.json({ success: true, data: updated, message: 'Homework updated' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.delete('/homework/:id', (req, res) => {
    try {
        const teacher = req.userData;
        const homework = db.findById('homework', req.params.id);
        if (!homework || !homework.isActive) {
            return res.status(404).json({ success: false, message: 'Homework not found' });
        }
        if (!isClassAllowedForUser(teacher, homework.classId) || !isSubjectAllowedForUser(teacher, homework.subjectId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
        }

        // Soft delete, consistent with how admin/homework.js treats isActive
        // elsewhere in this codebase (never a hard db.deleteById on content
        // students may already have submissions against).
        db.findByIdAndUpdate('homework', homework._id, { isActive: false });
        res.json({ success: true, message: 'Homework deleted' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Notices — fan out to every student in one of the teacher's assigned
// classes, via the existing notification system (services/notifications.js)
// that the student app's Notices tab already reads from
// (GET /api/notifications). NOTE: config/permissions.js does not yet
// grant the 'teacher' role a 'communication:*'-equivalent permission on
// the admin-panel side (that's admin/super_admin only there, scoped to
// bulk marketing sends) — this is a narrower, class-scoped capability
// only for the teacher's own assigned classes, deliberately not the same
// permission. Flag this for Rohit/the admin owner as a product decision,
// not just a technical one, before shipping it.
// ============================================================
router.post('/notices', async (req, res) => {
    try {
        const teacher = req.userData;
        const { classId, title, message } = req.body;

        if (!classId || !title || !message) {
            return res.status(400).json({ success: false, message: 'classId, title and message are required' });
        }
        if (!isClassAllowedForUser(teacher, classId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class." });
        }

        const students = db.findAll('users').filter(u => u.role === 'student' && u.classId === classId);
        for (const student of students) {
            await notificationService.createNotification(
                student._id,
                'notice',
                title,
                message,
                { classId, teacherId: teacher._id, teacherName: teacher.name }
            );
        }

        res.status(201).json({ success: true, data: { notifiedCount: students.length }, message: 'Notice sent' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Study Material upload
// Deliberately NOT routed through routes/notes.js — that file has no
// auth middleware at all and accepts a raw fileUrl string with no
// upload handling, so it isn't a safe base to build a teacher-facing
// upload feature on. This writes to the same 'notes' collection (so it
// shows up wherever 'notes' is already read from) but scoped and
// authenticated the way homework attachments are. Add real file-upload
// (multer + r2Service, same as middleware/upload.js's
// uploadHomeworkAttachment) before shipping — fileUrl below is a
// placeholder for wherever the app uploads the file to first.
// ============================================================
router.post('/materials', (req, res) => {
    try {
        const teacher = req.userData;
        const { title, classId, subjectId, fileUrl } = req.body;

        if (!title || !classId || !subjectId || !fileUrl) {
            return res.status(400).json({ success: false, message: 'title, classId, subjectId and fileUrl are required' });
        }
        if (!isClassAllowedForUser(teacher, classId) || !isSubjectAllowedForUser(teacher, subjectId)) {
            return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
        }

        const newNote = db.insertOne('notes', {
            title,
            content: '',
            subject: subjectId,
            classId,
            fileUrl,
            createdBy: teacher._id,
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ success: true, data: newNote, message: 'Study material uploaded' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Profile
// ============================================================
router.get('/profile', (req, res) => {
    try {
        const teacher = req.userData;
        const { classes, subjects } = resolveScope(teacher);
        res.json({
            success: true,
            data: {
                id: teacher._id,
                name: teacher.name,
                email: teacher.email,
                phone: teacher.phone || null,
                role: teacher.role,
                classes: classes.map(c => ({ id: c._id, name: classDisplayName(c) })),
                subjects: subjects.map(s => ({ id: s._id, name: subjectDisplayName(s) }))
            }
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.put('/profile', (req, res) => {
    try {
        const teacher = req.userData;
        const { phone } = req.body;
        const updates = {};
        if (typeof phone === 'string') updates.phone = phone;

        const updated = db.updateById('users', teacher._id, updates);
        res.json({
            success: true,
            data: { id: updated._id, name: updated.name, email: updated.email, phone: updated.phone || null },
            message: 'Profile updated'
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

router.post('/change-password', async (req, res) => {
    try {
        const teacher = req.userData;
        const { currentPassword, newPassword } = req.body;

        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        const fullUser = db.findById('users', teacher._id);
        const isValid = await bcrypt.compare(currentPassword, fullUser.password);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        db.updateById('users', teacher._id, { password: hashed });

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;
