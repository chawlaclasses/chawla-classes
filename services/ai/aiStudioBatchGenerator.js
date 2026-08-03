// services/ai/aiStudioBatchGenerator.js
//
// Orchestrates AI Question Studio generation: the admin picks 1+ question
// types (Section 4) and a difficulty distribution across up to 4 buckets
// (Section 6 — easy/medium/hard/very_hard, must sum to the requested
// question count). This module fans that combination out into small
// per-type-per-difficulty batches (same MAX_TOKENS-avoidance strategy as
// services/ai/aiBatchGenerator.js), validates each batch with
// aiStudioValidator, retries failures, and merges + dedupes the result.
//
// IMPORTANT: this module only ever returns questions in memory. Nothing
// is written to the database here — see routes/admin/ai-question-studio.js
// for why that split matters (Generate -> Preview -> Review -> Approve -> Save).

"use strict";

const aiStudioProvider = require('./aiStudioProvider');
const aiStudioValidator = require('./aiStudioValidator');
const { withRetry } = require('./aiRetry');
const aiLogger = require('./aiLogger');
const { generateUUID } = require('../../utils/helpers');

const DEFAULT_BATCH_SIZE = parseInt(process.env.AI_BATCH_SIZE, 10) || 5;
const DEFAULT_MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES, 10) || 3;

/**
 * Splits `total` into `parts` buckets as evenly as possible, e.g.
 * splitEvenly(10, 3) -> [4, 3, 3].
 */
function splitEvenly(total, parts) {
    if (parts <= 0) return [];
    const base = Math.floor(total / parts);
    let remainder = total - base * parts;
    return Array.from({ length: parts }, () => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        return base + extra;
    });
}

async function generateOneCell({ topicDescriptor, type, difficultyLabel, count, spec, batchSize, maxRetries, excludeTexts }) {
    const collected = [];
    const label = `studio/${type}/${difficultyLabel}`;
    let batchNumber = 0;
    const totalBatches = Math.ceil(count / batchSize);

    while (collected.length < count) {
        batchNumber += 1;
        const remaining = count - collected.length;
        const thisBatchSize = Math.min(batchSize, remaining);
        const alreadySeen = [...excludeTexts, ...collected.map(q => q.questionText)];

        aiLogger.batchStart({ label, batchNumber, totalBatches, requested: thisBatchSize });
        const batchStart = Date.now();

        const result = await withRetry(
            () => aiStudioProvider.generateQuestionBatch({
                topicDescriptor, type, difficultyLabel, count: thisBatchSize,
                spec: { ...spec, excludeTexts: alreadySeen },
            }),
            { label, maxRetries }
        );

        if (!result.ok) {
            aiLogger.providerError({ label, message: `Giving up after retries: ${result.reason}` });
            break;
        }

        const { valid, invalid } = aiStudioValidator.validateBatch(result.data, type);
        invalid.forEach(item => aiLogger.validationError({ label, index: item.index, errors: item.errors }));

        valid.forEach(q => { if (!q.difficulty) q.difficulty = difficultyLabel; });
        collected.push(...valid);

        aiLogger.batchEnd({ label, batchNumber, totalBatches, valid: valid.length, invalid: invalid.length, durationMs: Date.now() - batchStart });

        if (valid.length === 0) {
            aiLogger.providerError({ label, message: 'Batch produced zero valid questions, stopping cell early' });
            break;
        }
    }

    return collected.slice(0, count);
}

/**
 * @param {{
 *   topicDescriptor: string,
 *   questionTypes: string[],           // e.g. ['mcq', 'subjective']
 *   difficultyMix: {easy?:number, medium?:number, hard?:number, very_hard?:number},
 *   spec: object,                      // full studio spec passed through to the prompt builder
 *   batchSize?: number, maxRetries?: number
 * }} params
 * @returns {Promise<{ questions: object[], requested: number, generated: number, cells: object[] }>}
 */
async function generateStudioQuestions({
    topicDescriptor, questionTypes, difficultyMix, spec,
    batchSize = DEFAULT_BATCH_SIZE, maxRetries = DEFAULT_MAX_RETRIES,
}) {
    const types = (questionTypes && questionTypes.length) ? questionTypes : ['mcq'];
    const difficulties = ['easy', 'medium', 'hard', 'very_hard'].filter(d => Number(difficultyMix[d]) > 0);
    const totalRequested = difficulties.reduce((sum, d) => sum + Number(difficultyMix[d]), 0);

    let merged = [];
    const excludeTexts = [];
    const cells = [];

    for (const difficultyLabel of difficulties) {
        const difficultyCount = Number(difficultyMix[difficultyLabel]);
        // Spread this difficulty's count across the selected question types.
        const perType = splitEvenly(difficultyCount, types.length);

        for (let i = 0; i < types.length; i++) {
            const type = types[i];
            const count = perType[i];
            if (count <= 0) continue;

            const bucket = await generateOneCell({
                topicDescriptor, type, difficultyLabel, count, spec,
                batchSize, maxRetries, excludeTexts,
            });
            bucket.forEach(q => excludeTexts.push(q.questionText));
            merged.push(...bucket);
            cells.push({ type, difficulty: difficultyLabel, requested: count, generated: bucket.length });
        }
    }

    merged = aiStudioValidator.dedupeQuestions(merged);

    // Assign a client-side-stable tempId now — the Preview step, edits,
    // regenerate, and Save all reference questions by this id, never by
    // array position (positions shift as items are deleted/regenerated).
    merged.forEach(q => { q.tempId = generateUUID(); });

    return {
        questions: merged,
        requested: totalRequested,
        generated: merged.length,
        cells,
    };
}

module.exports = {
    generateStudioQuestions,
    splitEvenly,
    DEFAULT_BATCH_SIZE,
    DEFAULT_MAX_RETRIES,
};
