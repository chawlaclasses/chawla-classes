"use strict";
// Shared helpers for sending a new/updated account's login details:
//  - appDownloadUrl(req): the public "Download App" link (admin-configured
//    in Admin -> App Download; /download-app redirects/streams to it).
//  - buildCredentialsText(): plain-text body used for SMS.
//  - sendCredentialsSms(): sends that text via utils/sms.js (Fast2SMS).
const { sendSms, isConfigured } = require("./sms");

function appDownloadUrl(req) {
  return `${req.protocol}://${req.get("host")}/download-app`;
}

// Accepts 10-digit Indian numbers, 91XXXXXXXXXX, or +<country><number>.
function toE164(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return /^\+\d{8,15}$/.test(digits) ? digits : "";
  const d = digits.replace(/^0+/, "");
  if (/^\d{10}$/.test(d)) return "+91" + d;
  if (/^91\d{10}$/.test(d)) return "+" + d;
  return "";
}

function buildCredentialsText({ name, loginId, password, appLink, loginLink, isUpdate }) {
  const lines = [
    `Chawla Classes: ${isUpdate ? "login details updated" : "your account is ready"}${name ? ` (${name})` : ""}.`,
    `Login ID: ${loginId}`,
    `Password: ${password || "(unchanged - use your existing password)"}`,
  ];
  if (loginLink) lines.push(`Login: ${loginLink}`);
  if (appLink) lines.push(`Download app: ${appLink}`);
  return lines.join("\n");
}

async function sendCredentialsSms(opts, phone) {
  const to = toE164(phone);
  if (!to) return { sent: false, reason: "No valid phone number saved (add a 10-digit mobile number)" };
  return sendSms({ to, body: buildCredentialsText(opts) });
}

module.exports = { appDownloadUrl, toE164, buildCredentialsText, sendCredentialsSms, smsConfigured: isConfigured };
