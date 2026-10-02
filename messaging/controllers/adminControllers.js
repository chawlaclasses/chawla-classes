"use strict";
const NotificationLog = require("../models/NotificationLog");
const Campaign = require("../models/Campaign");
const OptOut = require("../models/OptOut");
const { handle, need, adminId } = require("./helpers");
const { normalizePhone } = require("../utils/phone");
const { MessagingError } = require("../utils/errors");
const { STATUS } = require("../constants");

module.exports = (c) => ({
  status: handle(async () => ({
    enabled: c.config.enabled,
    providers: c.registry.describe(),
    queue: Object.fromEntries((await NotificationLog.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])).map((x) => [x._id, x.n])),
    mockMode: Object.values(c.config.providers).includes("mock"),
  })),

  templates: {
    list: handle((req) => c.templates.list(req.query.channel ? { channel: req.query.channel } : {})),
    upsert: handle((req) => c.templates.upsert(req.body, adminId(req))),
    setActive: handle((req) => c.templates.setActive(req.params.id, !!req.body.isActive)),
  },

  logs: handle(async (req) => {
    const { status, purpose, channel, phone, campaignId } = req.query;
    const q = {};
    if (status) q.status = status;
    if (purpose) q.purpose = purpose;
    if (channel) q.channel = channel;
    if (campaignId) q.campaignId = campaignId;
    if (phone) q["recipient.phone"] = normalizePhone(phone) || phone;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = Math.min(100, parseInt(req.query.limit, 10) || 25);
    const [items, total] = await Promise.all([
      NotificationLog.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("-events").lean(),
      NotificationLog.countDocuments(q),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }),

  retry: handle(async (req) => {
    const r = await NotificationLog.findOneAndUpdate({ messageId: req.params.messageId, status: STATUS.FAILED, sensitive: false },
      { $set: { status: STATUS.QUEUED, nextAttemptAt: new Date(), attempts: 0 }, $push: { events: { status: "queued", note: `manual retry by ${adminId(req)}` } } }, { new: true });
    if (!r) throw new MessagingError("Only failed, non-OTP messages can be retried", { code: "BAD_STATE", status: 409 });
    return { messageId: r.messageId, status: r.status };
  }),

  test: handle((req) => {
    need(req.body, "to");
    return c.messaging.send({
      purpose: "notice", templateKey: "student_notice", channel: req.body.channel, to: req.body.to,
      variables: { title: "Test", message: req.body.message || "This is a test message from Chawla Classes." },
      createdBy: adminId(req), immediate: true,
    });
  }),

  campaigns: {
    create: handle((req) => c.bulk.createCampaign(req.body, adminId(req))),
    list: handle(() => Campaign.find().sort({ createdAt: -1 }).limit(50).lean()),
    get: handle((req) => c.bulk.stats(req.params.id)),
    preview: handle((req) => c.bulk.preview(req.params.id)),
    launch: handle((req) => c.bulk.launch(req.params.id, adminId(req))),
    cancel: handle((req) => c.bulk.cancel(req.params.id)),
  },

  optOuts: {
    list: handle(() => OptOut.find().sort({ createdAt: -1 }).limit(200).lean()),
    add: handle(async (req) => {
      need(req.body, "phone");
      const phone = normalizePhone(req.body.phone, c.config.defaultCountryCode);
      if (!phone) throw new MessagingError("Invalid phone", { code: "INVALID_PHONE" });
      return OptOut.findOneAndUpdate({ phone, channel: req.body.channel || "all" },
        { phone, channel: req.body.channel || "all", scope: req.body.scope || "promotional", reason: req.body.reason, source: "admin" }, { upsert: true, new: true });
    }),
    remove: handle(async (req) => { await OptOut.deleteOne({ _id: req.params.id }); return { removed: true }; }),
  },

  dev: {
    outbox: handle(() => c.registry.byProviderName("mock")?.getOutbox() || []),
    clear: handle(() => { c.registry.byProviderName("mock")?.clearOutbox(); return { cleared: true }; }),
  },
});
