"use strict";
const crypto = require("crypto");
const NotificationLog = require("../models/NotificationLog");
const OptOut = require("../models/OptOut");
const Campaign = require("../models/Campaign");
const { renderTemplate } = require("../utils/renderTemplate");
const { normalizePhone } = require("../utils/phone");
const { MessagingError, ProviderError } = require("../utils/errors");
const { STATUS, CATEGORIES, PRIORITY, PURPOSES } = require("../constants");
const log = require("../utils/log");

/**
 * MessagingService — the ONLY thing business code (OTP, fees, notices ...) talks to.
 * It knows nothing about Fast2SMS / MSG91 / WhatsApp: it renders, applies policy, writes a log row,
 * and asks the provider registered for the channel to deliver.
 */
class MessagingService {
  constructor({ config, registry, templates }) {
    this.config = config;
    this.registry = registry;
    this.templates = templates;
    this.guards = [];   // async (logDoc) => string|null  — return a reason to cancel the send
  }

  /** Register a pre-send guard (e.g. "enquiry already converted -> don't send follow-up"). */
  registerGuard(fn) { this.guards.push(fn); }

  // ───────────────────────────── public API ─────────────────────────────

  /**
   * Queue (or immediately send) one message.
   * @param {object} req
   *  purpose, templateKey, to, variables           (required)
   *  channel, language, name, userId, recipientType, related:{type,id}, idempotencyKey,
   *  scheduledAt, priority, campaignId, createdBy, category, immediate
   * @returns {{ messageId, status, duplicate?, skippedReason? }}
   */
  async send(req) {
    if (!this.config.enabled) throw new MessagingError("Messaging is disabled (MESSAGING_ENABLED=false)", { code: "DISABLED", status: 503 });
    const prepared = await this._prepare(req);
    if (prepared.skip) return prepared.skip;

    const doc = await this._insert(prepared.row);
    if (doc.duplicate) return { messageId: doc.existing.messageId, status: doc.existing.status, duplicate: true };

    if (req.immediate) {
      const result = await this.dispatch(doc.row, prepared.plainBody);
      return { messageId: result.messageId, status: result.status, error: result.error };
    }
    return { messageId: doc.row.messageId, status: doc.row.status };
  }

  /**
   * Prepare + bulk-insert many messages. Used by campaigns. Returns counts; never throws per-recipient.
   * items: array of send() requests sharing campaignId.
   */
  async enqueueMany(items) {
    const rows = [];
    let skipped = 0;
    for (const req of items) {
      try {
        const p = await this._prepare(req, { persistSkips: false });
        if (p.skip) { skipped++; continue; }
        rows.push(p.row);
      } catch (e) { skipped++; log.warn(`enqueueMany skip: ${e.message}`); }
    }
    let queued = 0, duplicates = 0;
    if (rows.length) {
      try {
        const res = await NotificationLog.insertMany(rows, { ordered: false });
        queued = res.length;
      } catch (e) {
        // ordered:false -> unique-key (idempotency) collisions are expected on re-launch
        queued = e.insertedDocs ? e.insertedDocs.length : (e.result?.insertedCount ?? 0);
        duplicates = rows.length - queued;
        if (e.code !== 11000 && !e.writeErrors) throw e;
      }
    }
    return { queued, skipped, duplicates };
  }

  // ───────────────────────────── preparation ─────────────────────────────

  async _prepare(req, { persistSkips = true } = {}) {
    const channel = (req.channel || this.config.defaultChannel).toLowerCase();
    const phone = normalizePhone(req.to, this.config.defaultCountryCode);
    const base = {
      purpose: req.purpose, channel, templateKey: req.templateKey,
      recipient: { phone: phone || String(req.to || ""), name: req.name, userId: req.userId, type: req.recipientType || "other" },
      campaignId: req.campaignId, related: req.related, createdBy: req.createdBy,
    };
    const skip = async (reason, category = CATEGORIES.SERVICE) => {
      const row = { ...base, category, status: STATUS.SKIPPED, error: { code: "SKIPPED", message: reason }, events: [{ status: STATUS.SKIPPED, note: reason }] };
      if (persistSkips) await NotificationLog.create(row);
      return { skip: { messageId: null, status: STATUS.SKIPPED, skippedReason: reason } };
    };

    if (!phone) return skip("Invalid phone number");

    const tpl = await this.templates.resolve(req.templateKey, channel, req.language || "en");
    const category = req.category || tpl.category;

    // Consent: promotional always honours opt-out; service honours a global "all" opt-out; transactional never blocked
    if (category !== CATEGORIES.TRANSACTIONAL) {
      const scopes = category === CATEGORIES.PROMOTIONAL ? ["promotional", "all"] : ["all"];
      const opted = await OptOut.findOne({ phone, channel: { $in: [channel, "all"] }, scope: { $in: scopes } }).lean();
      if (opted) return skip("Recipient opted out", category);
    }

    const body = renderTemplate(tpl.body, req.variables || {});   // throws TEMPLATE_VARS_MISSING
    const sensitive = !!tpl.sensitive;

    let nextAttemptAt = req.scheduledAt ? new Date(req.scheduledAt) : new Date();
    if (category !== CATEGORIES.TRANSACTIONAL) nextAttemptAt = this._afterQuietHours(nextAttemptAt);

    return {
      plainBody: body,
      row: {
        ...base,
        messageId: crypto.randomUUID(),
        category,
        language: tpl.language,
        variables: sensitive ? undefined : req.variables,
        body: sensitive ? "[REDACTED]" : body,
        sensitive,
        status: STATUS.QUEUED,
        priority: req.priority ?? (req.purpose === PURPOSES.OTP ? PRIORITY.HIGH : PRIORITY.NORMAL),
        maxAttempts: sensitive ? 1 : this.config.queue.maxAttempts,   // OTP is never retried from the queue
        nextAttemptAt,
        idempotencyKey: req.idempotencyKey,
        events: [{ status: STATUS.QUEUED }],
      },
    };
  }

  async _insert(row) {
    try {
      const created = await NotificationLog.create(row);
      return { row: created };
    } catch (e) {
      if (e.code === 11000 && row.idempotencyKey) {
        const existing = await NotificationLog.findOne({ idempotencyKey: row.idempotencyKey }).lean();
        return { duplicate: true, existing };
      }
      throw e;
    }
  }

  /** Push non-transactional sends out of quiet hours (IST). "21:00-08:00" */
  _afterQuietHours(date) {
    const q = this.config.quietHours;
    if (!q) return date;
    const m = q.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!m) return date;
    const [sh, sm, eh, em] = m.slice(1).map(Number);
    const IST = 330 * 60000;
    const ist = new Date(date.getTime() + IST);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const start = sh * 60 + sm, end = eh * 60 + em;
    const inQuiet = start > end ? (mins >= start || mins < end) : (mins >= start && mins < end);
    if (!inQuiet) return date;
    const target = new Date(ist);
    target.setUTCHours(eh, em, 0, 0);
    if (start > end && mins >= start) target.setUTCDate(target.getUTCDate() + 1);
    return new Date(target.getTime() - IST);
  }

  // ───────────────────────────── dispatch ─────────────────────────────

  /**
   * Deliver one claimed/created log row through its channel's provider.
   * `plainBody` is only supplied for sensitive (OTP) messages that were never stored.
   */
  async dispatch(row, plainBody) {
    const doc = row.save ? row : await NotificationLog.findById(row._id);
    const channel = doc.channel;
    const provider = this.registry.forChannel(channel);

    for (const guard of this.guards) {
      const reason = await guard(doc).catch(() => null);
      if (reason) {
        await this._finish(doc, STATUS.CANCELLED, { note: reason });
        return { messageId: doc.messageId, status: STATUS.CANCELLED, error: reason };
      }
    }

    doc.provider = provider.name;
    doc.attempts += 1;
    doc.status = STATUS.PROCESSING;
    await doc.save();

    try {
      const tpl = await this.templates.resolve(doc.templateKey, channel, doc.language || "en");
      const providerRef = tpl.providerRefs?.[provider.name];
      if (provider.capabilities.requiresRegisteredTemplate && !providerRef) {
        throw new ProviderError(`Template "${doc.templateKey}" has no providerRefs.${provider.name} registration`, { retryable: false, code: "TEMPLATE_NOT_REGISTERED" });
      }
      const result = await provider.send({
        messageId: doc.messageId,
        channel,
        to: doc.recipient.phone,
        body: plainBody ?? doc.body,
        template: { key: doc.templateKey, language: doc.language, variables: doc.variables, providerRef },
        senderId: undefined,
        metadata: { purpose: doc.purpose, campaignId: doc.campaignId && String(doc.campaignId) },
      });
      doc.providerMessageId = result.providerMessageId;
      doc.cost = result.cost;
      doc.sentAt = new Date();
      doc.error = undefined;
      await this._finish(doc, STATUS.SENT, {});
      if (doc.campaignId) await Campaign.updateOne({ _id: doc.campaignId }, { $inc: { "stats.sent": 1 } });
      return { messageId: doc.messageId, status: STATUS.SENT };
    } catch (err) {
      return this._handleFailure(doc, err);
    }
  }

  async _handleFailure(doc, err) {
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const error = { code: err.code || "ERROR", message: String(err.message).slice(0, 500), retryable };
    if (retryable && doc.attempts < doc.maxAttempts) {
      const delay = this.config.queue.backoffBaseMs * 2 ** (doc.attempts - 1);
      doc.nextAttemptAt = new Date(Date.now() + delay);
      doc.error = error;
      await this._finish(doc, STATUS.QUEUED, { note: `retry #${doc.attempts} in ${Math.round(delay / 1000)}s: ${error.message}` });
      return { messageId: doc.messageId, status: STATUS.QUEUED, error: error.message };
    }
    doc.error = error;
    await this._finish(doc, STATUS.FAILED, { note: error.message });
    if (doc.campaignId) await Campaign.updateOne({ _id: doc.campaignId }, { $inc: { "stats.failed": 1 } });
    log.warn(`message ${doc.messageId} failed: ${error.message}`);
    await this._tryFallback(doc);
    return { messageId: doc.messageId, status: STATUS.FAILED, error: error.message };
  }

  /** e.g. WhatsApp failed -> same template via SMS (if configured & template exists). Never for OTP. */
  async _tryFallback(doc) {
    const fb = this.config.fallback[doc.channel];
    if (!fb || fb === doc.channel || doc.sensitive || doc.fallbackOf) return;
    try {
      await this.send({
        purpose: doc.purpose, channel: fb, templateKey: doc.templateKey, language: doc.language,
        to: doc.recipient.phone, name: doc.recipient.name, userId: doc.recipient.userId, recipientType: doc.recipient.type,
        variables: doc.variables, related: doc.related, campaignId: doc.campaignId, createdBy: doc.createdBy,
        idempotencyKey: doc.idempotencyKey ? `${doc.idempotencyKey}:fb:${fb}` : undefined,
      }).then(async (r) => {
        if (r.messageId) await NotificationLog.updateOne({ messageId: r.messageId }, { fallbackOf: doc.messageId });
      });
    } catch (e) { log.warn(`fallback to ${fb} not possible: ${e.message}`); }
  }

  async _finish(doc, status, { note }) {
    doc.status = status;
    doc.lockedAt = undefined;
    doc.lockedBy = undefined;
    doc.events.push({ status, note });
    await doc.save();
  }
}

module.exports = MessagingService;
