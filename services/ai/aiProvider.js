// services/ai/aiProvider.js
//
// Single choke point for talking to an LLM. Routes and the batch
// generator never call an LLM SDK directly — they call
// generateQuestionBatch() / explainAnswer() below, and this file decides
// which underlying provider actually handles it.
//
// Today that's Google Gemini, via the project's existing utils/llm.js
// (already wired up with GEMINI_API_KEY handling and JSON-mode parsing).
// Adding another provider later means adding a new branch in each
// function below — no route or service-layer code changes required.
//
// Select the active provider with the AI_PROVIDER env var (default:
// "gemini"). An unimplemented provider fails loudly rather than silently
// falling back to Gemini, so a typo in AI_PROVIDER can't quietly bill the
// wrong account or use the wrong model.

const { callClaude, callClaudeJSON } = require('../../utils/llm');
const aiLogger = require('./aiLogger');

const SUPPORTED_PROVIDERS = ['gemini'];
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const QUESTION_GEN_SYSTEM_PROMPT = `You are an expert exam question writer for an Indian coaching institute.

Generate high-quality multiple-choice questions suitable for students preparing for board/competitive exams.

Always respond with ONLY a JSON array (no markdown fences, no commentary) in this exact shape:

[{"questionText":"...","options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}],"correctAnswer":"<text of the correct option>","explanation":"<2-3 sentence explanation>","difficulty":"easy|medium|hard"}]

Each question must have exactly 4 options.
Exactly one option must have "isCorrect": true.
Do not repeat questions.

IMPORTANT:
Return ONLY valid JSON.

Do NOT return:
- markdown
- explanations
- notes
- thinking
- code fences

The first character of your response MUST be "[".
The last character of your response MUST be "]".

If you cannot generate questions, return [] only.`;

const NOTES_GEN_SYSTEM_PROMPT = `You are an expert teacher at an Indian coaching institute, writing clear study notes for students preparing for board/competitive exams.

Always respond with ONLY a JSON object (no markdown fences, no commentary) in this exact shape:

{"title":"<short chapter/topic title>","content":"<the full study notes, using \\n for line breaks>"}

The "content" value must be well-structured study notes in Markdown:
- Start with a one-line overview of the topic.
- Use "## " headings for each key sub-topic/section.
- Use bullet points ("- ") for definitions, formulas, and key facts.
- Include a short "## Key Points to Remember" section at the end.
- Keep language simple and exam-focused. No filler, no repetition.

IMPORTANT:
Return ONLY valid JSON — the first character of your response MUST be "{" and the last character MUST be "}".`;

// Tokens are budgeted per-question, generously. Batching (see
// aiBatchGenerator.js) is what actually solves MAX_TOKENS truncation —
// this is just a second line of defense so a single small batch is never
// starved of tokens either.
const TOKENS_PER_QUESTION = 500;
const MIN_BATCH_TOKENS = 1200;

/**
 * Ask the provider for exactly `count` questions on `chapter` at
 * `difficultyLabel`. Never throws.
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, reason: string}>}
 */
async function generateQuestionBatch({ chapter, difficultyLabel, count }) {
    if (!SUPPORTED_PROVIDERS.includes(PROVIDER)) {
        // Placeholder for future providers (OpenAI, ...).
        return { ok: false, reason: `Provider "${PROVIDER}" is not implemented yet. Supported: ${SUPPORTED_PROVIDERS.join(', ')}.` };
    }

    try {
        const result = await callClaudeJSON({
            system: QUESTION_GEN_SYSTEM_PROMPT,
            prompt: `Generate exactly ${count} multiple-choice questions on the topic "${chapter}" with difficulty "${difficultyLabel}". Return ONLY the JSON array with exactly ${count} items.`,
            maxTokens: Math.max(MIN_BATCH_TOKENS, TOKENS_PER_QUESTION * count),
        });

        if (!result.ok) {
            aiLogger.providerError({ label: `generateQuestionBatch(${chapter}/${difficultyLabel})`, message: result.reason });
            return { ok: false, reason: result.reason || 'Provider call failed' };
        }
        if (!Array.isArray(result.data)) {
            return { ok: false, reason: 'Provider returned invalid JSON (not an array)' };
        }
        return { ok: true, data: result.data };
    } catch (err) {
        aiLogger.providerError({ label: `generateQuestionBatch(${chapter}/${difficultyLabel})`, message: err.message });
        return { ok: false, reason: err.message || 'Unknown provider error' };
    }
}

/**
 * Ask the provider to explain why an answer is correct. Thin passthrough
 * to callClaude today; kept here so routes never import utils/llm.js
 * directly — same rule as generateQuestionBatch.
 * @returns {Promise<{ok: true, text: string} | {ok: false, reason: string}>}
 */
async function explainAnswer({ questionText, options, correctAnswer }) {
    if (!SUPPORTED_PROVIDERS.includes(PROVIDER)) {
        return { ok: false, reason: `Provider "${PROVIDER}" is not implemented yet. Supported: ${SUPPORTED_PROVIDERS.join(', ')}.` };
    }

    try {
        const result = await callClaude({
            system: 'You are a patient tutor. Explain WHY the correct answer is correct in clear, simple language a student can learn from. 2-4 sentences. No markdown, no headers.',
            prompt: `Question: ${questionText}\nOptions: ${(options || []).map(o => o.text).join(' | ')}\nCorrect answer: ${correctAnswer}\n\nExplain why this is correct.`,
            maxTokens: 400,
        });

        if (!result.ok) {
            aiLogger.providerError({ label: 'explainAnswer', message: result.reason });
            return { ok: false, reason: result.reason };
        }
        return { ok: true, text: result.text.trim() };
    } catch (err) {
        aiLogger.providerError({ label: 'explainAnswer', message: err.message });
        return { ok: false, reason: err.message || 'Unknown provider error' };
    }
}

/**
 * Ask the provider to write full study notes on a chapter/topic.
 * Never throws.
 * @returns {Promise<{ok: true, data: {title: string, content: string}} | {ok: false, reason: string}>}
 */
async function generateNotes({ chapter, subject, classLevel }) {
    if (!SUPPORTED_PROVIDERS.includes(PROVIDER)) {
        return { ok: false, reason: `Provider "${PROVIDER}" is not implemented yet. Supported: ${SUPPORTED_PROVIDERS.join(', ')}.` };
    }

    try {
        const contextBits = [
            `topic/chapter "${chapter}"`,
            subject ? `subject "${subject}"` : null,
            classLevel ? `class level "${classLevel}"` : null,
        ].filter(Boolean).join(', ');

        const result = await callClaudeJSON({
            system: NOTES_GEN_SYSTEM_PROMPT,
            prompt: `Write complete study notes for ${contextBits}. Return ONLY the JSON object described in the system prompt.`,
            maxTokens: 2500,
        });

        if (!result.ok) {
            aiLogger.providerError({ label: `generateNotes(${chapter})`, message: result.reason });
            return { ok: false, reason: result.reason || 'Provider call failed' };
        }
        if (!result.data || typeof result.data.content !== 'string' || !result.data.content.trim()) {
            return { ok: false, reason: 'Provider returned invalid JSON (missing content)' };
        }
        return {
            ok: true,
            data: {
                title: (result.data.title && String(result.data.title).trim()) || chapter,
                content: result.data.content.trim(),
            },
        };
    } catch (err) {
        aiLogger.providerError({ label: `generateNotes(${chapter})`, message: err.message });
        return { ok: false, reason: err.message || 'Unknown provider error' };
    }
}

module.exports = {
    generateQuestionBatch,
    explainAnswer,
    generateNotes,
    CURRENT_PROVIDER: PROVIDER,
};