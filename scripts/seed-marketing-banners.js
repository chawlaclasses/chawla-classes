/**
 * scripts/seed-marketing-banners.js
 *
 * One-time seeder for the homepage auto-slider's 5 default slides
 * (Admissions Open 2026-27 / Free Demo Classes / Concept Clarity /
 * Experienced Faculty / Excellent Results). Inserts them as real
 * `marketingBanners` documents — the same collection and shape Admin ->
 * Marketing -> Banners & Offers already manages — so they show on the
 * homepage slider immediately AND are fully editable/deletable/
 * reorderable from the admin panel from the moment you run this.
 *
 * SAFE TO RUN ANYTIME: it only inserts if there are currently zero
 * 'homepage'-placement banners. If you've already added any homepage
 * banner yourself (including a previous run of this script), it does
 * nothing and just prints a message — it will never duplicate or
 * overwrite what's already there.
 *
 * Usage:
 *   npm run seed-banners
 *   node scripts/seed-marketing-banners.js
 */

"use strict";

require("dotenv").config();
const db = require("../services/jsonDb");

// ctaLink uses "/#section" (not bare "#section") so it passes the
// isSafeUrl validator on routes/admin/marketing.js's PUT /banners/:id —
// isSafeUrl treats anything starting with "/" as safe by construction,
// while a bare "#anchor" fails its new URL() parse. Resolves identically
// in the browser either way since the site is served from "/".
const DEFAULT_BANNERS = [
  {
    title: "Admissions Open 2026-27",
    message: "Seats are filling up for the new academic session. Secure your spot at Chawla Classes today.",
    ctaText: "Enroll Now",
    ctaLink: "/#admission",
  },
  {
    title: "Free Demo Classes Available",
    message: "Not sure yet? Sit in on a live class, meet the faculty, and see our teaching style — no cost, no obligation.",
    ctaText: "Book Free Demo",
    ctaLink: "/#enquirySection",
  },
  {
    title: "100% Focus on Concept Clarity",
    message: "We teach for understanding, not rote memorization — so results hold up in exams and beyond.",
    ctaText: "Learn More",
    ctaLink: "/#about",
  },
  {
    title: "Experienced Faculty & Personal Attention",
    message: "Small batches and dedicated mentors mean every student gets noticed, not lost in the crowd.",
    ctaText: "Meet Our Faculty",
    ctaLink: "/#faculty",
  },
  {
    title: "Excellent Academic Results",
    message: "10000+ students and 95%+ board results — a track record built over 24+ years in Uttam Nagar.",
    ctaText: "See Results",
    ctaLink: "/#results",
  },
];

async function seedMarketingBanners() {
  const existingHomepageBanners = db.find("marketingBanners", { placement: "homepage" });
  if (existingHomepageBanners.length > 0) {
    console.log(`ℹ️  ${existingHomepageBanners.length} homepage banner(s) already exist — skipping seed (nothing was changed).`);
    console.log("   Manage them from Admin → Marketing → Banners & Offers.");
    return;
  }

  const docs = DEFAULT_BANNERS.map((banner, index) => ({
    ...banner,
    placement: "homepage",
    imageUrl: "", // none uploaded yet — homepage slider shows the text-based design until you add one
    startDate: "",
    endDate: "",
    priority: index,
    isActive: true,
    createdBy: "seed-script",
  }));

  db.insertMany("marketingBanners", docs);

  console.log(`✅ Seeded ${docs.length} default homepage banners:`);
  docs.forEach((d) => console.log(`   - ${d.title}`));
  console.log("   They're live on the homepage slider now, and editable from Admin → Marketing → Banners & Offers.");
}

// Same reasoning as scripts/create-admin.js: jsonDb now needs a real
// MongoDB connection before any read/write, so db.connect() is awaited
// first, and the process exits explicitly afterward via db.close() (an
// open MongoClient handle would otherwise keep this one-off script
// running forever).
db.connect()
  .then(seedMarketingBanners)
  .catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
