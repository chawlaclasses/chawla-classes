# AI Question Studio — what was added

New, additive module for the Chawla Classes admin panel. Nothing existing
was renamed or rewritten — three files were touched only to *wire in* the
new module (one line each), everything else is new.

## New files (drop straight into your project at these paths)

- `services/ai/aiStudioValidator.js` — type-aware validation for all 9
  question types in the spec (MCQ, Subjective, Assertion-Reason, Case
  Study, Fill in Blanks, True/False, Match the Following, Numerical,
  Diagram Based). Your existing `services/ai/aiValidator.js` (MCQ-only,
  used by `ai-v2.js`) is untouched.
- `services/ai/aiStudioProvider.js` — builds the LLM prompt from the full
  spec (Bloom's taxonomy weights, generation pattern, advanced-control
  sliders/toggles, negative instructions, tags, custom prompt) and calls
  your existing `utils/llm.js` (also untouched).
- `services/ai/aiStudioBatchGenerator.js` — fans a request out across the
  selected question types × difficulty distribution, in small batches,
  with retry (reuses your existing `services/ai/aiRetry.js` and
  `aiLogger.js` as-is).
- `routes/admin/ai-question-studio.js` — the new router:
  `/generate`, `/regenerate`, `/extract` (PDF/OCR/Text), `/duplicate-check`,
  `/save`, `/export`. Reuses `ocr/extractor.js`, `parser/`,
  `utils/textSimilarity.js`, `utils/reportGenerator.js`,
  `utils/questionHistory.js`, `utils/auditLog.js` — all unchanged.
- `public/admin/js/ai-question-studio.js` — the full 18-section wizard UI
  (same vanilla-JS, `apiCall`/`showToast`/`showModal` conventions as your
  other `public/admin/js/*.js` files).

## Modified files (one small, additive change each)

- `routes/adminRoutes.js` — added one line mounting the new router at
  `/ai-question-studio` (sits next to the existing `/ai` and `/ai-v2`
  mounts, doesn't touch them).
- `public/admin/dashboard.html` — added one sidebar item ("AI Question
  Studio", under `ai:generate` permission, same as AI Review Queue) and
  one `<script>` tag.
- `public/admin/js/navigation.js` — added one entry to the
  `sectionLoaders` map.

## Why nothing can reach the Question Bank un-reviewed

Every route except `/save` only ever returns data for the browser to hold
in memory — nothing is written to the `questions` collection by
`/generate`, `/regenerate`, `/extract`, `/duplicate-check`, or `/export`.
`/save` is the only writer, and it only persists items the request body
marks `approved: true`. Even the "Question Bank" destination (which
writes `status: 'approved'` directly) requires the `questions:approve`
permission — the same one every other approval path in the app already
requires — so it doesn't skip review, it records that a reviewer already
did it in Preview.

## Follow-up improvements (added on request)

All three are in `public/admin/js/ai-question-studio.js` only — no backend
changes needed for these.

1. **Auto Save Draft** — every 25 seconds (plus once immediately after a
   generation batch lands, once after Save, and once on `beforeunload`),
   the entire form + Preview state is mirrored to `localStorage`
   (`chawlaClasses_aiQuestionStudio_session_v1`). This is a *browser-local*
   autosave, not a server-side draft — it survives a closed tab or crashed
   browser on the same machine, but not switching devices. If you want a
   true cross-device draft (backed by the `questions` collection like
   everything else in the app), that's a bigger change — a small
   `PATCH /ai-question-studio/draft` endpoint plus a `studio-drafts`
   collection — happy to add it if useful, but it wasn't folded in here
   since it changes the backend surface this task was scoped to.
2. **Resume Previous Session** — on opening the module, if a non-empty
   autosaved session exists, a modal asks *"Resume previous AI Studio
   session?"* with **Resume** / **Start New**. Implementation note: the
   modal's Cancel button is shared across the whole admin panel, so
   "Start New" relabels it *only for this one prompt* via a
   `{ once: true }` listener and resets the label back to "Cancel"
   afterward — it does not permanently repurpose that button anywhere
   else in the app.
3. **Approve All / Reject All** — added to the Preview toolbar next to the
   existing Approve Selected / Reject Selected / Regenerate Selected /
   Delete Selected / Export Selected. Approve All skips (and reports) any
   question still flagged `needsAnswerKey` (e.g. an MCQ pulled from PDF
   Import with no inferred correct option), same safeguard the single-card
   Approve button already had.

`MAX_TOTAL_QUESTIONS = 100` in `routes/admin/ai-question-studio.js` — left
as-is, no change needed.

## MathJax fix (raw LaTeX like `$...$`, `\frac{}{}` showing instead of rendered math)

This was a **pre-existing gap in the whole admin panel**, not something the
Studio introduced — `parser/normalise.js` already has a comment saying
`\frac{}{}` is kept as-is "for MathJax rendering", but MathJax itself was
never actually included anywhere in the project. It just wasn't very
visible before, since earlier generation paths produced mostly plain-text
questions; the Studio's math/numerical questions surface it constantly.

Fixed in `public/admin/dashboard.html` — added the MathJax 3 CDN script
(with `$...$` inline-math delimiters explicitly enabled, since MathJax's
default config only recognizes `\(...\)`). This benefits every module on
the page, not just the Studio, since it's loaded once in `<head>`.

`public/admin/js/ai-question-studio.js` also now calls
`MathJax.typesetPromise(...)` after every place it injects question text
(Preview cards, the Question Preview modal, the duplicate's "Open
Existing" modal) — MathJax only auto-typesets on page load, so anything
injected afterward has to be told to re-render explicitly.

**Note:** the Question Bank page, Tests, and anywhere else in the admin
panel that displays stored question text will *also* now render LaTeX
correctly on first page load (MathJax auto-typesets the whole page once
on load) — but if any of those pages replace their own content via
`innerHTML` afterward (e.g. switching between questions, editing), they'll
need the same `MathJax.typesetPromise(...)` call added at their own
render points to keep rendering correctly after that point. Happy to add
that to `questions.js` / `test-builder.js` etc. if you want it done
everywhere in one pass — didn't touch those files here since it's outside
what this task originally covered.

## Things worth knowing before you wire it into your live app

- I couldn't run `npm install` or boot the server in this sandbox (no
  network access, and `node_modules/` isn't in the zip you gave me), so
  this hasn't been runtime-tested end to end — only syntax-checked
  (`node -c` on every new file) and cross-checked line-by-line against
  every function/export it calls into (`db.*`, `logAudit`,
  `recordQuestionHistory`, `requirePermission`, `hasPermission`,
  `jaccardSimilarity`, `generateUUID`, `extractText`,
  `parseQuestionsFromText`, `createPdfDoc`/`sendPdf`, etc. — all verified
  against your actual files, not assumed). Please do a real smoke test
  (generate → preview → approve → save, one run per source type) before
  relying on it.
- Image OCR calls `tesseract.js` directly (`eng+hin`, same language pack
  your `ocr/extractor.js` already uses internally for scanned PDF pages) —
  it's already a dependency in your `package.json`, nothing new to install.
- The Creativity/Accuracy/Diversity/Difficulty-Strictness sliders are
  implemented as **prompt-level instructions**, not an actual API
  `temperature` parameter — your `utils/llm.js` hardcodes `temperature: 0.2`
  and I intentionally didn't touch that file. If you'd rather have real
  temperature control, that's a one-line change to `utils/llm.js` I can
  make on request.
- "AI Confidence / Quality Score / Estimated Student Accuracy" (Section 15)
  are the model's own self-reported numbers, not a separately calibrated
  scoring model — flagged as such in code comments so it isn't mistaken
  for more than it is.
- `very_hard` is a new difficulty label the Question Bank didn't validate
  against before (it only checks the type-level shape, not an enum), so
  existing Question Bank views will just display it like any other string
  — nothing breaks, but you may want to add a display label for it in the
  Question Bank UI if you want it styled differently from "hard".
