/**
 * config/r2.js
 *
 * Cloudflare R2 client setup. R2 exposes an S3-compatible API, so we use
 * the standard AWS SDK v3 S3Client pointed at R2's account-specific
 * endpoint instead of AWS. No AWS account or credentials are involved.
 *
 * Required env vars (see .env.example):
 *   R2_ACCOUNT_ID        — Cloudflare account ID (dashboard → R2 → Overview)
 *   R2_ACCESS_KEY_ID      — R2 API token access key (R2 → Manage API Tokens)
 *   R2_SECRET_ACCESS_KEY  — R2 API token secret
 *   R2_BUCKET_NAME         — the bucket uploads go into
 *   R2_PUBLIC_URL          — base URL for PUBLIC objects only (custom domain
 *                             connected to the bucket, or the r2.dev dev
 *                             subdomain). Not used for private objects —
 *                             those are always streamed through the server.
 */

"use strict";

const { S3Client } = require("@aws-sdk/client-s3");

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "";
// Strip a trailing slash so key-joining (`${R2_PUBLIC_URL}/${key}`) never
// produces a double slash.
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

const R2_CONFIGURED = Boolean(
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME
);

/**
 * FIX (fail fast, same philosophy as config/index.js#validateConfig): a
 * missing R2 var used to mean every upload would 500 one request at a
 * time with a confusing SDK error. Call this from config/index.js's
 * validateConfig() at boot so a bad/missing R2 config is a loud, immediate
 * failure instead.
 */
function validateR2Config({ required = true } = {}) {
  if (R2_CONFIGURED) {
    console.log(`\u2601\ufe0f  R2 storage configured (bucket: ${R2_BUCKET_NAME})`);
    if (!R2_PUBLIC_URL) {
      console.warn(
        "\u26a0\ufe0f  R2_PUBLIC_URL is not set — public assets (homework attachments, " +
        "branding logo/favicon) will upload fine but their public URL cannot be " +
        "built. Set R2_PUBLIC_URL to your bucket's custom domain or r2.dev subdomain."
      );
    } else {
      // FIX (bug: 2026-08-12 — marketing banner images 404ing): R2_PUBLIC_URL
      // was set on Render to this app's OWN production domain
      // (https://chawlaclasses.in) instead of the R2 bucket's public domain
      // (a connected custom subdomain like https://files.chawlaclasses.in,
      // or the bucket's r2.dev subdomain). Every generated "public" URL then
      // pointed back at this Express app, which has no route for object
      // keys like /marketing-banners/<file> — so it 404'd with this app's
      // own JSON 404 handler instead of ever reaching R2.
      // This can't be caught with certainty (ALLOWED_ORIGINS is
      // best-effort, not authoritative), so it's a loud warning, not a
      // fail-fast exit — but it's specific enough to catch this exact
      // mistake if it happens again.
      const publicUrlHost = safeHostname(R2_PUBLIC_URL);
      const ownOrigins = (process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((o) => safeHostname(o.trim()))
        .filter(Boolean);
      const renderOwnHost = safeHostname(process.env.RENDER_EXTERNAL_URL || "");
      if (publicUrlHost && (ownOrigins.includes(publicUrlHost) || publicUrlHost === renderOwnHost)) {
        console.error(
          `\u274c R2_PUBLIC_URL (${R2_PUBLIC_URL}) looks like THIS APP'S OWN domain ` +
          `(${publicUrlHost}), not Cloudflare R2's public bucket domain. Any "public" ` +
          "file URL generated with this value will 404 (it'll hit this app's own " +
          "router, not R2). Set R2_PUBLIC_URL to the bucket's connected custom " +
          "domain or r2.dev subdomain from Cloudflare dashboard → R2 → your bucket " +
          "→ Settings → Public Access."
        );
      }
    }
    return;
  }

  const missing = [
    !R2_ACCOUNT_ID && "R2_ACCOUNT_ID",
    !R2_ACCESS_KEY_ID && "R2_ACCESS_KEY_ID",
    !R2_SECRET_ACCESS_KEY && "R2_SECRET_ACCESS_KEY",
    !R2_BUCKET_NAME && "R2_BUCKET_NAME",
  ].filter(Boolean).join(", ");

  if (required) {
    console.error(`\u274c FATAL: Cloudflare R2 is not configured. Missing: ${missing}. See .env.example.`);
    process.exit(1);
  } else {
    console.warn(`\u26a0\ufe0f  Cloudflare R2 is not configured (missing: ${missing}). File uploads will fail.`);
  }
}

// Best-effort URL -> hostname, used only for the misconfiguration warning
// above — never throws on a malformed value, just returns "" so the check
// is skipped rather than crashing boot over a logging nicety.
function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

// R2's S3-compatible endpoint is always this shape — account-scoped, not
// bucket-scoped (the bucket is chosen per-request via the Bucket param).
const r2Client = R2_CONFIGURED
  ? new S3Client({
      region: "auto", // R2 does not use AWS regions; "auto" is required here
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

module.exports = {
  r2Client,
  R2_BUCKET_NAME,
  R2_PUBLIC_URL,
  R2_CONFIGURED,
  validateR2Config,
};
