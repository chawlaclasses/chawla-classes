/**
 * utils/questionHistory.js
 *
 * Records every meaningful change to a Question Bank item — creation,
 * content edits, and workflow status transitions — into the
 * 'question-history' collection, so each question has its own full
 * timeline independent of the general audit log (which only keeps a
 * short human-readable description, not structured per-question history).
 */

"use strict";

const db = require('../services/jsonDb');

/**
 * @param {object} req - the Express request (for who's making the change)
 * @param {string} questionId
 * @param {string} event - 'created' | 'edited' | 'status_change'
 * @param {object} [details] - { fromStatus, toStatus, note, summary, snapshot }
 *   snapshot: the FULL question object as it was immediately before this
 *   change was applied. Only meaningful on 'edited' events — it's what
 *   lets a later "Restore this version" action put the question back
 *   exactly as it was, instead of just showing a text description of
 *   what changed.
 */
function recordQuestionHistory(req, questionId, event, details = {}) {
    db.insertOne('question-history', {
        questionId,
        event,
        fromStatus: details.fromStatus || null,
        toStatus: details.toStatus || null,
        note: details.note || '',
        summary: details.summary || '',
        snapshot: details.snapshot || null,
        changedBy: req.user?.id || null,
        changedByName: req.userData?.name || 'System',
    });
}

function getQuestionHistory(questionId) {
    return db.find('question-history', { questionId })
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { recordQuestionHistory, getQuestionHistory };