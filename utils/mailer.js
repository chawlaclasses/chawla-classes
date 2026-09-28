/**
 * utils/mailer.js
 *
 * Thin nodemailer wrapper for transactional emails (currently: fee payment
 * reminders). Gracefully no-ops — logs and returns { sent: false } instead of
 * throwing — when SMTP env vars aren't configured, so callers (e.g. the
 * "remind" fee endpoints) can still succeed from the admin's point of view
 * even on a fresh install that hasn't set up email yet.
 */

"use strict";

const nodemailer = require("nodemailer");
const logger = require("./logger");
const { sendViaBrevoApi } = require("./brevoMailer");
const settingsService = require("../services/settings");

let _transporter = null;
let _checkedConfig = false;

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY) || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Parses '"Chawla Classes" <no-reply@chawlaclasses.com>' (or a bare email)
// into { name, email }, reusing the existing SMTP_FROM env var so Brevo
// doesn't need its own separate from-name/from-email config.
function parseFrom(raw) {
  if (!raw) return null;
  const quoted = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (quoted) return { name: quoted[1].trim(), email: quoted[2].trim() };
  if (/^[^<>\s]+@[^<>\s]+$/.test(raw.trim())) return { name: "Chawla Classes", email: raw.trim() };
  return null;
}

// FIX: this used to only look at the SMTP_FROM/SMTP_USER *env vars*, which
// aren't necessarily the same address that's actually verified as a sender
// in Brevo (or authorized to relay via the SMTP account). Admin ->
// Settings -> Email Configuration writes a *different*, DB-stored address
// (settingsService's `email.fromAddress`/`user`) that routes/settings.js's
// /test-email already sends from successfully. Prefer that DB-configured,
// known-working address; fall back to the env vars only if the admin
// hasn't configured one, so this stays backward compatible with
// env-var-only installs.
function resolveFrom() {
  try {
    const { email } = settingsService.getSettings();
    const dbAddress = email && (email.fromAddress || email.user);
    if (dbAddress) {
      return { name: (email && email.fromName) || "Chawla Classes", email: dbAddress };
    }
  } catch (err) {
    // Settings not readable for some reason -- fall through to env vars
    // below rather than failing the send entirely.
  }
  return parseFrom(process.env.SMTP_FROM) || { name: "Chawla Classes", email: process.env.SMTP_USER };
}

function getTransporter() {
  if (_transporter || _checkedConfig) return _transporter;
  _checkedConfig = true;

  if (!isConfigured()) {
    logger.warn("Email not sent: SMTP_HOST/SMTP_USER/SMTP_PASS are not set in .env — mailer running in no-op mode.");
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // FIX: default connectionTimeout is 2 minutes — if the host's outbound
    // SMTP is blocked (e.g. Render free tier), every fee-reminder send would
    // silently hang for 2 min before failing. Fail fast instead so callers
    // (and their HTTP requests) aren't stuck waiting on a doomed connection.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  return _transporter;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
  if (!to) return { sent: false, reason: "No recipient email address" };

  // Prefer Brevo's HTTP API when configured — it goes over HTTPS (443), so
  // it isn't affected by hosts (like Render's free tier) that block outbound
  // SMTP ports. Falls through to SMTP below if BREVO_API_KEY isn't set.
  if (process.env.BREVO_API_KEY) {
    const from = resolveFrom();
    try {
      await sendViaBrevoApi({
        to,
        subject,
        html,
        text: text || (html ? html.replace(/<[^>]+>/g, " ") : undefined),
        fromName: from.name,
        fromEmail: from.email,
        apiKey: process.env.BREVO_API_KEY,
      });
      return { sent: true };
    } catch (err) {
      logger.error(`Brevo API email send failed to ${to}: ${err.message}`);
      return { sent: false, reason: err.message };
    }
  }

  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "SMTP not configured" };

  try {
    const from = resolveFrom();
    await transporter.sendMail({
      from: `"${from.name}" <${from.email}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " "),
    });
    return { sent: true };
  } catch (err) {
    logger.error(`Email send failed to ${to}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, isConfigured };
