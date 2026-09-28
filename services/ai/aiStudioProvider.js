// services/ai/aiStudioProvider.js
//
// LLM provider for the AI Question Studio. Sibling to
// services/ai/aiProvider.js (used by ai-v2.js) — that one always asks
// for plain 4-option MCQs on a chapter/difficulty. The Studio needs a
// single call shape that can flex to: any of 9 question types, a
// generation "pattern" (NCERT/CBSE/Competency/Board/Sample Paper/PYQ/
// Olympiad/Custom), Bloom's-taxonomy weighting, tags, a free-text admin
// prompt, negative instructions, and a set of "also generate ___"
// toggles (explanation/hint/step solution/diagram suggestion/alternate
// question) — all driven from one "spec" object built by the frontend
// wizard and passed straight through from routes/admin/ai-question-studio.js.
//
// Same rule as aiProvider.js: routes/services above this never import
// utils/llm.js directly, they only ever call functions exported here.

"use strict";

const { callClaudeJSON } = require('../../utils/llm');
const aiLogger = require('./aiLogger');

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const TYPE_LABELS = {
    'mcq': 'Multiple Choice Question (exactly 4 options, exactly 1 correct)',
    'subjective': 'Subjective / long-answer question',
    'assertion-reason': 'Assertion-Reason question (Assertion + Reason, 4 standard relationship options)',
    'case-study': 'Case Study based question (a short passage/case, then a question on it)',
    'fill-in-blank': 'Fill in the Blanks',
    'true-false': 'True/False',
    'match-following': 'Match the Following (two columns)',
    'numerical': 'Numerical answer question',
    'diagram-based': 'Diagram-based question (describe the diagram needed)',
};

const PATTERN_HINTS = {
    ncert: 'Base questions strictly on NCERT textbook content and phrasing conventions.',
    cbse: 'Follow CBSE board exam question conventions and marking style.',
    competency_based: 'Write competency-based questions that test application/real-life reasoning, not rote recall, per NEP/CBSE competency-based guidelines.',
    board_pattern: 'Match the exact structure/marks pattern typically seen in board exam papers.',
    sample_paper: 'Match the style and difficulty spread of an official CBSE sample paper.',
    previous_year: 'Write in the style of previous years\u2019 board/competitive exam questions on this topic (do not copy any real PYQ verbatim — write fresh, original questions in that style).',
    olympiad: 'Write at Olympiad difficulty — deeper conceptual/logical reasoning than a standard school exam.',
    custom: '',
};

const BLOOM_LABELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

function buildBloomInstruction(bloom) {
    if (!bloom || typeof bloom !== 'object') return '';
    const active = BLOOM_LABELS.filter(l => Number(bloom[l]) > 0);
    if (active.length === 0) return '';
    const parts = active.map(l => `${l} (${Math.round(Number(bloom[l]))}%)`);
    return `Distribute questions across Bloom's Taxonomy levels roughly in these proportions: ${parts.join(', ')}.`;
}

function buildAdvancedInstruction(advanced = {}) {
    const lines = [];
    // Sliders are prompt-level steering, not an API temperature knob —
    // utils/llm.js fixes its own temperature and is intentionally not
    // modified here (existing API, not to be touched). Framing the
    // slider as an instruction is what stays within that constraint
    // while still giving the admin a meaningfully different result.
    const creativity = Number(advanced.creativity);
    if (Number.isFinite(creativity)) {
        if (creativity >= 70) lines.push('Be creative: use varied real-world contexts, scenarios and phrasing rather than textbook-identical wording.');
        else if (creativity <= 30) lines.push('Stay close to standard textbook phrasing and familiar question framing; avoid unusual scenarios.');
    }
    const accuracy = Number(advanced.accuracy);
    if (Number.isFinite(accuracy) && accuracy >= 70) {
        lines.push('Prioritize factual and numerical accuracy above all else. Double-check every computed value, date, formula and unit before finalizing.');
    }
    const diversity = Number(advanced.diversity);
    if (Number.isFinite(diversity) && diversity >= 70) {
        lines.push('Maximize diversity between questions — vary sentence structure, sub-topic focus, and context so no two questions feel like templates of each other.');
    }
    const strictness = Number(advanced.difficultyStrictness);
    if (Number.isFinite(strictness) && strictness >= 70) {
        lines.push('Adhere strictly to the requested difficulty level — do not let an "easy" question drift into medium territory or vice versa.');
    }
    if (advanced.generateExplanation !== false) lines.push('Include a clear "explanation" field (2-4 sentences) for every question.');
    if (advanced.generateHint) lines.push('Include a short "hint" field — a nudge toward the answer without giving it away.');
    if (advanced.generateStepSolution) lines.push('Include a "stepSolution" field — the full step-by-step working, especially for numerical/subjective questions.');
    if (advanced.generateDiagramSuggestion) lines.push('Include a "diagramSuggestion" field describing a diagram/figure that would help illustrate the question, even if the type is not diagram-based.');
    if (advanced.generateWrongOptions) lines.push('For MCQ-like types, make wrong options genuinely plausible common-mistake distractors, not obviously-wrong filler.');
    if (advanced.generateAlternateQuestion) lines.push('Include an "alternateQuestion" field — one alternate phrasing/version of the same question testing the same concept.');
    if (advanced.duplicateDetection !== false) lines.push('Do not repeat the same underlying question in different words within this batch.');
    return lines.join('\n');
}

function buildNegativeInstruction(negativeInstructions) {
    const defaults = [
        'Avoid duplicate questions.',
        'Avoid copying NCERT text verbatim — write original questions.',
        'Avoid incorrect numerical values.',
        'Avoid repeating well-known previous year questions verbatim.',
        'Avoid spelling mistakes.',
    ];
    const custom = Array.isArray(negativeInstructions)
        ? negativeInstructions.filter(Boolean)
        : (negativeInstructions ? [String(negativeInstructions)] : []);
    return [...defaults, ...custom].map(l => `- ${l}`).join('\n');
}

function buildTagsInstruction(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return '';
    return `Keep these tags/labels in mind as the intended use-case for these questions (do not literally repeat them in the question text): ${tags.join(', ')}.`;
}

function schemaFor(type) {
    const base = `"questionText":"...", "type":"${type}", "difficulty":"easy|medium|hard|very_hard", "marks": <number>, "explanation":"...", "aiConfidence": <0-100 self-rated confidence this question is correct and well-formed>, "qualityScore": <0-100 self-rated overall quality>, "estimatedStudentAccuracy": <0-100 estimated % of students who would answer correctly>`;

    switch (type) {
        case 'mcq':
            return `{${base}, "options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}], "correctAnswer":"<text of correct option>"}`;
        case 'assertion-reason':
            return `{${base}, "assertion":"...", "reason":"...", "options":[{"text":"Both assertion and reason are true and reason is the correct explanation","isCorrect":true},{"text":"Both assertion and reason are true but reason is not the correct explanation","isCorrect":false},{"text":"Assertion is true but reason is false","isCorrect":false},{"text":"Assertion is false but reason is true","isCorrect":false}], "correctAnswer":"<text of correct option>"}`;
        case 'case-study':
            return `{${base}, "caseText":"<short passage/case, 3-6 sentences>", "options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}], "correctAnswer":"<text of correct option>"}`;
        case 'fill-in-blank':
            return `{${base}, "correctAnswer":"<the word/phrase that fills the blank>"}`;
        case 'true-false':
            return `{${base}, "correctAnswer":"True|False"}`;
        case 'match-following':
            return `{${base}, "columnA":["...","...","...","..."], "columnB":["...","...","...","..."], "correctMapping":{"1":"c","2":"a","3":"d","4":"b"}}`;
        case 'numerical':
            return `{${base}, "correctAnswer":"<numeric value>", "unit":"<unit if applicable, else empty string>"}`;
        case 'diagram-based':
            return `{${base}, "diagramDescription":"<what the diagram should show>", "options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}], "correctAnswer":"<text of correct option>"}`;
        case 'subjective':
        default:
            return `{${base}, "modelAnswer":"<a full model answer>", "expectedAnswerPoints":["...","...","..."]}`;
    }
}

/**
 * Builds the full system + user prompt for one batch call.
 * @param {{ topicDescriptor: string, type: string, difficultyLabel: string, count: number, spec: object }} params
 */
function buildBatchPrompt({ topicDescriptor, type, difficultyLabel, count, spec = {} }) {
    const typeLabel = TYPE_LABELS[type] || type;
    const patternHint = PATTERN_HINTS[spec.pattern] || '';
    const bloomLine = buildBloomInstruction(spec.bloom);
    const advancedLines = buildAdvancedInstruction(spec.advanced);
    const negativeLines = buildNegativeInstruction(spec.negativeInstructions);
    const tagsLine = buildTagsInstruction(spec.tags);
    const language = spec.language && spec.language !== 'english' ? `Write the questions in ${spec.language}.` : '';
    const customPrompt = spec.prompt ? `Additional admin instructions: ${spec.prompt}` : '';
    const excludeTexts = Array.isArray(spec.excludeTexts) ? spec.excludeTexts.slice(0, 30) : [];
    const excludeLine = excludeTexts.length
        ? `Do NOT repeat or closely rephrase any of these already-generated questions:\n${excludeTexts.map(t => `- ${t}`).join('\n')}`
        : '';

    const system = `You are an expert exam question writer for an Indian coaching institute, generating content for the AI Question Studio admin tool.

Question type for this batch: ${typeLabel}
${patternHint}

Always respond with ONLY a JSON array (no markdown fences, no commentary) of exactly ${count} objects in this exact shape:
[${schemaFor(type)}]

Rules:
${negativeLines}
${bloomLine}
${advancedLines}

The first character of your response MUST be "[". The last character MUST be "]".
If you cannot generate valid questions, return [] only.`;

    const prompt = [
        `Generate exactly ${count} "${typeLabel}" question(s) on ${topicDescriptor}, difficulty "${difficultyLabel}".`,
        tagsLine,
        language,
        customPrompt,
        excludeLine,
        `Return ONLY the JSON array with exactly ${count} item(s).`,
    ].filter(Boolean).join('\n');

    return { system, prompt };
}

const TOKENS_PER_QUESTION = 700; // richer schema than plain MCQ, budget generously
const MIN_BATCH_TOKENS = 1500;

/**
 * Ask the provider for exactly `count` questions of one type/difficulty.
 * Never throws.
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, reason: string}>}
 */
async function generateQuestionBatch({ topicDescriptor, type, difficultyLabel, count, spec }) {
    try {
        const { system, prompt } = buildBatchPrompt({ topicDescriptor, type, difficultyLabel, count, spec });
        const result = await callClaudeJSON({
            system,
            prompt,
            maxTokens: Math.max(MIN_BATCH_TOKENS, TOKENS_PER_QUESTION * count),
        });

        if (!result.ok) {
            aiLogger.providerError({ label: `studio(${type}/${difficultyLabel})`, message: result.reason });
            return { ok: false, reason: result.reason || 'Provider call failed' };
        }
        if (!Array.isArray(result.data)) {
            return { ok: false, reason: 'Provider returned invalid JSON (not an array)' };
        }
        return { ok: true, data: result.data };
    } catch (err) {
        aiLogger.providerError({ label: `studio(${type}/${difficultyLabel})`, message: err.message });
        return { ok: false, reason: err.message || 'Unknown provider error' };
    }
}

module.exports = {
    generateQuestionBatch,
    TYPE_LABELS,
    PATTERN_HINTS,
};
