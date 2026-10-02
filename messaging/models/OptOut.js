"use strict";
const mongoose = require("mongoose");
const { CHANNELS } = require("../constants");

/** Consent registry. Promotional/bulk sends are filtered against it; OTP is never blocked. */
const schema = new mongoose.Schema({
  phone:   { type: String, required: true },
  channel: { type: String, enum: [...Object.values(CHANNELS), "all"], default: "all" },
  scope:   { type: String, enum: ["promotional", "all"], default: "promotional" },
  reason:  String,
  source:  { type: String, default: "admin" },      // admin | inbound_stop | parent_request
}, { timestamps: true });

schema.index({ phone: 1, channel: 1 }, { unique: true });

module.exports = mongoose.models.MessagingOptOut || mongoose.model("MessagingOptOut", schema);
