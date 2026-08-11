/**
 * services/r2Service.js
 *
 * All Cloudflare R2 object operations live here — every route/middleware
 * that touches R2 goes through this file instead of calling the AWS SDK
 * directly. Mirrors the shape of the app's other services/ modules.
 *
 * Object key layout (folders are logical prefixes inside one bucket, same
 * idea as the old per-category local directories):
 *   student-documents/<key>
 *   homework-attachments/<key>            (public)
 *   homework-submissions/<key>
 *   doubts/images/<key>
 *   doubts/voice-notes/<key>
 *   faculty-applications/resumes/<key>
 *   faculty-applications/certificates/<key>
 *   faculty-applications/photos/<key>
 *   faculty-applications/demo-videos/<key>
 *   branding/<key>                        (public)
 */

"use strict";

const path = require("path");
const crypto = require("crypto");
const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

const { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL, R2_CONFIGURED } = require("../config/r2");
const logger = require("../utils/logger");

function assertConfigured() {
  if (!R2_CONFIGURED || !r2Client) {
    throw new Error("Cloudflare R2 is not configured — check R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME");
  }
}

/**
 * Builds a unique, safe object key for a folder + original filename.
 * Same sanitisation rules as the old middleware/upload.js diskStorage()
 * filename() callback (Windows-path-safe basename, character whitelist),
 * plus a short random suffix — needed because multiple fields in the same
 * multi-file request (e.g. faculty application: resume + certificates +
 * photo + demoVideo) can land in the same millisecond, and unlike the old
 * per-file disk writes, R2 keys are generated concurrently in this app.
 *
 * @param {string} folder   e.g. "student-documents", "doubts/images"
 * @param {string} originalName  the uploaded file's original name
 * @returns {string} e.g. "student-documents/1751234567890-a1b2c3d4-marksheet.pdf"
 */
function generateKey(folder, originalName) {
  const base = path.win32.basename(originalName || "upload"); // strips Windows-style paths too
  const safe = path.basename(base).replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${folder}/${Date.now()}-${suffix}-${safe}`;
}

/**
 * Uploads a buffer to R2 under the given key.
 * @param {Object} opts
 * @param {Buffer} opts.buffer
 * @param {string} opts.key
 * @param {string} [opts.contentType]
 * @returns {Promise<{ key: string, url: string|null }>}
 */
async function uploadBuffer({ buffer, key, contentType }) {
  assertConfigured();
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream",
  }));
  return { key, url: getPublicUrl(key) };
}

/**
 * Returns the public URL for a key. Only meaningful for objects in a
 * folder the bucket actually serves publicly (homework-attachments/,
 * branding/) — calling this for a private key is harmless (it just
 * returns a URL that won't resolve), private downloads never use it.
 */
function getPublicUrl(key) {
  if (!R2_PUBLIC_URL || !key) return null;
  return `${R2_PUBLIC_URL}/${key}`;
}

/**
 * Fetches an object as a Node Readable stream plus its metadata, for
 * proxying a private download through an authenticated Express route
 * (res.download()/res.sendFile() equivalent for R2-backed files).
 *
 * @param {string} key
 * @returns {Promise<{ stream: import('stream').Readable, contentType: string, contentLength: number }>}
 */
async function getObjectStream(key) {
  assertConfigured();
  const result = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  return {
    stream: result.Body, // Node runtime: a Readable stream
    contentType: result.ContentType || "application/octet-stream",
    contentLength: result.ContentLength,
  };
}

/**
 * Streams a private R2 object straight into an Express response —
 * replaces the res.download()/res.sendFile() calls that used to read
 * straight off local disk. Handles the "object doesn't exist" case the
 * same way the old code implicitly did (404), instead of letting an SDK
 * exception bubble into a generic 500.
 *
 * @param {string} key
 * @param {import('express').Response} res
 * @param {Object} [opts]
 * @param {string} [opts.downloadName] sets Content-Disposition: attachment; filename=...
 * @param {boolean} [opts.inline] if true, Content-Disposition: inline (view in browser, e.g. images/audio) instead of attachment
 */
async function streamToResponse(key, res, { downloadName, inline = false } = {}) {
  try {
    const { stream, contentType, contentLength } = await getObjectStream(key);
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (downloadName) {
      const disposition = inline ? "inline" : "attachment";
      res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(downloadName)}"`);
    }
    stream.on("error", (err) => {
      logger.error(`R2 stream error for key ${key}: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    throw err;
  }
}

/**
 * Deletes a single object. Never throws — mirrors the old cleanupFile()'s
 * "best effort, swallow errors" behaviour so a delete-record request
 * doesn't 500 just because the underlying object was already gone.
 */
async function deleteObject(key) {
  if (!key) return;
  try {
    assertConfigured();
    await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  } catch (err) {
    logger.warn(`R2 deleteObject failed for key ${key}: ${err.message}`);
  }
}

/**
 * Deletes multiple objects in one call (R2 supports up to 1000 per
 * request, same as S3). Used for faculty applications' certificates[]
 * array. Never throws, same reasoning as deleteObject().
 */
async function deleteObjects(keys) {
  const list = (keys || []).filter(Boolean);
  if (!list.length) return;
  try {
    assertConfigured();
    await r2Client.send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET_NAME,
      Delete: { Objects: list.map((Key) => ({ Key })) },
    }));
  } catch (err) {
    logger.warn(`R2 deleteObjects failed: ${err.message}`);
  }
}

/** Best-effort existence check — used nowhere critical, handy for scripts. */
async function objectExists(key) {
  try {
    assertConfigured();
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  generateKey,
  uploadBuffer,
  getPublicUrl,
  getObjectStream,
  streamToResponse,
  deleteObject,
  deleteObjects,
  objectExists,
};
