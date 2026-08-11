"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
// PERF: "compression" was already a package.json dependency but was never
// require()'d/app.use()'d anywhere — every JSON API response and every
// static asset (JS bundles, CSS, notes, images) was being sent uncompressed.
// Wiring it in gzips/brotli-compresses responses on the fly, which cuts
// transfer size (and therefore load time) for text-heavy responses
// significantly with no behavior change to any route.
const compression = require("compression");

// NEW (Phase 2): general-purpose API rate limiting and session support,
// wired in from _incoming-patch/app-updates.js. See PHASE_2_REPORT.md for
// why each is scoped/guarded the way it is below (both are additive — they
// don't replace the existing per-route limiters in middleware/rateLimit.js,
// which stay exactly as they were).
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const { initializeCsrfProtection, verifyCsrfToken } = require("./middleware/csrfProtection");

// NEW (Phase 2): Sentry error tracking. Requiring these two packages is
// always safe/cheap (no native bindings — @sentry/profiling-node was
// deliberately dropped, see PHASE_2_REPORT.md); Sentry.init() itself below
// is still gated on SENTRY_DSN + NODE_ENV=production, so this is a true
// no-op until Rohit actually configures it.
const Sentry = require("@sentry/node");
require("@sentry/tracing"); // extends Sentry with the tracing integrations used below

const {
  ALLOWED_ORIGINS,
  STATIC_DIR,
  NOTES_DIR,
  UPLOADS_DIR,
  DATA_DIR,
  HOMEWORK_DIR,
  HOMEWORK_SUBMISSIONS_DIR,
  DOUBTS_DIR,
} = require("./config");

const { globalErrorHandler, notFoundHandler } = require("./middleware/errors");
const logger = require("./utils/logger");
const healthRoutes = require("./routes/health");
// NEW (Phase 2): fallback secret for the new session middleware below. Using
// the resolved JWT_SECRET export (env var -> persisted random 32-byte
// secret file -> auto-generate + persist, see services/auth.js) rather
// than raw process.env.JWT_SECRET — same reasoning middleware/apiAuth.js
// already uses for its own JWT_SECRET import: process.env.JWT_SECRET isn't
// guaranteed to be set (the persisted-secret-file fallback means the app
// can run fine without it in .env), and express-session throws at startup
// if handed an undefined secret.
const { JWT_SECRET } = require("./services/auth");

// ── Error tracking (Sentry) ───────────────────────────────────────────────────
// NEW (Phase 2): only initializes when SENTRY_DSN is actually set AND
// NODE_ENV=production — matches _incoming-patch/app-updates.js's own guard,
// so this stays a no-op in dev/test until Rohit configures a real DSN.
// Runs once at module load (this file is only require()'d once by
// server.js / __tests__ setup), same as the route requires below it.
if (process.env.SENTRY_DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 1.0,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express(),
    ],
  });
  logger.info("Sentry error tracking initialized");
}

// ── Route modules ─────────────────────────────────────────────────────────────
// authRoutes (routes/auth.js) and the five legacy CRUD route modules below are
// intentionally required but not mounted — see the security note near the old
// app.use("/", studentRoutes) lines further down for why each was unmounted.
const authRoutes = require("./routes/auth"); // eslint-disable-line no-unused-vars
const studentRoutes = require("./routes/students"); // eslint-disable-line no-unused-vars
const questionRoutes = require("./routes/questions"); // eslint-disable-line no-unused-vars
const resultsRoutes = require("./routes/results"); // eslint-disable-line no-unused-vars
const notesRoutes = require("./routes/notes"); // eslint-disable-line no-unused-vars
const pdfRoutes = require("./routes/pdf"); // eslint-disable-line no-unused-vars

// ── New test system route modules ─────────────────────────────────────────────
const apiAuthRoutes = require("./routes/apiAuth");
const adminRoutes = require("./routes/adminRoutes");
const staffRoutes = require("./routes/staff");
const apiStudentRoutes = require("./routes/studentRoutes");
const importRoutes = require("./routes/import");

// FIX: these five route modules existed, and their controllers/services were
// fully implemented, but nothing in app.js ever required or mounted them —
// so /api/notifications, /api/bookmarks, /api/ai, /api/practice, and
// /api/analytics all 404'd even though the front-end (public/student/js/api/*)
// was already calling them. Each file applies its own requireApiStudent
// internally, so no extra auth middleware is needed at the mount point here.
const notificationsRoutes = require("./routes/notifications");
const recruitmentPublicRoutes = require("./routes/recruitment");
const publicEnquiryRoutes = require("./routes/publicEnquiry");
const marketingPublicRoutes = require("./routes/marketing");
const reviewsPublicRoutes = require("./routes/reviews");
const bookmarksRoutes = require("./routes/bookmarks");
const practiceRoutes = require("./routes/practice");
const achievementsRoutes = require("./routes/achievements");
const dailyTargetsRoutes = require("./routes/dailytargets");
const revisionRoutes = require("./routes/revision");
const reportsRoutes = require("./routes/reports");
const analyticsRoutes = require("./routes/analytics");
const settingsRoutes = require("./routes/settings");
const settingsService = require("./services/settings");

// ── Auth middleware ───────────────────────────────────────────────────────────
const { requireApiAdmin, requireApiStudent } = require("./middleware/apiAuth");

// ── Ensure runtime directories exist ─────────────────────────────────────────
for (const dir of [DATA_DIR, NOTES_DIR, UPLOADS_DIR, HOMEWORK_DIR, HOMEWORK_SUBMISSIONS_DIR, DOUBTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createApp() {
  const app = express();
app.set('trust proxy', 1);
  if (process.env.TRUST_PROXY !== undefined) {
    const val = process.env.TRUST_PROXY;
    app.set("trust proxy", val === "0" ? 0 : Number(val) || val);
  }

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
          // FIX (CSP tighten): 'unsafe-eval' and three CDN origins removed after
          // auditing every .html/.js in public/ and index.html — no eval()/new
          // Function() usage anywhere, and maps.googleapis.com, maps.gstatic.com,
          // cdn.mathjax.org are never referenced by any <script src>. Google Maps
          // is only ever embedded as an <iframe src="https://maps.google.com">,
          // which is already covered by frameSrc, not scriptSrc.
          // 'unsafe-inline' stays for now: index.html and most public/ pages still
          // have real inline <script> blocks (form handlers, counters, etc.) that
          // would need to move to external files or a nonce scheme to drop it —
          // that's a bigger refactor, best done alongside the admin panel
          // modularization work rather than folded silently into this pass.
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          // Same story as scriptSrc's 'unsafe-inline': admin/dashboard.html alone
          // has 145+ onclick handlers plus onchange/oninput/ondrop/ondragover/
          // ondragstart attrs, and every student page uses onclick too. Removing
          // this means rewriting every one of those to addEventListener — left
          // for the admin-panel modularization pass, not done here.
          scriptSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          fontSrc: ["'self'", "data:", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
          connectSrc: ["'self'", "https://script.google.com", "https://script.googleusercontent.com"],
          frameSrc: ["'self'", "https://www.google.com", "https://maps.google.com"],
          // FIX (CSP tighten): these four directives weren't set before, so helmet
          // left them at CSP's permissive defaults. Verified safe to lock down:
          // no <object>/<embed> tags, no native <form action="...">  (every form
          // submits via JS fetch()), and no <base> tag anywhere in the codebase.
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // ── Health check (NEW, production hardening 2026-08) ──────────────────────
  // Registered this early, right after helmet, so it stays reachable even
  // if something later in the chain (Sentry, session, CSRF) has a problem.
  // See routes/health.js for the route itself.
  app.use(healthRoutes);

  // ── Sentry request/tracing handlers (NEW, Phase 2) ────────────────────────
  // Must be registered early — before routes, right after helmet — so Sentry
  // can time and tag the full request. No-op unless Sentry.init() actually
  // ran above (SENTRY_DSN + production).
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === "production") {
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());
  }

  // ── Session middleware (NEW, Phase 2) ──────────────────────────────────────
  // Added as a prerequisite for CSRF token storage below (middleware/
  // csrfProtection.js reads/writes req.session) — nothing else in this
  // codebase uses req.session. Distinct from, and unrelated to, the JWT
  // `sid` concept in utils/sessionManager.js (used for the "active
  // sessions" / revoke-device feature on the auth routes) — same word,
  // two different mechanisms; don't confuse the two.
  // In-memory store only for now: connect-redis is installed and ready
  // (`npm ls connect-redis`), but wiring an actual Redis client is a
  // separate decision (needs a running Redis instance) — out of scope for
  // this pass. MemoryStore is fine for a single-process deployment like
  // the current one; revisit if/when this ever runs multi-process.
  // Scoped to /api only: every state-changing route in this app lives
  // under /api/*, so there's no reason to hand out a session cookie (and
  // pay the MemoryStore bookkeeping cost) on every static asset request —
  // JS/CSS bundles, /images, /notes, /uploads, /homework-files — which is
  // the bulk of this app's traffic by request count.
  app.use(
    "/api",
    session({
      secret: process.env.SESSION_SECRET || JWT_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: ALLOWED_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // ── Response compression ─────────────────────────────────────────────────
  // PERF: gzip/br-compresses JSON API responses and static assets (JS/CSS/
  // notes/images) on the fly. compression() already skips already-compressed
  // formats and tiny responses by default (via its own internal threshold/
  // filter), so this is safe to apply globally with no route-specific logic.
  app.use(compression());

  // ── Block direct access to sensitive directories ──────────────────────────
  app.use(["/data", "/uploads"], (_req, res) => res.status(404).end());

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "2mb" }));

  // ── General API rate limiter (NEW, Phase 2) ────────────────────────────────
  // Additive defense-in-depth — does NOT replace or touch the existing
  // per-route limiters in middleware/rateLimit.js (test-taking, submissions,
  // question generation, and the login-specific createAuthRateLimiter()
  // already applied in routes/apiAuth.js). Those stay exactly as they were.
  // This one is new coverage for everything else — every /api/admin/*,
  // /api/student/* etc. CRUD endpoint had zero rate limiting before this.
  //
  // FIX vs _incoming-patch/app-updates.js's reference numbers (100 req /
  // 15 min per IP): verified against the real admin frontend
  // (public/admin/js/*.js) before picking a number — it makes 182 distinct
  // apiCall() call sites, and a single office/NAT IP can mean several staff
  // sharing one IP. 100/15min would have started 429-ing normal dashboard
  // use almost immediately. Defaults below are deliberately generous —
  // this is meant to stop a flood/bot, not throttle a busy admin — and are
  // env-overridable so Rohit can tune without a code change.
  const GENERAL_RATE_LIMIT_WINDOW_MIN = parseInt(process.env.GENERAL_RATE_LIMIT_WINDOW_MIN, 10) || 15;
  const GENERAL_RATE_LIMIT_MAX = parseInt(process.env.GENERAL_RATE_LIMIT_MAX, 10) || 2000;
  const generalApiLimiter = rateLimit({
    windowMs: GENERAL_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    limit: GENERAL_RATE_LIMIT_MAX,
    message: { success: false, message: "Too many requests from this IP, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const adminIPs = (process.env.ADMIN_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
      return adminIPs.includes(req.ip);
    },
  });
  app.use("/api", generalApiLimiter);

  // ── CSRF protection (Phase 2, enforcement settled Phase 2 follow-up) ──────
  // initializeCsrfProtection attaches/creates a token per session (harmless
  // on its own — no request is ever blocked by it). verifyCsrfToken is the
  // part that can reject a request. Enforcement is genuinely ON in this
  // build (CSRF_ENFORCE=true in .env) — see PUBLIC_UNAUTHENTICATED_WRITE_
  // PATHS in middleware/csrfProtection.js for the explicit allowlist that
  // made turning it on safe, and PHASE_2_REPORT.md / PHASE_4_REPORT.md for
  // the history. This is settled, not staged — don't revert to log-only
  // without Rohit asking for it.
  // Scoped to /api for the same reason session is: nothing outside /api
  // ever does a state-changing request in this app.
  app.use("/api", initializeCsrfProtection);
  app.use("/api", verifyCsrfToken);

  // ── Request logging ───────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    logger.debug(`→ ${req.method} ${req.originalUrl}`);
    next();
  });

  // ── Public settings (no auth) ─────────────────────────────────────────────
  // Safe subset only (institute name/logo/favicon/maintenance flag) — never
  // email/WhatsApp credentials. Used by login pages for branding and by the
  // maintenance-mode check below.
  app.get("/api/public-settings", (_req, res) => {
    res.json({ success: true, data: settingsService.getPublicSettings() });
  });

  // ── Maintenance mode ───────────────────────────────────────────────────────
  // FIX: this used to be registered AFTER the static file serving / SPA
  // root below — since Express runs middleware in registration order, and
  // express.static() (and the "/" route) fully handle+respond to a
  // request before it ever reaches later middleware, maintenance mode was
  // silently doing nothing: "/" and "/student/login.html" kept returning
  // 200 no matter what the setting said. Moving this above static serving
  // fixes that. Admin panel, admin API, images, and the public-settings
  // check itself stay reachable so an admin can always get back in to
  // turn maintenance mode off again.
  app.use((req, res, next) => {
    const { maintenanceMode, maintenanceMessage, instituteName } = settingsService.getPublicSettings();
    if (!maintenanceMode) return next();
    if (
      req.path.startsWith("/admin") ||
      req.path.startsWith("/api/admin") ||
      req.path === "/api/public-settings" ||
      req.path.startsWith("/images") ||
      req.path === "/style.css"
    ) {
      return next();
    }
    if (req.path.startsWith("/api/")) {
      return res.status(503).json({ success: false, message: maintenanceMessage, maintenance: true });
    }
    res.status(503).send(`<!DOCTYPE html><html><head><title>Under Maintenance</title>
      <style>body{font-family:sans-serif;background:#0a1628;color:#F8F9FC;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}
      .box{max-width:480px;padding:32px;} h1{color:#F5A623;}</style></head>
      <body><div class="box"><h1>🛠️ ${instituteName}</h1><p>${maintenanceMessage}</p></div></body></html>`);
  });

  // ── Serve static files ────────────────────────────────────────────────────
  // FIX: STATIC_DIR (the marketing/landing site — index.html, style.css,
  // images/, robots.txt, sitemap.xml — all living at the project root) was
  // imported from ./config but never actually used, so "/" 404'd (it was
  // looking for public/index.html, which doesn't exist; public/ only holds
  // the admin/ and student/ SPA panels). We deliberately do NOT
  // `express.static(STATIC_DIR)` the whole project root, since STATIC_DIR
  // is the same directory as server.js/services/routes/.env — that would
  // leak backend source and secrets over HTTP. Instead we expose only the
  // specific marketing assets that actually need to be public.
  // PERF: express.static() defaults to no Cache-Control header at all, so
  // browsers re-request every image/note/upload/JS/CSS file on every single
  // page load instead of using their local cache. Two cache policies below,
  // matched to how each directory's filenames actually behave:
  //   - STATIC_ASSET_OPTS: for content whose filename can be reused with
  //     different bytes (site images, notes, raw uploads) — cache for a day
  //     but always revalidate with the server first (ETag/If-None-Match),
  //     so an edited file is picked up immediately while unchanged files
  //     still skip the full re-download (304 Not Modified).
  //   - IMMUTABLE_ASSET_OPTS: for uploaded files that embed a timestamp in
  //     their filename (multer's `${Date.now()}-${name}` pattern used
  //     throughout middleware/upload.js) — homework files. Because the
  //     filename itself changes whenever the content changes, it's safe to
  //     cache these for a year with `immutable` and skip revalidation
  //     entirely.
  const STATIC_ASSET_OPTS = { maxAge: "1d", etag: true, lastModified: true };
  const IMMUTABLE_ASSET_OPTS = { maxAge: "1y", immutable: true, etag: true, lastModified: true };

  app.use(express.static(path.join(__dirname, "public"), STATIC_ASSET_OPTS));
  app.use("/images", express.static(path.join(STATIC_DIR, "images"), STATIC_ASSET_OPTS));
  app.get("/style.css", (_req, res) => res.sendFile(path.join(STATIC_DIR, "style.css")));
  app.get("/robots.txt", (_req, res) => res.sendFile(path.join(STATIC_DIR, "robots.txt")));
  app.get("/sitemap.xml", (_req, res) => res.sendFile(path.join(STATIC_DIR, "sitemap.xml")));
  app.use("/notes", express.static(NOTES_DIR, STATIC_ASSET_OPTS));
  app.use("/uploads", express.static(UPLOADS_DIR, STATIC_ASSET_OPTS));
  // homework-submissions is deliberately NOT mounted here — student
  // submissions are only reachable through the authenticated download
  // routes, same reasoning as STUDENT_DOCS_DIR.
  app.use("/homework-files", express.static(HOMEWORK_DIR, IMMUTABLE_ASSET_OPTS));

  // ── SPA root ──────────────────────────────────────────────────────────────
  app.get("/", (_req, res) => {
    res.sendFile(path.join(STATIC_DIR, "index.html"));
  });

  // ── Existing API routes ───────────────────────────────────────────────────
  // FIX: notesRoutes and pdfRoutes were mounted at bare "/" alongside
  // studentRoutes (routes/students.js, the legacy CRUD one). Their generic
  // internal paths (GET '/', GET '/:id', POST '/upload') collided with
  // studentRoutes' GET '/:id' catch-all and with the "/notes" static file
  // server registered above — so GET /notes and GET /pdf never actually
  // reached these routers (e.g. GET /pdf was being swallowed by
  // studentRoutes' /:id handler, returning a bogus "Student not found").
  // Giving them their own prefixes makes them reachable.
  // FIX (security): routes/auth.js is superseded, legacy, and confirmed
  // unused by any frontend page (everything actually calls the /api/...
  // endpoints in apiAuthRoutes below) — but it was still mounted and
  // reachable, and it's actively dangerous to leave wired up:
  //   1) Its POST /register endpoint creates a user with an admin-chosen
  //      role (including 'admin') and has NO auth middleware on it at all —
  //      anyone, unauthenticated, could POST there and hand themselves an
  //      admin account.
  //   2) Its POST /admin/login and /student/login duplicate apiAuthRoutes'
  //      /api/admin/login and /api/student/login but don't have the account
  //      lockout added in apiAuth.js — leaving this mounted would let an
  //      attacker route around the lockout entirely by hitting this path
  //      instead.
  // Leaving the file in place (unmounted) in case any of its logic is
  // wanted later, but it must not be reachable over HTTP as-is.
  // app.use("/", authRoutes);
  // FIX (security, audit 2026-07): studentRoutes/questionRoutes/resultsRoutes/
  // notesRoutes/pdfRoutes (routes/students.js, questions.js, results.js,
  // notes.js, pdf.js) had NO auth middleware at all — full GET/POST/PUT/DELETE
  // on every student, question, result, note, and PDF was reachable by anyone,
  // unauthenticated. Confirmed by grep across public/admin/**/*.js and
  // public/student/**/*.js that no frontend code calls any of these paths
  // (/students, /questions, /results, /api/notes-data, /api/pdf-data) —
  // everything actually in use goes through the authenticated /api/admin/...
  // and /api/student/... routes below. Unmounting closes the hole with zero
  // functional impact, same reasoning as authRoutes above. Files are left in
  // place (unmounted) in case any of their logic is wanted later behind
  // proper auth — see routes/students.js etc.
  // app.use("/", studentRoutes);
  // app.use("/", questionRoutes);
  // app.use("/", resultsRoutes);
  // app.use("/api/notes-data", notesRoutes);
  // app.use("/api/pdf-data", pdfRoutes);

  // ── New test system API routes ────────────────────────────────────────────
  app.use("/", apiAuthRoutes);
  app.use("/api/admin", requireApiAdmin, adminRoutes);
  app.use("/api/admin/staff", requireApiAdmin, staffRoutes);
  app.use("/api/admin/settings", requireApiAdmin, settingsRoutes);
  app.use("/api/student", requireApiStudent, apiStudentRoutes);
  app.use("/api/import", requireApiAdmin, importRoutes);

  // ── Previously-unwired student feature routes ─────────────────────────────
  app.use("/api/notifications", notificationsRoutes);
  // Public — no auth. Job applicants aren't a user in the system yet;
  // security here is the route's own rate limiter + duplicate-submission
  // guard (see routes/recruitment.js), not a login check.
  app.use("/api/careers", recruitmentPublicRoutes);
  // Public — no auth. The marketing site's "Quick Enquiry" form. Writes
  // into the same 'enquiries' collection the admin panel manages.
  app.use("/api/enquiry", publicEnquiryRoutes);
  // Public — no auth, read-only. Active promo banners for index.html's
  // promo bar / offers section. Admin CRUD is separate (/api/admin/marketing).
  app.use("/api/marketing", marketingPublicRoutes);
  // Public — no auth. index.html's "Student Feedback & Rating" form
  // (submission) + the "Student Reviews" section (approved-only read).
  // Admin moderation is separate (/api/admin/reviews).
  app.use("/api/reviews", reviewsPublicRoutes);
  app.use("/api/bookmarks", bookmarksRoutes);
  app.use("/api/practice", practiceRoutes);
  app.use("/api/achievements", achievementsRoutes);
  app.use("/api/daily-targets", dailyTargetsRoutes);
  app.use("/api/revision", revisionRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/analytics", analyticsRoutes);

  // ── 404 & global error ────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // NEW (Phase 2): Sentry error handler. FIX vs _incoming-patch/app-updates.js's
  // reference order, which put this AFTER globalErrorHandler — checked
  // middleware/errors.js and globalErrorHandler sends the JSON response
  // itself and never calls next(err), so anything registered after it in
  // the chain is unreachable dead code. Sentry's handler only captures and
  // re-throws via next(err); it must run BEFORE globalErrorHandler, which
  // still owns sending the actual response, unchanged.
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === "production") {
    app.use(
      Sentry.Handlers.errorHandler({
        shouldHandleError(error) {
          // Only send 500s to Sentry — 4xx are expected/handled errors.
          return error.status === undefined || error.status >= 500;
        },
      })
    );
  }

  app.use(globalErrorHandler);

  return app;
}

module.exports = { createApp };
