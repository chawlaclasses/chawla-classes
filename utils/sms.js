/**
 * utils/sms.js
 *
 * Single SMS sender for the app (credentials texts, Communication Center,
 * Marketing Campaigns). Provider: Fast2SMS (https://www.fast2sms.com),
 * called through Node's built-in https module — no SDK dependency needed.
 *
 * Same graceful-no-op pattern as utils/mailer.js / utils/whatsapp.js: if
 * FAST2SMS_API_KEY isn't set, this logs and returns { sent: false } instead
 * of throwing.
 *
 * Env:
 *   FAST2SMS_API_KEY      (required to actually send)
 *   FAST2SMS_ROUTE        "q" (quick SMS, default) | "dlt" | "otp"
 *   FAST2SMS_SENDER_ID    DLT sender id (only for route "dlt")
 *   FAST2SMS_TEMPLATE_ID  DLT message id (only for route "dlt" free-form sends)
 *
 * Recipient numbers may be 10-digit, 91XXXXXXXXXX, or +91XXXXXXXXXX —
 * they are normalised to the 10-digit form Fast2SMS expects.
 */

"use strict";

const https = require("https");
const logger = require("./logger");

const API_HOST = "www.fast2sms.com";
const API_PATH = "/dev/bulkV2";

function isConfigured() {
  return Boolean(process.env.FAST2SMS_API_KEY);
}

/** "+919876543210" | "919876543210" | "09876543210" | "9876543210" -> "9876543210" ("" if invalid) */
function normalizeNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return "";
}

function buildPayload({ numbers, body, route, variables, templateId, senderId }) {
  if (route === "otp") {
    return { route: "otp", variables_values: String(variables || body), numbers };
  }
  if (route === "dlt") {
    return {
      route: "dlt",
      sender_id: senderId || process.env.FAST2SMS_SENDER_ID,
      message: templateId || process.env.FAST2SMS_TEMPLATE_ID,
      variables_values: variables || "",
      numbers,
    };
  }
  return { route: "q", message: body, numbers, flash: 0 };
}

/**
 * Low-level call. Resolves with { sent, reason?, requestId?, raw? } — never rejects.
 * `numbers` may be a single number or an array / comma-separated list (already normalised or not).
 */
function postToFast2Sms(payload) {
  return new Promise((resolve) => {
    const json = JSON.stringify(payload);
    const req = https.request({
      hostname: API_HOST,
      path: API_PATH,
      method: "POST",
      headers: {
        authorization: process.env.FAST2SMS_API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(json),
      },
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { /* non-JSON body */ }
        const ok = res.statusCode >= 200 && res.statusCode < 300 && parsed && parsed.return === true;
        if (ok) return resolve({ sent: true, requestId: parsed.request_id, raw: parsed });
        const reason = (parsed && parsed.message)
          ? (Array.isArray(parsed.message) ? parsed.message.join(", ") : String(parsed.message))
          : `Fast2SMS error (HTTP ${res.statusCode})`;
        logger.error(`SMS send failed: HTTP ${res.statusCode} — ${data}`);
        resolve({ sent: false, reason, status: res.statusCode, raw: parsed });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Fast2SMS request timed out")));
    req.on("error", (err) => {
      logger.error(`SMS send error: ${err.message}`);
      resolve({ sent: false, reason: err.message });
    });
    req.write(json);
    req.end();
  });
}

/**
 * @param {{ to: string, body: string, route?: string, variables?: string, templateId?: string, senderId?: string }} opts
 * @returns {Promise<{ sent: boolean, reason?: string, requestId?: string }>}
 */
async function sendSms({ to, body, route, variables, templateId, senderId }) {
  if (!to) return { sent: false, reason: "No recipient phone number" };
  if (!isConfigured()) {
    logger.warn("SMS not sent: FAST2SMS_API_KEY not set — running in no-op mode.");
    return { sent: false, reason: "SMS (Fast2SMS) not configured" };
  }
  const numbers = normalizeNumber(to);
  if (!numbers) return { sent: false, reason: "Invalid phone number (need a 10-digit Indian mobile number)" };

  const payload = buildPayload({
    numbers, body, variables, templateId, senderId,
    route: (route || process.env.FAST2SMS_ROUTE || "q").toLowerCase(),
  });
  const result = await postToFast2Sms(payload);
  return result.sent
    ? { sent: true, requestId: result.requestId }
    : { sent: false, reason: result.reason };
}

module.exports = { sendSms, isConfigured, normalizeNumber, buildPayload, postToFast2Sms };
