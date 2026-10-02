#!/usr/bin/env node
/**
 * Real-database smoke test (MONGODB_URI required). Everything stays in mock mode: nothing is sent.
 *   npm run messaging:smoke
 * Prints mock messages to the console, then cleans up its own test rows.
 */
"use strict";
require("dotenv").config();
process.env.MESSAGING_SMS_PROVIDER = "mock";
process.env.MESSAGING_WHATSAPP_PROVIDER = "mock";
process.env.MESSAGING_ALLOW_MOCK_IN_PRODUCTION = "true";
process.env.MESSAGING_WORKER_ENABLED = "false";   // we tick manually
process.env.MESSAGING_OTP_EXPOSE_CODE_DEV = "true";

(async () => {
  const messaging = require("../messaging");
  await messaging.init({ startWorker: false });
  const c = messaging.get();
  const PHONE = "9000000000";

  console.log("\n1) OTP");
  const otp = await c.otp.request({ phone: PHONE, purpose: "smoke" });
  const ok = await c.otp.verify({ phone: PHONE, purpose: "smoke", code: otp.devCode || c.registry.byProviderName("mock").getOutbox()[0].body.slice(0, 6) });
  console.log("   verified:", ok.verified);

  console.log("\n2) Queued notice -> worker");
  const q = await c.messaging.send({ purpose: "notice", templateKey: "student_notice", channel: "whatsapp", to: PHONE, variables: { title: "Smoke", message: "Hello from the queue" } });
  await c.worker.tick();
  console.log("   queued as", q.messageId);

  console.log("\n3) Fee sweep (dry run against your real fees-v2 data)");
  console.log("  ", JSON.stringify(await c.fees.runDailySweep({ dryRun: true })));

  const { NotificationLog, OtpRequest } = require("../messaging/models");
  await NotificationLog.deleteMany({ "recipient.phone": "+91" + PHONE });
  await OtpRequest.deleteMany({ phone: "+91" + PHONE });
  await messaging.shutdown();
  process.exit(0);
})().catch((e) => { console.error("SMOKE FAILED:", e); process.exit(1); });
