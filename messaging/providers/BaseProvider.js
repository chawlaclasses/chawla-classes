"use strict";
const { EventEmitter } = require("events");
const { NotImplementedProviderError } = require("../utils/errors");

/**
 * ProviderMessage — what the service layer hands to a provider (provider-agnostic):
 * {
 *   messageId:  string           // our NotificationLog.messageId (use as client reference / idempotency)
 *   channel:    "sms"|"whatsapp"
 *   to:         "+919876543210"  // already normalised E.164
 *   body:       string           // fully rendered text (SMS providers w/o templates, mock)
 *   template:   { key, language, variables, providerRef }  // providerRef = this provider's own
 *                                // template id (DLT id / MSG91 template_id / WhatsApp template name)
 *   senderId:   string|undefined
 *   metadata:   object
 * }
 *
 * ProviderSendResult: { providerMessageId, status: "sent"|"queued", cost?, raw? }
 * DeliveryEvent:      { providerMessageId, status: "sent"|"delivered"|"read"|"failed", error?, at: Date, raw? }
 *
 * Implementing a new provider = extend this class, implement send() (+ parseWebhook if the vendor
 * pushes receipts), register it in ProviderRegistry. Business logic never changes.
 */
class BaseProvider extends EventEmitter {
  /** @param {object} options provider-specific config injected by the registry */
  constructor(options = {}) {
    super();
    this.options = options;
  }

  /** Registry key, matches MESSAGING_*_PROVIDER env value. */
  get name() { throw new Error("Provider must define name"); }

  /** Channels this provider can serve. */
  get channels() { throw new Error("Provider must define channels"); }

  get capabilities() {
    return {
      requiresRegisteredTemplate: false, // true for DLT SMS / WhatsApp business-initiated
      bulk: false,                       // native batch endpoint
      maxBatchSize: 1,
      deliveryReceipts: "none",          // "webhook" | "poll" | "none"
      unicode: true,
    };
  }

  /** @returns {Promise<{providerMessageId:string,status:string,cost?:number,raw?:any}>} @throws ProviderError */
  async send(/* message */) { throw new NotImplementedProviderError(this.name); }

  /** Default bulk = parallel send(). Override when the vendor has a batch API. */
  async sendBulk(messages) {
    const settled = await Promise.allSettled(messages.map((m) => this.send(m)));
    return settled.map((s, i) => s.status === "fulfilled"
      ? { messageId: messages[i].messageId, ok: true, result: s.value }
      : { messageId: messages[i].messageId, ok: false, error: s.reason });
  }

  /** Verify authenticity of an incoming delivery-receipt webhook (signature / token). */
  verifyWebhook(/* req */) { return false; }

  /** Convert a vendor webhook request into normalised DeliveryEvents. */
  parseWebhook(/* req */) { return []; }

  async healthCheck() { return { ok: true }; }
}

module.exports = BaseProvider;
