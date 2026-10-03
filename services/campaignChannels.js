/**
 * services/campaignChannels.js
 *
 * Channel registry for Marketing Campaigns. services/recipientEngine.js
 * decides WHO gets a campaign; this file decides HOW each channel reaches
 * them. Adding a channel later (e.g. Push) means adding one entry here —
 * the recipient selection, cost estimate, validation, confirmation and
 * history code all work off this common shape:
 *
 *   {
 *     id, label,
 *     available,                  // false = shown as "coming soon", cannot be sent
 *     address(recipient)          -> normalised destination ("" if unusable)
 *     units(message)              -> { units, encoding, length, perUnit } billing units for ONE message
 *     send({ recipient, address, message, title }) -> { sent, reason? }   (never throws)
 *   }
 *
 * Senders are the app's existing single implementations
 * (utils/sms.js, utils/whatsapp.js, utils/mailer.js) — nothing new is
 * integrated here, so provider credentials/config stay exactly as they are.
 */

"use strict";

const { sendSms, normalizeNumber } = require("../utils/sms");
const { sendWhatsApp } = require("../utils/whatsapp");
const { sendMail } = require("../utils/mailer");

// ------------------------------------------------------------------
// SMS unit counting
// ------------------------------------------------------------------
// GSM 03.38 basic set (1 char each) and extension set (2 chars each). Any
// character outside both — Hindi, emoji, and notably "₹" — forces UCS-2
// encoding (70 chars per SMS, 67 when concatenated) instead of 160/153.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

function smsUnits(message) {
  const text = String(message || "");
  if (!text.length) return { units: 0, encoding: "GSM-7", length: 0, perUnit: 160 };

  let gsmLength = 0;
  let isGsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else { isGsm = false; break; }
  }

  if (isGsm) {
    const units = gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
    return { units, encoding: "GSM-7", length: gsmLength, perUnit: gsmLength <= 160 ? 160 : 153 };
  }
  // UCS-2 counts UTF-16 code units (so an emoji = 2)
  const ucsLength = text.length;
  const units = ucsLength <= 70 ? 1 : Math.ceil(ucsLength / 67);
  return { units, encoding: "Unicode", length: ucsLength, perUnit: ucsLength <= 70 ? 70 : 67 };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ------------------------------------------------------------------
// Registry
// ------------------------------------------------------------------
const CHANNELS = {
  sms: {
    id: "sms",
    label: "SMS",
    available: true,
    address: r => normalizeNumber(r.phone),
    units: smsUnits,
    send: ({ recipient, message }) => sendSms({ to: recipient.phone, body: message }),
  },

  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    available: true,
    address: r => normalizeNumber(r.phone),
    // WhatsApp bills per conversation/message, not per 160 characters
    units: m => ({ units: m ? 1 : 0, encoding: "Text", length: String(m || "").length, perUnit: 4096 }),
    send: ({ recipient, message, title }) =>
      sendWhatsApp({ to: recipient.phone, body: title ? `*${title}*\n\n${message}` : message }),
  },

  email: {
    id: "email",
    label: "Email",
    available: true,
    address: r => (EMAIL_RE.test(r.email || "") ? r.email.trim().toLowerCase() : ""),
    units: m => ({ units: m ? 1 : 0, encoding: "HTML", length: String(m || "").length, perUnit: Infinity }),
    send: ({ recipient, message, title }) =>
      sendMail({
        to: recipient.email,
        subject: title || "Chawla Classes",
        html: `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p><p>— Chawla Classes</p>`,
      }),
  },

  // Placeholder so the UI/API already speak about Push. Needs a device-token
  // audience (students with the app installed), which the shared recipient
  // directory doesn't carry yet — see services/fcm.js for the sender.
  push: {
    id: "push",
    label: "Push Notification",
    available: false,
    address: () => "",
    units: m => ({ units: m ? 1 : 0, encoding: "Text", length: String(m || "").length, perUnit: 4096 }),
    send: async () => ({ sent: false, reason: "Push campaigns are not available yet" }),
  },
};

function getChannel(id) {
  return CHANNELS[id] || null;
}

function listChannels() {
  return Object.values(CHANNELS).map(c => ({ id: c.id, label: c.label, available: c.available }));
}

module.exports = { CHANNELS, getChannel, listChannels, smsUnits, EMAIL_RE };
