"use strict";
/**
 * WhatsApp Business Cloud API (Meta) — PLUG-IN TEMPLATE (not active, no HTTP calls).
 *
 * To enable later:
 *   Set MESSAGING_WHATSAPP_PROVIDER=whatsapp_cloud plus WHATSAPP_PHONE_NUMBER_ID,
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN.
 *   Fill providerRefs.whatsapp_cloud = { name, language, variableOrder } on each MessageTemplate.
 *
 * Mapping notes (verify against Meta docs when implementing):
 *   - POST https://graph.facebook.com/<ver>/<PHONE_NUMBER_ID>/messages  Bearer token
 *     { messaging_product:"whatsapp", to:"919876543210", type:"template",
 *       template:{ name, language:{code}, components:[{ type:"body", parameters:[{type:"text",text}] }] } }
 *   - Business-initiated messages MUST be pre-approved templates (requiresRegisteredTemplate = true).
 *   - Receipts + inbound replies arrive on ONE webhook: verify X-Hub-Signature-256 (HMAC of raw body
 *     with APP_SECRET) in verifyWebhook(); map statuses sent/delivered/read/failed in parseWebhook().
 *   - GET webhook challenge (hub.verify_token) is handled by routes/webhookRoutes if you add it.
 */
const BaseProvider = require("../BaseProvider");
const { NotImplementedProviderError } = require("../../utils/errors");

class WhatsAppCloudProvider extends BaseProvider {
  get name() { return "whatsapp_cloud"; }
  get channels() { return ["whatsapp"]; }
  get capabilities() {
    return { requiresRegisteredTemplate: true, bulk: false, maxBatchSize: 1, deliveryReceipts: "webhook", unicode: true };
  }
  async send(/* message */) { throw new NotImplementedProviderError("whatsapp_cloud"); }
  verifyWebhook(/* req */) { return false; }
  parseWebhook(/* req */) { return []; }
}
module.exports = WhatsAppCloudProvider;
