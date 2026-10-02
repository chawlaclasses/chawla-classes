"use strict";
const NotificationLog = require("../models/NotificationLog");
const Campaign = require("../models/Campaign");
const { STATUS } = require("../constants");
const log = require("../utils/log");

const RANK = { queued: 0, processing: 1, sent: 2, delivered: 3, read: 4, failed: 5 };

/** Applies provider delivery receipts (webhook or mock) to NotificationLog. Idempotent & order-safe. */
class DeliveryReceiptService {
  async apply(providerName, evt) {
    if (!evt || !evt.providerMessageId) return null;
    const doc = await NotificationLog.findOne({ providerMessageId: evt.providerMessageId });
    if (!doc) { log.debug(`receipt for unknown providerMessageId ${evt.providerMessageId}`); return null; }

    const next = evt.status;
    if (!(next in RANK)) return doc;
    // never move backwards (e.g. late "sent" after "delivered"); failed only overrides sent
    if (RANK[next] <= RANK[doc.status] && !(next === "failed" && doc.status === STATUS.SENT)) return doc;

    doc.status = next;
    if (next === STATUS.DELIVERED) doc.deliveredAt = evt.at || new Date();
    if (next === STATUS.FAILED) doc.error = { code: "DELIVERY_FAILED", message: evt.error || "Delivery failed", retryable: false };
    doc.events.push({ status: next, at: evt.at || new Date(), note: evt.error });
    await doc.save();

    if (doc.campaignId) {
      const inc = next === STATUS.DELIVERED ? { "stats.delivered": 1 } : next === STATUS.FAILED ? { "stats.failed": 1, "stats.sent": -1 } : null;
      if (inc) await Campaign.updateOne({ _id: doc.campaignId }, { $inc: inc });
    }
    return doc;
  }
}

module.exports = DeliveryReceiptService;
