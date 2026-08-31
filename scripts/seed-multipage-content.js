/**
 * scripts/seed-multipage-content.js
 *
 * Starter content for the 4 new Website-Builder-driven pages introduced
 * by the multi-page transformation: About, Courses, Results, Gallery
 * (public/about.html, courses.html, results.html, gallery.html — each a
 * thin shell that renders Admin -> Website Builder sections for its own
 * `page` slug, exactly like public/site-page.html already does for any
 * admin-created page).
 *
 * WHY THIS SCRIPT EXISTS: "Website Builder First" means none of this
 * content is hardcoded into the HTML shells — but a brand-new page with
 * zero sections in `websiteSections` is genuinely empty on day one
 * (site-page.html's own emptyState div is exactly for this case). This
 * script inserts a reasonable starting version of each page's content —
 * carried over from the copy that used to live in index.html and
 * admission.html — as real `websiteSections` documents, using ONLY
 * section types the Website Builder already supports (text, image_text,
 * gallery, testimonials, faq, cta — see utils/validators.js's
 * SECTION_FIELD_VALIDATORS). After this runs, every word of it is a
 * normal Website Builder section an admin can edit, reorder, hide, or
 * delete from Admin -> Website Builder exactly like anything else there
 * — nothing here is special-cased or protected.
 *
 * PER-PAGE, NOT ALL-OR-NOTHING: each of the 4 pages is seeded
 * independently and only if that page currently has ZERO sections, so
 * this is safe to run on a site where an admin has already started
 * building one of these pages by hand (e.g. Gallery) — it won't touch
 * that page, it'll only fill in the ones still empty.
 *
 * "Top Performers" (Results page) uses the "testimonials" section type
 * — its name/review/photo fields map directly onto student name/
 * achievement text/photo, so this reuses an existing, already-validated
 * section type instead of adding a new one, consistent with "Do NOT
 * create unnecessary collections." The homepage's Results Preview
 * (index.html's loadResultsPreview()) specifically looks for this
 * section type on page="results" to build its live preview — see that
 * function's comments in index.html.
 *
 * "Gallery" albums use one "text" section as a heading immediately
 * before each "gallery" section (consecutive order values), since the
 * gallery section type itself has no title/caption field — this is a
 * layout convention, not a schema change.
 *
 * Usage:
 *   npm run seed-page-content
 *   node scripts/seed-multipage-content.js
 */

"use strict";

require("dotenv").config();
const db = require("../services/jsonDb");

const SEEDED_BY = "seed-multipage-content";

function textSection(page, order, title, description) {
  return { page, type: "text", order, isActive: true, createdBy: SEEDED_BY, data: { title, description } };
}
function imageTextSection(page, order, title, description, image, imagePosition) {
  return { page, type: "image_text", order, isActive: true, createdBy: SEEDED_BY, data: { title, description, image, imagePosition } };
}
function gallerySection(page, order, images) {
  return { page, type: "gallery", order, isActive: true, createdBy: SEEDED_BY, data: { images } };
}
function testimonialsSection(page, order, items) {
  return { page, type: "testimonials", order, isActive: true, createdBy: SEEDED_BY, data: { items } };
}
function faqSection(page, order, items) {
  return { page, type: "faq", order, isActive: true, createdBy: SEEDED_BY, data: { items } };
}
function ctaSection(page, order, heading, description, buttonText, buttonLink) {
  return { page, type: "cta", order, isActive: true, createdBy: SEEDED_BY, data: { heading, description, buttonText, buttonLink } };
}

// ---------------------------------------------------------------------
// ABOUT — Institute Story, History, Mission, Vision, Leadership,
// Infrastructure, Achievements
// ---------------------------------------------------------------------
const ABOUT_SECTIONS = (page) => [
  imageTextSection(
    page, 0,
    "Our Story",
    "Chawla Classes began in Uttam Nagar in 2002 with a simple goal: give every student the personal attention a large, impersonal institute never could. What started as a small coaching centre for a handful of students has grown, over more than two decades, into one of the most trusted names in the area — without ever losing that original focus on the individual child.",
    "/images/aboutus.png", "right"
  ),
  textSection(
    page, 1,
    "Our History",
    "Founded in 2002 by Mrs. Manju Chawla, the institute grew steadily through word of mouth as families saw real results in their children's confidence and grades. Mr. Rohit Chawla joined as Co-Founder, bringing modern teaching methods and expanding the institute's offerings from school-level coaching into Commerce and BBA/B.Com preparation. Today, Chawla Classes has guided over 10,000 students from Classes 1st-12th through to college-level Commerce coaching."
  ),
  textSection(
    page, 2,
    "Our Mission",
    "To provide every student with quality education, personal attention and result-oriented guidance through expert teaching methods — making quality coaching accessible to all students in Uttam Nagar and beyond."
  ),
  textSection(
    page, 3,
    "Our Vision",
    "To be Delhi's most trusted educational institution — empowering every student with knowledge, confidence and the skills to achieve their dreams, while building strong academic foundations for a brighter future."
  ),
  testimonialsSection(page, 4, [
    { name: "Mrs. Manju Chawla", review: "Founder & Academic Director — 40+ Years Experience. Education expert, student mentor and guide, dedicated to giving every student personal attention and a strong academic foundation.", photo: "/images/manju.jpg" },
    { name: "Mr. Rohit Chawla", review: "Co-Founder — 14+ Years Experience. Mathematics faculty bringing modern teaching methods, concept clarity and a result-oriented approach to every batch.", photo: "/images/rohit.jpg" },
  ]),
  imageTextSection(
    page, 5,
    "Infrastructure",
    "Our Uttam Nagar centre is built for focused learning — well-lit, ventilated classrooms, dedicated space for small-batch teaching, a well-stocked library corner for reference material, and a friendly front-office team to help with admissions and enquiries at any time.",
    "/images/classroom.jpg", "left"
  ),
  textSection(
    page, 6,
    "Achievements",
    "24+ years of continuous operation in Uttam Nagar. 10,000+ students guided since 2002. A consistent track record of 95%+ board results year after year. A reputation built entirely on word-of-mouth from families across Uttam Nagar and neighbouring areas."
  ),
];

// ---------------------------------------------------------------------
// COURSES — 9 courses, each with description/subjects/timings/fees copy
// folded into one description block per validators.js's "text" schema
// (title + description only), plus a shared enquiry CTA at the end.
// ---------------------------------------------------------------------
const COURSES_SECTIONS = (page) => [
  textSection(page, 0, "Junior Wing (Classes 1st–8th)",
    "Subjects: All subjects (Mathematics, Science, English, Social Science, Hindi). Batch Timings: 3:00 PM – 5:00 PM, Monday to Saturday. Fees: Contact us for the latest fee structure — call 9210660809."),
  textSection(page, 1, "Class 9 & Class 10",
    "Subjects: Mathematics, Science, English, Social Science. Batch Timings: 5:00 PM – 7:00 PM, Monday to Saturday, with a dedicated test every Sunday. Fees: Contact us for the latest fee structure — call 9210660809."),
  textSection(page, 2, "Class 11 & 12 — Commerce",
    "Subjects: Accountancy, Business Studies, Economics, Mathematics, English. Batch Timings: 6:00 PM – 8:00 PM, Monday to Saturday. Fees: Contact us for the latest fee structure — call 9210660809."),
  textSection(page, 3, "Class 11 & 12 — Arts",
    "Subjects: History, Geography, Political Science, Economics, English. Batch Timings: 6:00 PM – 8:00 PM, Monday to Saturday. Fees: Contact us for the latest fee structure — call 9210660809."),
  textSection(page, 4, "B.Com",
    "Subjects: Financial Accounting, Cost Accounting, Corporate Accounting, Business Mathematics, Business Statistics. Batch Timings: Flexible batches to suit college schedules. Fees: Contact us for the latest fee structure — call 9210660809."),
  textSection(page, 5, "BBA",
    "Subjects: Business Management Foundations, Business Mathematics, Business Statistics, Financial Accounting. Batch Timings: Flexible batches to suit college schedules. Fees: Contact us for the latest fee structure — call 9210660809."),
  ctaSection(page, 6,
    "Have Questions About a Course?",
    "Call us, WhatsApp us, or send a quick enquiry and our team will help you pick the right course and batch.",
    "Enquire Now", "/contact.html"
  ),
];

// ---------------------------------------------------------------------
// RESULTS — Notice Board, Top Performers (testimonials type — see
// index.html's loadResultsPreview()), Academic Achievements, Year-wise
// Results, Subject Toppers
// ---------------------------------------------------------------------
const RESULTS_SECTIONS = (page) => [
  textSection(page, 0, "Results Notice Board",
    "Chawla Classes is proud to announce another year of outstanding board results across Classes 10th and 12th, with 95%+ of students achieving first division and multiple students scoring above 90%. Congratulations to all our students and their families for this achievement."),
  testimonialsSection(page, 1, [
    { name: "Add Your Top Performer", review: "Replace this with the student's name, class and achievement (e.g. \"Scored 98% in Class 12 Commerce Boards, 2026\") from Admin -> Website Builder.", photo: "/images/results.jpg" },
  ]),
  textSection(page, 2, "Academic Achievements",
    "24+ years of consistent 95%+ board results. 10,000+ students guided to academic success since 2002. Multiple students each year securing admission to top Delhi University colleges. A proven track record in Commerce, Arts and school-level coaching alike."),
  textSection(page, 3, "Year-wise Results",
    "Session 2025-26: 95%+ students achieved first division across Classes 10th and 12th. (Add each academic year's results here from Admin -> Website Builder as new sections, so this page builds a running, year-by-year record over time.)"),
  textSection(page, 4, "Subject Toppers",
    "Add subject-wise toppers here (e.g. Accountancy, Mathematics, Business Studies) from Admin -> Website Builder as results are announced each session."),
];

// ---------------------------------------------------------------------
// GALLERY — 5 albums. Each album = one "text" heading section
// immediately followed by one "gallery" section (gallery type has no
// title field of its own, so the heading is a lightweight adjacent
// section rather than a schema change).
// ---------------------------------------------------------------------
const GALLERY_SECTIONS = (page) => [
  textSection(page, 0, "Classroom Photos", "A look inside our classrooms at Uttam Nagar."),
  gallerySection(page, 1, ["/images/classroom.jpg", "/images/hero-student.jpg"]),
  textSection(page, 2, "Events", "Highlights from events held at Chawla Classes."),
  gallerySection(page, 3, ["/images/hero-student1.png"]),
  textSection(page, 4, "Celebrations", "Festivals and milestones celebrated together."),
  gallerySection(page, 5, ["/images/aboutus.png"]),
  textSection(page, 6, "Activities", "Beyond the classroom — activities and student engagement."),
  gallerySection(page, 7, ["/images/jyoti.jpg"]),
  textSection(page, 8, "Infrastructure", "Our facilities at Uttam Nagar."),
  gallerySection(page, 9, ["/images/classroom.jpg"]),
];

const PAGES = {
  about: ABOUT_SECTIONS,
  courses: COURSES_SECTIONS,
  results: RESULTS_SECTIONS,
  gallery: GALLERY_SECTIONS,
};

async function seedMultipageContent() {
  let totalInserted = 0;

  for (const [page, buildSections] of Object.entries(PAGES)) {
    const existing = db.find("websiteSections", {}).filter((s) => s.page === page);
    if (existing.length > 0) {
      console.log(`= "${page}" already has ${existing.length} section(s) — skipped (not touched).`);
      continue;
    }
    const sections = buildSections(page);
    sections.forEach((s) => db.insertOne("websiteSections", s));
    totalInserted += sections.length;
    console.log(`+ Seeded ${sections.length} starter section(s) for "${page}".`);
  }

  console.log(`\n✅ Done. ${totalInserted} section(s) inserted in total.`);
  console.log("   Edit any of it from Admin -> Website Builder — none of it is hardcoded.");
}

db.connect()
  .then(seedMultipageContent)
  .catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
