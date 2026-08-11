/**
 * routes/health.js
 *
 * GET /health — liveness/readiness endpoint for a load balancer, uptime
 * monitor, or `curl` during an incident. No auth: nothing returned here is
 * sensitive (connection booleans/counts, package version, process uptime).
 *
 * Mounted directly in app.js, deliberately NOT under /api, so it never
 * goes through the /api-scoped session/CSRF/rate-limit middleware and
 * stays reachable even if one of those has a problem.
 *
 * NEW (production hardening, audit 2026-08).
 */

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../services/jsonDb");
const { version: APP_VERSION } = require("../package.json");

router.get("/health", (_req, res) => {
  const dbStatus = db.getStatus();
  const healthy = dbStatus.connected;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptimeSeconds: Math.floor(process.uptime()),
    version: APP_VERSION,
    mongo: { connected: dbStatus.connected },
    queue: { pendingWrites: dbStatus.pendingWrites },
  });
});

module.exports = router;
