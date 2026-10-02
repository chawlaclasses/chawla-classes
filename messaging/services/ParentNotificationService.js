"use strict";
const { getHostAdapter } = require("../adapters/hostDataAdapter");
const { PURPOSES } = require("../constants");
const { MessagingError } = require("../utils/errors");

const EVENTS = {
  absent:  { template: "parent_absence_alert",    vars: ["date"] },
  result:  { template: "parent_result_published", vars: ["exam", "marks"] },
  custom:  { template: "parent_custom_message",   vars: ["message"] },
};

/** Single-student → parent messages (absence alert, result published, free text). */
class ParentNotificationService {
  constructor({ config, messaging }) { this.config = config; this.messaging = messaging; }

  async notify({ studentId, event, data = {}, channel, adminId }) {
    const spec = EVENTS[event];
    if (!spec) throw new MessagingError(`Unknown event "${event}". Use: ${Object.keys(EVENTS).join(", ")}`, { code: "VALIDATION" });
    const student = await getHostAdapter().getStudent(studentId);
    if (!student) throw new MessagingError("Student not found", { code: "NOT_FOUND", status: 404 });
    if (!student.parentPhone) throw new MessagingError("Parent phone number missing for this student", { code: "NO_PARENT_PHONE", status: 422 });
    const day = new Date().toISOString().slice(0, 10);
    return this.messaging.send({
      purpose: PURPOSES.PARENT_NOTIFICATION, channel: channel || this.config.defaultChannel, templateKey: spec.template,
      to: student.parentPhone, name: student.parentName, userId: student.id, recipientType: "parent",
      variables: { name: student.parentName, student: student.name, ...data },
      related: { type: `parent_${event}`, id: student.id }, createdBy: adminId,
      // absence alert once per student per day; others are explicit admin actions
      idempotencyKey: event === "absent" ? `parent:absent:${student.id}:${data.date || day}` : undefined,
    });
  }

  /** Bulk absence alerts after attendance is marked: [{studentId}] */
  async notifyAbsences(studentIds, date, adminId) {
    const results = [];
    for (const studentId of studentIds) {
      try { results.push({ studentId, ...(await this.notify({ studentId, event: "absent", data: { date }, adminId })) }); }
      catch (e) { results.push({ studentId, error: e.message }); }
    }
    return results;
  }
}
module.exports = ParentNotificationService;
