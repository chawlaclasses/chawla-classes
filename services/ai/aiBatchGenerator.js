// services/ai/aiBatchGenerator.js
//
// The actual fix for MAX_TOKENS / broken-JSON failures: never ask the
// provider for more than AI_BATCH_SIZE questions in a single call.
// A request like "Easy=5, Medium=10, Hard=5" is split into small batches
// per difficulty (Medium=10 becomes two batches of 5, by default), each
// batch is validated, invalid items are dropped, the shortfall is
// re-requested (up to AI_MAX_RETRIES), and everything is merged +
// deduplicated at the end.
//
// Default batch size: 5, configurable via AI_BATCH_SIZE. Never exceeded.

const aiProvider = require('./aiProvider');
const aiValidator = require('./aiValidator');
const { withRetry } = require('./aiRetry');
const aiLogger = require('./aiLogger');

const DEFAULT_BATCH_SIZE = parseInt(process.env.AI_BATCH_SIZE, 10) || 5;
const DEFAULT_MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES, 10) || 3;

/**
 * Generate `count` VALID questions for a single difficulty bucket, in
 * batches of at most `batchSize`. Invalid items are dropped (not counted
 * toward `count`) and the shortfall is re-requested from the provider,
 * with the retry engine handling transient failures within each batch.
 */
async function generateDifficultyBucket({ chapter, difficultyLabel, count, batchSize, maxRetries }) {
    const collected = [];
    let batchNumber = 0;
    const totalBatches = Math.ceil(count / batchSize);
    const bucketStart = Date.now();
    const label = `${chapter}/${difficultyLabel}`;

    while (collected.length < count) {
        batchNumber += 1;
        const remaining = count - collected.length;
        const thisBatchSize = Math.min(batchSize, remaining);

        aiLogger.batchStart({ label, batchNumber, totalBatches, requested: thisBatchSize });
        const batchStartTime = Date.now();

        const result = await withRetry(
            () => aiProvider.generateQuestionBatch({ chapter, difficultyLabel, count: thisBatchSize }),
            { label, maxRetries }
        );

        if (!result.ok) {
            // Couldn't get a usable response after all retries for this
            // batch — log it and stop trying for this bucket rather than
            // looping forever. Whatever was already collected is kept.
            aiLogger.providerError({ label, message: `Giving up after retries: ${result.reason}` });
            break;
        }

        const { valid, invalid } = aiValidator.validateBatch(result.data);
        invalid.forEach(item => aiLogger.validationError({ label, index: item.index, errors: item.errors }));

        // Tag difficulty explicitly — the model sometimes omits or
        // mislabels it even when asked directly for one difficulty.
        valid.forEach(q => { if (!q.difficulty) q.difficulty = difficultyLabel; });

        collected.push(...valid);

        aiLogger.batchEnd({
            label,
            batchNumber,
            totalBatches,
            valid: valid.length,
            invalid: invalid.length,
            durationMs: Date.now() - batchStartTime,
        });

        // Safety valve: if a batch comes back with zero valid questions
        // even after retries, don't spin forever re-requesting the same
        // broken shape — bail out of this bucket with what we have.
        if (valid.length === 0) {
            aiLogger.providerError({ label, message: 'Batch produced zero valid questions, stopping bucket early' });
            break;
        }
    }

    aiLogger.generationSummary({
        label,
        totalRequested: count,
        totalGenerated: collected.length,
        durationMs: Date.now() - bucketStart,
    });

    return collected.slice(0, count);
}

/**
 * Main entry point. `difficultyMix` is e.g. { easy: 5, medium: 10, hard: 5 }.
 * Each difficulty is generated independently, in its own batches, then
 * everything is merged and deduplicated by questionText.
 *
 * @param {{ chapter: string, difficultyMix: {easy?: number, medium?: number, hard?: number}, batchSize?: number, maxRetries?: number }} params
 * @returns {Promise<{ questions: object[], requested: number, generated: number }>}
 */
async function generateQuestions({ chapter, difficultyMix, batchSize = DEFAULT_BATCH_SIZE, maxRetries = DEFAULT_MAX_RETRIES }) {
    const difficulties = ['easy', 'medium', 'hard'].filter(d => Number(difficultyMix[d]) > 0);
    const totalRequested = difficulties.reduce((sum, d) => sum + Number(difficultyMix[d]), 0);

    let merged = [];
    for (const difficultyLabel of difficulties) {
        const count = Number(difficultyMix[difficultyLabel]);
        const bucket = await generateDifficultyBucket({ chapter, difficultyLabel, count, batchSize, maxRetries });
        merged.push(...bucket);
    }

    merged = aiValidator.dedupeQuestions(merged);

    return {
        questions: merged,
        requested: totalRequested,
        generated: merged.length,
    };
}

module.exports = {
    generateQuestions,
    DEFAULT_BATCH_SIZE,
    DEFAULT_MAX_RETRIES,
};
