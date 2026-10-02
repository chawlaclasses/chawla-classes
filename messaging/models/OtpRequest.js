"use strict";
const mongoose = require("mongoose");

/** Only a keyed hash of the code is stored — never the code itself. */
const schema = new mongoose.Schema({
  phone:     { type: String, required: true, index: true },
  purpose:   { type: String, required: true },     // login | admission_form | password_reset | review ...
  codeHash:  { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts:  { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  consumed:  { type: Boolean, default: false },
  verifiedAt: Date,
  requestIp: String,
  messageId: String,                                // NotificationLog.messageId
}, { timestamps: true });

schema.index({ phone: 1, purpose: 1, createdAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });   // keep 1h after expiry for audit, then purge

module.exports = mongoose.models.OtpRequest || mongoose.model("OtpRequest", schema);
