/**
 * middleware/honeypot.js
 *
 * Classic honeypot trap for the two public, unauthenticated form
 * endpoints (Admission Form, Career/Faculty Recruitment Form). Both
 * public/admission.html and public/careers.html now render a hidden
 * `website` field that a real visitor never sees or fills in (see each
 * HTML file's <style> for how it's hidden) — only an automated bot
 * blindly filling every input on the page fills it in.
 *
 * Deliberately responds with the SAME success-shaped response a genuine
 * submission would get, rather than a 400/validation error — a bot that
 * gets a distinct "rejected: honeypot filled" response can just learn to
 * leave that one field empty next time. Returning success-shaped JSON
 * without actually saving anything (see req.honeypotTriggered below)
 * gives no signal back to whatever is filling the form.
 *
 * Usage: mount BEFORE multer/validation in the route chain (cheapest
 * possible check, no point parsing/validating a submission that's about
 * to be silently dropped anyway):
 *   router.post("/admission", honeypotGuard(), ...)
 *
 * The route handler itself never actually needs to check anything special
 * — this middleware ends the response itself when triggered, so a route
 * handler downstream simply never runs for a caught bot.
 */

"use strict";

const logger = require("../utils/logger");

const HONEYPOT_FIELD = "website";

function honeypotGuard(successMessage = "Submitted successfully.") {
  return (req, res, next) => {
    const value = req.body && req.body[HONEYPOT_FIELD];
    if (value && String(value).trim() !== "") {
      // Logged server-side only for Rohit's visibility (never exposed to
      // the caller) — see requirement #10, "do not expose these details
      // publicly".
      logger.warn(`Honeypot triggered on ${req.method} ${req.originalUrl} from ${req.ip} (user-agent: ${req.headers["user-agent"] || "unknown"})`);
      return res.status(200).json({ success: true, message: successMessage });
    }
    next();
  };
}

module.exports = { honeypotGuard, HONEYPOT_FIELD };
