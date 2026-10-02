"use strict";
const crypto = require("crypto");
const BaseProvider = require("./BaseProvider");
const { ProviderError } = require("../utils/errors");
const { maskPhone } = require("../utils/phone");

/**
 * Development provider. Sends nothing — prints a readable block to the console and keeps the
 * last N messages in memory (GET /api/messaging/dev/outbox) so the React app can be built and
 * tested end to end without any SMS/WhatsApp account.
 *
 * Env knobs (all optional):
 *   MOCK_PROVIDER_LATENCY_MS=0        simulate network latency
 *   MOCK_PROVIDER_FAILURE_RATE=0      0..1 random retryable failures (test retry/backoff)
 *   MOCK_PROVIDER_AUTO_DELIVER=true   emit a 'delivered' receipt ~1s later
 *   MOCK_PROVIDER_QUIET=false         suppress console output (tests)
 */
class MockProvider extends BaseProvider {
  constructor(options = {}, env = process.env) {
    super(options);
    this.channelList = options.channels || ["sms", "whatsapp"];
    this.latencyMs = parseInt(env.MOCK_PROVIDER_LATENCY_MS || "0", 10);
    this.failureRate = parseFloat(env.MOCK_PROVIDER_FAILURE_RATE || "0");
    this.autoDeliver = String(env.MOCK_PROVIDER_AUTO_DELIVER || "true") !== "false";
    this.quiet = String(env.MOCK_PROVIDER_QUIET || "false") === "true";
    this.outbox = [];
    this.maxOutbox = 200;
  }

  get name() { return "mock"; }
  get channels() { return this.channelList; }
  get capabilities() {
    return { requiresRegisteredTemplate: false, bulk: true, maxBatchSize: 100, deliveryReceipts: "webhook", unicode: true };
  }

  async send(message) {
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new ProviderError("Mock provider simulated failure", { retryable: true, code: "MOCK_FAILURE" });
    }

    const providerMessageId = `mock_${crypto.randomUUID()}`;
    const entry = {
      providerMessageId,
      messageId: message.messageId,
      channel: message.channel,
      to: message.to,
      body: message.body,
      template: message.template ? message.template.key : null,
      at: new Date().toISOString(),
    };
    this.outbox.push(entry);
    if (this.outbox.length > this.maxOutbox) this.outbox.shift();

    if (!this.quiet) {
      const line = "─".repeat(60);
      console.log(
        `\n┌${line}\n│ 📨 [MOCK ${message.channel.toUpperCase()}] to ${maskPhone(message.to)}  (${message.to})\n` +
        `│ template: ${entry.template || "-"}   id: ${providerMessageId}\n├${line}\n` +
        message.body.split("\n").map((l) => `│ ${l}`).join("\n") + `\n└${line}\n`
      );
    }

    if (this.autoDeliver) {
      setTimeout(() => {
        this.emit("delivery", { providerMessageId, status: "delivered", at: new Date() });
      }, 1000).unref();
    }
    return { providerMessageId, status: "sent", cost: 0, raw: { mock: true } };
  }

  // Webhook shape for local testing: POST { providerMessageId, status, error? }
  verifyWebhook() { return true; }
  parseWebhook(req) {
    const b = req.body || {};
    return b.providerMessageId ? [{ providerMessageId: b.providerMessageId, status: b.status || "delivered", error: b.error, at: new Date(), raw: b }] : [];
  }

  getOutbox() { return [...this.outbox].reverse(); }
  clearOutbox() { this.outbox = []; }
}

module.exports = MockProvider;
