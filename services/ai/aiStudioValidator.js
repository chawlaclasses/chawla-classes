// services/ai/aiStudioValidator.js
//
// Validator for the AI Question Studio's generation output. Sibling to
// services/ai/aiValidator.js (used by ai-v2.js) — that one only ever
// needs to validate strict 4-option MCQs. The Studio supports every
// question type in the spec (MCQ, Subjective, Assertion-Reason, Case
// Study, Fill in Blanks, True/False, Match the Following, Numerical,
// Diagram Based), each with a different required shape, so it gets its
// own type-aware validator instead of overloading aiValidator.js with
// branches it was never designed for.
//
// Nothing here is saved anywhere — this only decides whether a
// provider-returned question object is well-formed enough to show in
// the Studio's Preview step. Saving only ever happens later, and only
// for items an admin has explicitly approved (routes/admin/ai-question-studio.js).

"use strict";

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'very_hard'];

const VALID_TYPES = [
    'mcq', 'subjective', 'assertion-reason', 'case-study',
    'fill-in-blank', 'true-false', 'match-following', 'numerical', 'diagram-based',
];

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

function clampScore(v, fallback = 70) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
}

// Every type shares these checks; type-specific checks are added on top.
function validateCommon(q, errors) {
    if (!isNonEmptyString(q.questionText)) errors.push('missing "questionText"');
    if (q.questionText && q.questionText.trim().length < 5) errors.push('questionText too short');
    if (q.difficulty && !VALID_DIFFICULTIES.includes(String(q.difficulty).toLowerCase())) {
        errors.push(`invalid difficulty "${q.difficulty}"`);
    }
}

function validateMCQLike(q, errors) {
    if (!Array.isArray(q.options)) {
        errors.push('options is not an array');
        return;
    }
    if (q.options.length !== 4) errors.push(`expected exactly 4 options, got ${q.options.length}`);
    const withText = q.options.filter(o => o && isNonEmptyString(o.text));
    if (withText.length !== q.options.length) errors.push('one or more options missing text');
    const correctCount = q.options.filter(o => o && o.isCorrect === true).length;
    if (correctCount !== 1) errors.push(`expected exactly 1 correct option, got ${correctCount}`);
    if (!isNonEmptyString(q.correctAnswer)) errors.push('missing "correctAnswer"');
}

const TYPE_VALIDATORS = {
    'mcq': (q, errors) => validateMCQLike(q, errors),

    'assertion-reason': (q, errors) => {
        if (!isNonEmptyString(q.assertion)) errors.push('missing "assertion"');
        if (!isNonEmptyString(q.reason)) errors.push('missing "reason"');
        validateMCQLike(q, errors);
    },

    'case-study': (q, errors) => {
        if (!isNonEmptyString(q.caseText)) errors.push('missing "caseText" (the passage/case)');
        validateMCQLike(q, errors);
    },

    'fill-in-blank': (q, errors) => {
        if (!isNonEmptyString(q.correctAnswer)) errors.push('missing "correctAnswer"');
    },

    'true-false': (q, errors) => {
        const ans = String(q.correctAnswer || '').trim().toLowerCase();
        if (!['true', 'false'].includes(ans)) errors.push('correctAnswer must be "True" or "False"');
    },

    'match-following': (q, errors) => {
        if (!Array.isArray(q.columnA) || q.columnA.length < 2) errors.push('columnA must have at least 2 items');
        if (!Array.isArray(q.columnB) || q.columnB.length < 2) errors.push('columnB must have at least 2 items');
        if (!q.correctMapping || typeof q.correctMapping !== 'object') errors.push('missing "correctMapping"');
    },

    'numerical': (q, errors) => {
        if (q.correctAnswer === undefined || q.correctAnswer === null || q.correctAnswer === '') {
            errors.push('missing "correctAnswer"');
        } else if (Number.isNaN(Number(q.correctAnswer))) {
            errors.push('correctAnswer is not numeric');
        }
    },

    'diagram-based': (q, errors) => {
        if (!isNonEmptyString(q.diagramDescription)) errors.push('missing "diagramDescription"');
    },

    'subjective': (q, errors) => {
        if (!isNonEmptyString(q.modelAnswer) && !Array.isArray(q.expectedAnswerPoints)) {
            errors.push('missing "modelAnswer" or "expectedAnswerPoints"');
        }
    },
};

/**
 * @param {any} q - raw question object from the provider
 * @param {string} expectedType - one of VALID_TYPES; the batch always
 *   requests one type at a time, so this is known ahead of validation.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateQuestion(q, expectedType) {
    const errors = [];
    if (!q || typeof q !== 'object') return { valid: false, errors: ['not an object'] };

    const type = VALID_TYPES.includes(q.type) ? q.type : expectedType;
    if (!VALID_TYPES.includes(type)) errors.push(`unknown question type "${q.type}"`);

    validateCommon(q, errors);
    const specific = TYPE_VALIDATORS[type];
    if (specific) specific(q, errors);

    return { valid: errors.length === 0, errors };
}

/**
 * @param {any} questions - raw array from the provider
 * @param {string} expectedType
 * @returns {{ valid: object[], invalid: {index:number, errors:string[], raw:any}[] }}
 */
function validateBatch(questions, expectedType) {
    const valid = [];
    const invalid = [];

    if (!Array.isArray(questions)) {
        return { valid, invalid: [{ index: -1, errors: ['response was not an array'], raw: questions }] };
    }

    questions.forEach((q, index) => {
        const { valid: ok, errors } = validateQuestion(q, expectedType);
        if (ok) {
            // Normalize/clamp the AI's self-reported quality signals
            // (Section 15) so a stray out-of-range or missing value from
            // the model never reaches the UI unclamped.
            q.type = VALID_TYPES.includes(q.type) ? q.type : expectedType;
            q.aiConfidence = clampScore(q.aiConfidence, 75);
            q.qualityScore = clampScore(q.qualityScore, 70);
            q.estimatedAccuracy = clampScore(q.estimatedStudentAccuracy ?? q.estimatedAccuracy, 60);
            delete q.estimatedStudentAccuracy;
            valid.push(q);
        } else {
            invalid.push({ index, errors, raw: q });
        }
    });

    return { valid, invalid };
}

/**
 * Dedupe by questionText (case-insensitive, trimmed) — same rule as
 * aiValidator.js, kept consistent across both AI modules.
 */
function dedupeQuestions(questions) {
    const seen = new Set();
    const result = [];
    for (const q of questions) {
        const key = String(q.questionText || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(q);
    }
    return result;
}

module.exports = {
    VALID_TYPES,
    VALID_DIFFICULTIES,
    validateQuestion,
    validateBatch,
    dedupeQuestions,
};
