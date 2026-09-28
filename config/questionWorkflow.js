/**
 * config/questionWorkflow.js
 *
 * State machine for the Question Bank's review workflow:
 *
 *   Draft → Review → Approved → Published → Archived
 *
 * with two "send back" paths (Review → Draft if it needs more work,
 * Approved → Draft if a reviewer changes their mind before publishing)
 * and a restore path (Archived → Draft, to revive and revise old
 * content instead of writing it from scratch again).
 *
 * This only applies to the reusable Question Bank ('questions'
 * collection) — questions authored directly inside a single test
 * ('testQuestions' collection) aren't part of a shared bank and don't
 * go through review.
 *
 * Each transition names the permission required to make it, so
 * "who drafts it" and "who can approve/publish it" can be different
 * people — see config/permissions.js, where 'teacher' has
 * questions:create/edit (drafting) but not questions:approve/publish
 * (review + publish stays with admin/super_admin), so a teacher can't
 * quietly self-approve their own question.
 */

"use strict";

const STATUSES = ['draft', 'review', 'approved', 'published', 'archived'];

const STATUS_LABELS = {
    draft: 'Draft',
    review: 'In Review',
    approved: 'Approved',
    published: 'Published',
    archived: 'Archived',
};

// fromStatus -> [{ to, permission, label }]
const TRANSITIONS = {
    draft: [
        { to: 'review', permission: 'questions:edit', label: 'Submit for Review' },
    ],
    review: [
        { to: 'approved', permission: 'questions:approve', label: 'Approve' },
        { to: 'draft', permission: 'questions:approve', label: 'Send Back to Draft' },
    ],
    approved: [
        { to: 'published', permission: 'questions:publish', label: 'Publish' },
        { to: 'draft', permission: 'questions:approve', label: 'Unapprove' },
    ],
    published: [
        { to: 'archived', permission: 'questions:approve', label: 'Archive' },
    ],
    archived: [
        { to: 'draft', permission: 'questions:edit', label: 'Restore to Draft' },
    ],
};

/**
 * @returns {{to:string, permission:string, label:string}|null}
 */
function getAllowedTransition(fromStatus, toStatus) {
    const options = TRANSITIONS[fromStatus] || [];
    return options.find(o => o.to === toStatus) || null;
}

/**
 * The list of transitions available FROM a given status — used by the
 * frontend to render the right action buttons without duplicating the
 * state machine in two places.
 */
function getAvailableTransitions(fromStatus) {
    return TRANSITIONS[fromStatus] || [];
}

module.exports = {
    STATUSES,
    STATUS_LABELS,
    TRANSITIONS,
    getAllowedTransition,
    getAvailableTransitions,
};
