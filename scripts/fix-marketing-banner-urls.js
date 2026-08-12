/**
 * scripts/fix-marketing-banner-urls.js
 *
 * ONE-TIME fix for the 2026-08-12 bug: R2_PUBLIC_URL was misconfigured to
 * this app's own domain (https://chawlaclasses.in) instead of the R2
 * bucket's real public domain, so every marketing banner image uploaded
 * during that window got a Mongo `imageUrl` that points back at this
 * Express app (which 404s — it has no route for /marketing-banners/*)
 * instead of at Cloudflare R2.
 *
 * The R2 object itself is fine (upload always worked) — only the saved
 * URL string is wrong. This script finds every `marketingBanners` record
 * whose imageUrl contains a "marketing-banners/<key>" path but does NOT
 * start with the (now-corrected) R2_PUBLIC_URL, extracts the object key
 * from the bad URL, rebuilds the correct public URL via
 * r2Service.getPublicUrl(), optionally confirms the object still exists in
 * R2, and rewrites the record.
 *
 * PREREQUISITE: fix R2_PUBLIC_URL in your environment (.env / Render env
 * vars) FIRST — to your bucket's actual custom domain or r2.dev subdomain
 * (Cloudflare dashboard → R2 → your bucket → Settings → Public Access).
 * This script trusts whatever R2_PUBLIC_URL is currently set to; running
 * it before fixing that env var will just rewrite bad URLs into other bad
 * URLs.
 *
 * Safe to run multiple times — records already pointing at R2_PUBLIC_URL
 * are skipped.
 *
 * Usage:
 *   node scripts/fix-marketing-banner-urls.js            # dry run — reports what it would change
 *   node scripts/fix-marketing-banner-urls.js --apply     # actually updates MongoDB
 *
 * Requires the same env vars as the app (MONGODB_URI, R2_* vars).
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const { R2_PUBLIC_URL } = require("../config/r2");
const r2Service = require("../services/r2Service");

const APPLY = process.argv.includes("--apply");
const FOLDER = "marketing-banners";

/**
 * Pulls the R2 object key (e.g. "marketing-banners/1786540965191-....png")
 * back out of a saved imageUrl, regardless of what (wrong) host it was
 * saved under. Only touches URLs that actually look like an R2 key under
 * marketing-banners/ — a banner using a hand-pasted external image URL
 * (no "marketing-banners/" segment) is left completely untouched.
 */
function extractKey(imageUrl) {
  if (!imageUrl) return null;
  const marker = `${FOLDER}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return null;
  return imageUrl.slice(idx); // "marketing-banners/<rest>"
}

async function main() {
  if (!R2_PUBLIC_URL) {
    console.error("\u274c R2_PUBLIC_URL is not set in the environment this script is run with. Fix that first — see the header comment in this file.");
    process.exit(1);
  }
  console.log(`Using R2_PUBLIC_URL = ${R2_PUBLIC_URL}`);
  console.log(APPLY ? "Running in APPLY mode — MongoDB will be updated\n" : "Running in DRY-RUN mode (pass --apply to actually update MongoDB)\n");

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const coll = db.collection("marketingBanners");

  const banners = await coll.find({ imageUrl: { $exists: true, $ne: "" } }).toArray();
  console.log(`Found ${banners.length} banner(s) with an imageUrl set.\n`);

  let fixed = 0, alreadyOk = 0, skippedNotR2 = 0, missingInR2 = 0;

  for (const banner of banners) {
    const key = extractKey(banner.imageUrl);
    if (!key) {
      skippedNotR2++;
      continue; // not an R2-hosted image (e.g. a pasted external URL) — leave as-is
    }

    const correctUrl = r2Service.getPublicUrl(key);

    if (banner.imageUrl === correctUrl) {
      alreadyOk++;
      continue; // already correct, nothing to do
    }

    const existsInR2 = await r2Service.objectExists(key);
    if (!existsInR2) {
      missingInR2++;
      console.warn(`  \u26a0\ufe0f  ${banner._id}: key "${key}" not found in R2 bucket — leaving imageUrl untouched (would 404 either way)`);
      continue;
    }

    console.log(`  ${APPLY ? "\u2705 fixing" : "[dry-run] would fix"} ${banner._id}:`);
    console.log(`      old: ${banner.imageUrl}`);
    console.log(`      new: ${correctUrl}`);

    if (APPLY) {
      await coll.updateOne({ _id: banner._id }, { $set: { imageUrl: correctUrl } });
    }
    fixed++;
  }

  console.log(
    `\nDone. ${fixed} ${APPLY ? "fixed" : "would be fixed"}, ${alreadyOk} already correct, ` +
    `${skippedNotR2} skipped (not an R2 marketing-banners URL), ${missingInR2} skipped (object missing in R2).`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
