/**
 * utils/whatsapp.js
 *
 * Sends WhatsApp text messages via Meta's WhatsApp Business Cloud API using
 * Node's built-in https module — no SDK dependency needed. Same
 * graceful-no-op pattern as utils/mailer.js and utils/sms.js: if the env vars
 * aren't set, this logs and returns { sent: false } instead of throwing, so
 * the calling broadcast endpoint can still report a clean per-channel result.
 *
 * To enable: set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env
 * (from Meta for Developers -> WhatsApp -> API Setup). Optional:
 * WHATSAPP_API_VERSION (default v20.0).
 *
 * NOTE: Meta only delivers free-form text to numbers that messaged you in the
 * last 24 hours. Business-initiated messages outside that window need an
 * approved template (see messaging/providers/stubs/whatsappCloud.js).
 *
 * Recipients may be 10-digit, 91XXXXXXXXXX, or +<country><number>.
 */

"use strict";

const https = require("https");
const logger = require("./logger");

function isConfigured() {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/** -> digits only, with country code (10-digit numbers get 91). "" if unusable. */
function toWaNumber(phone) {
  const digits = String(phone || "").replace(/^whatsapp:/, "").replace(/\D/g, "").replace(/^0+/, "");
  if (/^\d{10}$/.test(digits)) return "91" + digits;
  if (/^\d{11,15}$/.test(digits)) return digits;
  return "";
}

/**
 * @param {{ to: string, body: string }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
function sendWhatsApp({ to, body }) {
  return new Promise((resolve) => {
    if (!to) return resolve({ sent: false, reason: "No recipient phone number" });
    if (!isConfigured()) {
      logger.warn("WhatsApp not sent: WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN not set — running in no-op mode.");
      return resolve({ sent: false, reason: "WhatsApp not configured" });
    }
    const number = toWaNumber(to);
    if (!number) return resolve({ sent: false, reason: "Invalid phone number" });

    const payload = JSON.stringify({
      messaging_product: "whatsapp",
      to: number,
      type: "text",
      text: { preview_url: false, body },
    });

    const version = process.env.WHATSAPP_API_VERSION || "v20.0";
    const req = https.request({
      hostname: "graph.facebook.com",
      path: `/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ sent: true });
        } else {
          logger.error(`WhatsApp send failed to ${to}: HTTP ${res.statusCode} — ${data}`);
          resolve({ sent: false, reason: `WhatsApp API error (HTTP ${res.statusCode})` });
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("WhatsApp request timed out")));
    req.on("error", (err) => {
      logger.error(`WhatsApp send error to ${to}: ${err.message}`);
      resolve({ sent: false, reason: err.message });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { sendWhatsApp, isConfigured };
