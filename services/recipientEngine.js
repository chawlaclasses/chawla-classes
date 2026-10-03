/**
 * services/recipientEngine.js
 *
 * Recipient Selection Engine for Marketing Campaigns.
 *
 * This is deliberately CHANNEL-AGNOSTIC: it only knows how to build a
 * directory of people (students, parents, teachers, enquiries) from the
 * existing jsonDb collections and how to narrow it down by group / class /
 * status / search. Turning a recipient into an SMS number, a WhatsApp number
 * or an email address is the job of services/campaignChannels.js, so SMS,
 * WhatsApp, Email (and later Push) all share this one selection engine.
 *
 * Data sources (read-only — nothing here writes to the database):
 *   users (role: student)  -> student + parent rows
 *   users (role: teacher)  -> teacher rows
 *   enquiries              -> enquiry rows
 *   fees-v2 (Pending)      -> "Fee Due" flag on students
 *   classes                -> class names / streams
 *
 * Every row has a stable `key` ("student:<id>", "parent:<id>",
 * "teacher:<id>", "enquiry:<id>") so the admin UI can keep a selection as a
 * small set of keys and the server can re-resolve it at send time.
 */

"use strict";

const db = require("./jsonDb");

// ------------------------------------------------------------------
// Groups (the "Select Recipients" checkboxes)
// ------------------------------------------------------------------
const GROUPS = [
  { id: "all_students", label: "All Students" },
  { id: "active_students", label: "Active Students Only" },
  { id: "fee_due", label: "Fee Due Students" },
  { id: "new_enquiries", label: "New Enquiries" },
  { id: "parents", label: "Parents Only" },
  { id: "teachers", label: "Teachers Only" },
  // "custom" = the whole directory is available to hand-pick from; it never
  // auto-selects anyone.
  { id: "custom", label: "Custom Selection" },
];
const GROUP_IDS = GROUPS.map(g => g.id);
const AUTO_GROUP_IDS = GROUP_IDS.filter(g => g !== "custom");

// Class filters the institute asked for. They are always offered, even if
// the matching class record doesn't exist yet. Real classes from the
// 'classes' collection are added on top (see getClassOptions).
const DEFAULT_CLASS_OPTIONS = [
  { label: "Class 9" },
  { label: "Class 10" },
  { label: "Class 11 Commerce" },
  { label: "Class 12 Commerce" },
];

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------
const idOf = d => String(d._id || d.id);

function clean(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * "Class 11 Commerce" | "11th commerce" | "Class 11" + stream -> "11commerce"
 * Lets a class record, a student's stream and a free-text enquiry
 * ("interestedClass") all be matched against the same filter key.
 */
function normalizeClassKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(\d+)\s*(st|nd|rd|th)\b/g, "$1")
    .replace(/\b(class|std|standard|grade)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function classLabelOf(cls, stream) {
  const base = clean(cls && (cls.displayName || cls.name));
  if (!base) return "";
  return stream ? `${base} ${stream}` : base;
}

function statusLabel(s) {
  const v = clean(String(s || ""));
  return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : "New";
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

// ------------------------------------------------------------------
// Class options (for the filter chips / dropdown)
// ------------------------------------------------------------------
function getClassOptions() {
  const out = new Map(); // key -> { key, label }

  for (const cls of db.find("classes", {})) {
    if (cls.isActive === false) continue;
    const streams = Array.isArray(cls.streams) && cls.streams.length ? cls.streams : [""];
    for (const stream of streams) {
      const label = classLabelOf(cls, stream);
      const key = normalizeClassKey(label);
      if (key && !out.has(key)) out.set(key, { key, label });
    }
  }
  for (const d of DEFAULT_CLASS_OPTIONS) {
    const key = normalizeClassKey(d.label);
    if (!out.has(key)) out.set(key, { key, label: d.label });
  }

  // Natural order: 9, 10, 11 Commerce, 12 Commerce ...
  return Array.from(out.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
  );
}

// ------------------------------------------------------------------
// Directory — every person we could message, with group membership
// ------------------------------------------------------------------
function getDirectory() {
  const classes = db.find("classes", {});
  const classById = new Map(classes.map(c => [idOf(c), c]));
  const feeDueIds = new Set(db.find("fees-v2", { status: "Pending" }).map(f => String(f.studentId)));

  const rows = [];

  // ---- Students (+ their parents) ----
  for (const u of db.find("users", { role: "student" })) {
    const id = idOf(u);
    const isActive = u.isActive !== false;
    const cls = u.classId ? classById.get(String(u.classId)) : null;
    const stream = clean(u.stream);
    const classLabel = classLabelOf(cls, stream);
    const classKeys = classLabel ? [normalizeClassKey(classLabel)] : [];
    const feeDue = isActive && feeDueIds.has(id);
    const phone = clean(u.phone || u.contactPhone);
    const parentPhone = clean(u.parentPhone);

    const groups = ["all_students", "custom"];
    if (isActive) groups.push("active_students");
    if (feeDue) groups.push("fee_due");

    rows.push({
      key: `student:${id}`,
      kind: "student",
      name: clean(u.name) || "Student",
      studentName: clean(u.name) || "Student",
      phone,
      parentPhone,
      email: clean(u.email),
      className: classLabel,
      classKeys,
      status: isActive ? "Active" : "Inactive",
      feeDue,
      groups,
    });

    // Parent row — only when we actually know something about the parent.
    // Parents of inactive students are not offered under "Parents Only".
    if (parentPhone || clean(u.parentName)) {
      rows.push({
        key: `parent:${id}`,
        kind: "parent",
        name: clean(u.parentName) || `Parent of ${clean(u.name) || "Student"}`,
        studentName: clean(u.name) || "Student",
        phone: parentPhone, // a parent row's own number IS the parent number
        parentPhone,
        email: clean(u.parentEmail),
        className: classLabel,
        classKeys,
        status: isActive ? "Active" : "Inactive",
        feeDue,
        groups: isActive ? ["parents", "custom"] : ["custom"],
      });
    }
  }

  // ---- Teachers (staff with role 'teacher') ----
  for (const t of db.find("users", { role: "teacher" })) {
    const id = idOf(t);
    const isActive = t.isActive !== false;
    const assigned = Array.isArray(t.assignedClasses) ? t.assignedClasses : [];
    const labels = assigned
      .map(cid => classById.get(String(cid)))
      .filter(Boolean)
      .map(c => classLabelOf(c, ""));
    rows.push({
      key: `teacher:${id}`,
      kind: "teacher",
      name: clean(t.name) || "Teacher",
      studentName: "",
      phone: clean(t.phone),
      parentPhone: "",
      email: clean(t.email),
      className: labels.join(", "),
      // A teacher is assigned to a whole class, not a stream — so they match
      // "Class 11" AND every stream that class offers ("Class 11 Commerce").
      classKeys: uniq(assigned.flatMap(cid => {
        const c = classById.get(String(cid));
        if (!c) return [];
        const streams = Array.isArray(c.streams) ? c.streams : [];
        return [classLabelOf(c, ""), ...streams.map(st => classLabelOf(c, st))].map(normalizeClassKey);
      }).filter(Boolean)),
      status: isActive ? "Active" : "Inactive",
      feeDue: false,
      groups: isActive ? ["teachers", "custom"] : ["custom"],
    });
  }

  // ---- Enquiries (leads) ----
  for (const e of db.find("enquiries", {})) {
    const id = idOf(e);
    const status = statusLabel(e.status);
    const interested = clean(e.interestedClass);
    rows.push({
      key: `enquiry:${id}`,
      kind: "enquiry",
      name: clean(e.name || e.studentName) || "Enquiry",
      studentName: clean(e.name || e.studentName),
      phone: clean(e.phone),
      parentPhone: "",
      email: clean(e.email),
      className: interested,
      classKeys: interested ? [normalizeClassKey(interested)] : [],
      status,
      feeDue: false,
      groups: status === "New" ? ["new_enquiries", "custom"] : ["custom"],
    });
  }

  return rows;
}

// ------------------------------------------------------------------
// Filtering
// ------------------------------------------------------------------
function parseList(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

function matchesClassKeys(row, classKeys) {
  if (!classKeys.length) return true;
  return row.classKeys.some(k => classKeys.includes(k));
}

/** Rows that belong to ANY of the given groups and any of the given classes. */
function filterPool(directory, { groups, classKeys }) {
  const g = parseList(groups).filter(x => GROUP_IDS.includes(x));
  const ck = parseList(classKeys);
  if (!g.length) return [];
  return directory.filter(r => r.groups.some(x => g.includes(x)) && matchesClassKeys(r, ck));
}

/** Table-level filters on top of the pool: search / status / class dropdown. */
function applyTableFilters(rows, { search, status, classFilter }) {
  let out = rows;
  const q = clean(search).toLowerCase();
  if (q) {
    // Match the number only when the query LOOKS like a number ("98765",
    // "+91 98765"). A mixed query like "Student 7" is a name search — treating
    // its "7" as a phone fragment would match every number containing a 7.
    const looksNumeric = /^[\d\s+\-()]+$/.test(q);
    const digits = looksNumeric ? q.replace(/\D/g, "") : "";
    out = out.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (digits && (r.phone.replace(/\D/g, "").includes(digits) || r.parentPhone.replace(/\D/g, "").includes(digits)))
    );
  }
  const st = clean(status);
  if (st) {
    out = st.toLowerCase() === "fee due" ? out.filter(r => r.feeDue) : out.filter(r => r.status.toLowerCase() === st.toLowerCase());
  }
  const cf = clean(classFilter);
  if (cf) out = out.filter(r => r.classKeys.includes(cf));
  return out;
}

function toPublic(r) {
  return {
    key: r.key,
    kind: r.kind,
    name: r.name,
    phone: r.phone,
    parentPhone: r.parentPhone,
    className: r.className,
    status: r.status,
    feeDue: r.feeDue,
  };
}

// ------------------------------------------------------------------
// Public API used by the routes
// ------------------------------------------------------------------

/** Groups (with live counts), class options and status options for the UI. */
function getMeta() {
  const directory = getDirectory();
  const groups = GROUPS.map(g => ({
    ...g,
    count: directory.filter(r => r.groups.includes(g.id)).length,
  }));
  const statuses = uniq(directory.map(r => r.status));
  if (directory.some(r => r.feeDue)) statuses.push("Fee Due");
  return { groups, classes: getClassOptions(), statuses: uniq(statuses).sort() };
}

/**
 * One page of the recipient table + the keys of EVERYTHING matching the
 * current filters (so "Select All" can cover rows on other pages).
 */
function listRecipients({ groups, classKeys, search, status, classFilter, page = 1, limit = 25 }) {
  const directory = getDirectory();
  const pool = filterPool(directory, { groups, classKeys });
  const matching = applyTableFilters(pool, { search, status, classFilter });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const pages = Math.max(Math.ceil(matching.length / lim), 1);
  const pg = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);

  return {
    rows: matching.slice((pg - 1) * lim, pg * lim).map(toPublic),
    total: matching.length,
    page: pg,
    pages,
    limit: lim,
    matchingKeys: matching.map(r => r.key),
  };
}

/**
 * Keys of the whole pool, and the subset that is AUTO-selected (all groups
 * except "Custom Selection", which only makes people available).
 */
function getPool({ groups, classKeys }) {
  const directory = getDirectory();
  const g = parseList(groups).filter(x => GROUP_IDS.includes(x));
  const pool = filterPool(directory, { groups: g, classKeys });
  const autoGroups = g.filter(x => x !== "custom");
  const auto = autoGroups.length ? filterPool(directory, { groups: autoGroups, classKeys }) : [];
  return { poolKeys: pool.map(r => r.key), autoKeys: auto.map(r => r.key) };
}

/**
 * Turns the UI's compact selection into the actual recipient rows:
 *
 *   selection = {
 *     groups:    ["fee_due", "custom", ...],
 *     classKeys: ["10", "11commerce", ...],
 *     included:  [keys ticked by hand],
 *     excluded:  [keys un-ticked from an auto-selected group]
 *   }
 *
 *   effective = (autoKeys - excluded)  U  (included ∩ pool)
 *
 * The browser computes the same formula for its live counter; the server's
 * result is the one that is actually sent to.
 */
function resolveSelection(selection) {
  const sel = selection && typeof selection === "object" ? selection : {};
  const directory = getDirectory();
  const g = parseList(sel.groups).filter(x => GROUP_IDS.includes(x));
  const pool = filterPool(directory, { groups: g, classKeys: sel.classKeys });
  const poolByKey = new Map(pool.map(r => [r.key, r]));

  const autoGroups = g.filter(x => x !== "custom");
  const auto = autoGroups.length ? filterPool(directory, { groups: autoGroups, classKeys: sel.classKeys }) : [];

  const excluded = new Set(parseList(sel.excluded));
  const chosen = new Map();
  for (const r of auto) if (!excluded.has(r.key)) chosen.set(r.key, r);
  for (const k of parseList(sel.included)) {
    const r = poolByKey.get(k);
    if (r) chosen.set(k, r);
  }
  return Array.from(chosen.values());
}

module.exports = {
  GROUPS,
  GROUP_IDS,
  AUTO_GROUP_IDS,
  normalizeClassKey,
  getClassOptions,
  getDirectory,
  filterPool,
  applyTableFilters,
  getMeta,
  listRecipients,
  getPool,
  resolveSelection,
};
