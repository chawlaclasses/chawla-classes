"use strict";
const MessageTemplate = require("../models/MessageTemplate");
const { extractVariables } = require("../utils/renderTemplate");
const { MessagingError } = require("../utils/errors");
const defaults = require("../templates/defaultTemplates");
const { CHANNELS } = require("../constants");
const log = require("../utils/log");

const TTL_MS = 60_000;

class TemplateService {
  constructor() { this.cache = new Map(); }

  _ck(key, channel, language) { return `${key}|${channel}|${language}`; }
  invalidate() { this.cache.clear(); }

  /** Resolve template; falls back to English if the requested language is missing. */
  async resolve(key, channel, language = "en") {
    for (const lang of language === "en" ? ["en"] : [language, "en"]) {
      const ck = this._ck(key, channel, lang);
      const hit = this.cache.get(ck);
      if (hit && hit.exp > Date.now()) return hit.tpl;
      const tpl = await MessageTemplate.findOne({ key, channel, language: lang, isActive: true }).lean();
      if (tpl) {
        this.cache.set(ck, { tpl, exp: Date.now() + TTL_MS });
        return tpl;
      }
    }
    throw new MessagingError(`Template "${key}" (${channel}/${language}) not found or inactive`, { code: "TEMPLATE_NOT_FOUND", status: 404 });
  }

  async list(filter = {}) { return MessageTemplate.find(filter).sort({ key: 1, channel: 1 }).lean(); }

  async upsert(data, user) {
    const { key, channel, language = "en", body } = data;
    if (!key || !channel || !body) throw new MessagingError("key, channel and body are required", { code: "VALIDATION" });
    const payload = { ...data, key: key.toLowerCase(), language, variables: extractVariables(body), updatedBy: user };
    const existing = await MessageTemplate.findOne({ key: payload.key, channel, language });
    let doc;
    if (existing) {
      if (existing.body !== body) payload.version = existing.version + 1;
      Object.assign(existing, payload);
      doc = await existing.save();
    } else {
      doc = await MessageTemplate.create({ ...payload, createdBy: user });
    }
    this.invalidate();
    return doc;
  }

  async setActive(id, isActive) {
    const doc = await MessageTemplate.findByIdAndUpdate(id, { isActive }, { new: true });
    if (!doc) throw new MessagingError("Template not found", { code: "NOT_FOUND", status: 404 });
    this.invalidate();
    return doc;
  }

  /** Insert starter templates that don't exist yet. Safe to run on every boot. */
  async seedDefaults() {
    let created = 0;
    for (const t of defaults) {
      for (const channel of Object.values(CHANNELS)) {
        const res = await MessageTemplate.updateOne(
          { key: t.key, channel, language: "en" },
          { $setOnInsert: { ...t, channel, language: "en", variables: extractVariables(t.body), createdBy: "seed" } },
          { upsert: true });
        if (res.upsertedCount) created++;
      }
    }
    if (created) log.info(`seeded ${created} default message templates`);
    return created;
  }
}

module.exports = TemplateService;
