"use strict";
process.env.NODE_ENV = "test";
process.env.MOCK_PROVIDER_QUIET = "true";
process.env.MOCK_PROVIDER_AUTO_DELIVER = "false";
process.env.MESSAGING_QUIET_HOURS = "";
process.env.MESSAGING_OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.MESSAGING_OTP_EXPOSE_CODE_DEV = "true";
process.env.MESSAGING_DEV_ROUTES = "true";

const request = require("supertest");
const express = require("express");
const { installAll } = require("../testing/fakeMongoose");
const models = installAll();
const { buildContainer } = require("../container");
const { buildRouter } = require("../routes");

let app, c;
beforeAll(async () => {
  c = buildContainer();
  await c.templates.seedDefaults();
  app = express();
  app.use(express.json());
  const admin = (req, res, next) => (req.headers["x-admin"] ? ((req.user = { id: "admin1" }), next()) : res.status(401).json({ success: false }));
  app.use("/api/messaging", buildRouter(c, { requireAdmin: admin }));
});

test("OTP over HTTP: request -> verify, with validation + error mapping", async () => {
  expect((await request(app).post("/api/messaging/otp/request").send({})).status).toBe(400);
  const r = await request(app).post("/api/messaging/otp/request").send({ phone: "9876543210", purpose: "admission_form" });
  expect(r.status).toBe(200);
  const bad = await request(app).post("/api/messaging/otp/verify").send({ phone: "9876543210", purpose: "admission_form", code: "000001" });
  expect([400]).toContain(bad.status);
  const ok = await request(app).post("/api/messaging/otp/verify").send({ phone: "9876543210", purpose: "admission_form", code: r.body.data.devCode });
  expect(ok.status).toBe(200);
  expect(ok.body.data.verificationToken).toBeTruthy();
});

test("admin routes require auth; status/templates/logs/test-send/dev outbox work", async () => {
  expect((await request(app).get("/api/messaging/status")).status).toBe(401);
  const h = { "x-admin": "1" };
  const st = await request(app).get("/api/messaging/status").set(h);
  expect(st.body.data.mockMode).toBe(true);
  expect((await request(app).get("/api/messaging/templates").set(h)).body.data.length).toBeGreaterThan(10);
  const t = await request(app).post("/api/messaging/test").set(h).send({ to: "9876543210", channel: "whatsapp" });
  expect(t.body.data.status).toBe("sent");
  expect((await request(app).get("/api/messaging/dev/outbox").set(h)).body.data.length).toBeGreaterThan(0);
  const logs = await request(app).get("/api/messaging/logs?purpose=notice").set(h);
  expect(logs.body.data.total).toBe(1);
});

test("campaign API: create -> preview -> launch", async () => {
  const h = { "x-admin": "1" };
  const created = await request(app).post("/api/messaging/campaigns").set(h).send({
    name: "Custom", channel: "sms", templateKey: "student_notice", variables: { title: "Hi", message: "There" },
    audience: { kind: "custom", customRecipients: [{ phone: "9000000001", name: "A" }, { phone: "bad" }] } });
  expect(created.status).toBe(200);
  const id = created.body.data._id;
  const pv = await request(app).post(`/api/messaging/campaigns/${id}/preview`).set(h);
  expect(pv.body.data).toMatchObject({ recipients: 1, invalidNumbers: 1 });
  const l = await request(app).post(`/api/messaging/campaigns/${id}/launch`).set(h);
  expect(l.body.data.queued).toBe(1);
  expect((await request(app).post(`/api/messaging/campaigns/${id}/launch`).set(h)).status).toBe(409);
});

test("webhook delivers receipts for the mock provider", async () => {
  const sent = await c.messaging.send({ purpose: "notice", templateKey: "student_notice", channel: "sms", to: "9876543299", variables: { title: "a", message: "b" }, immediate: true });
  const log = await models.NotificationLog.findOne({ messageId: sent.messageId }).lean();
  const w = await request(app).post("/api/messaging/webhooks/mock").send({ providerMessageId: log.providerMessageId, status: "delivered" });
  expect(w.status).toBe(200);
  expect((await models.NotificationLog.findOne({ messageId: sent.messageId }).lean()).status).toBe("delivered");
  expect((await request(app).post("/api/messaging/webhooks/unknown").send({})).status).toBe(404);
});
