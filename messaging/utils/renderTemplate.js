"use strict";
/**
 * {{variable}} substitution. Strict: a missing variable throws so a broken
 * message never reaches a parent ("Dear {{name}}, ...").
 */
function renderTemplate(body, vars = {}) {
  const missing = [];
  const out = String(body).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") { missing.push(key); return ""; }
    return String(v);
  });
  if (missing.length) {
    const err = new Error(`Missing template variables: ${[...new Set(missing)].join(", ")}`);
    err.code = "TEMPLATE_VARS_MISSING";
    err.missing = missing;
    throw err;
  }
  return out;
}

function extractVariables(body) {
  const set = new Set();
  String(body).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, k) => set.add(k));
  return [...set];
}

/** Rough SMS segment estimate (GSM-7 160/153, UCS-2 70/67) — for cost previews on bulk sends. */
function smsSegments(text) {
  const unicode = /[^\x00-\x7F]/.test(text);
  const len = [...text].length;
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return len <= single ? 1 : Math.ceil(len / multi);
}

module.exports = { renderTemplate, extractVariables, smsSegments };
