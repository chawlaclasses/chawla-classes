"use strict";
const mongoose = require("mongoose");
const { CHANNELS, CATEGORIES } = require("../constants");

/**
 * One logical template ("fee_due_reminder") per channel+language.
 * `body` is OUR canonical text with {{vars}}.
 * `providerRefs` holds each vendor's registered template identity, so switching
 * provider is only data: add a key under providerRefs, flip the env var.
 *
 *   providerRefs: {
 *     fast2sms:       { templateId: "172345", variableOrder: ["name","amount","dueDate"] },
 *     msg91:          { templateId: "65f...", variableOrder: [...] },
 *     whatsapp_cloud: { name: "fee_due_reminder", language: "en", variableOrder: [...] }
 *   }
 */
const schema = new mongoose.Schema({
  key:       { type: String, required: true, trim: true, lowercase: true },   // e.g. fee_due_reminder
  channel:   { type: String, enum: Object.values(CHANNELS), required: true },
  language:  { type: String, default: "en" },                                  // en | hi | hinglish
  name:      { type: String, required: true },
  description: String,
  category:  { type: String, enum: Object.values(CATEGORIES), required: true },
  body:      { type: String, required: true, maxlength: 1600 },
  variables: [{ type: String }],                                               // auto-derived from body
  providerRefs: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  sensitive: { type: Boolean, default: false },                                // OTP: never store rendered body
  isActive:  { type: Boolean, default: true },
  version:   { type: Number, default: 1 },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

schema.index({ key: 1, channel: 1, language: 1 }, { unique: true });

module.exports = mongoose.models.MessageTemplate || mongoose.model("MessageTemplate", schema);
