"use strict";
/** Thin wrapper so the module works with the project's logger or plain console. */
let base;
try { base = require("../../utils/logger"); } catch { base = null; }
const fallback = {
  debug: (...a) => console.debug("[messaging]", ...a),
  info: (...a) => console.log("[messaging]", ...a),
  warn: (...a) => console.warn("[messaging]", ...a),
  error: (...a) => console.error("[messaging]", ...a),
};
module.exports = base && typeof base.info === "function" ? base : fallback;
