"use strict";
const mongoose = require("mongoose");
const crypto = require("crypto");
const { CHANNELS, PURPOSES, CATEGORIES, STATUS, PRIORITY } = require("../constants");

/**
 * NotificationLog doubles as the DURABLE QUEUE (outbox pattern):
 *   service inserts status=queued  ->  worker atomically claims  ->  provider.send  ->  sent/failed
 * One collection, one source of truth, survives restarts, scales by adding worker instances.
 */
const eventSchema = new mongoose.Schema({
  status: String,
  at: { type: Date, default: Date.now },
  note: String,
}, { _id: false });

const schema = new mongoose.Schema({
  messageId: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },

  purpose:  { type: String, enum: Object.values(PURPOSES), required: true, index: true },
  category: { type: String, enum: Object.values(CATEGORIES), required: true },
  channel:  { type: String, enum: Object.values(CHANNELS), required: true },
  provider: { type: String, index: true },          // filled at dispatch time

  recipient: {
    phone:  { type: String, required: true },       // E.164
    name:   String,
    userId: String,                                  // student/teacher id in host app
    type:   { type: String, enum: ["student", "parent", "enquiry", "teacher", "other"], default: "other" },
  },

  templateKey: String,
  language: String,
  variables: { type: mongoose.Schema.Types.Mixed },  // stripped for sensitive templates
  body: String,                                       // "[REDACTED]" when sensitive
  sensitive: { type: Boolean, default: false },

  status:   { type: String, enum: Object.values(STATUS), default: STATUS.QUEUED },
  priority: { type: Number, default: PRIORITY.NORMAL },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 4 },
  nextAttemptAt: { type: Date, default: Date.now },   // also used for scheduled sends
  lockedAt: Date,
  lockedBy: String,

  providerMessageId: { type: String, index: true, sparse: true },
  error: { code: String, message: String, retryable: Boolean },
  cost: Number,
  sentAt: Date,
  deliveredAt: Date,

  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "MessagingCampaign", index: true },
  related: { type: { type: String }, id: String },    // e.g. {type:"fee", id:"..."} / {type:"enquiry", id}
  idempotencyKey: { type: String },                   // prevents duplicate reminders
  fallbackOf: String,                                 // messageId of the failed original (channel fallback)
  createdBy: String,
  events: [eventSchema],
}, { timestamps: true });

// Worker claim query: status + due time + priority
schema.index({ status: 1, nextAttemptAt: 1, priority: 1 });
schema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
schema.index({ "recipient.phone": 1, createdAt: -1 });
schema.index({ purpose: 1, createdAt: -1 });
schema.index({ "related.type": 1, "related.id": 1 });
// Auto-purge old logs (MESSAGING_LOG_RETENTION_DAYS, default 180)
schema.index({ createdAt: 1 }, { expireAfterSeconds: (parseInt(process.env.MESSAGING_LOG_RETENTION_DAYS, 10) || 180) * 86400 });

module.exports = mongoose.models.NotificationLog || mongoose.model("NotificationLog", schema);
