/**
 * utils/llm.js
 *
 * Thin wrapper around the Google Gemini API (generateContent) using Node's
 * built-in https module — no SDK dependency needed. Same graceful-no-op
 * pattern as utils/mailer.js / utils/whatsapp.js / utils/sms.js: if
 * GEMINI_API_KEY isn't set, callers get back { ok: false, reason } instead
 * of a thrown error, so the AI routes can respond cleanly on a fresh
 * install that hasn't added a key yet.
 *
 * Switched from Anthropic Claude to Google Gemini (free tier) — same
 * callClaude / callClaudeJSON / isConfigured export names are kept so
 * services/ai.js and routes/admin/ai.js don't need any changes.
 *
 * Get a free key (no credit card) at https://aistudio.google.com/apikey
 *
 * Used by: AI Question Generator, AI Paper Generator, AI Answer
 * Explanation, and the optional narrative layer on Performance Prediction /
 * Weak Topic Recommendation (both of which still work without an API key,
 * since their core logic is statistical — see services/ai.js).
 */

"use strict";

const https = require("https");
const logger = require("./logger");

// Uses the "latest" alias so this always points at Google's current
// stable Flash model — avoids breaking again the next time Google
// deprecates a dated model ID (gemini-2.5-flash was retired June 2026).
const MODEL = "gemini-flash-latest";
const API_VERSION = "v1beta";

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Which "disable/limit thinking" shape to put in generationConfig.
// Gemini 2.5 models only understand thinkingBudget (token count).
// Gemini 3.x models only understand thinkingLevel (a semantic level) and
// reject thinkingBudget outright with 400 INVALID_ARGUMENT. Since MODEL is
// a "latest" alias that Google can silently roll onto a new generation,
// we can't hardcode one shape — we try each in turn and fall back.
const THINKING_CONFIG_VARIANTS = [
  { thinkingConfig: { thinkingBudget: 0 } },        // Gemini 2.5-style
  { thinkingConfig: { thinkingLevel: "MINIMAL" } },  // Gemini 3.x-style
  {},                                                // no thinking config at all
];

// Second fallback axis: some model/API-version combos also reject
// responseMimeType: "application/json" (400 invalid argument) even though
// the thinkingConfig shape was fine. We try JSON mode first (cleaner
// output), then fall back to plain text — callClaudeJSON() already strips
// markdown fences and stray text around the JSON, so plain text still works.
const RESPONSE_MODE_VARIANTS = [
  { responseMimeType: "application/json" },
  {},
];

// Full list of generationConfig combinations to try, in order.
const GENERATION_CONFIG_VARIANTS = RESPONSE_MODE_VARIANTS.flatMap(
  responseModeVariant => THINKING_CONFIG_VARIANTS.map(
    thinkingVariant => ({ ...responseModeVariant, ...thinkingVariant })
  )
);

function buildBody({ system, prompt, maxTokens, configVariant }) {
  return JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.2,
      ...configVariant,
    },
  });
}

function isThinkingParamError(statusCode, data) {
  if (statusCode !== 400) return false;
  // Gemini's 400 body for a bad thinkingConfig shape is often a generic
  // "Request contains an invalid argument." with no mention of "thinking"
  // at all — so we can't reliably detect this by message content. Instead,
  // retry on any 400 EXCEPT the handful of reasons a different
  // thinkingConfig shape can't possibly fix (bad/missing API key, quota,
  // or a safety block) — those would just fail 3x for the same reason.
  const msg = (data || "").toLowerCase();
  const definitelyNotFixableByRetry =
    msg.includes("api key") || msg.includes("api_key_invalid") ||
    msg.includes("quota") || msg.includes("resource_exhausted") ||
    msg.includes("safety") || msg.includes("blocked");
  return !definitelyNotFixableByRetry;
}

function doRequest(body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: `/${API_VERSION}/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, data }));
    });

    req.on("error", (err) => resolve({ statusCode: 0, data: "", error: err }));

    req.write(body);
    req.end();
  });
}

/**
 * @param {{ system?: string, prompt: string, maxTokens?: number }} opts
 * @returns {Promise<{ ok: boolean, text?: string, reason?: string }>}
 */
async function callClaude({ system, prompt, maxTokens = 2000 }) {
  if (!isConfigured()) {
    logger.warn("AI request skipped: GEMINI_API_KEY is not set in .env — AI features running in no-op mode.");
    return { ok: false, reason: "AI is not configured (GEMINI_API_KEY missing)" };
  }

  let lastResult = null;

  for (let i = 0; i < GENERATION_CONFIG_VARIANTS.length; i++) {
    const body = buildBody({ system, prompt, maxTokens, configVariant: GENERATION_CONFIG_VARIANTS[i] });
    const result = await doRequest(body);
    lastResult = result;

    if (result.error) {
      logger.error(`AI request error: ${result.error.message}`);
      return { ok: false, reason: result.error.message };
    }

    if (result.statusCode >= 200 && result.statusCode < 300) {
      try {
        const parsed = JSON.parse(result.data);
        const parts = parsed?.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p.text || "").join("\n");
        if (!text) {
          return { ok: false, reason: "AI returned an empty response" };
        }
        if (i > 0) {
          logger.info(`AI request succeeded on generationConfig variant ${i + 1}/${GENERATION_CONFIG_VARIANTS.length}: ${JSON.stringify(GENERATION_CONFIG_VARIANTS[i])}`);
        }
        return { ok: true, text };
      } catch (err) {
        return { ok: false, reason: "Could not parse AI response" };
      }
    }

    // Only retry with the next config shape if this looks like a fixable
    // "bad request" (wrong param for this model generation); any other
    // error (bad key, quota, safety block, etc.) fails immediately instead
    // of retrying 6x for no reason.
    if (!isThinkingParamError(result.statusCode, result.data)) {
      break;
    }
    logger.warn(`AI request got HTTP ${result.statusCode} on generationConfig variant ${i + 1}/${GENERATION_CONFIG_VARIANTS.length} (${JSON.stringify(GENERATION_CONFIG_VARIANTS[i])}), retrying with a different shape — ${result.data}`);
  }

  logger.error(`AI request failed: HTTP ${lastResult.statusCode} — ${lastResult.data}`);
  return { ok: false, reason: `AI service error (HTTP ${lastResult.statusCode})` };
}

// Convenience wrapper for prompts that ask the model to return strict JSON —
// strips ```json fences if present, and also strips any stray reasoning
// text before/after the JSON itself (some models emit a line of working
// before the array/object even when told not to), then parses.
async function callClaudeJSON(opts) {
  const result = await callClaude(opts);
  if (!result.ok) return result;
  try {
    let cleaned = result.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    // If there's stray text before/after the JSON, extract just the
    // outermost [...] or {...} block.
    const firstBracket = cleaned.search(/[[{]/);
    if (firstBracket > 0) {
      cleaned = cleaned.slice(firstBracket);
    }
    const lastCloseBracket = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (lastCloseBracket !== -1 && lastCloseBracket < cleaned.length - 1) {
      cleaned = cleaned.slice(0, lastCloseBracket + 1);
    }

    return { ok: true, data: JSON.parse(cleaned) };
  } catch (err) {
    logger.error(`AI JSON parse failed: ${err.message} — raw: ${result.text.slice(0, 300)}`);
    return { ok: false, reason: "AI returned unparseable content" };
  }
}

module.exports = { callClaude, callClaudeJSON, isConfigured };