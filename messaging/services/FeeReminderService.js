"use strict";
const { getHostAdapter } = require("../adapters/hostDataAdapter");
const { PURPOSES } = require("../constants");
const { MessagingError } = require("../utils/errors");
const log = require("../utils/log");

const DAY = 86400000;
const startOfDayIST = (d) => { const t = new Date(d.getTime() + 330 * 60000); t.setUTCHours(0, 0, 0, 0); return t.getTime() - 330 * 60000; };
const ymd = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Fee reminder workflow:
 *   daily sweep -> pending fees -> offset = today - dueDate (days)
 *   offset in MESSAGING_FEE_REMINDER_DAYS ("-3,0,3,7") -> reminder to parent (and/or student)
 *   idempotencyKey = fee:<id>:d<offset>:<parent|student>  => safe to run the sweep 10x/day or on 3 instances
 */
class FeeReminderService {
  constructor({ config, messaging }) { this.config = config; this.messaging = messaging; this.timer = null; }

  _templateFor(offset) { return offset < 0 ? "fee_due_upcoming" : offset === 0 ? "fee_due_today" : "fee_overdue"; }

  async _sendForFee(fee, student, offset, { idemSuffix, createdBy, channel } = {}) {
    const cfg = this.config.feeReminder;
    const targets = [];
    if (cfg.sendToParent && student.parentPhone) targets.push({ type: "parent", phone: student.parentPhone, name: student.parentName });
    if (!targets.length || !cfg.sendToParent) targets.push({ type: "student", phone: student.phone, name: student.name });

    const results = [];
    for (const t of targets) {
      results.push(await this.messaging.send({
        purpose: PURPOSES.FEE_REMINDER, channel: channel || cfg.channel, templateKey: this._templateFor(offset),
        to: t.phone, name: t.name, userId: student.id, recipientType: t.type,
        variables: { name: t.name, student: student.name, amount: fee.amount, title: fee.title, dueDate: fmtDate(fee.dueDate), daysOverdue: Math.max(offset, 0) },
        related: { type: "fee", id: fee.id }, createdBy,
        idempotencyKey: `fee:${fee.id}:${idemSuffix ?? "d" + offset}:${t.type}`,
        priority: 4,
      }));
    }
    return results;
  }

  /** Scheduled job. dryRun=true returns who WOULD be reminded without sending. */
  async runDailySweep({ dryRun = false, now = new Date() } = {}) {
    const host = getHostAdapter();
    const fees = await host.listPendingFees();
    const today = startOfDayIST(now);
    const summary = { checked: fees.length, due: 0, queued: 0, duplicates: 0, skipped: 0, errors: 0, preview: [] };

    for (const fee of fees) {
      const offset = Math.round((today - startOfDayIST(new Date(fee.dueDate))) / DAY);
      if (!this.config.feeReminder.scheduleDays.includes(offset)) continue;
      summary.due++;
      const student = await host.getStudent(fee.studentId);
      if (!student) { summary.skipped++; continue; }
      if (dryRun) { summary.preview.push({ student: student.name, amount: fee.amount, offset }); continue; }
      try {
        for (const r of await this._sendForFee(fee, student, offset)) {
          if (r.duplicate) summary.duplicates++; else if (r.skippedReason) summary.skipped++; else summary.queued++;
        }
      } catch (e) { summary.errors++; log.warn(`fee ${fee.id}: ${e.message}`); }
    }
    log.info(`fee sweep ${dryRun ? "(dry) " : ""}${JSON.stringify({ ...summary, preview: undefined })}`);
    return summary;
  }

  /** Admin button "Remind now" — one per fee per day (double-click safe). */
  async remindNow(feeId, { adminId, channel } = {}) {
    const host = getHostAdapter();
    const fee = await host.getFee(feeId);
    if (!fee) throw new MessagingError("Fee not found", { code: "NOT_FOUND", status: 404 });
    if (String(fee.status).toLowerCase() === "paid") throw new MessagingError("Fee is already paid", { code: "ALREADY_PAID", status: 409 });
    const student = await host.getStudent(fee.studentId);
    if (!student) throw new MessagingError("Student not found", { code: "NOT_FOUND", status: 404 });
    const offset = Math.round((startOfDayIST(new Date()) - startOfDayIST(new Date(fee.dueDate))) / DAY);
    return this._sendForFee(fee, student, offset, { idemSuffix: `manual:${ymd(new Date())}`, createdBy: adminId, channel });
  }

  /** Call from the "mark paid" handler. */
  async sendPaymentReceived(feeId) {
    const host = getHostAdapter();
    const fee = await host.getFee(feeId);
    const student = fee && await host.getStudent(fee.studentId);
    if (!student) return [];
    const to = student.parentPhone || student.phone, name = student.parentPhone ? student.parentName : student.name;
    return [await this.messaging.send({
      purpose: PURPOSES.FEE_REMINDER, channel: this.config.feeReminder.channel, templateKey: "fee_payment_received",
      to, name, userId: student.id, recipientType: student.parentPhone ? "parent" : "student",
      variables: { name, student: student.name, amount: fee.amount, title: fee.title },
      related: { type: "fee", id: fee.id }, idempotencyKey: `fee:${fee.id}:paid`,
    })];
  }

  /** In-process scheduler (hourly check, fires once/day at MESSAGING_FEE_SWEEP_HOUR IST). Idempotency keys make multi-instance safe. */
  start() {
    if (this.timer || String(process.env.MESSAGING_FEE_SCHEDULER || "true") === "false") return;
    const hour = parseInt(process.env.MESSAGING_FEE_SWEEP_HOUR || "10", 10);
    let lastRun = "";
    this.timer = setInterval(async () => {
      const ist = new Date(Date.now() + 330 * 60000);
      const key = ist.toISOString().slice(0, 10);
      if (ist.getUTCHours() !== hour || lastRun === key) return;
      lastRun = key;
      try { await this.runDailySweep(); } catch (e) { log.error(`fee sweep failed: ${e.message}`); }
    }, 5 * 60_000);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = FeeReminderService;
