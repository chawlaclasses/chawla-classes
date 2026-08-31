/**
 * scripts/seed-categories.js
 *
 * One-time seeder for the homepage navbar's 8 top-level categories
 * (Home, About, Courses, Results, Reviews, Gallery, Contact, Admission)
 * — inserts them as real `categories` documents, the same collection and
 * shape Admin -> Categories manages, with the EXACT hrefs/order the
 * multi-page site structure uses. Running this is what makes Admin ->
 * Categories a true "replace hardcoded with admin-managed" migration
 * instead of turning the navbar blank on a fresh install — index.html's
 * dynamic nav script (loadNavCategories) only replaces the static
 * fallback navbar once /api/categories returns at least one row, so
 * until this has been run, visitors keep seeing the static links baked
 * into each page's HTML.
 *
 * NOTE: this file's list changed from the original 11-item single-page
 * navbar (Home/About/Courses/Leadership/Results/Fees & Timings/Classes/
 * Admission/Careers/Feedback/Contact, all anchor links) to the 8-item
 * multi-page navbar below as part of the multi-page website
 * transformation. Leadership is no longer a navbar item (it now lives
 * inside the About page); Fees & Timings and Classes are no longer
 * separate navbar items (that content now lives on the Courses page);
 * Careers and Feedback remain reachable from their existing pages'
 * footers/links but are intentionally no longer top-level navbar items,
 * matching the approved 8-item navbar spec.
 *
 * SAFE TO RUN ANYTIME ON A FRESH INSTALL: it only inserts if the
 * `categories` collection is currently empty. If categories already
 * exist (including from an earlier version of this script), it does
 * nothing and just prints a message — it will never duplicate or
 * overwrite what's there. For an already-seeded/live site that needs to
 * move from the old 11-item navbar to this new 8-item one, use
 * scripts/migrate-navbar-8pages.js instead (see that file's header).
 *
 * Usage:
 *   npm run seed-categories
 *   node scripts/seed-categories.js
 */

"use strict";

require("dotenv").config();
const db = require("../services/jsonDb");

// Real page URLs, not homepage anchors — About/Courses/Results/Reviews/
// Gallery/Contact/Admission are now each a dedicated page, not a section
// of index.html. Icons match what the mobile drawer already used per
// item where a direct equivalent exists, so the dynamic drawer render
// looks as close as possible to the previous static one.
const DEFAULT_CATEGORIES = [
  { name: "Home", slug: "home", url: "/#home", icon: "fa-home" },
  { name: "About", slug: "about", url: "/about.html", icon: "fa-info-circle" },
  { name: "Courses", slug: "courses", url: "/courses.html", icon: "fa-book-open" },
  { name: "Results", slug: "results", url: "/results.html", icon: "fa-trophy" },
  { name: "Reviews", slug: "reviews", url: "/reviews.html", icon: "fa-star" },
  { name: "Gallery", slug: "gallery", url: "/gallery.html", icon: "fa-images" },
  { name: "Contact", slug: "contact", url: "/contact.html", icon: "fa-map-marker-alt" },
  { name: "Admission", slug: "admission", url: "/admission.html", icon: "fa-file-alt" },
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
