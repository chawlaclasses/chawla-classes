/**
 * middleware/errors.js
 *
 * Central error handling middleware and response-shape helpers.
 *
 * All routes should use `next(err)` or the helpers below for consistent
 * JSON responses — never write res.json({ success: false, ... }) ad-hoc.
 *
 * Response shape:
 *   { success: true,  ...payload }
 *   { success: false, message: "..." }
 */

"use strict";

const logger = require("../utils/logger");

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function badRequest(res, message)                       { return fail(res, 400, message); }
function unauthorized(res, message = "Unauthorized")    { return fail(res, 401, message); }
function forbidden(res, message = "Forbidden")          { return fail(res, 403, message); }
function notFound(res, message = "Not found")           { return fail(res, 404, message); }
function conflict(res, message)                         { return fail(res, 409, message); }
function serverError(res, message = "Internal server error") { return fail(res, 500, message); }

// ── Global error handler ──────────────────────────────────────────────────────

// Must have exactly 4 args for Express to treat it as error middleware.
// eslint-disable-next-line no-unused-vars
function globalErrorHandler(err, req, res, next) {
  logger.error(`Unhandled error: ${err.message}`, {
    stack:  err.stack,
    path:   req.path,
    method: req.method,
  });

  const status = err.status || err.statusCode || 500;

  // FIX: Previous condition `err.expose || status < 500` was misleading.
  //      `err.expose` is a boolean flag (http-errors convention) that
  //      explicitly marks an error message as safe to send to the client.
  //      Rewritten as explicit if/else for clarity:
  //        - 5xx errors without expose=true  → generic message (hide internals)
  //        - 4xx errors OR expose=true       → send actual err.message
  let message;
  if (status >= 500 && !err.expose) {
    message = "Internal server error";
  } else {
    message = err.message || "An error occurred";
  }

  // Guard against sending a response to an already-finished connection
  if (res.headersSent) return;

  return res.status(status).json({ success: false, message });
}

// ── 404 catch-all ─────────────────────────────────────────────────────────────

// FIX: Renamed from notFoundHandler → routeNotFound to avoid confusion with
//      the notFound() response helper exported above. Both existed with similar
//      names which could lead to importing the wrong one.
function routeNotFound(req, res) {
  return res
    .status(404)
    .json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
}

module.exports = {
  ok,
  fail,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serverError,
  globalErrorHandler,
  routeNotFound,
  notFoundHandler: routeNotFound,   // backward-compat alias for app.js imports
};