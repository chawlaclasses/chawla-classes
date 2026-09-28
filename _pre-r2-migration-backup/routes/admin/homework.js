// routes/admin/homework.js
//
// Homework module (admin side) — assignments (homework collection) and
// student submissions (homeworkSubmissions collection). Extracted out of
// routes/adminRoutes.js (refactor, 2026-07). Mounted at '/homework' by
// routes/adminRoutes.js, so the final URLs (/api/admin/homework,
// /api/admin/homework/:id, .../submissions, etc.) are unchanged.

const express = require('express');
const router = express.Router();
const path = require('path');

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { cleanupFile } = require('../../utils/helpers');
const { uploadHomeworkAttachment, homeworkMimeGuard, HOMEWORK_SUBMISSIONS_DIR } = require('../../middleware/upload');
const { HOMEWORK_DIR } = require('../../config');
const { isClassAllowedForUser, isSubjectAllowedForUser } = require('../../config/permissions');

// For the one file-upload route with body validation (PUT /:id): the
// shared `validate` middleware alone isn't enough — by the time it runs,
// multer has already written the uploaded file to disk. If validation
// then rejects the request, the file would be orphaned (never referenced
// by any DB record, never cleaned up). This mirrors the cleanup pattern
// used elsewhere in this file (`if (req.file) cleanupFile(req.file.path)`)
// so a rejected request leaves no orphaned file behind. Only used here —
// single-use, so it lives in this file rather than the shared _helpers.
function validateAndCleanupFile(req, res, next) {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  if (req.file) cleanupFile(req.file.path);
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array().map(err => ({ field: err.path, message: err.msg })),
  });
}

function homeworkWithCounts(hw) {
  const submissions = db.find('homeworkSubmissions', { homeworkId: hw._id });
  return {
    ...hw,
    submissionCount: submissions.length,
    gradedCount: submissions.filter(s => s.status === 'graded').length,
  };
}

// List homework, optionally filtered by class/subject
router.get('/', requirePermission('homework:view'), (req, res) => {
  try {
    const { classId, subjectId } = req.query;
    const filter = { isActive: true };
    if (classId) filter.classId = classId;
    if (subjectId) filter.subjectId = subjectId;

    const homework = db.find('homework', filter)
      .filter(hw => isClassAllowedForUser(req.userData, hw.classId) && isSubjectAllowedForUser(req.userData, hw.subjectId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(homeworkWithCounts);

    res.json({ success: true, data: homework });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Create homework, with an optional PDF/image attachment
router.post('/', requirePermission('homework:create'), uploadHomeworkAttachment.single('attachment'), homeworkMimeGuard, (req, res) => {
  try {
    const { title, description, classId, subjectId, dueDate, marks } = req.body;

    if (!title || !classId || !subjectId || !dueDate || !marks) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(400).json({ success: false, message: 'title, classId, subjectId, dueDate and marks are required' });
    }

    const classData = db.findById('classes', classId);
    if (!classData) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    if (!isClassAllowedForUser(req.userData, classId) || !isSubjectAllowedForUser(req.userData, subjectId)) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    const newHomework = db.insertOne('homework', {
      title,
      description: description || '',
      classId,
      subjectId,
      dueDate,
      marks: Number(marks),
      attachmentFilename: req.file ? req.file.filename : null,
      attachmentOriginalName: req.file ? req.file.originalname : null,
      isPublished: false,
      isActive: true,
      createdBy: req.user?.id || 'admin'
    });

    logAudit(req, 'create', 'homework', newHomework._id, `Created homework "${title}" for class`);

    res.status(201).json({ success: true, data: newHomework, message: 'Homework created successfully' });
  } catch (error) {
    if (req.file) cleanupFile(req.file.path);
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Edit homework metadata, optionally replacing the attachment
router.put('/:id', requirePermission('homework:edit'), uploadHomeworkAttachment.single('attachment'), homeworkMimeGuard, validators.updateHomework, validateAndCleanupFile, (req, res) => {
  try {
    const homework = db.findById('homework', req.params.id);
    if (!homework) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(404).json({ success: false, message: 'Homework not found' });
    }
    if (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId)) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    const { title, description, classId, subjectId, dueDate, marks } = req.body;
    if ((classId && !isClassAllowedForUser(req.userData, classId)) || (subjectId && !isSubjectAllowedForUser(req.userData, subjectId))) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(403).json({ success: false, message: "You're not assigned to that class/subject." });
    }
    const updates = {};
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (classId) updates.classId = classId;
    if (subjectId) updates.subjectId = subjectId;
    if (dueDate) updates.dueDate = dueDate;
    if (marks) updates.marks = Number(marks);

    if (req.file) {
      if (homework.attachmentFilename) {
        cleanupFile(path.join(HOMEWORK_DIR, homework.attachmentFilename));
      }
      updates.attachmentFilename = req.file.filename;
      updates.attachmentOriginalName = req.file.originalname;
    }

    const updated = db.findByIdAndUpdate('homework', req.params.id, updates);
    logAudit(req, 'edit', 'homework', req.params.id, `Updated homework "${homework.title}"`);

    res.json({ success: true, data: updated, message: 'Homework updated successfully' });
  } catch (error) {
    if (req.file) cleanupFile(req.file.path);
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Soft-delete homework
router.delete('/:id', requirePermission('homework:edit'), (req, res) => {
  try {
    const homework = db.findById('homework', req.params.id);
    if (!homework) {
      return res.status(404).json({ success: false, message: 'Homework not found' });
    }
    if (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    db.findByIdAndUpdate('homework', req.params.id, { isActive: false });
    logAudit(req, 'delete', 'homework', req.params.id, `Deleted homework "${homework.title}"`);
    res.json({ success: true, message: 'Homework deleted successfully' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/:id/publish', requirePermission('homework:edit'), (req, res) => {
  try {
    const homework = db.findById('homework', req.params.id);
    if (!homework) {
      return res.status(404).json({ success: false, message: 'Homework not found' });
    }
    if (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    const updated = db.findByIdAndUpdate('homework', req.params.id, { isPublished: true });
    logAudit(req, 'edit', 'homework', req.params.id, `Published homework "${homework.title}"`);
    res.json({ success: true, data: updated, message: 'Homework published' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/:id/unpublish', requirePermission('homework:edit'), (req, res) => {
  try {
    const homework = db.findById('homework', req.params.id);
    if (!homework) {
      return res.status(404).json({ success: false, message: 'Homework not found' });
    }
    if (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    const updated = db.findByIdAndUpdate('homework', req.params.id, { isPublished: false });
    logAudit(req, 'edit', 'homework', req.params.id, `Unpublished homework "${homework.title}"`);
    res.json({ success: true, data: updated, message: 'Homework unpublished' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// List every student in the homework's class alongside their submission (or
// lack of one) — gives the teacher a full roster view, not just "who
// submitted", so missing submissions are just as visible.
router.get('/:id/submissions', requirePermission('homework:view'), (req, res) => {
  try {
    const homework = db.findById('homework', req.params.id);
    if (!homework) {
      return res.status(404).json({ success: false, message: 'Homework not found' });
    }
    if (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    const classStudents = db.find('users', { classId: homework.classId, role: 'student' }).filter(s => s.isActive !== false);
    const submissions = db.find('homeworkSubmissions', { homeworkId: homework._id });
    const submissionByStudent = new Map(submissions.map(s => [s.studentId, s]));

    const roster = classStudents.map(student => {
      const submission = submissionByStudent.get(student._id) || null;
      return {
        studentId: student._id,
        studentName: student.name,
        rollNumber: student.rollNumber || null,
        submission,
      };
    });

    res.json({ success: true, data: { homework, roster } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Download a student's submitted file
router.get('/submissions/:submissionId/download', requirePermission('homework:view'), (req, res) => {
  try {
    const submission = db.findById('homeworkSubmissions', req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }
    const homework = db.findById('homework', submission.homeworkId);
    if (homework && (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId))) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    const filePath = path.join(HOMEWORK_SUBMISSIONS_DIR, submission.filename);
    res.download(filePath, submission.originalName);
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Grade a submission — marks awarded + teacher remarks
router.put('/submissions/:submissionId/grade', requirePermission('homework:grade'), validators.gradeHomeworkSubmission, validate, (req, res) => {
  try {
    const { marksAwarded, teacherRemarks } = req.body;
    const submission = db.findById('homeworkSubmissions', req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const homework = db.findById('homework', submission.homeworkId);
    if (homework && (!isClassAllowedForUser(req.userData, homework.classId) || !isSubjectAllowedForUser(req.userData, homework.subjectId))) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    if (homework && marksAwarded !== undefined && Number(marksAwarded) > homework.marks) {
      return res.status(400).json({ success: false, message: `Marks can't exceed the homework's total of ${homework.marks}` });
    }

    const updated = db.findByIdAndUpdate('homeworkSubmissions', req.params.submissionId, {
      marksAwarded: marksAwarded !== undefined ? Number(marksAwarded) : submission.marksAwarded,
      teacherRemarks: teacherRemarks !== undefined ? teacherRemarks : submission.teacherRemarks,
      status: 'graded',
      gradedBy: req.user?.id || 'admin',
      gradedAt: new Date().toISOString(),
    });

    logAudit(req, 'edit', 'homework', submission.homeworkId, `Graded submission for student ${submission.studentId}`);

    res.json({ success: true, data: updated, message: 'Submission graded' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;