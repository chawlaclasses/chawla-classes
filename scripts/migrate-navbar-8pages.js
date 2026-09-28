/**
 * scripts/migrate-navbar-8pages.js
 *
 * Migration for the multi-page website transformation's navbar change:
 * moves an ALREADY-SEEDED `categories` collection (i.e. a live site that
 * previously ran scripts/seed-categories.js with the old 11-item
 * single-page navbar) over to the new 8-item multi-page navbar — Home,
 * About, Courses, Results, Reviews, Gallery, Contact, Admission.
 *
 * scripts/seed-categories.js only inserts into an EMPTY collection, so it
 * intentionally does nothing on a site that already has categories. This
 * script is the counterpart for that case: it replaces whatever's
 * currently in `categories` with the new 8, by slug.
 *
 * WHAT IT DOES, per item in NEW_CATEGORIES below:
 *   - If a category with that slug already exists, its name/url/icon/
 *     order are updated in place (so any admin-side reference to that
 *     category document's _id, e.g. audit log entries, stays valid).
 *   - If it doesn't exist yet, it's inserted.
 * Any EXISTING category whose slug is NOT in the new 8 (e.g. the old
 * "leadership", "fees-timings", "classes" items) is deleted — those
 * sections no longer exist as standalone navbar destinations under the
 * new site structure (Leadership now lives inside the About page;
 * Fees & Timings and Classes content now lives on the Courses page).
 * "careers" and "feedback" categories (if present) are also removed from
 * this list since they're no longer top-level navbar items, but the
 * pages themselves (careers.html, feedback.html) are untouched and still
 * reachable directly — this only edits the `categories` collection that
 * drives the navbar, nothing else.
 *
 * IDEMPOTENT: safe to run more than once — running it again when the
 * collection already matches the new 8 just reports "already up to
 * date" for each item and changes nothing.
 *
 * Usage:
 *   node scripts/migrate-navbar-8pages.js
 */

"use strict";

require("dotenv").config();
const db = require("../services/jsonDb");

const NEW_CATEGORIES = [
  { name: "Home", slug: "home", url: "/#home", icon: "fa-home" },
  { name: "About", slug: "about", url: "/about.html", icon: "fa-info-circle" },
  { name: "Courses", slug: "courses", url: "/courses.html", icon: "fa-book-open" },
  { name: "Results", slug: "results", url: "/results.html", icon: "fa-trophy" },
  { name: "Reviews", slug: "reviews", url: "/reviews.html", icon: "fa-star" },
  { name: "Gallery", slug: "gallery", url: "/gallery.html", icon: "fa-images" },
  { name: "Contact", slug: "contact", url: "/contact.html", icon: "fa-map-marker-alt" },
  { name: "Admission", slug: "admission", url: "/admission.html", icon: "fa-file-alt" },
];

async function migrateNavbar() {
  const existing = db.find("categories", {});
  const existingBySlug = new Map(existing.map((c) => [c.slug, c]));
  const newSlugs = new Set(NEW_CATEGORIES.map((c) => c.slug));

  // Remove anything not in the new 8 (old anchor-only items: leadership,
  // fees-timings, classes, and any top-level careers/feedback entries).
  let removed = 0;
  for (const cat of existing) {
    if (!newSlugs.has(cat.slug)) {
      db.findByIdAndDelete("categories", cat._id);
      console.log(`   - Removed "${cat.name}" (${cat.slug}) — no longer a top-level navbar item`);
      removed++;
    }
  }

  let updated = 0;
  let inserted = 0;
  let unchanged = 0;

  NEW_CATEGORIES.forEach((cat, index) => {
    const current = existingBySlug.get(cat.slug);
    const desired = { ...cat, order: index, isActive: true };

    if (!current) {
      db.insertOne("categories", { ...desired, createdBy: "migrate-navbar-8pages" });
      console.log(`   + Inserted "${cat.name}" -> ${cat.url}`);
      inserted++;
      return;
    }

    const needsUpdate =
      current.name !== desired.name ||
      current.url !== desired.url ||
      current.icon !== desired.icon ||
      current.order !== desired.order ||
      current.isActive !== true;

    if (needsUpdate) {
      db.findByIdAndUpdate("categories", current._id, {
        name: desired.name,
        url: desired.url,
        icon: desired.icon,
        order: desired.order,
        isActive: true,
      });
      console.log(`   ~ Updated "${cat.name}" -> ${cat.url}`);
      updated++;
    } else {
      console.log(`   = "${cat.name}" already up to date`);
      unchanged++;
    }
  });

  console.log(
    `\n✅ Navbar migration complete: ${inserted} inserted, ${updated} updated, ` +
    `${unchanged} unchanged, ${removed} removed.`
  );
  console.log("   Navbar now shows: " + NEW_CATEGORIES.map((c) => c.name).join(" · "));
  console.log("   Manage it going forward from Admin → Categories.");
}

db.connect()
  .then(migrateNavbar)
  .catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
