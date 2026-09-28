/**
 * utils/whatsapp.js
 *
 * Sends WhatsApp messages via Twilio's WhatsApp API using Node's built-in
 * https module — no SDK dependency needed. Same graceful-no-op pattern as
 * utils/mailer.js: if TWILIO_* env vars aren't set, this logs and returns
 * { sent: false } instead of throwing, so the calling broadcast endpoint
 * can still report a clean per-channel result on a fresh install.
 *
 * To enable: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and
 * TWILIO_WHATSAPP_FROM (e.g. "whatsapp:+14155238886" for the Twilio sandbox)
 * in .env. Recipient numbers should be in E.164 format (e.g. +919876543210).
 */

"use strict";

const https = require("https");
const querystring = require("querystring");
const logger = require("./logger");

function isConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

/**
 * @param {{ to: string, body: string }} opts - `to` should be a phone number in E.164 format
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
function sendWhatsApp({ to, body }) {
  return new Promise((resolve) => {
    if (!to) return resolve({ sent: false, reason: "No recipient phone number" });
    if (!isConfigured()) {
      logger.warn("WhatsApp not sent: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM not set — running in no-op mode.");
      return resolve({ sent: false, reason: "WhatsApp (Twilio) not configured" });
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const payload = querystring.stringify({
      From: process.env.TWILIO_WHATSAPP_FROM,
      To: toAddr,
      Body: body,
    });

    const req = https.request({
      hostname: "api.twilio.com",
      path: `/2010-04-01/Accounts/${sid}/Messages.json`,
      method: "POST",
      auth: `${sid}:${process.env.TWILIO_AUTH_TOKEN}`,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ sent: true });
        } else {
          logger.error(`WhatsApp send failed to ${to}: HTTP ${res.statusCode} — ${data}`);
          resolve({ sent: false, reason: `Twilio error (HTTP ${res.statusCode})` });
        }
      });
    });

    req.on("error", (err) => {
      logger.error(`WhatsApp send error to ${to}: ${err.message}`);
      resolve({ sent: false, reason: err.message });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { sendWhatsApp, isConfigured };
