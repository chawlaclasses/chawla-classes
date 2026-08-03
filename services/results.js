/**
 * services/results.js
 *
 * FIX: crypto.randomUUID() replaced with generateUUID() from utils/helpers.
 *      randomUUID() only exists on Node 14.17+ — on older Node runtimes it
 *      throws "crypto.randomUUID is not a function", which was surfacing
 *      as a 500 Internal Server Error on POST /save-result. generateUUID()
 *      works on every Node version.
 */

"use strict";

const storage = require("./storage");
const { normalizeEmail, generateUUID } = require("../utils/helpers");

function saveResult({ email, score, total }) {
  if (!email || score === undefined || total === undefined) {
    throw Object.assign(new Error("Missing fields"), { status: 400 });
  }
  if (typeof score !== "number" || typeof total !== "number") {
    throw Object.assign(new Error("Score and total must be numbers"), { status: 400 });
  }

  const results = storage.read("results.json");
  const entry   = {
    // ⭐ FIX: was crypto.randomUUID() — now Node-version-safe generateUUID()
    id:    generateUUID(),
    email: normalizeEmail(email),
    score,
    total,
    date:  new Date().toLocaleString(),
  };

  results.push(entry);
  storage.write("results.json", results);

  const rank = [...results]
    .sort((a, b) => b.score - a.score)
    .findIndex((r) => r.id === entry.id) + 1;

  return { ...entry, rank };
}

function getAll() {
  return storage.read("results.json");
}

function getByEmail(email) {
  const normalized = normalizeEmail(email);
  return storage.read("results.json").filter((r) => normalizeEmail(r.email) === normalized);
}

function getPerformance(email) {
  const recs = getByEmail(email);
  let bestScore = 0, totalPct = 0;

  recs.forEach((r) => {
    const pct = r.total > 0 ? (r.score / r.total) * 100 : 0;
    if (pct > bestScore) bestScore = pct;
    totalPct += pct;
  });

  return {
    totalTests:   recs.length,
    bestScore:    bestScore.toFixed(1),
    averageScore: recs.length > 0 ? (totalPct / recs.length).toFixed(1) : "0.0",
  };
}

function getLeaderboard(students) {
  const results = storage.read("results.json");
  const best    = {};

  results.forEach((r) => {
    if (typeof r.score !== "number" || typeof r.total !== "number" || r.total === 0) return;
    const pct = (r.score / r.total) * 100;
    const em  = normalizeEmail(r.email);
    if (!best[em] || pct > best[em]) best[em] = pct;
  });

  return Object.keys(best)
    .map((em) => {
      const s = students.find((x) => normalizeEmail(x.email) === em);
      return { name: s ? s.name : "Anonymous", score: parseFloat(best[em].toFixed(1)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

module.exports = { saveResult, getAll, getByEmail, getPerformance, getLeaderboard };