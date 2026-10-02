"use strict";
const { sendMail } = require("./mailer");
const logger = require("./logger");
const { appDownloadUrl, sendCredentialsSms } = require("./credentialMessages");

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Emails a student's login details. Students sign in with their email, so
// Login ID == email. `password` may be omitted (e.g. only the email changed),
// in which case the mail says the password is unchanged.
async function sendStudentCredentials(req, { name, loginEmail, password, recipients, isUpdate }) {
  const loginUrl = `${req.protocol}://${req.get("host")}/`;
  const pwdCell = password
    ? `<strong>${esc(password)}</strong>`
    : `<span style="color:#666;">(unchanged \u2014 use your existing password)</span>`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222;">
      <h2 style="color:#4f6ef7;">Chawla Classes</h2>
      <p>Hello,</p>
      <p>${isUpdate ? "The login details were updated for" : "A student account has been created for"} <strong>${esc(name)}</strong>. Use the details below to sign in:</p>
      <table style="border-collapse:collapse;margin:14px 0;">
        <tr><td style="padding:6px 14px 6px 0;color:#666;">Login ID (Email)</td><td style="padding:6px 0;"><strong>${esc(loginEmail)}</strong></td></tr>
        <tr><td style="padding:6px 14px 6px 0;color:#666;">Password</td><td style="padding:6px 0;">${pwdCell}</td></tr>
      </table>
      <p><a href="${esc(loginUrl)}" style="background:#4f6ef7;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Open Chawla Classes</a></p>
      <p style="margin-top:8px;">Get the app: <a href="${esc(appDownloadUrl(req))}" style="color:#4f6ef7;font-weight:bold;">Download the Chawla Classes app</a></p>
      <p style="color:#888;font-size:12px;">Please keep these details private and change the password after your first login.</p>
    </div>`;
  const results = [];
  for (const to of recipients) {
    try {
      const r = await sendMail({ to, subject: isUpdate ? "Your Chawla Classes login details have been updated" : "Your Chawla Classes student login details", html });
      results.push({ to, sent: !!(r && r.sent), reason: r && r.reason });
    } catch (err) {
      logger.error(`Student credentials email failed for ${to}: ${err.message}`);
      results.push({ to, sent: false, reason: err.message });
    }
  }
  return results;
}

// Same details as a text message (SMS) to a phone number.
async function sendStudentSms(req, { name, loginEmail, password, phone, isUpdate }) {
  try {
    return await sendCredentialsSms({
      name, loginId: loginEmail, password, isUpdate,
      loginLink: `${req.protocol}://${req.get("host")}/`,
      appLink: appDownloadUrl(req),
    }, phone);
  } catch (err) {
    logger.error(`Student credentials SMS failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendStudentCredentials, sendStudentSms };
