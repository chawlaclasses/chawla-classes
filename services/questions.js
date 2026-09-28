/**
 * services/questions.js
 *
 * Business logic for the question bank.
 * Supports single and bulk operations.
 *
 * FIX: crypto.randomUUID() replaced with generateUUID() from utils/helpers.
 *      randomUUID() only exists on Node 14.17+ — on older Node runtimes it
 *      throws "crypto.randomUUID is not a function", which was surfacing
 *      as a 500 Internal Server Error on POST /add-question (and on bulk
 *      saves from the PDF import flow) whenever no `id` was supplied in
 *      the request body. generateUUID() works on every Node version.
 */

"use strict";

const storage = require("./storage");
const { generateUUID } = require("../utils/helpers");

// ── Validation ────────────────────────────────────────────────────────────────

function validateMCQ(options, answer) {
  if (!Array.isArray(options) || options.length === 0) {
    throw Object.assign(
      new Error("MCQ questions must have at least one option"),
      { status: 400 }
    );
  }
  if (answer && typeof answer === "string" && answer.trim() && !options.includes(answer)) {
    throw Object.assign(
      new Error("Answer must match one of the provided options"),
      { status: 400 }
    );
  }
}

function buildQuestion(body, existing = null) {
  const {
    // ⭐ FIX: was crypto.randomUUID() — now Node-version-safe generateUUID()
    id        = existing?.id || generateUUID(),
    question,
    options   = existing?.options || [],
    answer    = existing?.answer  || "",
    class: qClass = existing?.class   || "",
    subject   = existing?.subject  || "",
    chapter   = existing?.chapter  || "",
    type      = existing?.type     || "MCQ",
    marks     = existing?.marks    || 1,
  } = body;

  if (!question || !String(question).trim()) {
    throw Object.assign(new Error("Question text is required"), { status: 400 });
  }

  if (type === "MCQ") validateMCQ(options, answer);

  return {
    id,
    question: String(question).trim(),
    options:  Array.isArray(options) ? options : [],
    answer:   answer || "",
    class:    qClass || "",
    subject:  subject || "",
    chapter:  chapter || "",
    type,
    marks:    Number(marks) || 1,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

function getAll() {
  return storage.read("questions.json");
}

function add(body) {
  const questions = storage.read("questions.json");

  const q = buildQuestion(body);

  if (questions.find((x) => String(x.id) === String(q.id))) {
    throw Object.assign(new Error("Question ID already exists"), { status: 409 });
  }

  questions.push(q);
  storage.write("questions.json", questions);
  return q;
}

function update(body) {
  const { id } = body;
  if (!id) throw Object.assign(new Error("ID required"), { status: 400 });

  const questions = storage.read("questions.json");
  const index     = questions.findIndex((q) => String(q.id) === String(id));

  if (index === -1) throw Object.assign(new Error("Question not found"), { status: 404 });

  questions[index] = buildQuestion(body, questions[index]);
  storage.write("questions.json", questions);
  return questions[index];
}

function remove(id) {
  if (!id) throw Object.assign(new Error("ID required"), { status: 400 });

  const questions = storage.read("questions.json");
  const updated   = questions.filter((q) => String(q.id) !== String(id));

  if (updated.length === questions.length) {
    throw Object.assign(new Error("Question not found"), { status: 404 });
  }

  storage.write("questions.json", updated);
  return { deleted: true };
}

// ── Bulk operations ───────────────────────────────────────────────────────────

/**
 * Save an array of new questions (e.g. from PDF import after admin review).
 * Each question must have a type assigned by the admin before calling this.
 * Returns { saved, skipped } counts.
 */
function bulkSave(incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw Object.assign(new Error("No questions provided"), { status: 400 });
  }

  const questions = storage.read("questions.json");
  const existingIds = new Set(questions.map((q) => String(q.id)));

  let saved = 0, skipped = 0;

  for (const raw of incoming) {
    try {
      const q = buildQuestion(raw);
      if (existingIds.has(String(q.id))) { skipped++; continue; }
      questions.push(q);
      existingIds.add(String(q.id));
      saved++;
    } catch (_) {
      skipped++;
    }
  }

  storage.write("questions.json", questions);
  return { saved, skipped };
}

/**
 * Change the type and marks of multiple questions at once.
 * `updates` is an array of { id, type?, marks? }.
 */
function bulkUpdate(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw Object.assign(new Error("No updates provided"), { status: 400 });
  }

  const questions = storage.read("questions.json");
  let changed = 0;

  for (const { id, type, marks, class: cls, subject } of updates) {
    const q = questions.find((x) => String(x.id) === String(id));
    if (!q) continue;
    if (cls     !== undefined) q.class   = cls;
    if (subject !== undefined) q.subject = subject;
    if (type    !== undefined) q.type    = type;
    if (marks   !== undefined) q.marks   = Number(marks) || q.marks;
    changed++;
}

  storage.write("questions.json", questions);
  return { changed };
}

/**
 * Delete multiple questions by ID array.
 */
function bulkDelete(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw Object.assign(new Error("No IDs provided"), { status: 400 });
  }

  const idSet     = new Set(ids.map(String));
  const questions = storage.read("questions.json");
  const updated   = questions.filter((q) => !idSet.has(String(q.id)));
  const deleted   = questions.length - updated.length;

  storage.write("questions.json", updated);
  return { deleted };
}

module.exports = {
  getAll,
  add,
  update,
  remove,
  bulkSave,
  bulkUpdate,
  bulkDelete,
};