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
const campaignEngine = require("../../services/campaignEngine");
const marketingSelection = require("../../services/marketingSelection");

const VALID_CHANNELS = ["email", "whatsapp", "sms"];
const TARGET_TYPES = ["students", "enquiries", "admissions", "all_leads", "everyone", "selection"];

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
    case "selection":
      // Hand-picked audience: the client only sends { source, id } references.
      // They are looked up in the database here (services/marketingSelection.js)
      // — contact details sent by the browser are never used.
      return marketingSelection.resolveSelection(targetValue).contacts;
    default:
      return [];
  }
}

// Preview who a targeting selection would reach, before sending.
//
//   GET  /targets/preview?targetType=students            (all non-selection types — unchanged)
//   POST /targets/preview  { targetType: "selection", selection: { recipients: [...] } }
//
// A hand-picked list can be up to MAX_SELECTED ids, far too long for a query
// string, so the picker uses POST. GET still accepts targetType=selection (a
// comma-separated "source:id" list in `selection`/`targetValue`) so an old
// client or a bare ?targetType=selection never gets a 400.
function handleTargetPreview(req, res) {
  try {
    const src = req.method === "GET" ? req.query : (req.body || {});
    const { targetType, targetValue } = src;

    if (!targetType || typeof targetType !== "string" || !TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ success: false, message: "A valid targetType is required" });
    }

    if (targetType === "selection") {
      const rawSelection = src.selection !== undefined && src.selection !== null ? src.selection : targetValue;
      const resolved = marketingSelection.resolveSelection(rawSelection);
      // A preview *answers a question* ("who would this reach?"). "Nobody yet —
      // pick someone" is a valid answer, so it is a 200 with a friendly message,
      // not an error status. (Sending is different — see POST /send.)
      if (!resolved.ok) {
        return res.json({
          success: true,
          data: { count: 0, contacts: [], valid: false, code: resolved.code, message: resolved.message, summary: resolved.summary },
        });
      }
      return res.json({
        success: true,
        data: {
          valid: true,
          count: resolved.contacts.length,
          contacts: resolved.contacts.slice(0, 50),
          summary: resolved.summary,
        },
      });
    }

    const contacts = resolveMarketingTargets(targetType, targetValue);
    res.json({ success: true, data: { count: contacts.length, contacts: contacts.slice(0, 50) } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
}

router.get("/targets/preview", requirePermission("marketing:view"), handleTargetPreview);
router.post("/targets/preview", requirePermission("marketing:view"), handleTargetPreview);

// Everyone the "Custom Recipient Selection" picker can offer: students,
// enquiries and admission leads, each as { key, source, name, phone, email }.
// Filtering/search/paging happen in the browser; the server re-validates the
// ids on preview and send, so this list is purely a convenience for the UI.
router.get("/targets/recipients", requirePermission("marketing:view"), (req, res) => {
  try {
    const rows = marketingSelection.getDirectory();
    res.json({
      success: true,
      data: {
        rows,
        total: rows.length,
        counts: marketingSelection.countsBySource(rows),
        maxSelectable: marketingSelection.MAX_SELECTED,
      },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Compose and send — fans the message out across every selected channel to
// every resolved contact, and logs one 'marketingCampaigns' record.
// Channel failures (e.g. SMTP/Fast2SMS not configured) don't block the
// other channels — each is attempted independently, same as Communication
// Center's /communication/send.
router.post("/send", requirePermission("marketing:send"), async (req, res) => {
  try {
    const { title, message, channels, targetType, targetValue, selection } = req.body;

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

    let contacts;
    let selectionSummary = null;
    if (targetType === "selection") {
      // Only the ids the admin ticked are sent to — re-resolved from the
      // database here, so a tampered/stale request can't widen the audience.
      // Validation problems are 422 (well-formed request, unusable selection)
      // with a `code` the UI can act on.
      const resolved = marketingSelection.resolveSelection(selection !== undefined && selection !== null ? selection : targetValue);
      if (!resolved.ok) {
        return res.status(422).json({ success: false, code: resolved.code, message: resolved.message });
      }
      contacts = resolved.contacts;
      selectionSummary = resolved.summary;

      // Don't "send" to a channel nobody on the list can receive.
      const reachable = { email: selectionSummary.reach.email, whatsapp: selectionSummary.reach.phone, sms: selectionSummary.reach.phone };
      if (selectedChannels.every(c => reachable[c] === 0)) {
        const needs = selectedChannels.every(c => c === "email") ? "an email address" : selectedChannels.every(c => c !== "email") ? "a phone number" : "a phone number or email address";
        return res.status(422).json({
          success: false,
          code: "NO_REACHABLE_RECIPIENTS",
          message: `None of the selected recipients have ${needs} for the channel(s) you chose. Pick different recipients or another channel.`,
        });
      }
    } else {
      contacts = resolveMarketingTargets(targetType, targetValue);
      if (contacts.length === 0) {
        return res.status(400).json({ success: false, message: "No contacts match this target — nothing was sent" });
      }
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
      // For hand-picked audiences, history shows "12 selected: 5 students, ..."
      // instead of a raw id list.
      targetValue: selectionSummary ? marketingSelection.describeSummary(selectionSummary) : (targetValue || null),
      recipientCount: contacts.length,
      channelResults,
      sentBy: req.userData._id,
      sentByName: req.userData.name,
      ...(selectionSummary ? { selectionSummary } : {}),
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

// ============================================================
// Recipient-selection campaigns (SMS / WhatsApp / Email)
// ============================================================
// Everything below is ADDITIVE — the /send, /history and /targets/preview
// routes above are unchanged. These use the shared recipient engine
// (services/recipientEngine.js) + campaign engine so the admin picks exact
// recipients, sees the cost, confirms, and the result is logged to the SAME
// 'marketingCampaigns' collection (old fields kept so the legacy "Recent
// Campaigns" list keeps rendering new records too).

// One in-flight send per admin: stops a double-click / second tab from
// firing the same campaign twice while the first is still going out.
const sendsInProgress = new Set();

router.post("/send-selected", requirePermission("marketing:send"), async (req, res) => {
  const adminId = String(req.userData?._id || "unknown");
  try {
    const { message, channel = "sms", selection } = req.body || {};
    const title = String(req.body?.title || "").trim();

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message cannot be empty" });
    }

    const plan = campaignEngine.buildPlan({ channel, message, selection });
    const problem = campaignEngine.validatePlan(plan, { title, requireTitle: true });
    if (problem) return res.status(400).json({ success: false, message: problem });

    if (sendsInProgress.has(adminId)) {
      return res.status(409).json({ success: false, message: "A campaign is already being sent. Please wait for it to finish." });
    }
    sendsInProgress.add(adminId);

    let outcome;
    try {
      outcome = await campaignEngine.executePlan(plan, { title });
    } finally {
      sendsInProgress.delete(adminId);
    }

    const groups = Array.isArray(selection?.groups) ? selection.groups : [];
    const campaign = db.insertOne("marketingCampaigns", {
      // legacy fields (read by the old Recent Campaigns list)
      title,
      message: plan.message,
      channels: [plan.channel],
      targetType: "selection",
      targetValue: groups.join(",") || null,
      recipientCount: plan.validCount,
      channelResults: { [plan.channel]: { sent: outcome.sent, failed: outcome.failed } },
      sentBy: req.userData._id,
      sentByName: req.userData.name,
      // campaign history fields
      campaignName: title,
      channel: plan.channel,
      totalRecipients: plan.validCount,
      successfulSends: outcome.sent,
      failedSends: outcome.failed,
      skippedInvalid: plan.invalidCount,
      skippedDuplicates: plan.duplicateCount,
      totalUnits: plan.totalUnits,
      costPerUnit: plan.rate,
      estimatedCost: plan.estimatedCost,
      totalCost: outcome.totalCost,
      failureReasons: outcome.failureReasons,
      selectionSummary: {
        groups,
        classKeys: Array.isArray(selection?.classKeys) ? selection.classKeys : [],
      },
      createdBy: req.userData._id,
      createdByName: req.userData.name,
    });

    logAudit(
      req, "create", "marketing-campaign", campaign._id,
      `Sent "${campaign.campaignName}" via ${plan.channel} to ${plan.validCount} recipient(s): ${outcome.sent} sent, ${outcome.failed} failed`
    );

    res.status(201).json({
      success: true,
      data: {
        _id: campaign._id,
        sent: outcome.sent,
        failed: outcome.failed,
        totalRecipients: plan.validCount,
        skippedInvalid: plan.invalidCount,
        skippedDuplicates: plan.duplicateCount,
        totalCost: outcome.totalCost,
        failureReasons: outcome.failureReasons,
      },
      message: outcome.failed === 0
        ? `Sent to ${outcome.sent} recipient(s)`
        : `Sent to ${outcome.sent} recipient(s); ${outcome.failed} failed`,
    });
  } catch (error) {
    sendsInProgress.delete(adminId);
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// Normalises a stored campaign (old or new) into the Campaign History shape.
function toHistoryRow(c) {
  const results = c.channelResults || {};
  const sumOf = key => Object.values(results).reduce((n, r) => n + (Number(r && r[key]) || 0), 0);
  return {
    _id: c._id,
    campaignName: c.campaignName || c.title || "Untitled",
    message: c.message || "",
    channels: Array.isArray(c.channels) ? c.channels : (c.channel ? [c.channel] : []),
    totalRecipients: c.totalRecipients ?? c.recipientCount ?? 0,
    successfulSends: c.successfulSends ?? sumOf("sent"),
    failedSends: c.failedSends ?? sumOf("failed"),
    totalCost: typeof c.totalCost === "number" ? c.totalCost : null, // older campaigns weren't costed
    createdBy: c.createdByName || c.sentByName || "—",
    createdAt: c.createdAt,
  };
}

// Campaign History table: newest first, searchable by name, paginated
router.get("/campaign-history", requirePermission("marketing:view"), (req, res) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

    let rows = db.find("marketingCampaigns", {})
      .map(toHistoryRow)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (search) rows = rows.filter(r => r.campaignName.toLowerCase().includes(search));

    const pages = Math.max(Math.ceil(rows.length / limit), 1);
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);

    res.json({ success: true, data: { rows: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages, limit } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
