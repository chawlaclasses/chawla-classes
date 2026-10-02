"use strict";
/**
 * Fast2SMS — PLUG-IN TEMPLATE (not active, no HTTP calls).
 *
 * To enable later:
 *   1. Copy the body of send() below into real code using fetch/axios.
 *   2. Set  MESSAGING_SMS_PROVIDER=fast2sms  and FAST2SMS_API_KEY / FAST2SMS_SENDER_ID.
 *   3. In Template admin, fill providerRefs.fast2sms.templateId (DLT message id) per template.
 *
 * Mapping notes (verify against Fast2SMS docs when implementing):
 *   - DLT route:   POST https://www.fast2sms.com/dev/bulkV2   header: authorization: <API_KEY>
 *                  body: { route:"dlt", sender_id, message:<dlt template id>, variables_values:"a|b|c", numbers:"9876543210" }
 *   - OTP route:   route:"otp", variables_values:"123456"
 *   - Numbers go WITHOUT +91 -> strip with message.to.replace(/^\+91/, "").
 *   - Response { return:true, request_id } -> providerMessageId = request_id.
 *   - variables_values order must follow template.providerRef.variableOrder.
 */
const BaseProvider = require("../BaseProvider");
const { NotImplementedProviderError } = require("../../utils/errors");

class Fast2SmsProvider extends BaseProvider {
  get name() { return "fast2sms"; }
  get channels() { return ["sms"]; }
  get capabilities() {
    return { requiresRegisteredTemplate: true, bulk: true, maxBatchSize: 1000, deliveryReceipts: "none", unicode: true };
  }
  async send(/* message */) {
    // TODO(future): const key = process.env.FAST2SMS_API_KEY; build payload from message.template.providerRef
    throw new NotImplementedProviderError("fast2sms");
  }
}
module.exports = Fast2SmsProvider;
