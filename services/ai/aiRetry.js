// services/ai/aiRetry.js
//
// Generic retry wrapper for AI provider calls. Classifies failures so we
// only retry the ones worth retrying (transient/parsing issues) and give
// up immediately on the ones a retry can't fix (e.g. missing/invalid API
// key, permission errors).

// Failures we should NOT retry — retrying won't help and just burns time.
const NON_RETRYABLE_PATTERNS = [
    /api key/i,
    /not configured/i,
    /unauthorized/i,
    /forbidden/i,
    /permission/i,
];

// Failures explicitly called out in the spec as worth retrying.
const RETRYABLE_PATTERNS = [
    /max_?tokens/i,
    /invalid json/i,
    /unexpected token/i,
    /timeout/i,
    /timed out/i,
    /empty response/i,
    /malformed/i,
    /not an array/i,
    /econnreset/i,
    /rate limit/i,
    /overloaded/i,
    /5\d\d/, // e.g. "500", "503" surfaced in an error message
];

function isRetryable(reasonOrMessage) {
    const msg = String(reasonOrMessage || '');
    if (NON_RETRYABLE_PATTERNS.some(re => re.test(msg))) return false;
    if (!msg) return true; // no info at all — assume transient, worth one more try
    return RETRYABLE_PATTERNS.some(re => re.test(msg));
}

/**
 * Runs `fn` up to `maxRetries` times total. `fn` must return a promise
 * resolving to { ok: true, ... } on success or { ok: false, reason } on a
 * "soft" failure (the shape aiProvider.js uses), or it may throw.
 *
 * @param {(attempt: number) => Promise<{ok: boolean, [key: string]: any}>} fn
 * @param {{ label?: string, maxRetries?: number }} opts
 * @returns {Promise<{ok: boolean, [key: string]: any}>}
 */
async function withRetry(fn, { label = 'ai-call', maxRetries = 3 } = {}) {
    // Lazy require to avoid a circular dependency at module-load time.
    const aiLogger = require('./aiLogger');

    let lastReason = 'unknown error';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn(attempt);
            if (result && result.ok) {
                return result;
            }
            lastReason = (result && result.reason) || 'provider returned ok:false';
        } catch (err) {
            lastReason = err.message || 'unknown error';
        }

        const canRetry = attempt < maxRetries && isRetryable(lastReason);
        if (!canRetry) {
            break;
        }
        aiLogger.retry({ label, attempt, maxAttempts: maxRetries, reason: lastReason });
    }

    return { ok: false, reason: lastReason };
}

module.exports = { withRetry, isRetryable };
