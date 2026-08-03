// services/ai/aiValidator.js
//
// Validates AI-generated MCQ question objects before they get anywhere
// near the database. Uses the same question shape already produced by
// routes/admin/ai.js and expected by the Question Bank:
//
//   {
//     questionText: string,
//     options: [{ text: string, isCorrect: boolean }] x4,
//     correctAnswer: string,
//     explanation: string,
//     difficulty: 'easy' | 'medium' | 'hard'
//   }

const REQUIRED_FIELDS = ['questionText', 'options', 'correctAnswer', 'difficulty', 'explanation'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * Validate a single question object.
 * @param {any} q
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateQuestion(q) {
    const errors = [];

    if (!q || typeof q !== 'object') {
        return { valid: false, errors: ['not an object'] };
    }

    for (const field of REQUIRED_FIELDS) {
        if (q[field] === undefined || q[field] === null || q[field] === '') {
            errors.push(`missing "${field}"`);
        }
    }

    if (typeof q.questionText === 'string' && q.questionText.trim().length < 5) {
        errors.push('questionText too short');
    }

    if (!Array.isArray(q.options)) {
        errors.push('options is not an array');
    } else {
        if (q.options.length !== 4) {
            errors.push(`expected exactly 4 options, got ${q.options.length}`);
        }
        const withText = q.options.filter(o => o && typeof o.text === 'string' && o.text.trim().length > 0);
        if (withText.length !== q.options.length) {
            errors.push('one or more options missing text');
        }
        const correctCount = q.options.filter(o => o && o.isCorrect === true).length;
        if (correctCount !== 1) {
            errors.push(`expected exactly 1 correct option, got ${correctCount}`);
        }
    }

    if (q.difficulty && !VALID_DIFFICULTIES.includes(String(q.difficulty).toLowerCase())) {
        errors.push(`invalid difficulty "${q.difficulty}"`);
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate an array of questions, splitting into valid/invalid buckets.
 * Never throws — a malformed response is reported, not thrown.
 * @param {any} questions
 * @returns {{ valid: object[], invalid: { index: number, errors: string[], raw: any }[] }}
 */
function validateBatch(questions) {
    const valid = [];
    const invalid = [];

    if (!Array.isArray(questions)) {
        return { valid, invalid: [{ index: -1, errors: ['response was not an array'], raw: questions }] };
    }

    questions.forEach((q, index) => {
        const { valid: ok, errors } = validateQuestion(q);
        if (ok) {
            valid.push(q);
        } else {
            invalid.push({ index, errors, raw: q });
        }
    });

    return { valid, invalid };
}

/**
 * Remove duplicate questions by questionText (case-insensitive, trimmed).
 * Keeps the first occurrence.
 * @param {object[]} questions
 * @returns {object[]}
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
    validateQuestion,
    validateBatch,
    dedupeQuestions,
};
