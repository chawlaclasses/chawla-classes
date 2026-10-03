/**
 * services/marketingSelection.js
 *
 * Custom Recipient Selection for Marketing Campaigns (Quick Send →
 * "Custom Recipient Selection").
 *
 * Why this exists
 * ---------------
 * A hand-picked audience can't be described by a single string like the
 * other target types ("students", "enquiries", ...), and it must NEVER be
 * accepted as raw contact details from the browser — otherwise anyone able
 * to call the API could make the server message arbitrary numbers. So the
 * browser only ever sends *references* ({ source, id }); this module turns
 * them back into real contacts by looking them up in the database.
 *
 *   browser  ->  [{ source: "students", id: "<uuid>" }, ...]
 *   server   ->  looks every id up, drops anything unknown/inactive,
 *                de-duplicates by phone/email, reports what it skipped.
 *
 * Read-only: nothing here writes to the database.
 *
 * Used by routes/admin/marketing-campaigns.js:
 *   GET  /targets/recipients  -> getDirectory() / countsBySource()
 *   GET|POST /targets/preview -> resolveSelection()
 *   POST /send                -> resolveSelection()
 */

"use strict";

const db = require("./jsonDb");

// Keep in step with campaignEngine.MAX_RECIPIENTS_PER_SEND — a send runs
// inside a single HTTP request, so the audience size is capped.
const MAX_SELECTED = 1000;

// A real id is a UUID from jsonDb.generateId(); this is a deliberately
// looser sanity bound (no whitespace/colons, bounded length) so a hostile
// payload can't push huge strings through the lookup.
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// ------------------------------------------------------------------
// Sources — the three selectable groups
// ------------------------------------------------------------------
function clean(v) {
  return typeof v === "string" ? v.trim() : "";
}

function statusLabel(s) {
  const v = clean(typeof s === "string" ? s : "");
  return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : "New";
}

// Each source knows which collection it lives in, which rows are eligible
// (same rules as the existing "All Active Students" / "Website Enquiries" /
// "Admission Form Leads" targets), and how to read name/phone/email.
const SOURCES = {
  students: {
    label: "Student",
    rows: () => db.find("users", { role: "student" }).filter(s => s.isActive !== false),
    name: s => clean(s.name),
    phone: s => clean(s.phone) || clean(s.contactPhone),
    email: s => clean(s.email),
    status: () => "Active",
  },
  enquiries: {
    label: "Enquiry",
    rows: () => db.find("enquiries", {}),
    name: e => clean(e.name) || clean(e.studentName),
    phone: e => clean(e.phone),
    email: e => clean(e.email),
    status: e => statusLabel(e.status),
  },
  admissions: {
    label: "Admission",
    rows: () => db.find("admissions", {}),
    name: a => clean(a.studentName) || clean(a.name),
    phone: a => clean(a.phone),
    email: a => clean(a.email),
    status: a => statusLabel(a.status),
  },
};
const SOURCE_IDS = Object.keys(SOURCES);

const isSource = s => typeof s === "string" && Object.prototype.hasOwnProperty.call(SOURCES, s);
const makeKey = (source, id) => `${source}:${id}`;

// ------------------------------------------------------------------
// Directory (what the picker table shows)
// ------------------------------------------------------------------
function toRow(source, doc) {
  const def = SOURCES[source];
  const id = String(doc._id !== undefined ? doc._id : doc.id);
  return {
    key: makeKey(source, id),
    source,
    sourceLabel: def.label,
    id,
    name: def.name(doc) || def.label,
    phone: def.phone(doc),
    email: def.email(doc),
    status: def.status(doc),
  };
}

/** Every selectable person, grouped by source (students, enquiries, admissions). */
function getDirectory() {
  const rows = [];
  for (const source of SOURCE_IDS) {
    for (const doc of SOURCES[source].rows()) {
      if (doc && (doc._id !== undefined || doc.id !== undefined)) rows.push(toRow(source, doc));
    }
  }
  return rows;
}

function countsBySource(rows) {
  const counts = {};
  for (const s of SOURCE_IDS) counts[s] = 0;
  for (const r of rows) counts[r.source] += 1;
  return counts;
}

// ------------------------------------------------------------------
// Parsing the incoming selection
// ------------------------------------------------------------------
/**
 * Accepts the canonical payload plus two forgiving shapes:
 *
 *   { recipients: [{ source: "students", id: "<uuid>" }, ...] }   <- canonical (POST body)
 *   [ { source, id }, "students:<uuid>", ... ]                    <- bare array
 *   "students:<uuid>,enquiries:<uuid>"                            <- GET query string
 *
 * Returns { shapeOk, entries, malformed } — `entries` are de-duplicated
 * { source, id, key } objects; `malformed` counts items that were skipped
 * because they weren't a recognisable { source, id } reference.
 */
function parseSelection(raw) {
  let list;
  if (raw === undefined || raw === null || raw === "") return { shapeOk: true, entries: [], malformed: 0, total: 0 };

  if (typeof raw === "string") list = raw.split(",").map(s => s.trim()).filter(Boolean);
  else if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "object" && Array.isArray(raw.recipients)) list = raw.recipients;
  else if (typeof raw === "object" && (raw.recipients === undefined || raw.recipients === null)) return { shapeOk: true, entries: [], malformed: 0, total: 0 };
  else return { shapeOk: false, entries: [], malformed: 0, total: 0 };

  const seen = new Set();
  const entries = [];
  let malformed = 0;

  for (const item of list) {
    let source;
    let id;
    if (typeof item === "string") {
      const i = item.indexOf(":");
      source = i > 0 ? item.slice(0, i) : "";
      id = i > 0 ? item.slice(i + 1) : "";
    } else if (item && typeof item === "object") {
      source = item.source;
      id = item.id;
    }
    if (!isSource(source) || typeof id !== "string" || !ID_PATTERN.test(id)) {
      malformed += 1;
      continue;
    }
    const key = makeKey(source, id);
    if (seen.has(key)) continue; // same row ticked twice — not an error
    seen.add(key);
    entries.push({ source, id, key });
  }
  return { shapeOk: true, entries, malformed, total: list.length };
}

// ------------------------------------------------------------------
// Resolving to real contacts (the safe part)
// ------------------------------------------------------------------
const digits = v => String(v || "").replace(/\D/g, "");

// Same person reached by two rows (an enquiry that became a student, a
// parent's number shared by siblings) must get ONE message. Phones are
// compared on their last 10 digits so "+91 98765 43210" == "9876543210".
function dedupeKey(c) {
  const d = digits(c.phone);
  if (d.length >= 10) return `p:${d.slice(-10)}`;
  if (c.phone) return `p:${c.phone.toLowerCase()}`;
  if (c.email) return `e:${c.email.toLowerCase()}`;
  return "";
}

const fail = (code, message, summary = {}) => ({ ok: false, code, message, contacts: [], summary });

/**
 * Turns whatever the client sent into the contacts a campaign may be sent to.
 * Never throws and never trusts client-supplied contact details.
 *
 * Returns either
 *   { ok: true,  contacts, summary }
 *   { ok: false, code, message, summary }     // `message` is user-friendly
 *
 * contacts: [{ name, phone, email, source, sourceLabel }]
 * summary:  { requested, matched, missing, malformed, duplicates, unreachable,
 *             bySource, reach: { phone, email } }
 */
function resolveSelection(raw, { max = MAX_SELECTED } = {}) {
  const parsed = parseSelection(raw);

  if (!parsed.shapeOk) {
    return fail("INVALID_SELECTION", "The recipient selection wasn't in a valid format. Please reload the page and select recipients again.");
  }
  if (parsed.entries.length === 0) {
    // Either nothing was ticked, or everything sent was unrecognisable.
    return parsed.malformed > 0
      ? fail("INVALID_SELECTION", "The recipient selection wasn't in a valid format. Please reload the page and select recipients again.")
      : fail("NO_RECIPIENTS_SELECTED", "Please select at least one recipient.");
  }
  if (parsed.entries.length > max) {
    return fail(
      "TOO_MANY_RECIPIENTS",
      `You selected ${parsed.entries.length} recipients, but a campaign can reach at most ${max}. Please unselect ${parsed.entries.length - max} or send in batches.`,
      { requested: parsed.entries.length }
    );
  }

  // Look every reference up in the database — one pass per source.
  const lookup = new Map(); // key -> row
  const wanted = new Set(parsed.entries.map(e => e.source));
  for (const source of wanted) {
    for (const doc of SOURCES[source].rows()) {
      if (doc && (doc._id !== undefined || doc.id !== undefined)) {
        const row = toRow(source, doc);
        lookup.set(row.key, row);
      }
    }
  }

  const matched = [];
  let missing = 0;
  for (const e of parsed.entries) {
    const row = lookup.get(e.key);
    if (row) matched.push(row);
    else missing += 1; // deleted, deactivated, or never existed
  }

  const summary = {
    requested: parsed.entries.length,
    matched: matched.length,
    missing,
    malformed: parsed.malformed,
    duplicates: 0,
    unreachable: 0,
    bySource: countsBySource([]),
    reach: { phone: 0, email: 0 },
  };

  if (matched.length === 0) {
    return fail(
      "RECIPIENTS_NOT_FOUND",
      "None of the selected recipients could be found — they may have been deleted or deactivated. Please refresh the list and select again.",
      summary
    );
  }

  const seen = new Set();
  const contacts = [];
  for (const r of matched) {
    const key = dedupeKey(r);
    if (!key) { summary.unreachable += 1; continue; } // no phone and no email
    if (seen.has(key)) { summary.duplicates += 1; continue; }
    seen.add(key);
    contacts.push({ name: r.name, phone: r.phone, email: r.email, source: r.source, sourceLabel: r.sourceLabel });
    summary.bySource[r.source] += 1;
    if (r.phone) summary.reach.phone += 1;
    if (r.email) summary.reach.email += 1;
  }

  if (contacts.length === 0) {
    return fail("NO_CONTACT_DETAILS", "The selected recipients have no phone number or email address, so there is nobody to send to.", summary);
  }

  return { ok: true, contacts, summary };
}

/** "12 selected: 5 students, 4 enquiries, 3 admissions" — stored in campaign history. */
function describeSummary(summary) {
  const parts = SOURCE_IDS.filter(s => summary.bySource[s] > 0).map(s => `${summary.bySource[s]} ${s}`);
  const total = SOURCE_IDS.reduce((n, s) => n + summary.bySource[s], 0);
  return `${total} selected: ${parts.join(", ")}`;
}

module.exports = {
  MAX_SELECTED,
  SOURCE_IDS,
  getDirectory,
  countsBySource,
  parseSelection,
  resolveSelection,
  describeSummary,
};
