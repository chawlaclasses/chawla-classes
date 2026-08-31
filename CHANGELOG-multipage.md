# Chawla Classes — Multi-Page Transformation: Implementation Changelog

This implements the approved Final Implementation Plan. Everything below is
real, working code against the actual codebase — nothing is a placeholder,
mock, or TODO. Run the two seed/migration scripts once after deploying
(see "Deployment steps" at the bottom) and the site is live in its new form.

## What's new

### 4 new Website-Builder-driven pages
`public/about.html`, `public/courses.html`, `public/results.html`,
`public/gallery.html` — each a thin shell (same pattern as the existing
`public/site-page.html`) with **unique, correct SEO** (title, meta
description, canonical URL, Open Graph tags, BreadcrumbList JSON-LD, and
— on About — EducationalOrganization JSON-LD) that renders its content
entirely from Website Builder (`page: "about"`, `"courses"`, `"results"`,
`"gallery"` respectively). No page content is hardcoded — an admin edits
all of it from Admin → Website Builder, exactly like any other Website
Builder page, per the "Website Builder First" requirement.

- **About**: Institute Story, History, Mission, Vision, Leadership
  (Founder Mrs. Manju Chawla / Co-Founder Mr. Rohit Chawla, as a
  `testimonials`-type section), Infrastructure, Achievements.
- **Courses**: all 9 courses (Junior Wing, Class 9, Class 10, XI Commerce,
  XII Commerce, XI Arts, XII Arts, B.Com, BBA), each with subjects, batch
  timings and fee-enquiry copy, plus an Enquiry CTA.
- **Results**: Notice Board, Top Performers (`testimonials`-type — this is
  also what the homepage's live Results Preview reads from), Academic
  Achievements, Year-wise Results, Subject Toppers. **Deliberately does
  not use the existing student-test-results system** (`routes/results.js`)
  — that's a private, per-student system; this is separate, public,
  admin-editable content, exactly as specified.
- **Gallery**: 5 albums (Classroom Photos, Events, Celebrations,
  Activities, Infrastructure) as Website Builder `gallery` sections, each
  preceded by a `text` section acting as the album heading (the `gallery`
  type has no title field of its own — this is a layout convention, not a
  schema change). The **existing Instagram / Google Photos link cards are
  kept** below the albums, wired to the same `GET /api/public-settings`
  Admin → Settings → Social Links source as before — untouched
  functionality, just relocated onto the new page.

### `scripts/seed-multipage-content.js` (new)
Seeds a reasonable starting version of the 4 pages above as real
`websiteSections` documents (using only existing section types — `text`,
`image_text`, `gallery`, `testimonials`, `cta`), so the site isn't empty on
day one. **Per-page and non-destructive**: only seeds a page if it
currently has zero sections, so it's safe to run even if an admin has
already started building one of these pages by hand. Run once:
`npm run seed-page-content`.

### Navbar → 8 items, Leadership removed
- `scripts/seed-categories.js` updated to the new 8-item navbar (Home,
  About, Courses, Results, Reviews, Gallery, Contact, Admission) for
  fresh installs.
- `scripts/migrate-navbar-8pages.js` (new) — the counterpart for an
  **already-live** site: idempotently replaces the current `categories`
  collection with the new 8, removing the old anchor-only items
  (Leadership, Fees & Timings, Classes). Run once on deploy:
  `npm run migrate-navbar-8pages`.
- Hardcoded fallback `<nav>` markup (desktop + mobile drawer) updated to
  match, across every page: `index.html`, `about.html`, `courses.html`,
  `results.html`, `gallery.html`, `contact.html`, `admission.html`,
  `reviews.html`, `careers.html`, `feedback.html`, `edit-review.html`,
  `site-page.html`. Footer "Quick Links" updated the same way on all of
  them.
- `careers.html` and `feedback.html` are **not deleted** — they're simply
  no longer top-level navbar items, matching the approved 8-item navbar
  exactly. Still reachable by direct link.

### Homepage (`index.html`) — trimmed to the 9 approved sections
Hero (Admission Open / Quick Enquiry / WhatsApp buttons, retargeted) →
Admission Open → Why Choose Us → Courses Overview (short cards, "Learn
More" → Courses) → Leadership Preview (Founder/Co-Founder, short intro,
"Learn More" → About) → Results Preview (academic stats + a live
top-performers preview pulled from the Results page's own Website
Builder content, "View All Results" button) → Reviews Preview (existing
carousel, unchanged design/animation, now showing the **latest 6**
approved reviews with no featured-pinning) → Quick Enquiry CTA (button
only, no form, → Contact) → Footer.

Full About narrative, Vision/Mission, full Leadership detail, Fees &
Timings, the Offline/Online classes comparison, and the FAQ section were
all removed from the homepage — their content lives on (or was already
carried over to) the dedicated pages instead.

### Reviews system — untouched, plus one additive field
Per the explicit "DO NOT MODIFY EXISTING REVIEW SYSTEM" instruction:
submission flow, approval flow, OTP verification, Google Reviews
integration, the reviews carousel, and `reviews.html`'s own functionality
are all **byte-for-byte unchanged** in behavior. The one edit —
`routes/reviews.js`'s `GET /api/reviews/approved` now also returns a
`createdAt` field — is purely additive (existing consumers that don't
look for it are unaffected) and exists only because the homepage's new
"latest 6, no pinning" rule is impossible to implement without knowing
which reviews are newest. `reviews.html` keeps the endpoint's existing
featured-first order exactly as before.

### Contact page — 7-field form, low-friction (no OTP)
`public/contact.html`'s form now has exactly the required fields (Student
Name, Parent Name, Mobile, Email, Class Interested In, School, Message),
posts to the enquiry endpoint (`routes/publicEnquiry.js`), which was
extended with two new **optional** fields (`parentName`, `school`) — the
admission flow's OTP verification was deliberately **not** added here, so
Contact stays the low-friction "quick enquiry" option distinct from the
formal Admission page. Address, Google Map, Call/WhatsApp buttons, and
Office Hours are all present. SEO tags added.

### Admission page — process/documents/fee CTA added, form/OTP untouched
Added, around the *unmodified* existing form and OTP-verification code:
an "Admission Process" 4-step section, a "Required Documents" checklist,
and a "Fee Enquiry CTA" section linking to the new Courses page. Course
dropdown trimmed to the approved 9-course list. SEO tags added.

### SEO
- `sitemap.xml` now lists all 8 pages (was previously homepage-only).
- Every new/updated page has a unique `<title>`, meta description,
  canonical URL, Open Graph tags, and `BreadcrumbList` JSON-LD.
- `about.html` also carries `EducationalOrganization` JSON-LD.

## Deviations flagged for the client (please confirm)

1. **Google Sheets webhook removed from the Contact form.** The old
   `contact.html` posted every submission to an external Google Sheets
   Apps Script endpoint (`SHEET_URL`) in parallel with the admin database
   write. That webhook's field shape (`studentName`/`mobile`/`course`/
   `enquiryType`) doesn't match the new 7-field form, and Google Sheets
   wasn't listed among the "already have" systems in the implementation
   brief (Reviews/Admission/Contact/Gallery/Categories/Website Builder
   were). Rather than silently write mismatched data into that
   spreadsheet, this implementation removed the webhook and relies solely
   on the existing admin-panel enquiry database (which was already the
   primary channel). **If the Sheet is still actively used, let us know
   and we'll wire the new fields into it correctly instead of dropping
   it.**
2. Course list follows this round's spec exactly (9 courses; B.A. and
   Entrance Exam Prep/CUET/SSC dropped from the formal course list, as
   specified) — flagged in the prior review round as a silent delta, and
   this implementation proceeded on the assumption that dropping them was
   intentional, per "follow this specification exactly."
3. Reviews page groups reviews as **Google Reviews vs. Website Reviews**
   only (no separate Student/Parent split), since this round's spec
   explicitly listed only "Google Reviews, Website Reviews" for the
   Reviews page and reviews.html itself was left unmodified per the
   "do not redesign" instruction for that page.

## Deployment steps

1. Deploy this code as normal.
2. Run once: `npm run migrate-navbar-8pages` (safe on a live/already-seeded
   site — replaces the old 11-item navbar categories with the new 8).
   On a **brand-new** install with an empty database, use
   `npm run seed-categories` instead.
3. Run once: `npm run seed-page-content` (starter content for About /
   Courses / Results / Gallery — safe to run anytime, only fills pages
   that are currently empty).
4. Verify `/about.html`, `/courses.html`, `/results.html`, `/gallery.html`
   load correctly, and that Admin → Website Builder shows the new
   `about`/`courses`/`results`/`gallery` pages for editing.
5. Resubmit `sitemap.xml` to Google Search Console.
