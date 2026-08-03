/**
 * middleware/upload.js
 *
 * Multer storage and filter configurations.
 *
 * Exports two configured multer instances:
 *   uploadNote — for study-material uploads (notes/)
 *   uploadPdf  — for PDF question-bank imports (uploads/)
 *
 * Security layers applied:
 *   1. Extension whitelist (fast reject)
 *   2. Filename sanitisation (path traversal prevention)
 *   3. Magic-byte MIME validation post-upload via validateFileContent()
 */

"use strict";

const path   = require("path");
const fsp    = require("fs/promises");
const multer = require("multer");
const sharp  = require("sharp");
const { NOTES_DIR, UPLOADS_DIR, MAX_FILE_SIZE, MAX_PDF_SIZE, HOMEWORK_DIR, HOMEWORK_SUBMISSIONS_DIR, DOUBTS_DIR, FACULTY_APPLICATIONS_DIR } = require("../config");
const { validateFileContent, cleanupFile } = require("../utils/helpers");
const logger = require("../utils/logger");

// ── Allowed extensions ────────────────────────────────────────────────────────

const ALLOWED_NOTE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx", ".txt", ".png", ".jpg", ".jpeg",
]);

const ALLOWED_NOTE_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/png",
  "image/jpeg",
];

// Homework attachments/submissions are intentionally narrower than notes —
// just PDF or a photo of handwritten work, per how the module is used.
const ALLOWED_HOMEWORK_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg"]);
const ALLOWED_HOMEWORK_MIMES = ["application/pdf", "image/png", "image/jpeg"];

// Doubt attachments — a photo of the question, and/or a short voice note
// recorded in the browser (typically .webm from MediaRecorder, but a few
// other common audio types are allowed too in case a file is picked instead).
const ALLOWED_DOUBT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const ALLOWED_DOUBT_IMAGE_MIMES = ["image/png", "image/jpeg"];
const ALLOWED_DOUBT_VOICE_EXTENSIONS = new Set([".webm", ".mp3", ".wav", ".m4a", ".ogg"]);
const ALLOWED_DOUBT_VOICE_MIMES = ["audio/webm", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/ogg", "video/webm"];

// Faculty (teacher) job application — resume/certificates are documents,
// photo is an image, demo video (optional) is a short teaching clip.
const ALLOWED_RESUME_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const ALLOWED_RESUME_MIMES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const ALLOWED_CERTIFICATE_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg"]);
const ALLOWED_CERTIFICATE_MIMES = ["application/pdf", "image/png", "image/jpeg"];
const ALLOWED_PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const ALLOWED_PHOTO_MIMES = ["image/png", "image/jpeg"];
const ALLOWED_DEMO_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
const ALLOWED_DEMO_VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_DEMO_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB — a short teaching clip, not a full lecture

// ── Storage factory ───────────────────────────────────────────────────────────

function diskStorage(destDir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename:    (_req, file, cb) => {
      // FIX: path.basename alone doesn't neutralise Windows-style paths on Linux
      //      (e.g. "..\..\etc\passwd" → basename gives "passwd" on Linux anyway,
      //      but path.win32.basename handles cross-platform attacks explicitly).
      //      After basename extraction, strip any remaining non-safe characters.
      const base = path.win32.basename(file.originalname); // strips Windows paths
      const safe = path.basename(base).replace(/[^a-zA-Z0-9._-]/g, "_");

      // Extra guard: if sanitisation produced an empty name, use a fallback
      const name = safe || "upload";
      cb(null, `${Date.now()}-${name}`);
    },
  });
}

// ── Image optimization ─────────────────────────────────────────────────────
// PERF: uploaded photos (student docs, homework photos, doubt photos) were
// stored and served at whatever resolution/quality the phone camera or
// scanner produced them at — often several MB, far larger than needed for
// on-screen viewing. `sharp` was already a package.json dependency but was
// never actually used anywhere. This resizes down to a sensible max
// dimension and re-encodes at good-enough quality, in place, keeping the
// exact same file path/name/format — so nothing downstream (DB records,
// download routes, <img> tags) needs to change; the same URL just now
// serves a smaller file. Runs AFTER mimeGuard's magic-byte validation, so
// only files already confirmed to be real images are touched, and it never
// runs on PDFs/docs/audio.
const OPTIMIZABLE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const MAX_IMAGE_DIMENSION = 1920; // px, long edge — plenty for full-screen viewing/printing

async function optimizeImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!OPTIMIZABLE_IMAGE_EXTENSIONS.has(ext)) return; // not an image we handle — leave untouched

  const tmpPath = `${filePath}.opt.tmp`;
  try {
    const pipeline = sharp(filePath)
      .rotate() // apply EXIF orientation before resizing, then strip it (avoids sideways photos)
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true, // never upscale a smaller image
      });

    if (ext === ".png") {
      pipeline.png({ compressionLevel: 9, quality: 85 });
    } else {
      pipeline.jpeg({ quality: 82, mozjpeg: true });
    }

    await pipeline.toFile(tmpPath);

    // Only keep the optimized version if it's actually smaller — a handful
    // of already-small/simple images can come out larger after re-encoding,
    // and "optimization" should never make a file bigger.
    const [origStat, newStat] = await Promise.all([fsp.stat(filePath), fsp.stat(tmpPath)]);
    if (newStat.size < origStat.size) {
      await fsp.rename(tmpPath, filePath);
    } else {
      await fsp.unlink(tmpPath);
    }
  } catch (error) {
    // Never fail the upload because optimization failed — the original,
    // already-validated file is still perfectly usable as-is.
    logger.warn(`⚠️ Image optimization skipped for ${filePath}: ${error.message}`);
    try { await fsp.unlink(tmpPath); } catch (_) { /* tmp file was never created — ignore */ }
  }
}

// ── MIME validation wrapper ───────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates uploaded file MIME type
 * via magic bytes AFTER multer has written it to disk.
 *
 * FIX: Extension-only checks can be bypassed by renaming files.
 *      Magic-byte validation (via validateFileContent from helpers) confirms
 *      the actual file content matches expected types.
 *
 * @param {string[]} allowedMimes
 */
function mimeGuard(allowedMimes) {
  return async (req, res, next) => {
    const file = req.file;
    if (!file) return next(); // no file uploaded — let route handle it

    const isValid = await validateFileContent(file.path, allowedMimes);
    if (!isValid) {
      cleanupFile(file.path); // delete the rejected file
      return res.status(400).json({
        success: false,
        message: "File content does not match its extension. Upload rejected.",
      });
    }

    await optimizeImageFile(file.path); // no-op for non-image files (PDFs, docs, etc.)
    next();
  };
}

// ── uploadNote ────────────────────────────────────────────────────────────────

const uploadNote = multer({
  storage: diskStorage(NOTES_DIR),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_NOTE_EXTENSIONS.has(ext)) {
      // Pass error object to reject with reason; multer surfaces this via
      // the error handler. Do NOT pass false as second arg when using Error.
      return cb(new Error(`Unsupported file type: ${ext}`));
    }
    cb(null, true);
  },
});

// ── ⭐ uploadPdf — Allow PDF and TXT files ──────────────────────────────────

const uploadPdf = multer({
  storage: diskStorage(UPLOADS_DIR),
  limits:  { fileSize: MAX_PDF_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // ⭐ Allow both .pdf and .txt files
    if (ext === ".pdf" || ext === ".txt") {
      return cb(null, true);
    }
    return cb(new Error("Only PDF and TXT files are allowed"));
  },
});

// ── uploadStudentDocument ──────────────────────────────────────────────────────
// FIX: student documents (ID proofs, certificates) must NOT live in NOTES_DIR
// or UPLOADS_DIR — both are mounted with express.static and served to anyone
// with the URL, no auth required. STUDENT_DOCS_DIR is a private directory
// that is never registered with express.static; files are only readable
// through an authenticated download route (see routes/adminRoutes.js).
const fs = require("fs");
const STUDENT_DOCS_DIR = path.join(NOTES_DIR, "..", "student-documents");
if (!fs.existsSync(STUDENT_DOCS_DIR)) {
  fs.mkdirSync(STUDENT_DOCS_DIR, { recursive: true });
}

const uploadStudentDocument = multer({
  storage: diskStorage(STUDENT_DOCS_DIR),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_NOTE_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported file type: ${ext}`));
    }
    cb(null, true);
  },
});

// ── uploadHomeworkAttachment — admin-attached homework material (public) ──────

if (!fs.existsSync(HOMEWORK_DIR)) {
  fs.mkdirSync(HOMEWORK_DIR, { recursive: true });
}

const uploadHomeworkAttachment = multer({
  storage: diskStorage(HOMEWORK_DIR),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_HOMEWORK_EXTENSIONS.has(ext)) {
      return cb(new Error(`Only PDF or image (PNG/JPG) files are allowed`));
    }
    cb(null, true);
  },
});

// ── uploadHomeworkSubmission — student-submitted answers (private) ────────────

if (!fs.existsSync(HOMEWORK_SUBMISSIONS_DIR)) {
  fs.mkdirSync(HOMEWORK_SUBMISSIONS_DIR, { recursive: true });
}

const uploadHomeworkSubmission = multer({
  storage: diskStorage(HOMEWORK_SUBMISSIONS_DIR),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_HOMEWORK_EXTENSIONS.has(ext)) {
      return cb(new Error(`Only PDF or image (PNG/JPG) files are allowed`));
    }
    cb(null, true);
  },
});

// ── uploadDoubtAttachment — student doubt image + voice note (private) ────────

if (!fs.existsSync(DOUBTS_DIR)) {
  fs.mkdirSync(DOUBTS_DIR, { recursive: true });
}

const uploadDoubtAttachment = multer({
  storage: diskStorage(DOUBTS_DIR),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "image") {
      if (!ALLOWED_DOUBT_IMAGE_EXTENSIONS.has(ext)) {
        return cb(new Error("Doubt image must be PNG or JPG"));
      }
    } else if (file.fieldname === "voiceNote") {
      if (!ALLOWED_DOUBT_VOICE_EXTENSIONS.has(ext)) {
        return cb(new Error("Voice note must be a WEBM, MP3, WAV, M4A or OGG audio file"));
      }
    } else {
      return cb(new Error(`Unexpected field: ${file.fieldname}`));
    }
    cb(null, true);
  },
});

// ── MIME guard middleware for each uploader ───────────────────────────────────

const notesMimeGuard = mimeGuard(ALLOWED_NOTE_MIMES);
// ⭐ Allow PDF and TXT MIME types
const pdfMimeGuard   = mimeGuard(["application/pdf", "text/plain"]);
const homeworkMimeGuard = mimeGuard(ALLOWED_HOMEWORK_MIMES);

// Doubts can arrive with an image, a voice note, both, or (rarely) neither if
// the request only carries text — mimeGuard() (above) only looks at
// req.file/a single upload, so this checks each field of req.files against
// its own allowed MIME list using the same magic-byte validateFileContent().
async function doubtMimeGuard(req, res, next) {
  const files = req.files || {};
  try {
    for (const file of files.image || []) {
      const ok = await validateFileContent(file.path, ALLOWED_DOUBT_IMAGE_MIMES);
      if (!ok) {
        cleanupUploadedFields(files);
        return res.status(400).json({ success: false, message: "Doubt image content does not match its extension. Upload rejected." });
      }
      await optimizeImageFile(file.path);
    }
    for (const file of files.voiceNote || []) {
      const ok = await validateFileContent(file.path, ALLOWED_DOUBT_VOICE_MIMES);
      if (!ok) {
        cleanupUploadedFields(files);
        return res.status(400).json({ success: false, message: "Voice note content does not match its extension. Upload rejected." });
      }
    }
    next();
  } catch (err) {
    cleanupUploadedFields(files);
    next(err);
  }
}

function cleanupUploadedFields(files) {
  for (const list of Object.values(files)) {
    for (const file of list) {
      try { fs.unlinkSync(file.path); } catch (err) { /* already gone, ignore */ }
    }
  }
}

// ── uploadFacultyApplication — public job application (private storage) ───────
// Used by the public Careers page (routes/recruitment.js) — no auth, so
// this is the one uploader on a fully public endpoint. Files land in a
// private, non-static-served directory just like student documents; only
// an authenticated admin download route can read them back.

if (!fs.existsSync(FACULTY_APPLICATIONS_DIR)) {
  fs.mkdirSync(FACULTY_APPLICATIONS_DIR, { recursive: true });
}

const uploadFacultyApplication = multer({
  storage: diskStorage(FACULTY_APPLICATIONS_DIR),
  limits: { fileSize: MAX_DEMO_VIDEO_SIZE }, // the largest of the four fields; per-field type is what actually gates size expectations
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "resume") {
      if (!ALLOWED_RESUME_EXTENSIONS.has(ext)) return cb(new Error("Resume must be PDF, DOC or DOCX"));
    } else if (file.fieldname === "certificates") {
      if (!ALLOWED_CERTIFICATE_EXTENSIONS.has(ext)) return cb(new Error("Certificates must be PDF, PNG or JPG"));
    } else if (file.fieldname === "photo") {
      if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) return cb(new Error("Photo must be PNG or JPG"));
    } else if (file.fieldname === "demoVideo") {
      if (!ALLOWED_DEMO_VIDEO_EXTENSIONS.has(ext)) return cb(new Error("Demo video must be MP4, MOV or WEBM"));
    } else {
      return cb(new Error(`Unexpected field: ${file.fieldname}`));
    }
    cb(null, true);
  },
});

// Same "check each field against its own allowed MIME list" pattern as
// doubtMimeGuard, extended to four fields instead of two.
async function facultyApplicationMimeGuard(req, res, next) {
  const files = req.files || {};
  const checks = [
    { field: "resume", mimes: ALLOWED_RESUME_MIMES, optimize: false },
    { field: "certificates", mimes: ALLOWED_CERTIFICATE_MIMES, optimize: true },
    { field: "photo", mimes: ALLOWED_PHOTO_MIMES, optimize: true },
    { field: "demoVideo", mimes: ALLOWED_DEMO_VIDEO_MIMES, optimize: false },
  ];
  try {
    for (const { field, mimes, optimize } of checks) {
      for (const file of files[field] || []) {
        const ok = await validateFileContent(file.path, mimes);
        if (!ok) {
          cleanupUploadedFields(files);
          return res.status(400).json({ success: false, message: `${field} file content does not match its extension. Upload rejected.` });
        }
        if (optimize) await optimizeImageFile(file.path);
      }
    }
    next();
  } catch (err) {
    cleanupUploadedFields(files);
    next(err);
  }
}

module.exports = {
  uploadNote,
  uploadPdf,
  uploadStudentDocument,
  uploadHomeworkAttachment,
  uploadHomeworkSubmission,
  uploadDoubtAttachment,
  uploadFacultyApplication,
  notesMimeGuard,   // use after uploadNote.single(...) in routes
  pdfMimeGuard,     // use after uploadPdf.single(...) in routes
  homeworkMimeGuard,
  doubtMimeGuard,
  facultyApplicationMimeGuard,
  studentDocumentMimeGuard: notesMimeGuard, // same allowed MIME set as notes
  STUDENT_DOCS_DIR,
  HOMEWORK_SUBMISSIONS_DIR,
  DOUBTS_DIR,
  FACULTY_APPLICATIONS_DIR,
  diskStorage,      // exposed for other routes (e.g. branding logo/favicon uploads) that need their own destination dir
};