/**
 * CSRF Protection Middleware
 * Prevents Cross-Site Request Forgery attacks
 * 
 * Token is generated per session and validated on state-changing operations
 * GET/HEAD/OPTIONS are exempt (safe operations)
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// Store active tokens per session
// In production, use Redis for distributed sessions
const tokenStore = new Map();

/**
 * Generate a new CSRF token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to initialize CSRF protection
 * Should be called once per session/page load
 */
function initializeCsrfProtection(req, res, next) {
  if (!req.session) {
    req.session = {};
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
    tokenStore.set(req.session.id || req.ip, req.session.csrfToken);
  }

  // Attach token to response locals so templates can access it
  res.locals.csrfToken = req.session.csrfToken;

  // Also send in response header for AJAX requests
  res.setHeader('X-CSRF-Token', req.session.csrfToken);

  next();
}

/**
 * Middleware to verify CSRF token on state-changing requests
 * Only validates POST/PUT/DELETE/PATCH
 *
 * (Phase 2, 2026-08-02): wired in staged disabled (log-only) behind
 * CSRF_ENFORCE, pending a plan for the public unauthenticated endpoints.
 * (Phase 2 follow-up, same day): that plan is the PUBLIC_UNAUTHENTICATED_
 * WRITE_PATHS allowlist below — CSRF_ENFORCE is now on in this build. See
 * PHASE_2_REPORT.md / the follow-up section for the reasoning: this app
 * authenticates with a JWT Bearer token, not a cookie, so the classic CSRF
 * attack this middleware defends against (browser silently attaching
 * ambient credentials to a forged cross-site request) never applied to the
 * authenticated traffic exempted below. The public endpoints are exempted
 * for the same underlying reason, made explicit: they don't carry
 * Authorization either, but there's still no ambient cookie credential for
 * a cross-site page to ride on, so a per-route allowlist is the correct
 * fix rather than a reason to leave enforcement off indefinitely.
 *
 * FIX: original also read `req.body._csrf` unconditionally, which throws
 * if this middleware ever runs before the JSON body parser (req.body
 * undefined). Changed to optional chaining.
 */
const CSRF_ENFORCE = process.env.CSRF_ENFORCE === 'true';

// Real public, unauthenticated write endpoints — enumerated by reading
// app.js's actual route mounts (not guessed): admin/student login (no
// token exists yet at login time), the public enquiry form, the
// careers/faculty application form (multipart upload — req.body isn't
// even JSON-parsed for this one by the time this middleware runs, so a
// token couldn't be read out of it reliably anyway), and the public
// review-submission form (routes/reviews.js) along with its two email-
// verification steps (send-otp/verify-otp) that run before it — same
// reasoning applies to those two: no ambient cookie credential, no JWT
// yet at that point in the flow, already rate-limited at the route level.
// Each already has its own rate limiting (authRateLimiter /
// createSubmissionRateLimiter) at the route level — this allowlist only
// removes the CSRF check, nothing else.
// Real public, unauthenticated write endpoints — enumerated by reading
// app.js's actual route mounts (not guessed): admin/student login (no
// token exists yet at login time), the public enquiry form, the
// careers/faculty application form (multipart upload — req.body isn't
// even JSON-parsed for this one by the time this middleware runs, so a
// token couldn't be read out of it reliably anyway), and the public
// review-submission form (routes/reviews.js) along with its two email-
// verification steps (send-otp/verify-otp) that run before it, plus its
// self-service edit flow (GET/PUT /edit/:token and resend-edit-link) —
// same reasoning applies to all of these: no ambient cookie credential,
// no JWT yet at that point in the flow, already rate-limited at the
// route level.
// Each already has its own rate limiting (authRateLimiter /
// createSubmissionRateLimiter) at the route level — this allowlist only
// removes the CSRF check, nothing else.
//
// FIX (production-readiness audit, 2026-08-21): PUT /api/reviews/edit/:token
// has a dynamic :token segment, so it can never satisfy an exact-string
// .includes() match against req.originalUrl — every real edit-save and
// resend-link request was being rejected with 403 "CSRF token missing or
// invalid" even though the route itself was otherwise correct. Exact
// matches stay in PUBLIC_UNAUTHENTICATED_WRITE_PATHS; anything with a
// dynamic segment goes in PUBLIC_UNAUTHENTICATED_WRITE_PREFIXES instead
// and is matched with startsWith().
const PUBLIC_UNAUTHENTICATED_WRITE_PATHS = [
  '/api/admin/login',
  '/api/student/login',
  '/api/enquiry',
  '/api/enquiry/admission',
  '/api/enquiry/admission/send-otp',
  '/api/enquiry/admission/verify-otp',
  '/api/careers/apply',
  '/api/careers/send-otp',
  '/api/careers/verify-otp',
  '/api/reviews',
  '/api/reviews/send-otp',
  '/api/reviews/verify-otp',
  '/api/reviews/resend-edit-link',
];

const PUBLIC_UNAUTHENTICATED_WRITE_PREFIXES = [
  '/api/reviews/edit/', // PUT /api/reviews/edit/:token — dynamic token segment
];

function isPublicUnauthenticatedWrite(req) {
  const path = req.originalUrl.split('?')[0];
  if (PUBLIC_UNAUTHENTICATED_WRITE_PATHS.includes(path)) return true;
  return PUBLIC_UNAUTHENTICATED_WRITE_PREFIXES.some(prefix => path.startsWith(prefix));
}

function verifyCsrfToken(req, res, next) {
  // Skip safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip requests that carry a JWT Bearer token (they have their own
  // security) — this is the entire authenticated admin/student API surface.
  // FIX (found via live verification, 2026-08-02): this used to check
  // `req.path.startsWith('/api/')` too, copied from the original patch
  // file which assumed this middleware would be mounted globally. It's
  // actually mounted as `app.use("/api", verifyCsrfToken)` in app.js —
  // Express strips the "/api" mount prefix from req.path inside a
  // path-scoped middleware, so req.path here is e.g. "/admin/dashboard",
  // never "/api/admin/dashboard", and that check could never be true.
  // Confirmed live: a curl'd request with a real Authorization header was
  // still being flagged "CSRF token missing" before this fix. Since the
  // /api scoping is already guaranteed by the mount point itself, the path
  // check was redundant even when correct — removed, not replaced.
  if (req.headers.authorization) {
    return next();
  }

  // Skip the explicit public-endpoint allowlist — see comment above it.
  if (isPublicUnauthenticatedWrite(req)) {
    return next();
  }

  const token =
    req.body?._csrf ||                   // Form field
    req.headers['x-csrf-token'] ||       // Header
    req.headers['x-xsrf-token'];         // Alternative header

  const sessionToken = req.session?.csrfToken;

  const rejectionReason = !token || !sessionToken
    ? 'missing'
    : (token !== sessionToken ? 'mismatch' : null);

  if (!rejectionReason) {
    return next();
  }

  logger.warn(`CSRF token ${rejectionReason}: ${req.method} ${req.originalUrl}`, {
    hasToken: !!token,
    hasSessionToken: !!sessionToken,
    ip: req.ip,
    enforced: CSRF_ENFORCE,
  });

  if (!CSRF_ENFORCE) {
    // Log-only mode: record what would have been rejected, let it through.
    return next();
  }

  return res.status(403).json({
    success: false,
    message: rejectionReason === 'missing' ? 'CSRF token missing or invalid' : 'CSRF token invalid'
  });
}

/**
 * Middleware to regenerate CSRF token on login
 * Important: Do this after successful authentication
 */
function regenerateCsrfToken(req, res, next) {
  if (req.session) {
    const oldToken = req.session.csrfToken;
    req.session.csrfToken = generateToken();
    
    if (oldToken) {
      tokenStore.delete(req.session.id || req.ip);
    }
    tokenStore.set(req.session.id || req.ip, req.session.csrfToken);
    
    res.setHeader('X-CSRF-Token', req.session.csrfToken);
  }
  next();
}

module.exports = {
  initializeCsrfProtection,
  verifyCsrfToken,
  regenerateCsrfToken,
  generateToken
};