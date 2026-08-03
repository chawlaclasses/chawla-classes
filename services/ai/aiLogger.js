// services/ai/aiLogger.js
//
// Centralized structured logging for the AI v2 pipeline (ai-v2.js and its
// service layer). Wraps the project's existing utils/logger so every
// AI-related log line shares a consistent "[AI-v2]" prefix and shape,
// making batches/retries/failures easy to grep in production logs
// without touching the app-wide logger itself.

const logger = require('../../utils/logger');

const PREFIX = '[AI-v2]';

/** Logged once per batch, before the provider call goes out. */
function batchStart({ label, batchNumber, totalBatches, requested }) {
    logger.info(`${PREFIX} Batch start | ${label} | batch ${batchNumber}/${totalBatches} | requested=${requested}`);
}

/** Logged once per batch, after validation, whether it fully succeeded or not. */
function batchEnd({ label, batchNumber, totalBatches, valid, invalid, durationMs }) {
    logger.info(`${PREFIX} Batch end   | ${label} | batch ${batchNumber}/${totalBatches} | valid=${valid} invalid=${invalid} durationMs=${durationMs}`);
}

/** Logged every time the retry engine re-attempts a failed provider call. */
function retry({ label, attempt, maxAttempts, reason }) {
    logger.warn(`${PREFIX} Retry | ${label} | attempt ${attempt}/${maxAttempts} | reason=${reason}`);
}

/** Logged on any provider-level failure (network, API error, bad shape, etc). */
function providerError({ label, message }) {
    logger.error(`${PREFIX} Provider error | ${label} | ${message}`);
}

/** Logged per rejected question object during validation. */
function validationError({ label, index, errors }) {
    logger.warn(`${PREFIX} Validation error | ${label} | item #${index} | ${errors.join('; ')}`);
}

/** Logged once per top-level generation request (all difficulties combined). */
function generationSummary({ label, totalRequested, totalGenerated, durationMs }) {
    logger.info(`${PREFIX} Generation summary | ${label} | requested=${totalRequested} generated=${totalGenerated} durationMs=${durationMs}`);
}

module.exports = {
    batchStart,
    batchEnd,
    retry,
    providerError,
    validationError,
    generationSummary,
};
