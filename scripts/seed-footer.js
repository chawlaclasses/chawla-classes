/**
 * scripts/seed-footer.js
 *
 * One-time seeder for the new Footer Management feature (Admin -> Footer
 * Management). Populates:
 *   - `footer-settings` (singleton) — About column + Contact Info column
 *     + Bottom Bar text, taken from the values that were hardcoded into
 *     every page's <footer> before this migration (see index.html's old
 *     footer markup for the source of truth).
 *   - `footerLinks` — the Quick Links and Student Resources columns,
 *     using the DEFAULT items listed in the feature spec (Home/About Us/
 *     Courses/Classes/Results/Admission/Contact, and FAQ/Reviews/
 *     Feedback/Careers/Gallery/Privacy Policy/Terms & Conditions).
 *   - `socialLinks` — only the ones with a REAL destination already
 *     live on the site (WhatsApp — the number used by the site-wide
 *     floating WhatsApp button — and Instagram, if one was ever set via
 *     the older Admin -> Settings -> Social Links field). Facebook/
 *     YouTube/LinkedIn/Telegram/Twitter are intentionally left for an
 *     admin to add once real handles exist — this script never invents
 *     a fake social URL.
 *
 * A few notes on choices made here that aren't 1:1 with the old markup:
 *   - "FAQ" and "Terms & Conditions" don't have dedicated .html files
 *     yet. They're seeded pointing at this site's existing generic
 *     page-builder route (`/page/<slug>` — see app.js's `GET /page/:slug`
 *     + public/site-page.html), so an admin can build that page's
 *     content from Admin -> Website Builder and the footer link will
 *     just start working, OR they can simply edit the link's URL from
 *     Admin -> Footer Management at any time. "Privacy Policy" DOES have
 *     a real page (public/privacy-policy.html) and is seeded pointing
 *     straight at it.
 *   - "Classes" (a separate default from "Courses" per the spec) is
 *     seeded pointing at the same /courses.html page as "Courses",
 *     since the site doesn't have a separate Classes page — again,
 *     trivially re-pointed later from the admin panel.
 *   - Reviews and Gallery moved from the old Quick Links column into
 *     the new Student Resources column, matching the spec's defaults.
 *
 * SAFE TO RUN ANYTIME: each of the three collections is only seeded if
 * it's currently empty (footer-settings: only if it doesn't already
 * hold non-default values... in practice, if the document doesn't exist
 * yet). Running this on an already-configured site changes nothing and
 * just prints what it skipped.
 *
 * Usage:
 *   npm run seed-footer
 *   node scripts/seed-footer.js
 */

"use strict";

require("dotenv").config();
const db = require("../services/jsonDb");
const footerSettingsService = require("../services/footerSettings");

const DEFAULT_QUICK_LINKS = [
  { label: "Home", url: "/#home" },
  { label: "About Us", url: "/about.html" },
  { label: "Courses", url: "/courses.html" },
  { label: "Classes", url: "/courses.html" },
  { label: "Results", url: "/results.html" },
  { label: "Admission", url: "/admission.html" },
  { label: "Contact", url: "/contact.html" },
];

const DEFAULT_STUDENT_RESOURCES = [
  { label: "FAQ", url: "/page/faq" },
  { label: "Reviews", url: "/reviews.html" },
  { label: "Feedback", url: "/feedback.html" },
  { label: "Careers", url: "/careers.html" },
  { label: "Gallery", url: "/gallery.html" },
  { label: "Privacy Policy", url: "/privacy-policy.html" },
  { label: "Terms & Conditions", url: "/page/terms-and-conditions" },
];

async function seedFooterLinks() {
  const existing = db.find("footerLinks", {});
  if (existing.length > 0) {
    console.log(`ℹ️  ${existing.length} footer link(s) already exist — skipping Quick Links / Student Resources seed.`);
    return;
  }

  const docs = [
    ...DEFAULT_QUICK_LINKS.map((l, index) => ({
      column: "quick_links",
      label: l.label,
      url: l.url,
      order: index,
      isActive: true,
      createdBy: "seed-script",
    })),
    ...DEFAULT_STUDENT_RESOURCES.map((l, index) => ({
      column: "student_resources",
      label: l.label,
      url: l.url,
      order: index,
      isActive: true,
      createdBy: "seed-script",
    })),
  ];

  db.insertMany("footerLinks", docs);
  console.log(`✅ Seeded ${docs.length} footer links (${DEFAULT_QUICK_LINKS.length} Quick Links + ${DEFAULT_STUDENT_RESOURCES.length} Student Resources).`);
}

async function seedSocialLinks() {
  const existing = db.find("socialLinks", {});
  if (existing.length > 0) {
    console.log(`ℹ️  ${existing.length} social link(s) already exist — skipping Social Links seed.`);
    return;
  }

  const docs = [];

  // The number used by the site-wide floating WhatsApp button + the
  // mobile drawer's "Chat on WhatsApp" link (see index.html and every
  // other public page) — a real, already-live number, so it's safe to
  // carry over as the first Social Link.
  docs.push({
    platform: "WhatsApp",
    url: "https://wa.me/919717914003",
    icon: "fab fa-whatsapp",
    order: 0,
    isActive: true,
    createdBy: "seed-script",
  });

  // Carry over Instagram only if one was actually configured via the
  // older Admin -> Settings -> Social Links field (services/settings.js).
  const settings = db.findById("app-settings", "app-settings");
  const instagramHandle = settings?.socialLinks?.instagram;
  if (instagramHandle) {
    const url = instagramHandle.startsWith("http")
      ? instagramHandle
      : `https://instagram.com/${instagramHandle.replace(/^@/, "")}`;
    docs.push({
      platform: "Instagram",
      url,
      icon: "fab fa-instagram",
      order: 1,
      isActive: true,
      createdBy: "seed-script",
    });
  }

  db.insertMany("socialLinks", docs);
  console.log(`✅ Seeded ${docs.length} social link(s): ${docs.map((d) => d.platform).join(", ")}.`);
  console.log("   Add Facebook / YouTube / LinkedIn / Telegram / Twitter (X) from Admin → Footer Management → Social Links whenever real handles are ready.");
}

async function seedFooterSettings() {
  const alreadyExists = !!db.findById("footer-settings", footerSettingsService.FOOTER_SETTINGS_ID);
  if (alreadyExists) {
    console.log("ℹ️  Footer settings already exist — skipping About/Contact/Bottom Bar seed.");
    return;
  }

  footerSettingsService.updateFooterSettings({
    about: {
      title: "Chawla Classes",
      // Consolidates the old footer's several hardcoded <p> lines
      // ("Since 2002 | Excellence in Education", "Classes 1st–12th |
      // Commerce & Arts Specialists", "B.Com | BBA", the
      // '"Step Towards Success"' tagline) into one editable block,
      // since the feature spec's About column is one title + one
      // content field. Newlines are preserved and rendered as separate
      // lines on the public site (see public/js/footer.js).
      content:
        "Since 2002 | Excellence in Education\nClasses 1st–12th | Commerce & Arts Specialists\nB.Com | BBA\n\"Step Towards Success\"",
    },
    contact: {
      phone: "9210660809",
      whatsapp: "9717914003",
      email: "4chawlaclasses@gmail.com",
      address: "Shop 72, Hastsal Road, Opp. Sabji Mandi, Near Metro Pillar 657, Uttam Nagar, New Delhi - 110059",
      workingHours: "",
    },
    bottomBar: {
      copyrightText: `© ${new Date().getFullYear()} Chawla Classes. All Rights Reserved.`,
      developedByText: "",
      footerNote: "",
    },
  });

  console.log("✅ Seeded footer settings (About / Contact Info / Bottom Bar).");
}

async function seedFooter() {
  await seedFooterSettings();
  await seedFooterLinks();
  await seedSocialLinks();
  console.log("\nDone. Manage all of it from Admin → Footer Management.");
}

// Same reasoning as scripts/seed-categories.js: jsonDb needs a real
// MongoDB connection before any read/write, so db.connect() is awaited
// first, and the process exits explicitly afterward via db.close().
db.connect()
  .then(seedFooter)
  .catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
