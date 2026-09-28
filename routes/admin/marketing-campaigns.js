/**
 * routes/admin/marketing-campaigns.js
 *
 * Admin-side Marketing Campaigns — bulk promotional Email/WhatsApp/SMS
 * blasts. Deliberately separate from routes/admin/communication.js
 * (Communication Center), which only ever targets *students* for
 * operational messages (fee reminders, absence alerts). This module's
 * whole point is reaching *leads* too — website enquiries and admission
 * submissions who aren't students yet — for promotions ("new batch
 * starting", "admissions open", festival offers, etc.). No 'push' channel
 * here, unlike Communication Center: leads have no login/notification
 * inbox to push into.
 *
 * Every send is logged to the 'marketingCampaigns' collection (mirrors
 * how Communication Center logs to 'broadcasts') so there's a history to
 * review or duplicate later. Mounted at '/marketing/campaigns' by
 * routes/adminRoutes.js, so final URLs are /api/admin/marketing/campaigns/*.
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../../services/jsonDb");
const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const { sendMail } = require("../../utils/mailer");
const { sendWhatsApp } = require("../../utils/whatsapp");
const { sendSms } = require("../../utils/sms");

const VALID_CHANNELS = ["email", "whatsapp", "sms"];
const TARGET_TYPES = ["students", "enquiries", "admissions", "all_leads", "everyone"];

// Same contact can legitimately show up in more than one collection (e.g.
// an enquiry that later became a student) — dedupe by phone (falling back
// to email) so nobody gets the same campaign message twice.
function dedupeContacts(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = (c.phone || c.email || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function getStudentContacts() {
  return db
    .find("users", { role: "student" })
    .filter(s => s.isActive !== false)
    .map(s => ({ name: s.name, phone: s.phone || "", email: s.email || "" }));
}

function getEnquiryContacts(status) {
  let list = db.find("enquiries", {});
  if (status) list = list.filter(e => e.status === status);
  return list.map(e => ({ name: e.name, phone: e.phone || "", email: e.email || "" }));
}

function getAdmissionContacts(status) {
  let list = db.find("admissions", {});
  if (status) list = list.filter(a => a.status === status);
  return list.map(a => ({ name: a.studentName, phone: a.phone || "", email: a.email || "" }));
}

function resolveMarketingTargets(targetType, targetValue) {
  switch (targetType) {
    case "students":
      return dedupeContacts(getStudentContacts());
    case "enquiries":
      return dedupeContacts(getEnquiryContacts(targetValue));
    case "admissions":
      return dedupeContacts(getAdmissionContacts(targetValue));
    case "all_leads":
      return dedupeContacts([...getEnquiryContacts(), ...getAdmissionContacts()]);
    case "everyone":
      return dedupeContacts([...getStudentContacts(), ...getEnquiryContacts(), ...getAdmissionContacts()]);
    default:
      return [];
  }
}

// Preview who a targeting selection would reach, before sending
router.get("/targets/preview", requirePermission("marketing:view"), (req, res) => {
  try {
    const { targetType, targetValue } = req.query;
    if (!targetType || !TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ success: false, message: "A valid targetType is required" });
    }
    const contacts = resolveMarketingTargets(targetType, targetValue);
    res.json({ success: true, data: { count: contacts.length, contacts: contacts.slice(0, 50) } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Compose and send — fans the message out across every selected channel to
// every resolved contact, and logs one 'marketingCampaigns' record.
// Channel failures (e.g. SMTP/Twilio not configured) don't block the
// other channels — each is attempted independently, same as Communication
// Center's /communication/send.
router.post("/send", requirePermission("marketing:send"), async (req, res) => {
  try {
    const { title, message, channels, targetType, targetValue } = req.body;

    if (!title || !message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }
    if (!targetType || !TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ success: false, message: "A valid targetType is required" });
    }
    const selectedChannels = (Array.isArray(channels) ? channels : []).filter(c => VALID_CHANNELS.includes(c));
    if (selectedChannels.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one channel" });
    }

    const contacts = resolveMarketingTargets(targetType, targetValue);
    if (contacts.length === 0) {
      return res.status(400).json({ success: false, message: "No contacts match this target — nothing was sent" });
    }

    const channelResults = {
      email: { sent: 0, failed: 0 },
      whatsapp: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
    };

    for (const contact of contacts) {
      if (selectedChannels.includes("email")) {
        const result = await sendMail({
          to: contact.email,
          subject: title,
          html: `<p>${message.trim().replace(/\n/g, "<br>")}</p><p>— Chawla Classes</p>`,
        });
        channelResults.email[result.sent ? "sent" : "failed"] += 1;
      }
      if (selectedChannels.includes("whatsapp")) {
        const result = await sendWhatsApp({ to: contact.phone, body: `*${title}*\n\n${message.trim()}` });
        channelResults.whatsapp[result.sent ? "sent" : "failed"] += 1;
      }
      if (selectedChannels.includes("sms")) {
        const result = await sendSms({ to: contact.phone, body: `${title}: ${message.trim()}` });
        channelResults.sms[result.sent ? "sent" : "failed"] += 1;
      }
    }

    const campaign = db.insertOne("marketingCampaigns", {
      title,
      message: message.trim(),
      channels: selectedChannels,
      targetType,
      targetValue: targetValue || null,
      recipientCount: contacts.length,
      channelResults,
      sentBy: req.userData._id,
      sentByName: req.userData.name,
    });

    logAudit(req, "create", "marketing-campaign", campaign._id, `Sent "${title}" to ${contacts.length} contact(s) via ${selectedChannels.join(", ")}`);

    res.status(201).json({
      success: true,
      data: campaign,
      message: `Sent to ${contacts.length} contact(s) via ${selectedChannels.join(", ")}`,
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Send history, newest first
router.get("/history", requirePermission("marketing:view"), (req, res) => {
  try {
    const history = db.find("marketingCampaigns", {}).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
    res.json({ success: true, data: history });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
