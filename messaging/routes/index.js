"use strict";
const express = require("express");
const rateLimit = require("express-rate-limit");

/**
 * Mounted at /api/messaging
 *   PUBLIC  (rate-limited)  POST /otp/request, /otp/verify
 *   WEBHOOK (provider-auth) POST /webhooks/:provider
 *   ADMIN   everything else (requireAdmin)
 */
function buildRouter(c, { requireAdmin } = {}) {
  const auth = requireAdmin || require("../../middleware/apiAuth").requireApiAdmin;
  const otp = require("../controllers/otpController")(c);
  const wf = require("../controllers/workflowControllers")(c);
  const admin = require("../controllers/adminControllers")(c);
  const webhook = require("../controllers/webhookController")(c);

  const r = express.Router();
  const otpLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again later." } });

  // ── public ──
  r.post("/otp/request", otpLimiter, otp.request);
  r.post("/otp/verify", otpLimiter, otp.verify);
  r.post("/webhooks/:provider", webhook);

  // ── admin ──
  r.use(auth);
  r.get("/status", admin.status);
  r.get("/logs", admin.logs);
  r.post("/logs/:messageId/retry", admin.retry);
  r.post("/test", admin.test);

  r.get("/templates", admin.templates.list);
  r.put("/templates", admin.templates.upsert);
  r.patch("/templates/:id/active", admin.templates.setActive);

  r.post("/enquiries/:id/follow-up", wf.enquiry.followUp);
  r.post("/enquiries/:id/cancel-follow-ups", wf.enquiry.cancel);
  r.get("/enquiries/:id/timeline", wf.enquiry.timeline);

  r.post("/fees/sweep", wf.fees.sweep);
  r.post("/fees/:feeId/remind", wf.fees.remind);

  r.post("/notices", wf.notices.publish);
  r.post("/parents/notify", wf.parents.notify);
  r.post("/parents/absences", wf.parents.absences);

  r.get("/campaigns", admin.campaigns.list);
  r.post("/campaigns", admin.campaigns.create);
  r.get("/campaigns/:id", admin.campaigns.get);
  r.post("/campaigns/:id/preview", admin.campaigns.preview);
  r.post("/campaigns/:id/launch", admin.campaigns.launch);
  r.post("/campaigns/:id/cancel", admin.campaigns.cancel);

  r.get("/opt-outs", admin.optOuts.list);
  r.post("/opt-outs", admin.optOuts.add);
  r.delete("/opt-outs/:id", admin.optOuts.remove);

  if (c.config.exposeDevRoutes) {
    r.get("/dev/outbox", admin.dev.outbox);
    r.delete("/dev/outbox", admin.dev.clear);
  }
  return r;
}

module.exports = { buildRouter };
