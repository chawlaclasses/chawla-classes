/**
 * scripts/seed-categories.js
 *
 * One-time seeder for the homepage navbar's original 11 categories
 * (Home, About, Courses, Leadership, Results, Fees & Timings, Classes,
 * Admission, Careers, Feedback, Contact) — inserts them as real
 * `categories` documents, the same collection and shape Admin ->
 * Categories manages, with the EXACT same hrefs/order the hardcoded
 * navbar in index.html always used. Running this is what makes the new
 * Admin -> Categories feature a true "replace hardcoded with
 * admin-managed" migration instead of turning the navbar blank on
 * upgrade — index.html's dynamic nav script (loadNavCategories) only
 * replaces the static fallback navbar once /api/categories returns at
 * least one row, so until this has been run, visitors keep seeing the
 * original static links exactly as before either way.
 *
 * SAFE TO RUN ANYTIME: it only inserts if the `categories` collection is
 * currently empty. If you've already added/edited any category yourself
 * (including a previous run of this script), it does nothing and just
 * prints a message — it will never duplicate or overwrite what's there.
 *
 * Usage:
 *   npm run seed-categories
 *   node scripts/seed-categories.js
 */

"use strict";

require("dotenv").config();
const db = require("../services/jsonDb");

// Same hrefs as index.html's original hardcoded #navLinks / #drawerNav
// (bare "#section" — isSafeUrl allows this directly, see
// utils/validators.js). Icons match what the mobile drawer already used
// per item, so the dynamic drawer render looks identical to the old
// static one.
const DEFAULT_CATEGORIES = [
  { name: "Home", slug: "home", url: "#home", icon: "fa-home" },
  { name: "About", slug: "about", url: "#about", icon: "fa-info-circle" },
  { name: "Courses", slug: "courses", url: "#courses", icon: "fa-book-open" },
  { name: "Leadership", slug: "leadership", url: "#faculty", icon: "fa-users" },
  { name: "Results", slug: "results", url: "#results", icon: "fa-trophy" },
  { name: "Fees & Timings", slug: "fees-timings", url: "#fees", icon: "fa-clock" },
  { name: "Classes", slug: "classes", url: "#classes-overview", icon: "fa-layer-group" },
  { name: "Admission", slug: "admission", url: "#admission", icon: "fa-file-alt" },
  { name: "Careers", slug: "careers", url: "/careers.html", icon: "fa-user-tie" },
  { name: "Feedback", slug: "feedback", url: "#feedback", icon: "fa-star" },
  { name: "Contact", slug: "contact", url: "#contact", icon: "fa-map-marker-alt" },
];

async function seedCategories() {
  const existing = db.find("categories", {});
  if (existing.length > 0) {
    console.log(`ℹ️  ${existing.length} categor${existing.length === 1 ? "y" : "ies"} already exist — skipping seed (nothing was changed).`);
    console.log("   Manage them from Admin → Categories.");
    return;
  }

  const docs = DEFAULT_CATEGORIES.map((cat, index) => ({
    ...cat,
    order: index,
    isActive: true,
    createdBy: "seed-script",
  }));

  db.insertMany("categories", docs);

  console.log(`✅ Seeded ${docs.length} default categories:`);
  docs.forEach((d) => console.log(`   - ${d.name} → ${d.url}`));
  console.log("   They're live in the homepage navbar now, and editable from Admin → Categories.");
}

// Same reasoning as scripts/seed-marketing-banners.js: jsonDb needs a real
// MongoDB connection before any read/write, so db.connect() is awaited
// first, and the process exits explicitly afterward via db.close().
db.connect()
  .then(seedCategories)
  .catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
