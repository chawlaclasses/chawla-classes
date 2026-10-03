// services/sendSMS.js
//
// Backward-compatible Fast2SMS helper: sendSMS(number, message).
// The actual HTTP call lives in utils/sms.js so the whole app has exactly one
// SMS implementation (Fast2SMS). Kept as a thin wrapper so any existing
// `require("./services/sendSMS")` caller keeps working.
"use strict";

const { sendSms } = require("../utils/sms");

async function sendSMS(number, message) {
  return sendSms({ to: number, body: message });
}

module.exports = sendSMS;
