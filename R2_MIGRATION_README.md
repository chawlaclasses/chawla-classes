# Chawla Classes — Local Storage → Cloudflare R2 Migration

Verified against your actual `chawla-classes-phase4.zip` (unzipped, edited in
place, `node -c` syntax-checked, `require()`-loaded with a live Mongo
connection, and the existing `settings-backup.test.js` suite re-run and
passing). Everything below reflects what's really in this bundle.

## 1. What moved to R2 and what didn't

| Category | Before | After |
|---|---|---|
| Student documents | local disk (`student-documents/`) | **R2**, private, streamed through an authenticated route |
| Homework attachments | local disk (`homework/`, public static) | **R2**, public URL |
| Homework submissions | local disk (`homework-submissions/`) | **R2**, private, streamed through an authenticated route |
| Doubt image + voice note | local disk (`doubts/`) | **R2**, private, streamed through an authenticated route |
| Faculty application files (resume/certs/photo/demo video) | local disk (`faculty-applications/`) | **R2**, private, streamed through an authenticated route |
| Branding logo/favicon | local disk (`images/`, public static) | **R2**, public URL |
| `uploadNote` (study material) | local disk, **unused — not mounted on any route** | left as-is (dead code, nothing to migrate) |
| Question-bank PDF/TXT import (`uploadPdf`, `routes/import.js`, `routes/admin/ai-question-studio.js`) | local disk, **deleted within the same request** after text extraction | left as-is — it's scratch space, never persisted, so it isn't "storage" and doesn't violate the "no uploaded file depends on Render local storage" goal |

After this change, none of the six persisted categories ever touch Render's
disk again — uploads go `browser → multer memoryStorage (RAM) → R2`, nothing
is written locally, so redeploys and restarts can't lose them.

## 2. Install

```bash
npm install @aws-sdk/client-s3
```

That's the only new package. No other dependency changes.

## 3. Environment variables

Add to `.env` (and to your Render environment):

```env
# ============================================================
# CLOUDFLARE R2 (file storage)
# ============================================================
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_api_token_access_key
R2_SECRET_ACCESS_KEY=your_r2_api_token_secret
R2_BUCKET_NAME=chawla-classes-uploads
R2_PUBLIC_URL=https://files.yourdomain.com
```

Where to get these:
- **R2_ACCOUNT_ID**: Cloudflare dashboard → R2 → Overview (shown in the right sidebar)
- **R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY**: R2 → Manage API Tokens → Create API Token (give it Object Read & Write, scoped to your bucket)
- **R2_BUCKET_NAME**: create a bucket in R2 → Create bucket
- **R2_PUBLIC_URL**: R2 → your bucket → Settings → Public Access. Either:
  - connect a custom domain (recommended — `https://files.yourdomain.com`), or
  - enable the `r2.dev` dev subdomain and use that URL (fine for testing, Cloudflare doesn't guarantee it for production traffic)

  This is only used for the two *public* categories (homework attachments,
  branding). Private categories (student docs, submissions, doubts, faculty
  applications) never expose a public URL — they're always streamed through
  an authenticated Express route, same as before.

The app now **fails fast at boot** if these are missing (see
`config/index.js` → `validateConfig()`), the same way it already does for a
missing `MONGODB_URI`.

## 4. Files in this bundle

```
config/r2.js                        NEW
config/index.js                     MODIFIED (boot-time R2 validation)
services/r2Service.js               NEW
middleware/upload.js                MODIFIED (memoryStorage + R2 upload for 5 categories)
utils/helpers.js                    MODIFIED (added validateBufferContent)
routes/admin/student-profile.js     MODIFIED
routes/admin/homework.js            MODIFIED
routes/studentRoutes.js             MODIFIED
routes/admin/doubts.js              MODIFIED
routes/recruitment.js               MODIFIED
routes/admin/recruitment.js         MODIFIED
routes/settings.js                  MODIFIED
scripts/backfill-r2.js              NEW (optional, one-time)
```

Drop these into your project at the matching paths (they overwrite the
originals except the two brand-new files). `app.js` is **not** touched —
the old `/notes`, `/uploads`, `/homework-files`, `/images` static mounts
stay in place on purpose, so any pre-migration record still works even if
you never run the backfill script.

## 5. MongoDB — what changed on each collection

No collection was renamed or restructured. New fields only:

| Collection | New field(s) | Old field kept? |
|---|---|---|
| `student-documents` | `key` | `filename` kept, now display-only |
| `homework` | `attachmentKey`, `attachmentUrl` | `attachmentFilename` kept for pre-migration records |
| `homeworkSubmissions` | `key` | `filename` kept, now display-only |
| `doubts` | `imageKey`, `voiceNoteKey` | `imageFilename`/`voiceNoteFilename` kept |
| `facultyApplications` | `.resume.key`, `.photo.key`, `.demoVideo.key`, `.certificates[].key` | filenames kept |
| `settings` | `logoKey`, `faviconKey` | `logoUrl`/`faviconUrl` now hold the full R2 public URL instead of `/images/...` |

Every read path checks the new key field first and falls back to the old
local file if it's absent, so old records don't need to be touched
immediately.

## 6. Backfilling existing local files (optional, do this at your own pace)

```bash
# Dry run first — reports what it would do, changes nothing
node scripts/backfill-r2.js

# Then actually migrate
node scripts/backfill-r2.js --apply
```

Uploads every local file that belongs to a pre-migration record up to R2
and fills in its `key`/`url` field. It does **not** delete the local files
or touch the old `/notes`, `/uploads`, `/homework-files`, `/images` static
mounts — run it, verify things look right in the app, then decide for
yourself whether/when to remove the old local files and static mounts.

## 7. Local testing checklist (in VS Code, before deploying)

1. `npm install @aws-sdk/client-s3`
2. Add the five `R2_*` vars to `.env`, plus your existing `MONGODB_URI`
3. `npm run dev` — confirm it boots and logs `☁️  R2 storage configured (bucket: ...)` with no fatal error
4. **Student documents**: admin panel → a student → upload a document → confirm it appears → download it → confirm it opens correctly → delete it → confirm the R2 object is gone (check your R2 bucket dashboard)
5. **Homework attachment**: create homework with a PDF attached → confirm the attachment opens from its public URL → edit the homework and replace the attachment → confirm the old R2 object was deleted (check the bucket) and the new one serves correctly
6. **Homework submission**: as a student, submit a homework file → confirm it appears in the admin's submission list → download it as both student and admin → replace an ungraded submission → confirm the old R2 object was deleted
7. **Doubts**: as a student, ask a doubt with an image and a voice note → confirm both play back correctly for the student and for an admin viewing the same doubt
8. **Faculty application** (`/careers` page, no login required): submit an application with a resume, 2 certificates, a photo, and a demo video → in the admin panel, download each file individually → confirm the correct file comes back each time
9. **Branding**: settings → upload a new logo and favicon → confirm the site header/tab icon updates to the new R2-hosted image
10. **Restart test** (the actual point of this migration): stop the dev server (`Ctrl+C`), start it again (`npm run dev`), and re-download a document/homework/submission/doubt file you uploaded in step 4–9 — it should still work, since nothing was ever written to local disk
11. **Backfill** (only if you have pre-migration records with real local files to test against): run `node scripts/backfill-r2.js` (dry run), inspect the output, then `--apply`, then confirm an old record's file now downloads via R2 instead of the local fallback path

One thing to flag for you directly: a few of the admin/student frontend
JS files reference the old public paths (`homework.js`, `marketing.js`,
`careers.html`, etc., referencing `/homework-files/...` and `/images/...`).
Since `attachmentUrl`/`logoUrl`/`faviconUrl` in API responses now already
carry the full R2 URL, most of these should keep working as long as the
frontend just renders whatever URL the API gives it — but if any of them
hardcode the `/homework-files/` or `/images/` prefix instead of using the
API's URL field, they'll need a small update. Happy to grep those out and
fix them too if you want — just say the word.
