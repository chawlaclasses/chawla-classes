"use strict";
/**
 * Single source of truth for every MESSAGING_* env var.
 * Read once at boot (getConfig() is memoised) — nothing else in the module touches process.env
 * except individual provider classes reading their OWN credentials.
 *
 * Switching provider = change an env var + restart. No code change.
 */
const { CHANNELS } = require("../constants");

const bool = (v, d) => (v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(String(v).toLowerCase()));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

let cached;
function getConfig(env = process.env) {
  if (cached && env === process.env) return cached;
  const isProd = env.NODE_ENV === "production";

  const cfg = {
    enabled: bool(env.MESSAGING_ENABLED, true),
    isProd,

    // Which provider handles which channel. Unknown names fail fast at boot.
    providers: {
      [CHANNELS.SMS]: (env.MESSAGING_SMS_PROVIDER || "mock").toLowerCase(),
      [CHANNELS.WHATSAPP]: (env.MESSAGING_WHATSAPP_PROVIDER || "mock").toLowerCase(),
    },

    // If a channel exhausts retries, try this one (e.g. whatsapp -> sms). Empty = none.
    fallback: {
      [CHANNELS.WHATSAPP]: (env.MESSAGING_WHATSAPP_FALLBACK_CHANNEL || "").toLowerCase() || null,
      [CHANNELS.SMS]: (env.MESSAGING_SMS_FALLBACK_CHANNEL || "").toLowerCase() || null,
    },
    defaultChannel: (env.MESSAGING_DEFAULT_CHANNEL || CHANNELS.SMS).toLowerCase(),
    defaultCountryCode: env.MESSAGING_DEFAULT_COUNTRY_CODE || "91",

    // Safety: in production the mock provider must be explicitly allowed.
    allowMockInProduction: bool(env.MESSAGING_ALLOW_MOCK_IN_PRODUCTION, false),

    queue: {
      workerEnabled: bool(env.MESSAGING_WORKER_ENABLED, true),
      pollIntervalMs: int(env.MESSAGING_WORKER_POLL_MS, 2000),
      batchSize: int(env.MESSAGING_WORKER_BATCH_SIZE, 25),
      concurrency: int(env.MESSAGING_WORKER_CONCURRENCY, 5),
      maxAttempts: int(env.MESSAGING_MAX_ATTEMPTS, 4),
      backoffBaseMs: int(env.MESSAGING_BACKOFF_BASE_MS, 30_000), // 30s, 60s, 120s ...
      lockTimeoutMs: int(env.MESSAGING_LOCK_TIMEOUT_MS, 120_000), // reclaim stuck jobs
      // Provider throttle (messages/second) per channel. 0 = unlimited.
      ratePerSecond: {
        [CHANNELS.SMS]: int(env.MESSAGING_SMS_RATE_PER_SEC, 20),
        [CHANNELS.WHATSAPP]: int(env.MESSAGING_WHATSAPP_RATE_PER_SEC, 40),
      },
    },

    otp: {
      length: int(env.MESSAGING_OTP_LENGTH, 6),
      ttlSeconds: int(env.MESSAGING_OTP_TTL_SECONDS, 300),
      maxVerifyAttempts: int(env.MESSAGING_OTP_MAX_ATTEMPTS, 5),
      resendCooldownSeconds: int(env.MESSAGING_OTP_RESEND_COOLDOWN_SECONDS, 45),
      maxSendsPerHour: int(env.MESSAGING_OTP_MAX_SENDS_PER_HOUR, 5),
      channel: (env.MESSAGING_OTP_CHANNEL || CHANNELS.SMS).toLowerCase(),
      // HMAC secret for hashing codes. REQUIRED in production.
      secret: env.MESSAGING_OTP_SECRET || env.JWT_SECRET || "dev-only-otp-secret",
      // Mock/dev only: also return the code in the API response so React can be built without SMS.
      exposeCodeInResponse: bool(env.MESSAGING_OTP_EXPOSE_CODE_DEV, false) && !isProd,
    },

    bulk: {
      maxRecipientsPerCampaign: int(env.MESSAGING_BULK_MAX_RECIPIENTS, 5000),
      insertChunkSize: int(env.MESSAGING_BULK_INSERT_CHUNK, 500),
    },

    followUp: {
      // Delay (hours) after enquiry creation for each automatic touch
      stepsHours: (env.MESSAGING_ENQUIRY_FOLLOWUP_HOURS || "0,24,72")
        .split(",").map((s) => parseFloat(s.trim())).filter((n) => Number.isFinite(n) && n >= 0),
      channel: (env.MESSAGING_ENQUIRY_CHANNEL || CHANNELS.WHATSAPP).toLowerCase(),
    },

    feeReminder: {
      // Days relative to due date: -3 = 3 days before, 0 = on due date, 3 = 3 days overdue
      scheduleDays: (env.MESSAGING_FEE_REMINDER_DAYS || "-3,0,3,7")
        .split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite),
      channel: (env.MESSAGING_FEE_CHANNEL || CHANNELS.SMS).toLowerCase(),
      sendToParent: bool(env.MESSAGING_FEE_SEND_TO_PARENT, true),
    },

    // Quiet hours (IST) for non-transactional traffic. "21:00-08:00". Empty disables.
    quietHours: env.MESSAGING_QUIET_HOURS === undefined ? "21:00-08:00" : env.MESSAGING_QUIET_HOURS,

    webhookSecret: env.MESSAGING_WEBHOOK_SECRET || "",
    exposeDevRoutes: bool(env.MESSAGING_DEV_ROUTES, !isProd),
    logRetentionDays: int(env.MESSAGING_LOG_RETENTION_DAYS, 180),
  };

  if (env === process.env) cached = cfg;
  return cfg;
}

function resetConfigCache() { cached = undefined; }

module.exports = { getConfig, resetConfigCache };
