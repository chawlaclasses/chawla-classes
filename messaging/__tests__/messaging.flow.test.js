"use strict";
/**
 * End-to-end messaging flow in MOCK mode. No MongoDB, no network:
 * storage is an in-memory fake (testing/fakeMongoose.js) behind the real mongoose schemas.
 * Run:  npx jest messaging
 */
process.env.NODE_ENV = "test";
process.env.MOCK_PROVIDER_QUIET = "true";
process.env.MOCK_PROVIDER_AUTO_DELIVER = "false";
process.env.MESSAGING_QUIET_HOURS = "";            // tested separately
process.env.MESSAGING_OTP_COOLDOWN = "0";
process.env.MESSAGING_OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.MESSAGING_BACKOFF_BASE_MS = "1";
process.env.MESSAGING_MAX_ATTEMPTS = "3";
process.env.MESSAGING_SMS_RATE_PER_SEC = "0";
process.env.MESSAGING_WHATSAPP_RATE_PER_SEC = "0";
process.env.MESSAGING_OTP_SECRET = "test-secret";
process.env.MESSAGING_ENQUIRY_FOLLOWUP_HOURS = "0,24,72";

const { installAll } = require("../testing/fakeMongoose");
const models = installAll();
const { resetConfigCache } = require("../config/messaging.config");
const { buildContainer } = require("../container");
const { setHostAdapter } = require("../adapters/hostDataAdapter");
const { normalizePhone } = require("../utils/phone");
const { renderTemplate } = require("../utils/renderTemplate");
const ProviderRegistry = require("../providers/ProviderRegistry");
const { getConfig } = require("../config/messaging.config");

let c, mock;
const STUDENTS = [
  { id: "s1", name: "Aman", phone: "9876543210", parentName: "Mr Verma", parentPhone: "9811111111", classId: "c10", className: "Class 10", batch: "A" },
  { id: "s2", name: "Riya", phone: "9876543211", parentName: "Mrs Gupta", parentPhone: "9811111111", classId: "c10", className: "Class 10", batch: "A" }, // sibling-style duplicate parent number
  { id: "s3", name: "Kabir", phone: "12345", parentName: "Mr Khan", parentPhone: "9822222222", classId: "c10", className: "Class 10", batch: "B" },
];
let ENQUIRIES = {};

beforeEach(async () => {
  Object.values(models).forEach((m) => m.__reset());
  resetConfigCache();
  c = buildContainer(getConfig());
  await c.templates.seedDefaults();
  mock = c.registry.byProviderName("mock");
  mock.clearOutbox();
  mock.failureRate = 0;
  ENQUIRIES = { e1: { id: "e1", name: "Neha", phone: "9898989898", interestedClass: "Class 9", status: "new" } };
  setHostAdapter({
    getStudent: async (id) => STUDENTS.find((s) => s.id === id) || null,
    listStudents: async ({ classId, batch } = {}) => STUDENTS.filter((s) => (!classId || s.classId === classId) && (!batch || s.batch === batch)),
    getFee: async (id) => (id === "f1" ? { id: "f1", studentId: "s1", title: "Oct Fee", amount: 2500, dueDate: new Date(), status: "Pending" } : null),
    listPendingFees: async () => [
      { id: "f1", studentId: "s1", title: "Oct Fee", amount: 2500, dueDate: new Date(), status: "Pending" },                        // due today -> offset 0
      { id: "f2", studentId: "s2", title: "Oct Fee", amount: 1800, dueDate: new Date(Date.now() - 3 * 86400000), status: "Pending" }, // 3 days overdue
      { id: "f3", studentId: "s2", title: "Nov Fee", amount: 1800, dueDate: new Date(Date.now() + 20 * 86400000), status: "Pending" }, // not in schedule
    ],
    getEnquiry: async (id) => ENQUIRIES[id] || null,
    listEnquiries: async () => Object.values(ENQUIRIES),
  });
});

describe("utils", () => {
  test("phone normalisation", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91-9876543210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("5876543210")).toBeNull();
  });
  test("strict template rendering", () => {
    expect(renderTemplate("Hi {{name}}", { name: "A" })).toBe("Hi A");
    expect(() => renderTemplate("Hi {{name}} {{x}}", { name: "A" })).toThrow(/x/);
  });
});

describe("provider registry", () => {
  test("unknown provider fails fast", () => {
    const cfg = { ...getConfig(), providers: { sms: "nope", whatsapp: "mock" } };
    expect(() => new ProviderRegistry(cfg).init()).toThrow(/Unknown provider/);
  });
  test("mock blocked in production unless explicitly allowed", () => {
    const cfg = { ...getConfig(), isProd: true, allowMockInProduction: false };
    expect(() => new ProviderRegistry(cfg).init()).toThrow(/blocked in production/);
  });
  test("env switch to a stub provider is recognised but fails safely (non-retryable)", async () => {
    const cfg = { ...getConfig(), providers: { sms: "msg91", whatsapp: "mock" } };
    const c2 = buildContainer(cfg);
    expect(c2.registry.forChannel("sms").name).toBe("msg91");
    const r = await c2.messaging.send({ purpose: "notice", templateKey: "student_notice", channel: "sms", to: "9876543210", variables: { title: "t", message: "m" }, immediate: true });
    expect(r.status).toBe("failed");
  });
});

describe("OTP", () => {
  const lastCode = () => mock.getOutbox()[0].body.match(/^(\d{6})/)[1];

  test("request -> wrong code -> right code -> token; log is redacted; single use", async () => {
    const r = await c.otp.request({ phone: "9876543210", purpose: "admission_form" });
    expect(r.expiresInSeconds).toBe(300);
    expect(r.devCode).toBeUndefined();
    const code = lastCode();

    await expect(c.otp.verify({ phone: "9876543210", purpose: "admission_form", code: code === "000000" ? "111111" : "000000" })).rejects.toMatchObject({ code: "OTP_INCORRECT" });
    const ok = await c.otp.verify({ phone: "9876543210", purpose: "admission_form", code });
    expect(ok.verified).toBe(true);
    expect(c.otp.assertVerified(ok.verificationToken, "98765 43210", "admission_form")).toBe(true);
    expect(() => c.otp.assertVerified(ok.verificationToken, "9876543210", "other")).toThrow();
    await expect(c.otp.verify({ phone: "9876543210", purpose: "admission_form", code })).rejects.toMatchObject({ code: "OTP_EXPIRED" });

    const log = await models.NotificationLog.findOne({ purpose: "otp" }).lean();
    expect(log.body).toBe("[REDACTED]");
    expect(log.variables).toBeUndefined();
    expect(log.status).toBe("sent");
    const stored = [...models.OtpRequest.__store.values()][0];
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  test("locks after max wrong attempts", async () => {
    await c.otp.request({ phone: "9876543210", purpose: "login" });
    const code = lastCode(); const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await expect(c.otp.verify({ phone: "9876543210", purpose: "login", code: wrong })).rejects.toMatchObject({ code: "OTP_INCORRECT" });
    await expect(c.otp.verify({ phone: "9876543210", purpose: "login", code })).rejects.toMatchObject({ code: "OTP_LOCKED" });
  });

  test("invalid phone rejected; provider failure surfaces as OTP_SEND_FAILED and is never retried", async () => {
    await expect(c.otp.request({ phone: "123" })).rejects.toMatchObject({ code: "INVALID_PHONE" });
    mock.failureRate = 1;
    await expect(c.otp.request({ phone: "9876543210", purpose: "x" })).rejects.toMatchObject({ code: "OTP_SEND_FAILED" });
    expect((await models.NotificationLog.find({ purpose: "otp" }).lean())[0].attempts).toBe(1);
  });
});

describe("queue worker", () => {
  const send = (extra = {}) => c.messaging.send({ purpose: "notice", templateKey: "student_notice", channel: "sms", to: "9876543210", variables: { title: "T", message: "M" }, ...extra });

  test("queued -> worker -> sent -> delivery receipt", async () => {
    const r = await send();
    expect(r.status).toBe("queued");
    await c.worker.tick();
    const log = await models.NotificationLog.findOne({ messageId: r.messageId }).lean();
    expect(log.status).toBe("sent");
    expect(log.provider).toBe("mock");
    expect(mock.getOutbox()[0].body).toBe("Chawla Classes Notice: T - M");
    await c.receipts.apply("mock", { providerMessageId: log.providerMessageId, status: "delivered" });
    await c.receipts.apply("mock", { providerMessageId: log.providerMessageId, status: "sent" }); // late/out-of-order: ignored
    expect((await models.NotificationLog.findOne({ messageId: r.messageId }).lean()).status).toBe("delivered");
  });

  test("retries with backoff then fails permanently; manual retry works", async () => {
    mock.failureRate = 1;
    const r = await send();
    for (let i = 0; i < 5; i++) { await c.worker.tick(); await new Promise((x) => setTimeout(x, 15)); }
    let log = await models.NotificationLog.findOne({ messageId: r.messageId }).lean();
    expect(log.status).toBe("failed");
    expect(log.attempts).toBe(3);
    mock.failureRate = 0;
    await models.NotificationLog.updateOne({ messageId: r.messageId }, { status: "queued", attempts: 0, nextAttemptAt: new Date() });
    await c.worker.tick();
    log = await models.NotificationLog.findOne({ messageId: r.messageId }).lean();
    expect(log.status).toBe("sent");
  });

  test("two workers never double-send (atomic claim)", async () => {
    for (let i = 0; i < 6; i++) await send({ to: `98765432${10 + i}` });
    const w2 = new (require("../queue/DispatchWorker"))({ config: c.config, messaging: c.messaging, bulk: c.bulk });
    await Promise.all([c.worker.tick(), w2.tick()]);
    expect(mock.getOutbox()).toHaveLength(6);
  });

  test("scheduled messages wait; invalid numbers and missing vars are handled", async () => {
    await send({ scheduledAt: new Date(Date.now() + 3600_000) });
    await c.worker.tick();
    expect(mock.getOutbox()).toHaveLength(0);
    const bad = await send({ to: "123" });
    expect(bad.status).toBe("skipped");
    await expect(c.messaging.send({ purpose: "notice", templateKey: "student_notice", channel: "sms", to: "9876543210", variables: { title: "T" } })).rejects.toMatchObject({ code: "TEMPLATE_VARS_MISSING" });
  });

  test("WhatsApp failure falls back to SMS when configured", async () => {
    c.config.fallback.whatsapp = "sms";
    mock.send = (orig => async function (m) { if (m.channel === "whatsapp") { const { ProviderError } = require("../utils/errors"); throw new ProviderError("wa down", { retryable: false }); } return orig.call(this, m); })(mock.send);
    await send({ channel: "whatsapp" });
    await c.worker.tick(); await c.worker.tick();
    expect(mock.getOutbox().map((o) => o.channel)).toEqual(["sms"]);
  });

  test("quiet hours push promotional/service sends to morning, never transactional", async () => {
    c.messaging.config = { ...c.config, quietHours: "21:00-08:00" };
    const night = new Date("2026-10-02T17:00:00Z"); // 22:30 IST
    expect(c.messaging._afterQuietHours(night).toISOString()).toBe("2026-10-03T02:30:00.000Z"); // 08:00 IST next day
    const noon = new Date("2026-10-02T06:30:00Z");
    expect(c.messaging._afterQuietHours(noon)).toEqual(noon);
  });
});

describe("workflows", () => {
  test("fee sweep: reminds only scheduled offsets, to parent, idempotent across reruns", async () => {
    const dry = await c.fees.runDailySweep({ dryRun: true });
    expect(dry.due).toBe(2);
    const s1 = await c.fees.runDailySweep();
    expect(s1.queued).toBe(2);
    const s2 = await c.fees.runDailySweep();
    expect(s2.queued).toBe(0);
    expect(s2.duplicates).toBe(2);
    await c.worker.tick();
    const bodies = mock.getOutbox().map((o) => o.body);
    expect(bodies.some((b) => /due today/.test(b))).toBe(true);
    expect(bodies.some((b) => /overdue by 3 days/.test(b))).toBe(true);
    expect(mock.getOutbox().every((o) => o.to === "+919811111111")).toBe(true);
  });

  test("manual fee reminder is double-click safe", async () => {
    const a = await c.fees.remindNow("f1", { adminId: "a1" });
    const b = await c.fees.remindNow("f1", { adminId: "a1" });
    expect(a[0].duplicate).toBeUndefined();
    expect(b[0].duplicate).toBe(true);
  });

  test("enquiry sequence is scheduled, and stops once the enquiry converts", async () => {
    const r = await c.enquiry.onEnquiryCreated({ _id: "e1", name: "Neha", phone: "9898989898", interestedClass: "Class 9" });
    expect(r).toHaveLength(3);
    await c.worker.tick();                                // only step 0 is due
    expect(mock.getOutbox()).toHaveLength(1);
    expect(mock.getOutbox()[0].body).toMatch(/Neha/);
    ENQUIRIES.e1.status = "converted";
    await models.NotificationLog.updateMany({ status: "queued" }, { nextAttemptAt: new Date() }); // fast-forward
    await c.worker.tick();
    expect(mock.getOutbox()).toHaveLength(1);             // guard cancelled the rest
    expect((await models.NotificationLog.find({ status: "cancelled" }).lean())).toHaveLength(2);
    const dup = await c.enquiry.onEnquiryCreated({ _id: "e1", name: "Neha", phone: "9898989898" });
    expect(dup.every((x) => x.duplicate)).toBe(true);
  });

  test("parent notification: absence alert once per day; missing parent phone is a clear error", async () => {
    const a = await c.parents.notify({ studentId: "s1", event: "absent", data: { date: "02 Oct" } });
    const b = await c.parents.notify({ studentId: "s1", event: "absent", data: { date: "02 Oct" } });
    expect(b.duplicate).toBe(true);
    STUDENTS.push({ id: "s9", name: "X", phone: "9876500000", parentPhone: "" });
    await expect(c.parents.notify({ studentId: "s9", event: "absent", data: { date: "d" } })).rejects.toMatchObject({ code: "NO_PARENT_PHONE" });
    STUDENTS.pop();
    expect(a.status).toBe("queued");
  });

  test("bulk: preview, launch, opt-out skip, dedupe, stats, completion, double-launch blocked", async () => {
    await models.OptOut.create({ phone: "+919822222222", channel: "all", scope: "all" });
    const camp = await c.bulk.createCampaign({
      name: "Parent meet", channel: "sms", templateKey: "parent_notice", variables: { title: "PTM", message: "Sunday 10am" },
      audience: { kind: "parents", filter: { classId: "c10" } },
    }, "admin1");
    const pv = await c.bulk.preview(camp._id);
    expect(pv.recipients).toBe(2);               // +919811111111 (deduped siblings) and +919822222222
    expect(pv.sample[0].text).toMatch(/PTM/);
    const res = await c.bulk.launch(camp._id, "admin1");
    expect(res).toMatchObject({ queued: 1, skipped: 1 });   // Khan opted out
    await expect(c.bulk.launch(camp._id, "admin1")).rejects.toMatchObject({ code: "BAD_STATE" });
    await c.worker.tick();
    await c.bulk.finalizeFinished();
    const st = await c.bulk.stats(camp._id);
    expect(st.campaign.status).toBe("completed");
    expect(st.campaign.stats.sent).toBe(1);
    expect(mock.getOutbox()).toHaveLength(1);
  });

  test("bulk cancel stops queued messages", async () => {
    const camp = await c.bulk.createCampaign({ name: "x", channel: "sms", templateKey: "student_notice", variables: { title: "a", message: "b" }, audience: { kind: "students", filter: { classId: "c10" } } }, "a");
    await c.bulk.launch(camp._id, "a");
    expect((await c.bulk.cancel(camp._id)).cancelled).toBe(2);
    await c.worker.tick();
    expect(mock.getOutbox()).toHaveLength(0);
  });
});
