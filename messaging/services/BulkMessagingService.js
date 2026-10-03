"use strict";
const Campaign = require("../models/Campaign");
const NotificationLog = require("../models/NotificationLog");
const { MessagingError } = require("../utils/errors");
const { renderTemplate, smsSegments } = require("../utils/renderTemplate");
const { STATUS, CHANNELS } = require("../constants");

/**
 * Campaign lifecycle:  draft -> (preview) -> launch -> running -> completed | cancelled
 * Launch writes one queued NotificationLog per recipient (chunked). The worker does the sending,
 * so a 5,000-recipient blast returns in seconds and survives restarts.
 */
class BulkMessagingService {
  constructor({ config, messaging, templates, resolver }) {
    Object.assign(this, { config, messaging, templates, resolver });
  }

  async createCampaign(data, user) {
    const { name, channel, templateKey, audience } = data;
    if (!name || !channel || !templateKey || !audience?.kind) throw new MessagingError("name, channel, templateKey and audience are required", { code: "VALIDATION" });
    await this.templates.resolve(templateKey, channel, data.language || "en");
    return Campaign.create({ ...data, createdBy: user, status: "draft" });
  }

  /** Dry run: who will receive it, what it looks like, how many SMS segments it costs. No sends. */
  async preview(campaignId) {
    const c = await this._get(campaignId);
    const { recipients, invalid, total } = await this.resolver.resolve(c.audience);
    const tpl = await this.templates.resolve(c.templateKey, c.channel, c.language || "en");
    const sample = recipients.slice(0, 3).map((r) => {
      try { return { to: r.phone, text: renderTemplate(tpl.body, { ...c.variables, ...r.variables }) }; }
      catch (e) { return { to: r.phone, error: e.message }; }
    });
    const segs = c.channel === CHANNELS.SMS && sample[0]?.text ? smsSegments(sample[0].text) * recipients.length : null;
    c.status = "preview";
    c.estimatedSegments = segs ?? undefined;
    c.stats.total = recipients.length;
    await c.save();
    return { recipients: recipients.length, invalidNumbers: invalid, totalInAudience: total, estimatedSmsSegments: segs, sample };
  }

  async launch(campaignId, user) {
    const c = await this._get(campaignId);
    if (!["draft", "preview"].includes(c.status)) throw new MessagingError(`Campaign is already ${c.status}`, { code: "BAD_STATE", status: 409 });

    const { recipients } = await this.resolver.resolve(c.audience);
    if (recipients.length > this.config.bulk.maxRecipientsPerCampaign) {
      throw new MessagingError(`Audience (${recipients.length}) exceeds MESSAGING_BULK_MAX_RECIPIENTS (${this.config.bulk.maxRecipientsPerCampaign})`, { code: "AUDIENCE_TOO_LARGE" });
    }
    // claim the launch atomically so a double-click can't launch twice
    const claimed = await Campaign.findOneAndUpdate(
      { _id: c._id, status: { $in: ["draft", "preview"] } },
      { status: "running", startedAt: new Date(), approvedBy: user, "stats.total": recipients.length }, { returnDocument: "after" });
    if (!claimed) throw new MessagingError("Campaign already launched", { code: "BAD_STATE", status: 409 });

    let queued = 0, skipped = 0;
    const size = this.config.bulk.insertChunkSize;
    for (let i = 0; i < recipients.length; i += size) {
      const chunk = recipients.slice(i, i + size).map((r) => ({
        purpose: c.purpose, channel: c.channel, templateKey: c.templateKey, language: c.language,
        to: r.phone, name: r.name, userId: r.userId, recipientType: r.type,
        variables: { ...(c.variables || {}), ...r.variables },
        campaignId: c._id, scheduledAt: c.scheduledAt, createdBy: user,
        related: { type: "campaign", id: String(c._id) },
        idempotencyKey: `campaign:${c._id}:${r.phone}`,
        priority: 7,   // bulk yields to OTP/transactional
      }));
      const res = await this.messaging.enqueueMany(chunk);
      queued += res.queued; skipped += res.skipped;
    }
    await Campaign.updateOne({ _id: c._id }, { "stats.queued": queued, "stats.skipped": skipped, ...(queued === 0 ? { status: "completed", completedAt: new Date() } : {}) });
    return { campaignId: String(c._id), queued, skipped };
  }

  async cancel(campaignId) {
    const c = await this._get(campaignId);
    const res = await NotificationLog.updateMany(
      { campaignId: c._id, status: STATUS.QUEUED },
      { $set: { status: STATUS.CANCELLED }, $push: { events: { status: STATUS.CANCELLED, note: "campaign cancelled" } } });
    await Campaign.updateOne({ _id: c._id }, { status: "cancelled", completedAt: new Date() });
    return { cancelled: res.modifiedCount };
  }

  async stats(campaignId) {
    const c = await this._get(campaignId);
    const byStatus = await NotificationLog.aggregate([{ $match: { campaignId: c._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    return { campaign: c, live: Object.fromEntries(byStatus.map((s) => [s._id, s.n])) };
  }

  /** Called by the worker: flip running campaigns to completed once nothing is pending. */
  async finalizeFinished() {
    const running = await Campaign.find({ status: "running" }).select("_id").lean();
    for (const c of running) {
      const pending = await NotificationLog.countDocuments({ campaignId: c._id, status: { $in: [STATUS.QUEUED, STATUS.PROCESSING] } });
      if (!pending) await Campaign.updateOne({ _id: c._id, status: "running" }, { status: "completed", completedAt: new Date() });
    }
  }

  async _get(id) {
    const c = await Campaign.findById(id);
    if (!c) throw new MessagingError("Campaign not found", { code: "NOT_FOUND", status: 404 });
    return c;
  }
}

module.exports = BulkMessagingService;
