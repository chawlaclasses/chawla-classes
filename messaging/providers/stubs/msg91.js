"use strict";
/**
 * MSG91 — PLUG-IN TEMPLATE (not active, no HTTP calls).
 *
 * To enable later:
 *   Set MESSAGING_SMS_PROVIDER=msg91 plus MSG91_AUTH_KEY, MSG91_SENDER_ID, MSG91_DLT_PE_ID.
 *   Fill providerRefs.msg91.templateId on each MessageTemplate.
 *
 * Mapping notes (verify against MSG91 docs when implementing):
 *   - Flow API:  POST https://control.msg91.com/api/v5/flow/   header: authkey
 *                body: { template_id, recipients:[{ mobiles:"919876543210", VAR1:"..", VAR2:".." }] }
 *     (MSG91 expects mobiles WITH country code, no '+')
 *   - sendBulk: put up to N recipients in one Flow call -> set capabilities.bulk = true.
 *   - Delivery reports: MSG91 pushes to a webhook -> implement verifyWebhook()/parseWebhook().
 *   - WhatsApp via MSG91 can be a separate class (name "msg91_whatsapp", channels ["whatsapp"]).
 */
const BaseProvider = require("../BaseProvider");
const { NotImplementedProviderError } = require("../../utils/errors");

class Msg91Provider extends BaseProvider {
  get name() { return "msg91"; }
  get channels() { return ["sms"]; }
  get capabilities() {
    return { requiresRegisteredTemplate: true, bulk: true, maxBatchSize: 200, deliveryReceipts: "webhook", unicode: true };
  }
  async send(/* message */) { throw new NotImplementedProviderError("msg91"); }
  verifyWebhook(/* req */) { return false; }
  parseWebhook(/* req */) { return []; }
}
module.exports = Msg91Provider;
