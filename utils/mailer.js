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

let _transporter = null;
let _checkedConfig = false;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
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
  });
  return _transporter;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
  if (!to) return { sent: false, reason: "No recipient email address" };

  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "SMTP not configured" };

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Chawla Classes" <${process.env.SMTP_USER}>`,
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
