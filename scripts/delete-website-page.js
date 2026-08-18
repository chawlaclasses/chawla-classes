/**
 * scripts/delete-website-page.js
 *
 * One-off cleanup tool for a Website Builder page (Admin -> Website
 * Builder) that isn't showing up as a tab in the admin UI but still has
 * leftover `websiteSections` documents in MongoDB (so /page/<slug> still
 * renders real content). Bypasses the admin panel entirely and deletes
 * every section for the given page slug directly.
 *
 * This is exactly what Admin -> Website Builder's "Delete This Page"
 * button does server-side (DELETE /api/admin/website-sections/page/:slug
 * in routes/admin/website-sections.js) -- this script exists only for
 * the case where that page's tab doesn't appear in the UI at all, so
 * there's no button to click.
 *
 * Usage:
 *   node scripts/delete-website-page.js contact-us
 *
 * Lists every section that will be deleted before deleting anything, and
 * requires typing "yes" to confirm -- this permanently deletes data.
 */

"use strict";

require("dotenv").config();
const readline = require("readline");
const db = require("../services/jsonDb");

const pageSlug = (process.argv[2] || "").trim().toLowerCase();

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function run() {
  if (!pageSlug) {
    console.error("❌ Usage: node scripts/delete-website-page.js <page-slug>");
    console.error("   Example: node scripts/delete-website-page.js contact-us");
    process.exitCode = 1;
    return;
  }

  const sections = db.find("websiteSections", { page: pageSlug });
  if (sections.length === 0) {
    console.log(`ℹ️  No sections found with page="${pageSlug}". Nothing to delete.`);
    console.log("   (Case-sensitive -- double check the exact slug from the URL, e.g. /page/contact-us -> \"contact-us\".)");
    return;
  }

  console.log(`Found ${sections.length} section(s) for page "${pageSlug}":`);
  sections.forEach((s) => console.log(`   - ${s.type} (id: ${s._id})`));

  const answer = await ask(`\nType "yes" to permanently delete all ${sections.length} section(s) above: `);
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Cancelled -- nothing was deleted.");
    return;
  }

  sections.forEach((s) => db.findByIdAndDelete("websiteSections", s._id));
  console.log(`✅ Deleted ${sections.length} section(s). /page/${pageSlug} will now show "This page isn't set up yet."`);
}

db.connect()
  .then(run)
  .catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());