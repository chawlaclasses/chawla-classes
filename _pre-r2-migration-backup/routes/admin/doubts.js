// routes/admin/doubts.js
//
// Doubt management (admin side) — students ask doubts (text + optional
// image/voice note), admins reply and set status/priority.
// Extracted out of routes/adminRoutes.js (refactor, 2026-07). Mounted at
// '/doubts' by routes/adminRoutes.js, so the final URLs (/api/admin/doubts,
// /api/admin/doubts/:id, etc.) are unchanged.
//
// Note: the original "Doubt Management" section in adminRoutes.js also
// contained a large block of unrelated Question Bank routes with no
// separating banner comment. Those moved to routes/admin/question-bank.js
// instead, since they're a different domain — this file is genuinely just
// doubts.

const express = require('express');
const router = express.Router();
const path = require('path');

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { DOUBTS_DIR } = require('../../middleware/upload');
const { isClassAllowedForUser, isSubjectAllowedForUser } = require('../../config/permissions');

function doubtWithMeta(doubt) {
  const student = db.findById('users', doubt.studentId);
  const replies = db.find('doubtReplies', { doubtId: doubt._id });
  return {
    ...doubt,
    studentName: student ? student.name : 'Deleted student',
    replyCount: replies.length,
  };
}

const DOUBT_PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

// List all doubts — filterable by status/priority/classId, unresolved-and-urgent first
router.get('/', requirePermission('doubts:view'), (req, res) => {
  try {
    const { status, priority, classId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (classId) filter.classId = classId;

    const doubts = db.find('doubts', filter)
      .filter(d => isClassAllowedForUser(req.userData, d.classId) && isSubjectAllowedForUser(req.userData, d.subjectId))
      .map(doubtWithMeta)
      .sort((a, b) => {
        const byPriority = (DOUBT_PRIORITY_ORDER[a.priority] ?? 9) - (DOUBT_PRIORITY_ORDER[b.priority] ?? 9);
        if (byPriority !== 0) return byPriority;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    res.json({ success: true, data: doubts });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Single doubt + its reply thread
router.get('/:id', requirePermission('doubts:view'), (req, res) => {
  try {
    const doubt = db.findById('doubts', req.params.id);
    if (!doubt) {
      return res.status(404).json({ success: false, message: 'Doubt not found' });
    }
    if (!isClassAllowedForUser(req.userData, doubt.classId) || !isSubjectAllowedForUser(req.userData, doubt.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    const replies = db.find('doubtReplies', { doubtId: doubt._id }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ success: true, data: { doubt: doubtWithMeta(doubt), replies } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Reply to a doubt — also nudges status from "open" to "in_progress" the
// first time an admin responds, since a reply means someone is on it.
router.post('/:id/reply', requirePermission('doubts:reply'), (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Reply message is required' });
    }
    const doubt = db.findById('doubts', req.params.id);
    if (!doubt) {
      return res.status(404).json({ success: false, message: 'Doubt not found' });
    }
    if (!isClassAllowedForUser(req.userData, doubt.classId) || !isSubjectAllowedForUser(req.userData, doubt.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    const reply = db.insertOne('doubtReplies', {
      doubtId: doubt._id,
      message: message.trim(),
      repliedBy: req.user?.id || 'admin',
      repliedByName: req.user?.name || 'Admin',
    });

    if (doubt.status === 'open') {
      db.findByIdAndUpdate('doubts', doubt._id, { status: 'in_progress' });
    }

    logAudit(req, 'edit', 'doubt', doubt._id, `Replied to doubt from student ${doubt.studentId}`);

    res.status(201).json({ success: true, data: reply, message: 'Reply sent' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.put('/:id/status', requirePermission('doubts:reply'), (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}` });
    }
    const doubt = db.findById('doubts', req.params.id);
    if (!doubt) {
      return res.status(404).json({ success: false, message: 'Doubt not found' });
    }
    if (!isClassAllowedForUser(req.userData, doubt.classId) || !isSubjectAllowedForUser(req.userData, doubt.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    const updated = db.findByIdAndUpdate('doubts', req.params.id, { status });
    logAudit(req, 'edit', 'doubt', req.params.id, `Marked doubt as "${status}"`);
    res.json({ success: true, data: updated, message: 'Status updated' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.put('/:id/priority', requirePermission('doubts:reply'), (req, res) => {
  try {
    const { priority } = req.body;
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: `Priority must be one of: ${validPriorities.join(', ')}` });
    }
    const doubt = db.findById('doubts', req.params.id);
    if (!doubt) {
      return res.status(404).json({ success: false, message: 'Doubt not found' });
    }
    if (!isClassAllowedForUser(req.userData, doubt.classId) || !isSubjectAllowedForUser(req.userData, doubt.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    const updated = db.findByIdAndUpdate('doubts', req.params.id, { priority });
    logAudit(req, 'edit', 'doubt', req.params.id, `Set doubt priority to "${priority}"`);
    res.json({ success: true, data: updated, message: 'Priority updated' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Stream the doubt's attached image/voice note (admin can view any doubt's attachment)
router.get('/:id/image', requirePermission('doubts:view'), (req, res) => {
  const doubt = db.findById('doubts', req.params.id);
  if (!doubt || !doubt.imageFilename) {
    return res.status(404).json({ success: false, message: 'No image attached to this doubt' });
  }
  if (!isClassAllowedForUser(req.userData, doubt.classId) || !isSubjectAllowedForUser(req.userData, doubt.subjectId)) {
    return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
  }
  res.sendFile(path.join(DOUBTS_DIR, doubt.imageFilename));
});

router.get('/:id/voice', requirePermission('doubts:view'), (req, res) => {
  const doubt = db.findById('doubts', req.params.id);
  if (!doubt || !doubt.voiceNoteFilename) {
    return res.status(404).json({ success: false, message: 'No voice note attached to this doubt' });
  }
  if (!isClassAllowedForUser(req.userData, doubt.classId) || !isSubjectAllowedForUser(req.userData, doubt.subjectId)) {
    return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
  }
  res.sendFile(path.join(DOUBTS_DIR, doubt.voiceNoteFilename));
});

module.exports = router;