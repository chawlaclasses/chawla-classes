/**
 * routes/admin/marketing-recipients.js
 *
 * Recipient Selection System for Marketing Campaigns — the read-only side:
 * which groups / classes / statuses exist, the searchable + paginated
 * recipient table, and the live "how many people / what will it cost"
 * estimate. Sending lives in routes/admin/marketing-campaigns.js
 * (POST /send-selected), which uses the exact same services, so an estimate
 * always matches what is really sent.
 *
 * Channel-agnostic on purpose (SMS today; WhatsApp/Email already work; Push
 * later) — see services/recipientEngine.js and services/campaignChannels.js.
 *
 * Mounted at '/marketing/recipients' by routes/adminRoutes.js, so final URLs
 * are /api/admin/marketing/recipients/*.
 */

"use strict";

const express = require("express");
const router = express.Router();

const logger = require("../../utils/logger");
const { requirePermission } = require("../../middleware/permissions");
const recipientEngine = require("../../services/recipientEngine");
const campaignEngine = require("../../services/campaignEngine");
const { listChannels } = require("../../services/campaignChannels");
const settingsService = require("../../services/settings");

function fail(req, res, error) {
  logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

// Groups (with counts), class filters, status filters, channels, cost per message
router.get("/meta", requirePermission("marketing:view"), (req, res) => {
  try {
    const costs = settingsService.getSettings().campaignCosts || {};
    res.json({
      success: true,
      data: {
        ...recipientEngine.getMeta(),
        channels: listChannels(),
        costs,
        maxRecipientsPerSend: campaignEngine.MAX_RECIPIENTS_PER_SEND,
        maxMessageLength: campaignEngine.MAX_MESSAGE_LENGTH,
      },
    });
  } catch (error) {
    fail(req, res, error);
  }
});

// One page of the recipient table (+ keys of every match, for Select All)
router.get("/list", requirePermission("marketing:view"), (req, res) => {
  try {
    const { groups, classes, search, status, classFilter, page, limit } = req.query;
    res.json({
      success: true,
      data: recipientEngine.listRecipients({ groups, classKeys: classes, search, status, classFilter, page, limit }),
    });
  } catch (error) {
    fail(req, res, error);
  }
});

// Keys of the whole pool and of the auto-selected part of it
router.get("/pool", requirePermission("marketing:view"), (req, res) => {
  try {
    const { groups, classes } = req.query;
    res.json({ success: true, data: recipientEngine.getPool({ groups, classKeys: classes }) });
  } catch (error) {
    fail(req, res, error);
  }
});

// SMS count + cost + rendered sample, and whether the send would be allowed
router.post("/estimate", requirePermission("marketing:view"), (req, res) => {
  try {
    const { channel = "sms", message = "", selection } = req.body || {};
    const plan = campaignEngine.buildPlan({ channel, message, selection });
    const { recipients, ...summary } = plan; // never ship the whole recipient list back
    res.json({ success: true, data: { ...summary, validationError: campaignEngine.validatePlan(plan) } });
  } catch (error) {
    fail(req, res, error);
  }
});

module.exports = router;
