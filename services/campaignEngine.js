/**
 * services/campaignEngine.js
 *
 * The one place that turns "a selection + a message + a channel" into
 *   - a plan  (who exactly, how many units, what it will cost)   -> buildPlan
 *   - a verdict on whether it may be sent                        -> validatePlan
 *   - an actual send with per-recipient results                  -> executePlan
 *
 * The estimate endpoint and the send endpoint both go through buildPlan, so
 * "what you were shown in the confirmation" is always exactly "what is sent".
 */

"use strict";

const recipientEngine = require("./recipientEngine");
const { getChannel } = require("./campaignChannels");
const settingsService = require("./settings");

const MAX_RECIPIENTS_PER_SEND = 1000; // sends run inside one HTTP request
const MAX_MESSAGE_LENGTH = 1000;
const SEND_CONCURRENCY = 8;

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Fills {name} / {student} / {class} (also {{name}}) for one recipient.
 * Unknown placeholders are left untouched so a typo is visible in the
 * preview instead of silently disappearing.
 */
function renderMessage(template, recipient) {
  return String(template || "").replace(/\{\{?\s*(name|student|class)\s*\}?\}/gi, (_m, key) => {
    switch (key.toLowerCase()) {
      case "name": return recipient.name || "";
      case "student": return recipient.studentName || recipient.name || "";
      case "class": return recipient.className || "";
      default: return _m;
    }
  });
}

function getRate(channelId) {
  const costs = settingsService.getSettings().campaignCosts || {};
  const n = Number(costs[channelId]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {{ channel: string, message: string, selection: object }} input
 */
function buildPlan({ channel, message, selection }) {
  const ch = getChannel(channel);
  const text = String(message || "").trim();
  const selected = recipientEngine.resolveSelection(selection);

  const recipients = [];
  const seen = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;

  if (ch) {
    for (const r of selected) {
      const address = ch.address(r);
      if (!address) { invalidCount += 1; continue; }
      // siblings / shared parent numbers / an enquiry who became a student
      // must only get ONE message
      if (seen.has(address)) { duplicateCount += 1; continue; }
      seen.add(address);

      const rendered = renderMessage(text, r);
      recipients.push({ ...r, address, rendered, units: ch.units(rendered).units });
    }
  }

  const totalUnits = recipients.reduce((sum, r) => sum + r.units, 0);
  const rate = ch ? getRate(ch.id) : 0;
  const first = recipients[0] || null;

  return {
    channel: ch ? ch.id : null,
    channelLabel: ch ? ch.label : null,
    message: text,
    selectedCount: selected.length,
    validCount: recipients.length,
    invalidCount,
    duplicateCount,
    totalUnits,
    rate,
    estimatedCost: round2(totalUnits * rate),
    messageInfo: ch ? ch.units(first ? first.rendered : text) : null,
    sample: first ? { name: first.name, studentName: first.studentName, className: first.className, rendered: first.rendered } : null,
    recipients,
  };
}

/** Returns an error message, or null when the plan may be sent. */
function validatePlan(plan, { title, requireTitle = false } = {}) {
  const ch = getChannel(plan.channel);
  if (!ch) return "Select a valid channel";
  if (!ch.available) return `${ch.label} campaigns are not available yet`;
  if (requireTitle && !String(title || "").trim()) return "Campaign name is required";
  if (!plan.message) return "Message cannot be empty";
  if (plan.message.length > MAX_MESSAGE_LENGTH) return `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`;
  if (plan.selectedCount === 0) return "No recipients selected. Choose at least one recipient before sending";
  if (plan.validCount === 0) {
    const what = ch.id === "email" ? "email address" : "mobile number";
    return `None of the ${plan.selectedCount} selected recipient(s) has a valid ${what}`;
  }
  if (plan.validCount > MAX_RECIPIENTS_PER_SEND) {
    return `Too many recipients (${plan.validCount}). Send to at most ${MAX_RECIPIENTS_PER_SEND} at a time`;
  }
  return null;
}

/**
 * Sends to every recipient in the plan (bounded concurrency). Never throws:
 * a failing recipient is counted and its reason recorded, the rest continue.
 */
async function executePlan(plan, { title }) {
  const ch = getChannel(plan.channel);
  let sent = 0;
  let failed = 0;
  let sentUnits = 0;
  const failureReasons = {};

  let next = 0;
  async function worker() {
    while (next < plan.recipients.length) {
      const r = plan.recipients[next++];
      let result;
      try {
        result = await ch.send({ recipient: r, address: r.address, message: r.rendered, title });
      } catch (err) {
        result = { sent: false, reason: err.message };
      }
      if (result && result.sent) {
        sent += 1;
        sentUnits += r.units;
      } else {
        failed += 1;
        const reason = (result && result.reason) || "Unknown error";
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, plan.recipients.length) }, worker));

  return {
    sent,
    failed,
    sentUnits,
    // You are only billed for messages the provider actually accepted
    totalCost: round2(sentUnits * plan.rate),
    failureReasons,
  };
}

module.exports = {
  MAX_RECIPIENTS_PER_SEND,
  MAX_MESSAGE_LENGTH,
  renderMessage,
  buildPlan,
  validatePlan,
  executePlan,
};
