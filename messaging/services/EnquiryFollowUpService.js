"use strict";
const NotificationLog = require("../models/NotificationLog");
const { getHostAdapter } = require("../adapters/hostDataAdapter");
const { PURPOSES, STATUS } = require("../constants");
const { MessagingError } = require("../utils/errors");

const STOP_STATUSES = ["converted", "closed", "admitted", "not-interested"];

/**
 * Admission enquiry nurture sequence:
 *   t+0h   enquiry_welcome        (instant ack)
 *   t+24h  enquiry_followup_1     (MESSAGING_ENQUIRY_FOLLOWUP_HOURS="0,24,72")
 *   t+72h  enquiry_followup_2
 * All steps are scheduled up-front as queued rows (idempotent per enquiry+step). A guard re-checks the
 * enquiry right before each send, so converted / closed enquiries are never nagged.
 */
class EnquiryFollowUpService {
  constructor({ config, messaging }) {
    this.config = config;
    this.messaging = messaging;
    messaging.registerGuard(async (row) => {
      if (row.purpose !== PURPOSES.ENQUIRY_FOLLOWUP || row.related?.type !== "enquiry") return null;
      const enq = await getHostAdapter().getEnquiry(row.related.id);
      if (!enq) return "enquiry deleted";
      return STOP_STATUSES.includes(String(enq.status).toLowerCase()) ? `enquiry is ${enq.status}` : null;
    });
  }

  _templateFor(step) { return step === 0 ? "enquiry_welcome" : `enquiry_followup_${Math.min(step, 2)}`; }

  /** Call right after an enquiry is saved (see integration notes in docs). Never throws into the caller. */
  async onEnquiryCreated(enquiry, { createdBy } = {}) {
    const id = String(enquiry._id || enquiry.id);
    const name = enquiry.name || enquiry.studentName || "Parent";
    const base = Date.now();
    const out = [];
    for (const [step, hours] of this.config.followUp.stepsHours.entries()) {
      try {
        out.push(await this.messaging.send({
          purpose: PURPOSES.ENQUIRY_FOLLOWUP, channel: this.config.followUp.channel,
          templateKey: this._templateFor(step), to: enquiry.phone, name, recipientType: "enquiry", userId: id,
          variables: { name, course: enquiry.interestedClass || "our courses", contact: process.env.INSTITUTE_CONTACT_PHONE || "+91 00000 00000" },
          related: { type: "enquiry", id }, idempotencyKey: `enquiry:${id}:step:${step}`,
          scheduledAt: new Date(base + hours * 3600_000), createdBy,
          priority: step === 0 ? 3 : 5,
        }));
      } catch (e) { out.push({ error: e.message, step }); }
    }
    return out;
  }

  /** Call when admin changes enquiry status — cancels the remaining sequence immediately. */
  async cancelPending(enquiryId, reason = "enquiry status changed") {
    const res = await NotificationLog.updateMany(
      { "related.type": "enquiry", "related.id": String(enquiryId), purpose: PURPOSES.ENQUIRY_FOLLOWUP, status: STATUS.QUEUED },
      { $set: { status: STATUS.CANCELLED }, $push: { events: { status: STATUS.CANCELLED, note: reason } } });
    return { cancelled: res.modifiedCount };
  }

  /** Admin presses "Send follow-up now". */
  async sendManual(enquiryId, { templateKey = "enquiry_followup_1", channel, adminId } = {}) {
    const enq = await getHostAdapter().getEnquiry(enquiryId);
    if (!enq) throw new MessagingError("Enquiry not found", { code: "NOT_FOUND", status: 404 });
    return this.messaging.send({
      purpose: PURPOSES.ENQUIRY_FOLLOWUP, channel: channel || this.config.followUp.channel, templateKey,
      to: enq.phone, name: enq.name, recipientType: "enquiry", userId: enq.id,
      variables: { name: enq.name, course: enq.interestedClass || "our courses", contact: process.env.INSTITUTE_CONTACT_PHONE || "+91 00000 00000" },
      related: { type: "enquiry", id: enq.id }, createdBy: adminId, priority: 3,
    });
  }

  async timeline(enquiryId) {
    return NotificationLog.find({ "related.type": "enquiry", "related.id": String(enquiryId) })
      .sort({ createdAt: 1 }).select("-events -variables").lean();
  }
}

module.exports = EnquiryFollowUpService;
