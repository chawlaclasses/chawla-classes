/**
 * middleware/upload.js
 *
 * Multer storage and filter configurations.
 *
 * FIX (local storage -> Cloudflare R2 migration): the five uploaders whose
 * files are actually persisted long-term and read back later —
 * uploadStudentDocument, uploadHomeworkAttachment, uploadHomeworkSubmission,
 * uploadDoubtAttachment, uploadFacultyApplication — now use
 * multer.memoryStorage() instead of disk storage. Their MIME-guard
 * middleware (mimeGuard / doubtMimeGuard / facultyApplicationMimeGuard)
 * now does validation + image optimization on the in-memory buffer and
 * then uploads it straight to R2, attaching the result to
 * req.file.r2Key / req.file.r2Url (or per-field on req.files for the
 * multi-file uploaders) for the route handler to store in Mongo.
 *
 * uploadNote (NOTES_DIR) is unused dead code (not mounted on any route as
 * of this migration) and uploadPdf (UPLOADS_DIR) is transient scratch
 * storage for question-bank PDF/TXT text extraction — the file is deleted
 * via cleanupFile() within the same request and never persisted or served
 * back. Both are left on local disk unchanged; moving them to R2 would add
 * network latency for zero benefit.
 *
 * Security layers applied (unchanged from before):
 *   1. Extension whitelist (fast reject)
 *   2. Filename sanitisation (path traversal prevention) — now done in
 *      services/r2Service.js#generateKey() for the R2-backed uploaders
 *   3. Magic-byte MIME validation post-upload via validateFileContent() /
 *      validateBufferContent()
 */

"use strict";

const path   = require("path");
const fs     = require("fs");
const multer = require("multer");
const sharp  = require("sharp");
const {
  NOTES_DIR, UPLOADS_DIR, MAX_FILE_SIZE, MAX_PDF_SIZE,
  HOMEWORK_SUBMISSIONS_DIR, DOUBTS_DIR, FACULTY_APPLICATIONS_DIR,
} = require("../config");
const { validateBufferContent } = require("../utils/helpers");
const r2Service = require("../services/r2Service");
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

// ── Disk storage factory (still used by uploadNote / uploadPdf only) ──────────

function diskStorage(destDir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename:    (_req, file, cb) => {
      const base = path.win32.basename(file.originalname); // strips Windows paths
      const safe = path.basename(base).replace(/[^a-zA-Z0-9._-]/g, "_");
      const name = safe || "upload";
      cb(null, `${Date.now()}-${name}`);
    },
  });
}

// ── Image optimization ─────────────────────────────────────────────────────
// PERF: same reasoning/behaviour as before — resize down to a sensible max
// dimension and re-encode at good-enough quality — but now operating on an
// in-memory Buffer instead of a file path, since the R2-backed uploaders
// never touch local disk. Runs AFTER mimeGuard's magic-byte validation, so
// only buffers already confirmed to be real images are touched.
const OPTIMIZABLE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const MAX_IMAGE_DIMENSION = 1920; // px, long edge — plenty for full-screen viewing/printing

async function optimizeImageBuffer(buffer, originalname) {
  const ext = path.extname(originalname || "").toLowerCase();
  if (!OPTIMIZABLE_IMAGE_EXTENSIONS.has(ext)) return buffer; // not an image we handle — leave untouched

  try {
    const pipeline = sharp(buffer)
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

    const optimized = await pipeline.toBuffer();

    // Only keep the optimized version if it's actually smaller — a handful
    // of already-small/simple images can come out larger after re-encoding,
    // and "optimization" should never make a file bigger.
    return optimized.length < buffer.length ? optimized : buffer;
  } catch (error) {
    // Never fail the upload because optimization failed — the original,
    // already-validated buffer is still perfectly usable as-is.
    logger.warn(`⚠️ Image optimization skipped for ${originalname}: ${error.message}`);
    return buffer;
  }
}

// Content-Type map for the R2 PutObject call — mirrors ALLOWED_*_MIMES.
const EXT_CONTENT_TYPE = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
function contentTypeFor(originalname) {
  return EXT_CONTENT_TYPE[path.extname(originalname || "").toLowerCase()] || "application/octet-stream";
}

// ── R2 upload helper — validate buffer, optimize if image, push to R2 ─────────
// Shared by every R2-backed guard below. Attaches r2Key/r2Url onto the
// multer file object so route handlers can read req.file.r2Key (single
// upload) or req.files.<field>[0].r2Key (multi-field upload) the same way
// they used to read req.file.filename.
async function uploadFileToR2(file, folder) {
  const optimizedBuffer = await optimizeImageBuffer(file.buffer, file.originalname);
  const key = r2Service.generateKey(folder, file.originalname);
  const { url } = await r2Service.uploadBuffer({
    buffer: optimizedBuffer,
    key,
    contentType: file.mimetype || contentTypeFor(file.originalname),
  });
  file.r2Key = key;
  file.r2Url = url; // non-null only for folders the bucket serves publicly
  file.filename = path.basename(key); // kept for any code/log still reading .filename for display

  // LOGGING (requested by 2026-08-12 marketing-banner URL fix): the R2
  // object key and the public URL derived from it, at the exact moment
  // they're generated — so a bad R2_PUBLIC_URL config shows up immediately
  // in logs instead of silently producing a saved URL that 404s later.
  logger.info(`R2 upload complete: key="${key}" -> publicUrl=${url || "(null — private folder or R2_PUBLIC_URL unset)"}`);
}

// ── MIME validation + R2 upload wrapper (single-file uploaders) ───────────────
/**
 * Returns an Express middleware that:
 *   1. validates the in-memory buffer's real content via magic bytes
 *   2. optimizes it if it's an image
 *   3. uploads it to R2 under `folder`
 *   4. attaches req.file.r2Key / req.file.r2Url
 *
 * @param {string[]} allowedMimes
 * @param {string} folder  R2 key prefix, e.g. "student-documents"
 */
function mimeGuard(allowedMimes, folder) {
  return async (req, res, next) => {
    const file = req.file;
    if (!file) return next(); // no file uploaded — let route handle it

    try {
      const isValid = await validateBufferContent(file.buffer, allowedMimes);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: "File content does not match its extension. Upload rejected.",
        });
      }

      await uploadFileToR2(file, folder);
      next();
    } catch (err) {
      logger.error(`R2 upload failed (${folder}): ${err.message}`);
      res.status(502).json({ success: false, message: "File storage upload failed. Please try again." });
    }
  };
}

// ── uploadNote — for study-material uploads. NOT MOUNTED on any route as ──────
// of this migration (routes/notes.js's POST /upload is a stub and isn't
// even wired into app.js). Left on local disk unchanged; revisit if this
// is ever actually wired up.
if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });

const uploadNote = multer({
  storage: diskStorage(NOTES_DIR),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_NOTE_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported file type: ${ext}`));
    }
    cb(null, true);
  },
});

// ── uploadPdf — question-bank PDF/TXT import. Scratch storage only; the ───────
// uploaded file is parsed for text and deleted (cleanupFile) within the
// same request in controllers/pdfController.js. Left on local disk —
// moving a file to R2 just to delete it a few seconds later adds latency
// for no benefit.
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const uploadPdf = multer({
  storage: diskStorage(UPLOADS_DIR),
  limits:  { fileSize: MAX_PDF_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pdf" || ext === ".txt") {
      return cb(null, true);
    }
    return cb(new Error("Only PDF and TXT files are allowed"));
  },
});

// ── uploadStudentDocument — private, R2-backed ─────────────────────────────────
// FIX: student documents (ID proofs, certificates) go to R2 under
// "student-documents/" and are ONLY ever readable through the
// authenticated download route (routes/admin/student-profile.js), which
// streams the object through the server — the R2 bucket itself is never
// made public, so this preserves the exact same access guarantee the old
// "never registered with express.static" local directory provided.
//
// STUDENT_DOCS_DIR itself is kept (pointing at the same local path it
// always did) purely so download routes can still fall back to reading a
// PRE-MIGRATION record's file straight off local/persistent disk if it has
// no `key` field yet (see the migration-guidance section for details) —
// no new file is ever written here after this migration.
const STUDENT_DOCS_DIR = path.join(NOTES_DIR, "..", "student-documents");

const uploadStudentDocument = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_NOTE_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported file type: ${ext}`));
    }
    cb(null, true);
  },
});

// ── uploadHomeworkAttachment — admin-attached homework material (PUBLIC) ──────
// Goes to R2 under "homework-attachments/" with a public URL (this
// category was already served with no auth via /homework-files, so no
// access-control change here — just where the bytes live).

const uploadHomeworkAttachment = multer({
  storage: multer.memoryStorage(),
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
// Goes to R2 under "homework-submissions/"; only ever read back through
// the authenticated download routes in routes/admin/homework.js and
// routes/studentRoutes.js.

const uploadHomeworkSubmission = multer({
  storage: multer.memoryStorage(),
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
// Goes to R2 under "doubts/images/" and "doubts/voice-notes/".

const uploadDoubtAttachment = multer({
  storage: multer.memoryStorage(),
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

// ── MIME guard middleware for each single-file uploader ───────────────────────
// NOTE: notesMimeGuard/pdfMimeGuard do not exist here — confirmed by
// repo-wide search that neither was ever imported by any route (uploadNote
// isn't mounted at all; controllers/pdfController.js does its own inline
// validation on uploadPdf's output). mimeGuard() below is buffer-based and
// is only wired to the memoryStorage() uploaders.

const homeworkAttachmentMimeGuard = mimeGuard(ALLOWED_HOMEWORK_MIMES, "homework-attachments");
const homeworkSubmissionMimeGuard = mimeGuard(ALLOWED_HOMEWORK_MIMES, "homework-submissions");
const studentDocumentMimeGuard = mimeGuard(ALLOWED_NOTE_MIMES, "student-documents");

// Doubts can arrive with an image, a voice note, both, or (rarely) neither if
// the request only carries text — mimeGuard() (above) only looks at a
// single req.file, so this checks each field of req.files against its own
// allowed MIME list, optimizes if it's an image, and uploads each to its
// own R2 folder.
async function doubtMimeGuard(req, res, next) {
  const files = req.files || {};
  try {
    for (const file of files.image || []) {
      const ok = await validateBufferContent(file.buffer, ALLOWED_DOUBT_IMAGE_MIMES);
      if (!ok) {
        return res.status(400).json({ success: false, message: "Doubt image content does not match its extension. Upload rejected." });
      }
      await uploadFileToR2(file, "doubts/images");
    }
    for (const file of files.voiceNote || []) {
      const ok = await validateBufferContent(file.buffer, ALLOWED_DOUBT_VOICE_MIMES);
      if (!ok) {
        return res.status(400).json({ success: false, message: "Voice note content does not match its extension. Upload rejected." });
      }
      await uploadFileToR2(file, "doubts/voice-notes");
    }
    next();
  } catch (err) {
    logger.error(`R2 upload failed (doubts): ${err.message}`);
    res.status(502).json({ success: false, message: "File storage upload failed. Please try again." });
  }
}

// ── uploadFacultyApplication — public job application (private storage) ───────
// Files land as R2 objects that are never made public; only an
// authenticated admin download route (routes/admin/recruitment.js) can
// stream them back, same trust model as before.

const uploadFacultyApplication = multer({
  storage: multer.memoryStorage(),
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
// doubtMimeGuard, extended to four fields, each uploaded to its own R2
// folder under faculty-applications/.
async function facultyApplicationMimeGuard(req, res, next) {
  const files = req.files || {};
  const checks = [
    { field: "resume", mimes: ALLOWED_RESUME_MIMES, folder: "faculty-applications/resumes" },
    { field: "certificates", mimes: ALLOWED_CERTIFICATE_MIMES, folder: "faculty-applications/certificates" },
    { field: "photo", mimes: ALLOWED_PHOTO_MIMES, folder: "faculty-applications/photos" },
    { field: "demoVideo", mimes: ALLOWED_DEMO_VIDEO_MIMES, folder: "faculty-applications/demo-videos" },
  ];
  try {
    for (const { field, mimes, folder } of checks) {
      for (const file of files[field] || []) {
        const ok = await validateBufferContent(file.buffer, mimes);
        if (!ok) {
          return res.status(400).json({ success: false, message: `${field} file content does not match its extension. Upload rejected.` });
        }
        await uploadFileToR2(file, folder);
      }
    }
    next();
  } catch (err) {
    logger.error(`R2 upload failed (faculty-applications): ${err.message}`);
    res.status(502).json({ success: false, message: "File storage upload failed. Please try again." });
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
  homeworkMimeGuard: homeworkAttachmentMimeGuard,       // used by routes/admin/homework.js (POST/PUT — attachment field)
  homeworkSubmissionMimeGuard,                          // used by routes/studentRoutes.js (submission field)
  doubtMimeGuard,
  facultyApplicationMimeGuard,
  studentDocumentMimeGuard,
  uploadFileToR2, // reused by routes/settings.js for branding logo/favicon uploads
  diskStorage, // exposed for routes/settings.js's own multer instance — no longer used there after this migration (see routes/settings.js), kept exported in case anything else relies on it

  // Local dir constants — kept exported (unchanged import paths for
  // existing routes) purely for reading back PRE-MIGRATION files that
  // have no `key` field yet. Nothing writes into these anymore.
  STUDENT_DOCS_DIR,
  HOMEWORK_SUBMISSIONS_DIR,
  DOUBTS_DIR,
  FACULTY_APPLICATIONS_DIR,
};
