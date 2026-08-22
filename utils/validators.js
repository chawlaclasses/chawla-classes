/**
 * utils/validators.js
 *
 * FIX: Removed all .isMongoId() calls.
 *      This project uses custom JSON IDs (not MongoDB ObjectIds),
 *      so isMongoId() was failing every single validation — meaning
 *      test start, save-answer, and submit always returned 400.
 *      Replaced with .notEmpty() which correctly validates JSON IDs.
 */

"use strict";

const { body } = require("express-validator");
const { isValidIndianMobile, isBlockedEmailDomain } = require("./spamDetection");

// ── Shared anti-spam field validators (Admission Form + Career Form) ───────
// Both public/admission.html and public/careers.html now require a real,
// verifiable Indian mobile number and a real (non-disposable) email
// before an OTP is even sent — see utils/spamDetection.js for the actual
// pattern/domain-list logic this wraps.
function strictIndianMobile(field = "phone") {
  return body(field).trim().notEmpty().withMessage("Mobile number is required")
    .custom(value => {
      if (!isValidIndianMobile(value)) {
        throw new Error("Enter a valid 10-digit Indian mobile number");
      }
      return true;
    });
}

function nonDisposableEmail(field = "email") {
  return body(field).trim().notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Enter a valid email address").normalizeEmail()
    .custom(value => {
      if (isBlockedEmailDomain(value)) {
        throw new Error("Please use a permanent email address — temporary/disposable email addresses are not accepted");
      }
      return true;
    });
}

// FIX (security audit 2026-08): marketing banner ctaLink/imageUrl are
// admin-entered but rendered on the PUBLIC site (routes/marketing.js
// returns them verbatim, index.html presumably drops them straight into
// an <a href>/<img src>). Before this, the only checks were a max length
// — a value like "javascript:alert(document.cookie)" or a "data:" URI
// sailed straight through. This restricts both fields to http(s) absolute
// URLs or a same-site relative path ("/promo"), which is everything a
// banner link/image legitimately needs, and rejects javascript:, data:,
// vbscript:, and any other scheme.
function isSafeUrl(value) {
  if (value === undefined || value === null || value === "") return true; // optional field, nothing to check
  const v = String(value).trim();

  // Same-site relative path, e.g. "/admissions" — never carries a scheme,
  // so it's safe by construction. "//host" is protocol-relative (an
  // absolute URL in disguise), so it's deliberately excluded here and
  // falls through to the URL parse/scheme check below.
  if (v.startsWith("/") && !v.startsWith("//")) return true;
  // In-page anchor, e.g. "#admission" — used throughout index.html's own
  // single-page nav (Home/About/Courses/... all scroll to a section on
  // the same page rather than navigating anywhere), so this needs to stay
  // valid for both the marketing banner CTA link and the categories nav
  // URL field below. No scheme, can't navigate off-site — safe.
  if (v.startsWith("#")) return true;

  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    throw new Error("Must be a valid http(s) URL or a relative path starting with /");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http, https, or relative (/path) links are allowed");
  }
  return true;
}

// ── Website Builder section content validation ──────────────────────────
// Each section `type` has a fixed field shape — no free-text HTML field
// anywhere (see routes/admin/website-sections.js's header comment for
// why: this whole module exists specifically so an admin never has to
// enter markup). Called from the createSection/updateSection express-
// validator chains below with `req.body.type` + `req.body.data`.
function str(value, { field, required = false, maxLen = 500 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return;
  }
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  if (value.length > maxLen) throw new Error(`${field} must be ${maxLen} characters or fewer`);
}

function url(value, { field, required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return;
  }
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  isSafeUrl(value); // throws its own message if unsafe/malformed
}

const SECTION_FIELD_VALIDATORS = {
  hero: (d) => {
    str(d.heading, { field: "Heading", required: true, maxLen: 150 });
    str(d.subHeading, { field: "Sub Heading", maxLen: 300 });
    str(d.buttonText, { field: "Button Text", maxLen: 60 });
    url(d.buttonLink, { field: "Button Link" });
    url(d.backgroundImage, { field: "Background Image" });
  },
  text: (d) => {
    str(d.title, { field: "Title", required: true, maxLen: 150 });
    str(d.description, { field: "Description", required: true, maxLen: 3000 });
  },
  image: (d) => {
    url(d.image, { field: "Image", required: true });
    str(d.caption, { field: "Caption", maxLen: 200 });
  },
  image_text: (d) => {
    str(d.title, { field: "Title", required: true, maxLen: 150 });
    str(d.description, { field: "Description", required: true, maxLen: 3000 });
    url(d.image, { field: "Image", required: true });
    if (!["left", "right"].includes(d.imagePosition)) {
      throw new Error("Image Position must be 'left' or 'right'");
    }
  },
  gallery: (d) => {
    if (!Array.isArray(d.images) || d.images.length === 0) {
      throw new Error("At least one image is required");
    }
    if (d.images.length > 30) throw new Error("Maximum 30 images per gallery");
    d.images.forEach((img, i) => url(img, { field: `Image ${i + 1}`, required: true }));
  },
  testimonials: (d) => {
    if (!Array.isArray(d.items) || d.items.length === 0) {
      throw new Error("At least one testimonial is required");
    }
    if (d.items.length > 50) throw new Error("Maximum 50 testimonials");
    d.items.forEach((item, i) => {
      str(item.name, { field: `Testimonial ${i + 1}: Student Name`, required: true, maxLen: 100 });
      str(item.review, { field: `Testimonial ${i + 1}: Review`, required: true, maxLen: 1000 });
      url(item.photo, { field: `Testimonial ${i + 1}: Photo` });
    });
  },
  faq: (d) => {
    if (!Array.isArray(d.items) || d.items.length === 0) {
      throw new Error("At least one FAQ is required");
    }
    if (d.items.length > 50) throw new Error("Maximum 50 FAQs");
    d.items.forEach((item, i) => {
      str(item.question, { field: `FAQ ${i + 1}: Question`, required: true, maxLen: 300 });
      str(item.answer, { field: `FAQ ${i + 1}: Answer`, required: true, maxLen: 2000 });
    });
  },
  video: (d) => {
    str(d.title, { field: "Title", maxLen: 150 });
    url(d.videoUrl, { field: "Video URL", required: true });
  },
  cta: (d) => {
    str(d.heading, { field: "Heading", required: true, maxLen: 150 });
    str(d.description, { field: "Description", maxLen: 500 });
    str(d.buttonText, { field: "Button Text", maxLen: 60 });
    url(d.buttonLink, { field: "Button Link" });
  },
  contact: (d) => {
    str(d.title, { field: "Title", maxLen: 100 });
    str(d.phone, { field: "Phone", maxLen: 30 });
    str(d.email, { field: "Email", maxLen: 150 });
    str(d.address, { field: "Address", maxLen: 300 });
  },
};

function validateSectionData(type, data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("data must be an object");
  }
  const fieldValidator = SECTION_FIELD_VALIDATORS[type];
  if (!fieldValidator) throw new Error("Invalid section type"); // body("type") above already rejects this, belt-and-suspenders
  fieldValidator(data);
  return true;
}

// Where a Website Builder section can be positioned relative to the
// homepage's existing hardcoded sections (index.html's <section id="...">
// elements), plus "end" (the historical/default behavior: appended in its
// own container right before the footer, after everything else). Kept as
// a fixed allowlist matching index.html's actual section ids exactly --
// an arbitrary free-text anchor would let an admin "position" a section
// next to something that doesn't exist, silently falling back to "end"
// with no feedback that the anchor didn't match anything.
const HOMEPAGE_ANCHORS = [
  "end", "home", "about", "courses", "classes-overview", "faculty",
  "results", "fees", "online-classes", "faq", "admission", "feedback", "contact",
];

const validators = {
  // ── Class validators ──────────────────────────────────────────────────────
  createClass: [
    body("name")
      .trim()
      .notEmpty().withMessage("Class name is required")
      .isLength({ min: 2, max: 50 }).withMessage("Class name must be 2–50 characters"),
    body("displayName")
      .trim()
      .notEmpty().withMessage("Display name is required")
      .isLength({ min: 2, max: 50 }).withMessage("Display name must be 2–50 characters"),
    body("description")
      .optional().trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters"),
  ],

  // ── Subject validators ────────────────────────────────────────────────────
  createSubject: [
    body("name")
      .trim()
      .notEmpty().withMessage("Subject name is required")
      .isLength({ min: 2, max: 100 }).withMessage("Subject name must be 2–100 characters"),
    body("code")
      .trim()
      .notEmpty().withMessage("Subject code is required")
      .isLength({ min: 2, max: 10 }).withMessage("Subject code must be 2–10 characters")
      // FIX (audit 2026-07): was /^[A-Z0-9]+$/ (uppercase-only), which
      // would have rejected valid input — the actual route handler
      // (routes/adminRoutes.js POST /subjects) accepts any case and
      // normalizes with code.toUpperCase() itself; the admin UI form does
      // not force uppercase before sending. Made case-insensitive to match
      // real, currently-working behavior instead of introducing a new
      // rejection that didn't exist before.
      .matches(/^[A-Za-z0-9]+$/).withMessage("Subject code must contain only letters and numbers"),
    body("classId")
      .notEmpty().withMessage("Class ID is required"),   // ⭐ FIX: was .isMongoId()
    body("description")
      .optional().trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters"),
  ],

  // ── Series validators ─────────────────────────────────────────────────────
  createSeries: [
    body("name")
      .trim()
      .notEmpty().withMessage("Series name is required")
      .isLength({ min: 2, max: 100 }).withMessage("Series name must be 2–100 characters"),
    body("subjectId")
      .notEmpty().withMessage("Subject ID is required"),  // ⭐ FIX: was .isMongoId()
    body("classId")
      .notEmpty().withMessage("Class ID is required"),    // ⭐ FIX: was .isMongoId()
    body("type")
      .optional()
      .isIn(["chapter-wise", "weekly", "revision", "mock", "sample-paper", "other"])
      .withMessage("Invalid series type"),
    body("description")
      .optional().trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters"),
  ],

  // ── Test validators ───────────────────────────────────────────────────────
  createTest: [
    body("title")
      .trim()
      .notEmpty().withMessage("Test title is required")
      .isLength({ min: 3, max: 200 }).withMessage("Test title must be 3–200 characters"),
    body("seriesId")
      .notEmpty().withMessage("Series ID is required"),   // ⭐ FIX: was .isMongoId()
    body("subjectId")
      .notEmpty().withMessage("Subject ID is required"),  // ⭐ FIX: was .isMongoId()
    body("classId")
      .notEmpty().withMessage("Class ID is required"),    // ⭐ FIX: was .isMongoId()
    body("totalMarks")
      .isInt({ min: 1 }).withMessage("Total marks must be a positive integer"),
    body("passingMarks")
      .isInt({ min: 0 }).withMessage("Passing marks must be non-negative")
      .custom((value, { req }) => {
        if (value > req.body.totalMarks) throw new Error("Passing marks cannot exceed total marks");
        return true;
      }),
    body("duration")
      .isInt({ min: 1 }).withMessage("Duration must be a positive integer"),
    body("negativeMarking").optional().isObject(),
    body("negativeMarking.enabled").optional().isBoolean(),
    body("negativeMarking.value").optional().isFloat({ min: 0 }),
    body("maximumAttempts").optional().isInt({ min: 1 }),
    body("randomizeQuestions").optional().isBoolean(),
    body("randomizeOptions").optional().isBoolean(),
    body("isScheduled").optional().isBoolean(),
    body("startDate").optional().isISO8601().toDate(),
    body("endDate")
      .optional().isISO8601().toDate()
      .custom((value, { req }) => {
        if (req.body.startDate && value <= req.body.startDate) {
          throw new Error("End date must be after start date");
        }
        return true;
      }),
  ],

  // ── Question validators ───────────────────────────────────────────────────
  createQuestion: [
    body("questionText").trim().notEmpty().withMessage("Question text is required"),
    body("options")
      .isArray({ min: 2 }).withMessage("At least 2 options required")
      .custom((options) => {
        if (!options.some(o => o.isCorrect)) throw new Error("At least one correct option required");
        return true;
      }),
    body("options.*.text").trim().notEmpty().withMessage("Option text is required"),
    body("options.*.isCorrect").isBoolean().withMessage("isCorrect must be boolean"),
    body("correctAnswer").trim().notEmpty().withMessage("Correct answer is required"),
    // FIX (audit 2026-07): was required — the actual route handler
    // (routes/adminRoutes.js POST /questions) treats marks as optional and
    // defaults it to 1 (`marks || 1`) when not sent. Matching that instead
    // of introducing a new rejection for a case the handler already
    // handles gracefully.
    body("marks").optional().isFloat({ min: 0 }).withMessage("Marks must be non-negative"),
    body("type").optional().isIn(["mcq", "true-false", "fill-in-blank"]),
    body("explanation").optional().trim().isLength({ max: 500 }),
    // Question Bank subject tagging (2026-07): optional at the validator
    // level — the route handler itself is what enforces the subject
    // actually exists (404s if not), matching the existing pattern for
    // chapter/other lookups rather than duplicating that check here.
    body("subjectId").optional().trim(),
  ],

  // ── Student attempt validators ────────────────────────────────────────────
  startTest: [
    body("testId").notEmpty().withMessage("Test ID is required"),  // ⭐ FIX: was .isMongoId()
  ],

  saveAnswer: [
    body("attemptId").notEmpty().withMessage("Attempt ID is required"),   // ⭐ FIX
    body("questionId").notEmpty().withMessage("Question ID is required"),  // ⭐ FIX
    body("selectedOption").optional().trim(),
    body("timeSpent").optional().isInt({ min: 0 }),
  ],

  submitTest: [
    body("attemptId").notEmpty().withMessage("Attempt ID is required"),   // ⭐ FIX
  ],
  // ── Update validators (Module 5, audit 2026-07) ──────────────────────────
  // These mirror the corresponding create* schemas' field constraints, but
  // with every field made .optional() — because the PUT handlers for these
  // entities are genuine partial updates (each field falls back to the
  // existing stored value when omitted, e.g. `name: name || existing.name`
  // in routes/adminRoutes.js). Reusing the create* schemas as-is here would
  // have rejected legitimate partial-update requests that only change one
  // field. Verified against each handler individually before writing these:
  //   - updateClass:    PUT /classes/:id    — fully partial, nothing required
  //   - (subjects use createSubject directly — PUT /subjects/:id requires
  //     name+code+classId just like create, confirmed by reading the handler)
  //   - updateSeries:   PUT /series/:id     — requires name+subjectId only
  //     (NOT classId, unlike createSeries — matches the handler's own
  //     `if (!name || !subjectId)` check)
  //   - updateTest:     PUT /tests/:id      — fully partial, nothing required
  //   - updateQuestion: PUT /questions/:id  — fully partial, nothing required
  updateClass: [
    body("name").optional().trim()
      .isLength({ min: 2, max: 50 }).withMessage("Class name must be 2–50 characters"),
    body("displayName").optional().trim()
      .isLength({ min: 2, max: 50 }).withMessage("Display name must be 2–50 characters"),
    body("description").optional().trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters"),
    body("isActive").optional().isBoolean(),
  ],

  updateSeries: [
    body("name").trim().notEmpty().withMessage("Series name is required")
      .isLength({ min: 2, max: 100 }).withMessage("Series name must be 2–100 characters"),
    body("subjectId").notEmpty().withMessage("Subject ID is required"),
    body("classId").optional(),
    body("type").optional()
      .isIn(["chapter-wise", "weekly", "revision", "mock", "sample-paper", "other"])
      .withMessage("Invalid series type"),
    body("description").optional().trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters"),
    body("isActive").optional().isBoolean(),
  ],

  updateTest: [
    body("title").optional().trim()
      .isLength({ min: 3, max: 200 }).withMessage("Test title must be 3–200 characters"),
    body("seriesId").optional(),
    body("subjectId").optional(),
    body("classId").optional(),
    body("totalMarks").optional().isInt({ min: 1 }).withMessage("Total marks must be a positive integer"),
    body("passingMarks").optional().isInt({ min: 0 }).withMessage("Passing marks must be non-negative"),
    body("duration").optional().isInt({ min: 1 }).withMessage("Duration must be a positive integer"),
    body("negativeMarking").optional().isObject(),
    body("negativeMarking.enabled").optional().isBoolean(),
    body("negativeMarking.value").optional().isFloat({ min: 0 }),
    body("maximumAttempts").optional().isInt({ min: 1 }),
    body("randomizeQuestions").optional().isBoolean(),
    body("randomizeOptions").optional().isBoolean(),
    body("isActive").optional().isBoolean(),
    body("isScheduled").optional().isBoolean(),
    body("startDate").optional().isISO8601().toDate(),
    body("endDate").optional().isISO8601().toDate(),
  ],

  updateQuestion: [
    body("questionText").optional().trim().notEmpty().withMessage("Question text cannot be empty"),
    body("options").optional()
      .isArray({ min: 2 }).withMessage("At least 2 options required")
      .custom((options) => {
        if (!options.some(o => o.isCorrect)) throw new Error("At least one correct option required");
        return true;
      }),
    body("options.*.text").optional().trim().notEmpty().withMessage("Option text is required"),
    body("options.*.isCorrect").optional().isBoolean().withMessage("isCorrect must be boolean"),
    body("correctAnswer").optional().trim().notEmpty().withMessage("Correct answer cannot be empty"),
    body("marks").optional().isFloat({ min: 0 }).withMessage("Marks must be non-negative"),
    body("type").optional().isIn(["mcq", "true-false", "fill-in-blank"]),
    body("difficulty").optional().isIn(["easy", "medium", "hard"]),
    body("explanation").optional().trim().isLength({ max: 500 }),
    body("isActive").optional().isBoolean(),
    body("subjectId").optional().trim(),
  ],

  // ── Module 7 (audit 2026-07): fees / homework / students / enquiries ────
  // Same approach as the Module 5 update validators above — every field
  // .optional() to match each handler's genuine partial-update behavior,
  // verified by reading routes/adminRoutes.js directly rather than
  // guessing. Two real (if minor) data-integrity gaps found and closed
  // along the way:
  //   - PUT /fees/:id: `updates.amount = parseFloat(amount)` had NO
  //     fallback (unlike discountAmount/scholarshipAmount, which both do
  //     `|| 0`), so sending a non-numeric amount would previously have
  //     silently saved NaN into a fee record. isFloat({min:0}) now rejects
  //     that before it reaches the handler.
  //   - PUT /students/:id/profile had no format checking at all on
  //     parentEmail — now validated as an email if present.
  // doubts status/priority, fees payment-status, questions status/bulk-
  // approve, and the reorder endpoint were checked too but already have
  // their own correct manual enum/business-rule validation — no gap to
  // fill there, so left as-is to avoid redundant/conflicting checks.

  updateHomework: [
    body("title").optional().trim().isLength({ min: 2, max: 200 }).withMessage("Title must be 2–200 characters"),
    body("description").optional().trim().isLength({ max: 2000 }).withMessage("Description cannot exceed 2000 characters"),
    body("classId").optional(),
    body("subjectId").optional(),
    body("dueDate").optional().isISO8601().withMessage("Due date must be a valid date"),
    body("marks").optional().isFloat({ min: 0 }).withMessage("Marks must be non-negative"),
  ],

  gradeHomeworkSubmission: [
    body("marksAwarded").optional().isFloat({ min: 0 }).withMessage("Marks awarded must be non-negative"),
    body("teacherRemarks").optional().trim().isLength({ max: 1000 }).withMessage("Remarks cannot exceed 1000 characters"),
  ],

  updateStudentProfile: [
    body("phone").optional().trim().isLength({ min: 7, max: 15 }).withMessage("Phone must be 7–15 characters"),
    body("dob").optional().isISO8601().withMessage("Date of birth must be a valid date"),
    body("rollNumber").optional().trim().isLength({ max: 30 }),
    body("address").optional().trim().isLength({ max: 500 }),
    body("parentName").optional().trim().isLength({ max: 100 }),
    body("parentPhone").optional().trim().isLength({ min: 7, max: 15 }).withMessage("Parent phone must be 7–15 characters"),
    body("parentEmail").optional({ checkFalsy: true }).trim().isEmail().withMessage("Parent email must be a valid email address"),
    body("parentOccupation").optional().trim().isLength({ max: 100 }),
    body("batch").optional().trim().isLength({ max: 50 }),
  ],

  updateEnquiry: [
    body("status").optional().trim().isLength({ max: 30 }),
    body("notes").optional().trim().isLength({ max: 2000 }).withMessage("Notes cannot exceed 2000 characters"),
  ],

  updateFee: [
    body("amount").optional().isFloat({ min: 0 }).withMessage("Amount must be a non-negative number"),
    body("dueDate").optional().isISO8601().withMessage("Due date must be a valid date"),
    body("title").optional().trim().isLength({ min: 1, max: 200 }),
    body("discountAmount").optional().isFloat({ min: 0 }).withMessage("Discount amount must be non-negative"),
    body("discountReason").optional().trim().isLength({ max: 500 }),
    body("scholarshipAmount").optional().isFloat({ min: 0 }).withMessage("Scholarship amount must be non-negative"),
    body("scholarshipReason").optional().trim().isLength({ max: 500 }),
  ],

  applyLateFine: [
    body("lateFineAmount").optional().isFloat({ min: 0 }).withMessage("Late fine amount must be non-negative"),
  ],

  markFeePaid: [
    body("paymentMethod").optional().trim().isLength({ max: 30 }),
    body("transactionId").optional().trim().isLength({ max: 100 }),
  ],

  // ── Faculty Recruitment ──────────────────────────────────────────────
  // Public submission (routes/recruitment.js) — deliberately the strictest
  // validator in this file since it's the one endpoint anyone on the
  // internet can call. Fields not listed here (whatsapp, address, college,
  // university, currentInstitute, expectedSalary, skills, etc.) are
  // free-text/optional and just get trimmed + length-capped by the route
  // handler itself rather than rejected outright, since a resume shouldn't
  // bounce over an optional field.
  submitFacultyApplication: [
    body("fullName").trim().notEmpty().withMessage("Full name is required").isLength({ min: 2, max: 100 }),
    strictIndianMobile("phone"),
    // NOTE: nonDisposableEmail() is intentionally NOT applied again here —
    // the disposable-domain check already ran once at send-otp time (see
    // sendCareerOtp below), and by the time a request reaches this final
    // submit validator it must already carry a verifyToken proving that
    // exact email was OTP-verified. Re-running the full check here just
    // duplicates work; this only re-validates format + presence.
    body("email").trim().notEmpty().withMessage("Email is required").isEmail().withMessage("Enter a valid email").normalizeEmail(),
    body("verifyToken").trim().notEmpty().withMessage("Please verify your email before submitting"),
    body("gender").optional().trim().isIn(["male", "female", "other"]).withMessage("Invalid gender"),
    body("dob").optional().isISO8601().withMessage("Date of birth must be a valid date"),
    body("qualification").trim().notEmpty().withMessage("Highest qualification is required").isLength({ max: 150 }),
    body("experience").optional().trim().isLength({ max: 50 }),
    body("positionId").optional().trim().isLength({ max: 60 }),
    body("preferredSubjects").optional().trim().isLength({ max: 300 }),
    body("preferredClasses").optional().trim().isLength({ max: 300 }),
    body("employmentType").optional({ checkFalsy: true }).trim().isIn(["full_time", "part_time", "online", "offline", "hybrid"]).withMessage("Invalid employment type"),
    body("joiningDate").optional({ checkFalsy: true }).isISO8601().withMessage("Joining date must be a valid date"),
    body("declaration").custom(v => v === true || v === "true" || v === "on").withMessage("You must accept the declaration to apply"),
  ],

  // OTP verification for the public Career/Faculty Recruitment form
  // (routes/recruitment.js POST /send-otp, /verify-otp) — mirrors
  // sendReviewOtp/verifyReviewOtp below, but the disposable-domain check
  // lives here (not on submitFacultyApplication) since this is the point
  // where it actually matters: before an OTP email is ever sent.
  sendCareerOtp: [
    nonDisposableEmail("email"),
  ],
  verifyCareerOtp: [
    body("email").trim().notEmpty().isEmail().withMessage("Enter a valid email address").normalizeEmail(),
    body("otp").trim().notEmpty().withMessage("Enter the code we emailed you").isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits").isNumeric().withMessage("Code must be numeric"),
  ],

  // ── Job Positions (admin-managed, feed both the admin dropdown/filter
  // and the public Careers page's Open Positions list) ──────────────────
  // ── Public website enquiry form (index.html's "Quick Enquiry") ────────
  submitPublicEnquiry: [
    body("name").trim().notEmpty().withMessage("Name is required").isLength({ min: 2, max: 100 }),
    body("phone").trim().notEmpty().withMessage("Mobile number is required").matches(/^[0-9+\-\s()]{10,15}$/).withMessage("Enter a valid mobile number"),
    body("email").optional({ checkFalsy: true }).trim().isEmail().withMessage("Enter a valid email").normalizeEmail(),
    body("interestedClass").optional().trim().isLength({ max: 60 }),
    body("enquiryType").optional().trim().isLength({ max: 60 }),
    body("message").optional().trim().isLength({ max: 1000 }),
  ],

  // ── Public website admission form (index.html's "Admission Form") ─────
  // Used by routes/admin/admissions.js's staff "Log Admission Enquiry"
  // (walk-in/phone) action too — deliberately left EXACTLY as it was
  // (loose phone format, optional email) since that's an internally
  // trusted, non-public action with no spam exposure and no OTP step.
  // The public website submission uses submitAdmissionWebsite below.
  submitPublicAdmission: [
    body("studentName").trim().notEmpty().withMessage("Student name is required").isLength({ min: 2, max: 100 }),
    body("parentName").trim().notEmpty().withMessage("Parent's name is required").isLength({ max: 100 }),
    body("phone").trim().notEmpty().withMessage("Mobile number is required").matches(/^[0-9+\-\s()]{10,15}$/).withMessage("Enter a valid mobile number"),
    body("email").optional({ checkFalsy: true }).trim().isEmail().withMessage("Enter a valid email").normalizeEmail(),
    body("school").optional().trim().isLength({ max: 150 }),
    body("interestedClass").trim().notEmpty().withMessage("Class is required").isLength({ max: 60 }),
    body("address").optional().trim().isLength({ max: 500 }),
  ],

  // ── Public website admission form — actual internet-facing submission
  // (routes/publicEnquiry.js POST /admission). Stricter than
  // submitPublicAdmission above: real Indian mobile format (no sequential/
  // repeated-digit fakes), required email, and a verifyToken proving that
  // email was just OTP-verified (see sendAdmissionOtp/verifyAdmissionOtp
  // below).
  submitAdmissionWebsite: [
    body("studentName").trim().notEmpty().withMessage("Student name is required").isLength({ min: 2, max: 100 }),
    body("parentName").trim().notEmpty().withMessage("Parent's name is required").isLength({ max: 100 }),
    strictIndianMobile("phone"),
    // Format/presence only here — the disposable-domain block already ran
    // once at send-otp time (sendAdmissionOtp), same reasoning as
    // submitFacultyApplication above.
    body("email").trim().notEmpty().withMessage("Email is required").isEmail().withMessage("Enter a valid email").normalizeEmail(),
    body("verifyToken").trim().notEmpty().withMessage("Please verify your email before submitting"),
    body("school").optional().trim().isLength({ max: 150 }),
    body("interestedClass").trim().notEmpty().withMessage("Class is required").isLength({ max: 60 }),
    body("address").optional().trim().isLength({ max: 500 }),
  ],

  // OTP verification for the public Admission Form (routes/publicEnquiry.js
  // POST /admission/send-otp, /admission/verify-otp).
  sendAdmissionOtp: [
    nonDisposableEmail("email"),
  ],
  verifyAdmissionOtp: [
    body("email").trim().notEmpty().isEmail().withMessage("Enter a valid email address").normalizeEmail(),
    body("otp").trim().notEmpty().withMessage("Enter the code we emailed you").isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits").isNumeric().withMessage("Code must be numeric"),
  ],

  createPosition: [
    body("title").trim().notEmpty().withMessage("Position title is required").isLength({ max: 150 }),
    body("description").optional().trim().isLength({ max: 3000 }),
    body("qualification").optional().trim().isLength({ max: 200 }),
    body("experience").optional().trim().isLength({ max: 100 }),
    body("employmentType").optional().trim().isIn(["full_time", "part_time", "online", "offline", "hybrid"]).withMessage("Invalid employment type"),
    body("salary").optional().trim().isLength({ max: 100 }),
    body("status").optional().trim().isIn(["open", "closed"]).withMessage("Status must be open or closed"),
  ],

  updateApplicationStatus: [
    body("status").trim().notEmpty().withMessage("Status is required")
      .isIn(["applied", "screening", "shortlisted", "interview_scheduled", "demo_class", "selected", "offer_sent", "joined", "rejected"])
      .withMessage("Invalid status"),
  ],

  addApplicationNote: [
    body("note").trim().notEmpty().withMessage("Note text is required").isLength({ max: 2000 }),
  ],

  scheduleInterview: [
    body("date").notEmpty().withMessage("Interview date is required").isISO8601().withMessage("Date must be valid"),
    body("time").optional().trim().isLength({ max: 20 }),
    body("interviewer").optional().trim().isLength({ max: 100 }),
    body("meetingLink").optional().trim().isLength({ max: 300 }),
    body("remarks").optional().trim().isLength({ max: 1000 }),
  ],

  recordDemoEvaluation: [
    body("topic").optional().trim().isLength({ max: 200 }),
    body("class").optional().trim().isLength({ max: 50 }),
    body("duration").optional().trim().isLength({ max: 30 }),
    body("subjectKnowledge").optional().isFloat({ min: 0, max: 10 }),
    body("communication").optional().isFloat({ min: 0, max: 10 }),
    body("confidence").optional().isFloat({ min: 0, max: 10 }),
    body("classroomHandling").optional().isFloat({ min: 0, max: 10 }),
    body("studentInteraction").optional().isFloat({ min: 0, max: 10 }),
    body("boardWork").optional().isFloat({ min: 0, max: 10 }),
    body("overallRating").optional().isFloat({ min: 0, max: 10 }),
  ],

  // ── Reviews (public website "Student Feedback & Rating" form + admin ────
  // manual entry) — routes/reviews.js (public) and routes/admin/reviews.js.
  // email/phone/verifyToken are only required on the PUBLIC submit path —
  // an admin typing in a verbal/WhatsApp testimonial (routes/admin/reviews.js)
  // doesn't go through OTP verification, so those routes only send
  // studentName/studentClass/rating/feedback and skip this validator.
  submitReview: [
    body("studentName").trim().notEmpty().withMessage("Name is required").isLength({ min: 2, max: 100 }).withMessage("Name must be 2–100 characters"),
    body("studentClass").trim().notEmpty().withMessage("Class is required").isLength({ max: 60 }),
    body("rating").notEmpty().withMessage("Rating is required").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5").toInt(),
    body("feedback").trim().notEmpty().withMessage("Feedback is required").isLength({ min: 5, max: 1000 }).withMessage("Feedback must be 5–1000 characters"),
    body("email").trim().notEmpty().withMessage("Email is required").isEmail().withMessage("Enter a valid email address").isLength({ max: 150 }),
    body("phone").trim().notEmpty().withMessage("Mobile number is required").matches(/^[6-9]\d{9}$/).withMessage("Enter a valid 10-digit mobile number"),
    body("verifyToken").trim().notEmpty().withMessage("Please verify your email before submitting"),
  ],

  // One-time-email/phone verification for the review form (routes/reviews.js).
  sendReviewOtp: [
    body("email").trim().notEmpty().withMessage("Email is required").isEmail().withMessage("Enter a valid email address").isLength({ max: 150 }),
    body("phone").trim().notEmpty().withMessage("Mobile number is required").matches(/^[6-9]\d{9}$/).withMessage("Enter a valid 10-digit mobile number"),
  ],
  verifyReviewOtp: [
    body("email").trim().notEmpty().isEmail().withMessage("Enter a valid email address"),
    body("phone").trim().notEmpty().matches(/^[6-9]\d{9}$/).withMessage("Enter a valid 10-digit mobile number"),
    body("otp").trim().notEmpty().withMessage("Enter the code we emailed you").isLength({ min: 6, max: 6 }).withMessage("Code must be 6 digits").isNumeric().withMessage("Code must be numeric"),
  ],

  // "Lost your edit link?" (routes/reviews.js POST /resend-edit-link) --
  // same shape as sendReviewOtp, no OTP field since no code is issued here.
  resendEditLink: [
    body("email").trim().notEmpty().withMessage("Email is required").isEmail().withMessage("Enter a valid email address").isLength({ max: 150 }),
    body("phone").trim().notEmpty().withMessage("Mobile number is required").matches(/^[6-9]\d{9}$/).withMessage("Enter a valid 10-digit mobile number"),
  ],

  // Admin manual entry (routes/admin/reviews.js) -- same core fields as
  // submitReview above, but WITHOUT email/phone/verifyToken: an admin
  // typing in a verbal/WhatsApp testimonial never goes through the public
  // OTP flow, so there's no verified identity to require here.
  adminSubmitReview: [
    body("studentName").trim().notEmpty().withMessage("Name is required").isLength({ min: 2, max: 100 }).withMessage("Name must be 2–100 characters"),
    body("studentClass").trim().notEmpty().withMessage("Class is required").isLength({ max: 60 }),
    body("rating").notEmpty().withMessage("Rating is required").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5").toInt(),
    body("feedback").trim().notEmpty().withMessage("Feedback is required").isLength({ min: 5, max: 1000 }).withMessage("Feedback must be 5–1000 characters"),
  ],

  // Public self-service edit (routes/reviews.js PUT /edit/:token) -- the
  // reviewer's own edit-link flow, not the admin panel. Same required
  // fields as adminSubmitReview (no email/phone/verifyToken here either --
  // the token in the URL already proves identity, see routes/reviews.js).
  editReview: [
    body("studentName").trim().notEmpty().withMessage("Name is required").isLength({ min: 2, max: 100 }).withMessage("Name must be 2–100 characters"),
    body("studentClass").trim().notEmpty().withMessage("Class is required").isLength({ max: 60 }),
    body("rating").notEmpty().withMessage("Rating is required").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5").toInt(),
    body("feedback").trim().notEmpty().withMessage("Feedback is required").isLength({ min: 5, max: 1000 }).withMessage("Feedback must be 5–1000 characters"),
  ],

  updateReview: [
    body("studentName").optional().trim().isLength({ min: 2, max: 100 }).withMessage("Name must be 2–100 characters"),
    body("studentClass").optional().trim().isLength({ max: 60 }),
    body("rating").optional().isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5").toInt(),
    body("feedback").optional().trim().isLength({ min: 5, max: 1000 }).withMessage("Feedback must be 5–1000 characters"),
  ],

  updateReviewStatus: [
    body("status").trim().notEmpty().withMessage("Status is required").isIn(["pending", "approved", "rejected"]).withMessage("Invalid status"),
    body("rejectionReason").optional().trim().isLength({ max: 300 }),
  ],

  // ── Marketing banners (admin) — routes/admin/marketing.js. Public read ──
  // is unauthenticated (routes/marketing.js) so no validator needed there.
  createMarketingBanner: [
    body("title").trim().notEmpty().withMessage("Title is required").isLength({ max: 150 }),
    body("message").trim().notEmpty().withMessage("Message is required").isLength({ max: 500 }),
    body("placement").optional().trim().isIn(["top_bar", "homepage", "popup"]).withMessage("Placement must be top_bar, homepage, or popup"),
    body("ctaText").optional().trim().isLength({ max: 60 }),
    body("ctaLink").optional().trim().isLength({ max: 300 }).custom(isSafeUrl),
    body("ctaPosition").optional().trim().isIn(["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "center"]).withMessage("Invalid CTA position"),
    body("imageUrl").optional().trim().isLength({ max: 300 }).custom(isSafeUrl),
    body("startDate").optional({ checkFalsy: true }).trim().isISO8601().withMessage("Invalid start date"),
    body("endDate").optional({ checkFalsy: true }).trim().isISO8601().withMessage("Invalid end date"),
    body("priority").optional().isInt({ min: 0, max: 999 }).withMessage("Priority must be 0–999").toInt(),
  ],

  updateMarketingBanner: [
    body("title").optional().trim().isLength({ max: 150 }),
    body("message").optional().trim().isLength({ max: 500 }),
    body("placement").optional().trim().isIn(["top_bar", "homepage", "popup"]).withMessage("Placement must be top_bar, homepage, or popup"),
    body("ctaText").optional().trim().isLength({ max: 60 }),
    body("ctaLink").optional().trim().isLength({ max: 300 }).custom(isSafeUrl),
    body("ctaPosition").optional().trim().isIn(["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "center"]).withMessage("Invalid CTA position"),
    body("imageUrl").optional().trim().isLength({ max: 300 }).custom(isSafeUrl),
    body("startDate").optional({ checkFalsy: true }).trim().isISO8601().withMessage("Invalid start date"),
    body("endDate").optional({ checkFalsy: true }).trim().isISO8601().withMessage("Invalid end date"),
    body("priority").optional().isInt({ min: 0, max: 999 }).withMessage("Priority must be 0–999").toInt(),
    body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
  ],

  reorderMarketingBanners: [
    // No .isMongoId() — see note at the top of this file, these ids are
    // generateUUID() strings, not real Mongo ObjectIds.
    body("orderedIds").isArray({ min: 1 }).withMessage("orderedIds must be a non-empty array"),
    body("orderedIds.*").isString().trim().notEmpty().withMessage("Each id must be a non-empty string"),
  ],

  // ── Homepage nav categories ─────────────────────────────────────────────
  // Admin-managed replacement for index.html's hardcoded navbar
  // (Home/About/Courses/.../Contact). See routes/admin/categories.js and
  // routes/categories.js.
  createCategory: [
    body("name").trim().notEmpty().withMessage("Name is required").isLength({ max: 60 }),
    body("slug")
      .trim().notEmpty().withMessage("Slug is required").isLength({ max: 60 })
      .matches(/^[a-z0-9-]+$/).withMessage("Slug can only contain lowercase letters, numbers, and hyphens"),
    body("url").trim().notEmpty().withMessage("URL is required").isLength({ max: 300 }).custom(isSafeUrl),
    body("icon").optional().trim().isLength({ max: 60 }),
    body("order").optional().isInt({ min: 0, max: 999 }).withMessage("Order must be 0–999").toInt(),
    body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
  ],

  updateCategory: [
    body("name").optional().trim().isLength({ min: 1, max: 60 }),
    body("slug")
      .optional().trim().isLength({ min: 1, max: 60 })
      .matches(/^[a-z0-9-]+$/).withMessage("Slug can only contain lowercase letters, numbers, and hyphens"),
    body("url").optional().trim().isLength({ min: 1, max: 300 }).custom(isSafeUrl),
    body("icon").optional().trim().isLength({ max: 60 }),
    body("order").optional().isInt({ min: 0, max: 999 }).withMessage("Order must be 0–999").toInt(),
    body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
  ],

  reorderCategories: [
    body("orderedIds").isArray({ min: 1 }).withMessage("orderedIds must be a non-empty array"),
    body("orderedIds.*").isString().trim().notEmpty().withMessage("Each id must be a non-empty string"),
  ],

  updateCategoryStatus: [
    body("isActive").isBoolean().withMessage("isActive must be a boolean"),
  ],

  // ── Website Builder (GoDaddy-style homepage sections) ───────────────────
  // Strictly form-based, fixed-shape content blocks — no free HTML/rich-
  // text field anywhere. `data` is validated per `type` below so a "hero"
  // section can't be saved with, say, FAQ fields and vice versa. See
  // routes/admin/website-sections.js for the full type list.
  createSection: [
    body("type").trim().notEmpty().isIn([
      "hero", "text", "image", "image_text", "gallery",
      "testimonials", "faq", "video", "cta", "contact",
    ]).withMessage("Invalid section type"),
    body("data").custom((data, { req }) => validateSectionData(req.body.type, data)),
    body("page")
      .optional().trim().isLength({ max: 60 })
      .matches(/^[a-z0-9-]+$/).withMessage("Page must be lowercase letters, numbers, and hyphens only"),
    body("anchor").optional().trim().isIn(HOMEPAGE_ANCHORS).withMessage("Invalid position"),
    body("order").optional().isInt({ min: 0, max: 999 }).withMessage("Order must be 0–999").toInt(),
    body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
  ],

  updateSection: [
    body("type").optional().trim().isIn([
      "hero", "text", "image", "image_text", "gallery",
      "testimonials", "faq", "video", "cta", "contact",
    ]).withMessage("Invalid section type"),
    // On update, `type` may be omitted (editing content only) — validated
    // against the existing document's type by the route handler itself
    // (it has access to the record; a body-only validator here doesn't).
    body("data").optional().custom((data, { req }) => {
      if (req.body.type) return validateSectionData(req.body.type, data);
      if (data === undefined) return true; // no data change in this update
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error("data must be an object");
      }
      return true;
    }),
    body("page")
      .optional().trim().isLength({ max: 60 })
      .matches(/^[a-z0-9-]+$/).withMessage("Page must be lowercase letters, numbers, and hyphens only"),
    body("anchor").optional().trim().isIn(HOMEPAGE_ANCHORS).withMessage("Invalid position"),
    body("order").optional().isInt({ min: 0, max: 999 }).withMessage("Order must be 0–999").toInt(),
    body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
  ],

  reorderSections: [
    body("orderedIds").isArray({ min: 1 }).withMessage("orderedIds must be a non-empty array"),
    body("orderedIds.*").isString().trim().notEmpty().withMessage("Each id must be a non-empty string"),
  ],

  updateSectionStatus: [
    body("isActive").isBoolean().withMessage("isActive must be a boolean"),
  ],
};

// Exposed directly (not just wired into the .custom() chains above) so it
// can be unit-tested and reused without going through express-validator.
validators.isSafeUrl = isSafeUrl;
// Also called directly from routes/admin/website-sections.js's PUT /:id
// handler: when an edit changes `data` but not `type`, the express-
// validator chain above (updateSection) can only confirm `data` is *an
// object* — it has no DB access to know the record's existing type, so it
// can't validate hero-shaped vs faq-shaped fields at that point. The route
// handler re-validates data against the existing document's type with
// this same function right before saving, so a malformed edit still can't
// reach MongoDB.
validators.validateSectionData = validateSectionData;

module.exports = validators;