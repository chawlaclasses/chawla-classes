// routes/admin/ai-review-queue.js
//
// AI Review Queue — a dedicated triage view for AI-generated questions,
// separate from general Question Bank CRUD (routes/admin/question-bank.js).
//
// Why a separate module: AI-generated questions land in the 'questions'
// collection with generatedByAI:true, status:'draft' — same as any
// manually-typed draft. Before this module, reviewing them meant filtering
// the full Question Bank list by eye; there was no dedicated
// approve/reject flow for "is this AI output good enough to send into the
// normal review pipeline". This file adds that triage layer on top of the
// existing state machine (config/questionWorkflow.js) without changing it:
//
//   AI Generate (routes/admin/ai.js) → status:'draft', generatedByAI:true
//        ↓
//   AI Review Queue (this file) — lists those drafts
//        ↓
//   Approve  → draft → review → approved  (skips the queue, enters the
//              normal human review chain in one step — a queue reviewer
//              has effectively already done the "Submit for Review" +
//              "Approve" steps in one judgement call)
//   Reject   → draft → archived  (soft-rejected; reuses the existing
//              Archived → Draft restore path in questionWorkflow.js, so a
//              rejected AI question can still be revived and fixed later
//              instead of being lost)
//   Edit     → reuses the existing PUT /questions/:id route unchanged —
//              editing a draft doesn't change its review state, so no new
//              endpoint is needed for this step.
//        ↓
//   Question Bank (routes/admin/question-bank.js) — same collection,
//   now moving through the normal workflow
//
// Mounted at '/ai-review-queue' by routes/adminRoutes.js.

"use strict";

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { recordQuestionHistory } = require('../../utils/questionHistory');
const { getAllowedTransition } = require('../../config/questionWorkflow');
const { isClassAllowedForUser, isSubjectAllowedForUser } = require('../../config/permissions');

// A question is "in the AI Review Queue" if it was AI-generated and is
// still sitting untouched in Draft — the moment a human approves, rejects,
// or it's otherwise moved on, it drops out of this list on its own (no
// separate "queue" flag/collection to keep in sync).
function isQueued(q) {
  return Boolean(q.generatedByAI) && (q.status || 'draft') === 'draft';
}

// List everything currently awaiting AI-review-queue triage.
router.get('/', requirePermission('questions:view'), (req, res) => {
  try {
    const { subjectId, chapter, difficulty } = req.query;

    let questions = db.find('questions', { generatedByAI: true, status: 'draft' });
    questions = questions.filter(q => isClassAllowedForUser(req.userData, q.classId) && isSubjectAllowedForUser(req.userData, q.subjectId));

    if (subjectId) questions = questions.filter(q => q.subjectId === subjectId);
    if (chapter) questions = questions.filter(q => (q.chapter || '').toLowerCase() === String(chapter).toLowerCase());
    if (difficulty) questions = questions.filter(q => q.difficulty === difficulty);

    questions = questions.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ success: true, data: questions, count: questions.length });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Lightweight count for the sidebar badge — avoids shipping the full
// question payloads just to show a number.
router.get('/count', requirePermission('questions:view'), (req, res) => {
  try {
    const count = db.find('questions', { generatedByAI: true, status: 'draft' })
      .filter(q => isClassAllowedForUser(req.userData, q.classId) && isSubjectAllowedForUser(req.userData, q.subjectId))
      .length;
    res.json({ success: true, data: { count } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Approve a single queued question: draft → review → approved in one step.
router.post('/:id/approve', requirePermission('questions:approve'), (req, res) => {
  try {
    const question = db.findById('questions', req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    if (!isQueued(question)) {
      return res.status(400).json({ success: false, message: 'This question is not in the AI Review Queue (already actioned or not AI-generated).' });
    }

    const toReview = getAllowedTransition('draft', 'review');
    const toApproved = getAllowedTransition('review', 'approved');
    // Defensive only — both transitions are defined in questionWorkflow.js
    // today; this guards against the state machine changing under us.
    if (!toReview || !toApproved) {
      return res.status(500).json({ success: false, message: 'Approval workflow is misconfigured' });
    }

    db.findByIdAndUpdate('questions', question._id, { status: 'review' });
    recordQuestionHistory(req, question._id, 'status_change', { fromStatus: 'draft', toStatus: 'review', note: 'AI Review Queue: approved' });

    const updated = db.findByIdAndUpdate('questions', question._id, { status: 'approved' });
    recordQuestionHistory(req, question._id, 'status_change', { fromStatus: 'review', toStatus: 'approved', note: 'AI Review Queue: approved' });

    logAudit(req, 'edit', 'question', question._id, 'Approved from AI Review Queue');
    res.json({ success: true, data: updated, message: 'Question approved and moved into the review pipeline.' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Reject a single queued question: draft → archived (recoverable via the
// existing "Restore to Draft" transition, so nothing is destroyed).
router.post('/:id/reject', requirePermission('questions:approve'), (req, res) => {
  try {
    const { reason } = req.body;
    const question = db.findById('questions', req.params.id);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }
    if (!isQueued(question)) {
      return res.status(400).json({ success: false, message: 'This question is not in the AI Review Queue (already actioned or not AI-generated).' });
    }

    const updated = db.findByIdAndUpdate('questions', question._id, { status: 'archived' });
    recordQuestionHistory(req, question._id, 'status_change', {
      fromStatus: 'draft',
      toStatus: 'archived',
      note: 'AI Review Queue: rejected',
      summary: reason ? `Reason: ${reason}` : '',
    });

    logAudit(req, 'edit', 'question', question._id, `Rejected from AI Review Queue${reason ? ` — ${reason}` : ''}`);
    res.json({ success: true, data: updated, message: 'Question rejected. It can be restored to Draft later from Question Bank if needed.' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Bulk approve — same one-step draft → review → approved per question;
// per-item failures are collected rather than aborting the whole batch.
router.post('/bulk-approve', requirePermission('questions:approve'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
    }

    const approved = [];
    const skipped = [];

    for (const id of ids) {
      const question = db.findById('questions', id);
      if (!question) { skipped.push({ id, reason: 'Not found' }); continue; }
      if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) { skipped.push({ id, reason: 'Not assigned to this class/subject' }); continue; }
      if (!isQueued(question)) { skipped.push({ id, reason: 'Not in AI Review Queue' }); continue; }

      db.findByIdAndUpdate('questions', id, { status: 'review' });
      recordQuestionHistory(req, id, 'status_change', { fromStatus: 'draft', toStatus: 'review', note: 'AI Review Queue: bulk approved' });
      db.findByIdAndUpdate('questions', id, { status: 'approved' });
      recordQuestionHistory(req, id, 'status_change', { fromStatus: 'review', toStatus: 'approved', note: 'AI Review Queue: bulk approved' });
      approved.push(id);
    }

    if (approved.length > 0) {
      logAudit(req, 'edit', 'question', null, `Bulk approved ${approved.length} question(s) from AI Review Queue`);
    }

    res.json({
      success: true,
      data: { approvedIds: approved, skipped },
      message: skipped.length
        ? `Approved ${approved.length} question(s). Skipped ${skipped.length}.`
        : `Approved ${approved.length} question(s).`,
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Bulk reject — same draft → archived per question.
router.post('/bulk-reject', requirePermission('questions:approve'), (req, res) => {
  try {
    const { ids, reason } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
    }

    const rejected = [];
    const skipped = [];

    for (const id of ids) {
      const question = db.findById('questions', id);
      if (!question) { skipped.push({ id, reason: 'Not found' }); continue; }
      if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) { skipped.push({ id, reason: 'Not assigned to this class/subject' }); continue; }
      if (!isQueued(question)) { skipped.push({ id, reason: 'Not in AI Review Queue' }); continue; }

      db.findByIdAndUpdate('questions', id, { status: 'archived' });
      recordQuestionHistory(req, id, 'status_change', {
        fromStatus: 'draft',
        toStatus: 'archived',
        note: 'AI Review Queue: bulk rejected',
        summary: reason ? `Reason: ${reason}` : '',
      });
      rejected.push(id);
    }

    if (rejected.length > 0) {
      logAudit(req, 'edit', 'question', null, `Bulk rejected ${rejected.length} question(s) from AI Review Queue${reason ? ` — ${reason}` : ''}`);
    }

    res.json({
      success: true,
      data: { rejectedIds: rejected, skipped },
      message: skipped.length
        ? `Rejected ${rejected.length} question(s). Skipped ${skipped.length}.`
        : `Rejected ${rejected.length} question(s).`,
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;