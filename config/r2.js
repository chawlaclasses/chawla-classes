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
