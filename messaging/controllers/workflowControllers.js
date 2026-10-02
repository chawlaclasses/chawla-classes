"use strict";
const { handle, need, adminId } = require("./helpers");

/** Enquiry follow-up, fee reminders, notices, parent notifications. */
module.exports = (c) => ({
  enquiry: {
    followUp: handle((req) => c.enquiry.sendManual(req.params.id, { templateKey: req.body.templateKey, channel: req.body.channel, adminId: adminId(req) })),
    cancel: handle((req) => c.enquiry.cancelPending(req.params.id, "cancelled by admin")),
    timeline: handle((req) => c.enquiry.timeline(req.params.id)),
  },
  fees: {
    sweep: handle((req) => c.fees.runDailySweep({ dryRun: req.body.dryRun !== false && req.body.dryRun !== "false" })),
    remind: handle((req) => c.fees.remindNow(req.params.feeId, { adminId: adminId(req), channel: req.body.channel })),
  },
  notices: {
    publish: handle((req) => { need(req.body, "title", "message"); return c.notices.publish(req.body, adminId(req)); }),
  },
  parents: {
    notify: handle((req) => { need(req.body, "studentId", "event"); return c.parents.notify({ ...req.body, adminId: adminId(req) }); }),
    absences: handle((req) => { need(req.body, "studentIds", "date"); return c.parents.notifyAbsences(req.body.studentIds, req.body.date, adminId(req)); }),
  },
});
