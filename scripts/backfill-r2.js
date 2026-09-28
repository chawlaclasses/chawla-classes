/**
 * scripts/backfill-r2.js
 *
 * ONE-TIME migration helper. Finds every existing Mongo record in the
 * five R2-backed collections that still has a local `filename` but no
 * `key` (i.e. was uploaded before the R2 migration), uploads that local
 * file to R2, and writes the `key` (and `url`, for public categories)
 * back onto the record.
 *
 * Safe to run multiple times — records that already have a `key` are
 * skipped. Does NOT delete the local files (so the app's built-in
 * legacy-fallback code paths keep working even if you run this against
 * only some records, or if a local file is missing for some reason).
 *
 * Usage:
 *   node scripts/backfill-r2.js                 # dry run — reports what it would do
 *   node scripts/backfill-r2.js --apply          # actually uploads + updates Mongo
 *
 * Requires the same env vars as the app (MONGODB_URI, R2_* vars) — run it
 * with your local .env loaded, or `export $(cat .env | xargs)` first.
 */

"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const {
  NOTES_DIR, HOMEWORK_DIR, HOMEWORK_SUBMISSIONS_DIR, DOUBTS_DIR, FACULTY_APPLICATIONS_DIR, IMAGES_DIR,
} = require("../config");
const r2Service = require("../services/r2Service");

const APPLY = process.argv.includes("--apply");

// { collection, localDir, filenameField, keyField, urlField|null, isArray }
const JOBS = [
  { collection: "student-documents", localDir: path.join(NOTES_DIR, "..", "student-documents"), filenameField: "filename", keyField: "key", urlField: null, folder: "student-documents" },
  { collection: "homework", localDir: HOMEWORK_DIR, filenameField: "attachmentFilename", keyField: "attachmentKey", urlField: "attachmentUrl", folder: "homework-attachments", optional: true },
  { collection: "homeworkSubmissions", localDir: HOMEWORK_SUBMISSIONS_DIR, filenameField: "filename", keyField: "key", urlField: null, folder: "homework-submissions" },
];

async function backfillSimpleField(db, job) {
  const coll = db.collection(job.collection);
  const query = job.optional
    ? { [job.filenameField]: { $exists: true, $ne: null }, [job.keyField]: { $in: [null, undefined] } }
    : { [job.keyField]: { $in: [null, undefined] } };
  const cursor = coll.find(query);
  let count = 0, missing = 0;

  for await (const doc of cursor) {
    const filename = doc[job.filenameField];
    if (!filename) continue;
    const localPath = path.join(job.localDir, filename);
    if (!fs.existsSync(localPath)) {
      console.warn(`  ⚠️  ${job.collection}/${doc._id}: local file missing (${localPath}) — skipped`);
      missing++;
      continue;
    }
    count++;
    if (!APPLY) {
      console.log(`  [dry-run] would upload ${localPath} -> ${job.folder}/`);
      continue;
    }
    const buffer = fs.readFileSync(localPath);
    const key = r2Service.generateKey(job.folder, filename);
    const { url } = await r2Service.uploadBuffer({ buffer, key, contentType: guessContentType(filename) });
    const update = { [job.keyField]: key };
    if (job.urlField) update[job.urlField] = url;
    await coll.updateOne({ _id: doc._id }, { $set: update });
    console.log(`  ✅ ${job.collection}/${doc._id} -> ${key}`);
  }
  console.log(`${job.collection}: ${count} migrated, ${missing} missing local file\n`);
}

// Doubts and faculty applications have multiple file fields per record,
// handled separately from the simple single-field jobs above.
async function backfillDoubts(db) {
  const coll = db.collection("doubts");
  const cursor = coll.find({ $or: [
    { imageFilename: { $exists: true, $ne: null }, imageKey: { $in: [null, undefined] } },
    { voiceNoteFilename: { $exists: true, $ne: null }, voiceNoteKey: { $in: [null, undefined] } },
  ] });
  let count = 0;
  for await (const doc of cursor) {
    const update = {};
    if (doc.imageFilename && !doc.imageKey) {
      const localPath = path.join(DOUBTS_DIR, doc.imageFilename);
      if (fs.existsSync(localPath)) {
        if (APPLY) {
          const key = r2Service.generateKey("doubts/images", doc.imageFilename);
          await r2Service.uploadBuffer({ buffer: fs.readFileSync(localPath), key, contentType: guessContentType(doc.imageFilename) });
          update.imageKey = key;
        }
        count++;
      }
    }
    if (doc.voiceNoteFilename && !doc.voiceNoteKey) {
      const localPath = path.join(DOUBTS_DIR, doc.voiceNoteFilename);
      if (fs.existsSync(localPath)) {
        if (APPLY) {
          const key = r2Service.generateKey("doubts/voice-notes", doc.voiceNoteFilename);
          await r2Service.uploadBuffer({ buffer: fs.readFileSync(localPath), key, contentType: guessContentType(doc.voiceNoteFilename) });
          update.voiceNoteKey = key;
        }
        count++;
      }
    }
    if (APPLY && Object.keys(update).length) {
      await coll.updateOne({ _id: doc._id }, { $set: update });
      console.log(`  ✅ doubts/${doc._id} -> ${Object.values(update).join(", ")}`);
    }
  }
  console.log(`doubts: ${count} files ${APPLY ? "migrated" : "found (dry-run)"}\n`);
}

async function backfillFacultyApplications(db) {
  const coll = db.collection("facultyApplications");
  const cursor = coll.find({});
  let count = 0;
  for await (const doc of cursor) {
    const update = {};
    for (const field of ["resume", "photo", "demoVideo"]) {
      const file = doc[field];
      if (file && file.filename && !file.key) {
        const localPath = path.join(FACULTY_APPLICATIONS_DIR, file.filename);
        if (fs.existsSync(localPath)) {
          count++;
          if (APPLY) {
            const key = r2Service.generateKey(`faculty-applications/${field === "resume" ? "resumes" : field === "photo" ? "photos" : "demo-videos"}`, file.filename);
            await r2Service.uploadBuffer({ buffer: fs.readFileSync(localPath), key, contentType: guessContentType(file.filename) });
            update[field] = { ...file, key };
          }
        }
      }
    }
    if (Array.isArray(doc.certificates)) {
      const newCerts = [];
      let changed = false;
      for (const cert of doc.certificates) {
        if (cert && cert.filename && !cert.key) {
          const localPath = path.join(FACULTY_APPLICATIONS_DIR, cert.filename);
          if (fs.existsSync(localPath)) {
            count++;
            changed = true;
            if (APPLY) {
              const key = r2Service.generateKey("faculty-applications/certificates", cert.filename);
              await r2Service.uploadBuffer({ buffer: fs.readFileSync(localPath), key, contentType: guessContentType(cert.filename) });
              newCerts.push({ ...cert, key });
              continue;
            }
          }
        }
        newCerts.push(cert);
      }
      if (APPLY && changed) update.certificates = newCerts;
    }
    if (APPLY && Object.keys(update).length) {
      await coll.updateOne({ _id: doc._id }, { $set: update });
      console.log(`  ✅ facultyApplications/${doc._id} updated`);
    }
  }
  console.log(`facultyApplications: ${count} files ${APPLY ? "migrated" : "found (dry-run)"}\n`);
}

async function backfillBranding(db) {
  // Settings is a single-document collection — just check the current logo/favicon.
  const coll = db.collection("settings");
  const doc = await coll.findOne({});
  if (!doc) return;
  const update = {};
  if (doc.logoUrl && doc.logoUrl.startsWith("/images/") && !doc.logoKey) {
    const filename = doc.logoUrl.replace("/images/", "");
    const localPath = path.join(IMAGES_DIR, filename);
    if (fs.existsSync(localPath)) {
      console.log(`  found local logo: ${filename}`);
      if (APPLY) {
        const key = r2Service.generateKey("branding", filename);
        const { url } = await r2Service.uploadBuffer({ buffer: fs.readFileSync(localPath), key, contentType: guessContentType(filename) });
        update.logoKey = key;
        update.logoUrl = url;
      }
    }
  }
  if (doc.faviconUrl && doc.faviconUrl.startsWith("/images/") && !doc.faviconKey) {
    const filename = doc.faviconUrl.replace("/images/", "");
    const localPath = path.join(IMAGES_DIR, filename);
    if (fs.existsSync(localPath)) {
      console.log(`  found local favicon: ${filename}`);
      if (APPLY) {
        const key = r2Service.generateKey("branding", filename);
        const { url } = await r2Service.uploadBuffer({ buffer: fs.readFileSync(localPath), key, contentType: guessContentType(filename) });
        update.faviconKey = key;
        update.faviconUrl = url;
      }
    }
  }
  if (APPLY && Object.keys(update).length) {
    await coll.updateOne({ _id: doc._id }, { $set: update });
    console.log("  ✅ settings/branding updated");
  }
}

function guessContentType(filename) {
  const map = {
    ".pdf": "application/pdf", ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webm": "audio/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  };
  return map[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

async function main() {
  console.log(APPLY ? "Running backfill (APPLY mode — Mongo will be updated)\n" : "Running backfill in DRY-RUN mode (pass --apply to actually migrate)\n");

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  for (const job of JOBS) {
    console.log(`--- ${job.collection} ---`);
    await backfillSimpleField(db, job);
  }
  console.log("--- doubts ---");
  await backfillDoubts(db);
  console.log("--- facultyApplications ---");
  await backfillFacultyApplications(db);
  console.log("--- settings (branding) ---");
  await backfillBranding(db);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
