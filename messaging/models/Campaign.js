"use strict";
const mongoose = require("mongoose");
const { CHANNELS, PURPOSES } = require("../constants");

const schema = new mongoose.Schema({
  name:    { type: String, required: true },
  purpose: { type: String, enum: Object.values(PURPOSES), default: PURPOSES.BULK },
  channel: { type: String, enum: Object.values(CHANNELS), required: true },
  templateKey: { type: String, required: true },
  language: { type: String, default: "en" },
  variables: mongoose.Schema.Types.Mixed,           // campaign-wide variables (e.g. {event:"Parent meet"})
  audience: {
    kind: { type: String, enum: ["students", "parents", "enquiries", "custom"], required: true },
    filter: mongoose.Schema.Types.Mixed,            // { classId, batch, ... } resolved by RecipientResolver
    customRecipients: [{ phone: String, name: String, variables: mongoose.Schema.Types.Mixed }],
  },
  status: { type: String, enum: ["draft", "preview", "queued", "running", "completed", "cancelled", "failed"], default: "draft", index: true },
  scheduledAt: Date,
  stats: {
    total: { type: Number, default: 0 },
    queued: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  estimatedSegments: Number,
  createdBy: String,
  approvedBy: String,
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true });

module.exports = mongoose.models.MessagingCampaign || mongoose.model("MessagingCampaign", schema);
