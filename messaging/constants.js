"use strict";

const CHANNELS = Object.freeze({ SMS: "sms", WHATSAPP: "whatsapp" });

/** Why a message is being sent. Drives opt-out rules, priority, retention. */
const PURPOSES = Object.freeze({
  OTP: "otp",
  ENQUIRY_FOLLOWUP: "enquiry_followup",
  NOTICE: "notice",
  FEE_REMINDER: "fee_reminder",
  PARENT_NOTIFICATION: "parent_notification",
  BULK: "bulk",
});

/**
 * Category decides compliance behaviour (TRAI/DLT + WhatsApp policy):
 *  - transactional: OTP, fee due, attendance  -> opt-out is NOT applied
 *  - service:       notices, enquiry replies  -> opt-out applied for "stop all" only
 *  - promotional:   campaigns, offers         -> opt-out always applied
 */
const CATEGORIES = Object.freeze({
  TRANSACTIONAL: "transactional",
  SERVICE: "service",
  PROMOTIONAL: "promotional",
});

const STATUS = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "skipped", // opt-out / invalid number / duplicate — never attempted
});

const TERMINAL_STATUS = [STATUS.DELIVERED, STATUS.READ, STATUS.FAILED, STATUS.CANCELLED, STATUS.SKIPPED];

const PRIORITY = Object.freeze({ HIGH: 1, NORMAL: 5, LOW: 9 });

module.exports = { CHANNELS, PURPOSES, CATEGORIES, STATUS, TERMINAL_STATUS, PRIORITY };
