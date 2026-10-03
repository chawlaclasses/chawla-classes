"use strict";
/**
 * Fast2SMS — the SMS provider for the messaging layer (OTP, fee reminders,
 * notices, bulk campaigns).
 *
 * Env:
 *   FAST2SMS_API_KEY      required
 *   FAST2SMS_ROUTE        "q" (default; sends the rendered body, no DLT template needed)
 *                         | "dlt" (uses the template's providerRefs.fast2sms.templateId)
 *   FAST2SMS_SENDER_ID    DLT sender id (route "dlt")
 *
 * Route "dlt": each MessageTemplate needs providerRefs.fast2sms =
 *   { templateId: "<DLT message id>", variableOrder: ["name","amount"] }
 * and variables are sent as "a|b|c" in that order.
 *
 * Numbers go to Fast2SMS WITHOUT +91.  Response { return:true, request_id } -> providerMessageId.
 * Fast2SMS has no delivery-receipt webhook, so status stops at "sent".
 */
const BaseProvider = require("./BaseProvider");
const { ProviderError } = require("../utils/errors");
const { postToFast2Sms, normalizeNumber } = require("../../utils/sms");

class Fast2SmsProvider extends BaseProvider {
  get name() { return "fast2sms"; }
  get channels() { return ["sms"]; }
  get route() { return (process.env.FAST2SMS_ROUTE || "q").toLowerCase(); }
  get capabilities() {
    return {
      requiresRegisteredTemplate: this.route === "dlt",
      bulk: true,
      maxBatchSize: 1000,
      deliveryReceipts: "none",
      unicode: true,
    };
  }

  async send(message) {
    if (!process.env.FAST2SMS_API_KEY) {
      throw new ProviderError("FAST2SMS_API_KEY is not set", { retryable: false, code: "PROVIDER_NOT_CONFIGURED" });
    }
    const numbers = normalizeNumber(message.to);
    if (!numbers) {
      throw new ProviderError(`Invalid Indian mobile number: ${message.to}`, { retryable: false, code: "INVALID_RECIPIENT" });
    }

    let payload;
    if (this.route === "dlt") {
      const ref = message.template && message.template.providerRef;
      if (!ref || !ref.templateId) {
        throw new ProviderError("Template has no providerRefs.fast2sms.templateId", { retryable: false, code: "TEMPLATE_NOT_REGISTERED" });
      }
      const vars = message.template.variables || {};
      const order = ref.variableOrder || Object.keys(vars);
      payload = {
        route: "dlt",
        sender_id: message.senderId || process.env.FAST2SMS_SENDER_ID,
        message: ref.templateId,
        variables_values: order.map((k) => String(vars[k] ?? "")).join("|"),
        numbers,
      };
    } else {
      payload = { route: "q", message: message.body, numbers, flash: 0 };
    }

    const res = await postToFast2Sms(payload);
    if (!res.sent) {
      // 4xx = bad request / auth / insufficient balance -> permanent; network / 5xx / 429 -> retry
      const status = res.status || 0;
      const retryable = !status || status >= 500 || status === 429;
      throw new ProviderError(res.reason || "Fast2SMS send failed", { retryable, code: "FAST2SMS_ERROR", providerCode: status || undefined, raw: res.raw });
    }
    return { providerMessageId: String(res.requestId || message.messageId), status: "sent", raw: res.raw };
  }
}

module.exports = Fast2SmsProvider;
