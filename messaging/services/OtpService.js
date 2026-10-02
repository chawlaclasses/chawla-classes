"use strict";
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const OtpRequest = require("../models/OtpRequest");
const { normalizePhone } = require("../utils/phone");
const { MessagingError } = require("../utils/errors");
const { PURPOSES, STATUS } = require("../constants");

/**
 * OTP lifecycle. Provider-agnostic: it only calls MessagingService.send({immediate:true}).
 * Security: code is hashed with HMAC (never stored), constant-time compare, attempt cap,
 * resend cooldown, hourly cap per phone, single use, and a short-lived verification token
 * the caller (e.g. admission form submit) can require.
 */
class OtpService {
  constructor({ config, messaging }) {
    this.cfg = config.otp;
    this.config = config;
    this.messaging = messaging;
  }

  _hash(phone, purpose, code) {
    return crypto.createHmac("sha256", this.cfg.secret).update(`${phone}|${purpose}|${code}`).digest("hex");
  }

  _generate() {
    const max = 10 ** this.cfg.length;
    return String(crypto.randomInt(0, max)).padStart(this.cfg.length, "0");
  }

  async request({ phone: rawPhone, purpose = "generic", ip, channel }) {
    const phone = normalizePhone(rawPhone, this.config.defaultCountryCode);
    if (!phone) throw new MessagingError("Enter a valid 10-digit mobile number", { code: "INVALID_PHONE" });

    const now = Date.now();
    const last = await OtpRequest.findOne({ phone, purpose }).sort({ createdAt: -1 }).lean();
    if (last) {
      const wait = Math.ceil((last.createdAt.getTime() + this.cfg.resendCooldownSeconds * 1000 - now) / 1000);
      if (wait > 0) throw new MessagingError(`Please wait ${wait}s before requesting another OTP`, { code: "OTP_COOLDOWN", status: 429, details: { retryAfterSeconds: wait } });
    }
    const sentLastHour = await OtpRequest.countDocuments({ phone, createdAt: { $gt: new Date(now - 3600_000) } });
    if (sentLastHour >= this.cfg.maxSendsPerHour) {
      throw new MessagingError("Too many OTP requests. Try again later.", { code: "OTP_HOURLY_LIMIT", status: 429, details: { retryAfterSeconds: 3600 } });
    }

    // invalidate older unconsumed codes for this phone+purpose
    await OtpRequest.updateMany({ phone, purpose, consumed: false }, { consumed: true });

    const code = this._generate();
    const record = await OtpRequest.create({
      phone, purpose, codeHash: this._hash(phone, purpose, code),
      expiresAt: new Date(now + this.cfg.ttlSeconds * 1000),
      maxAttempts: this.cfg.maxVerifyAttempts, requestIp: ip,
    });

    const result = await this.messaging.send({
      purpose: PURPOSES.OTP, templateKey: "otp_verification", channel: channel || this.cfg.channel,
      to: phone, variables: { code, minutes: Math.round(this.cfg.ttlSeconds / 60) },
      recipientType: "other", immediate: true, related: { type: "otp", id: String(record._id) },
    });

    if (result.status !== STATUS.SENT) {
      await OtpRequest.updateOne({ _id: record._id }, { consumed: true });
      throw new MessagingError("Could not send OTP right now. Please try again.", { code: "OTP_SEND_FAILED", status: 502 });
    }
    await OtpRequest.updateOne({ _id: record._id }, { messageId: result.messageId });

    return {
      requestId: String(record._id),
      expiresInSeconds: this.cfg.ttlSeconds,
      resendAfterSeconds: this.cfg.resendCooldownSeconds,
      ...(this.cfg.exposeCodeInResponse ? { devCode: code } : {}),   // dev-only escape hatch, off in prod
    };
  }

  async verify({ phone: rawPhone, purpose = "generic", code }) {
    const phone = normalizePhone(rawPhone, this.config.defaultCountryCode);
    if (!phone || !/^\d+$/.test(String(code || ""))) throw new MessagingError("Invalid OTP", { code: "OTP_INVALID" });

    const rec = await OtpRequest.findOne({ phone, purpose, consumed: false }).sort({ createdAt: -1 });
    if (!rec || rec.expiresAt < new Date()) throw new MessagingError("OTP expired. Request a new one.", { code: "OTP_EXPIRED", status: 400 });

    // atomic attempt counter — parallel guesses can't bypass the cap
    const upd = await OtpRequest.findOneAndUpdate(
      { _id: rec._id, consumed: false, attempts: { $lt: rec.maxAttempts } },
      { $inc: { attempts: 1 } }, { new: true });
    if (!upd) {
      await OtpRequest.updateOne({ _id: rec._id }, { consumed: true });
      throw new MessagingError("Too many wrong attempts. Request a new OTP.", { code: "OTP_LOCKED", status: 429 });
    }

    const expected = Buffer.from(rec.codeHash, "hex");
    const actual = Buffer.from(this._hash(phone, purpose, String(code)), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw new MessagingError(`Incorrect OTP. ${rec.maxAttempts - upd.attempts} attempt(s) left.`, { code: "OTP_INCORRECT", status: 400 });
    }

    await OtpRequest.updateOne({ _id: rec._id }, { consumed: true, verifiedAt: new Date() });
    const verificationToken = jwt.sign({ typ: "otp_verified", phone, purpose }, this.cfg.secret, { expiresIn: "15m" });
    return { verified: true, phone, verificationToken };
  }

  /** Call from any endpoint that must prove phone ownership (e.g. admission form submit). */
  assertVerified(token, phone, purpose) {
    try {
      const p = jwt.verify(token, this.cfg.secret);
      const norm = normalizePhone(phone, this.config.defaultCountryCode);
      if (p.typ !== "otp_verified" || p.phone !== norm || p.purpose !== purpose) throw new Error("mismatch");
      return true;
    } catch {
      throw new MessagingError("Phone verification required or expired", { code: "OTP_NOT_VERIFIED", status: 403 });
    }
  }
}

module.exports = OtpService;
