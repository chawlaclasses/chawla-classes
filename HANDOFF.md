# Chawla Classes — MongoDB Hardening — Handoff (after Phase 4)

Context for picking this back up in a new session. Separate track from the Sentry/session/rate-limit/CSRF middleware patch work (that project's phases are numbered independently).

**Status: every CRITICAL issue from the original 13-issue audit is resolved.** What's left (#8, #11, #13) is real but not urgent the way the earlier items were. No rush on a Phase 5.

## Project architecture (need-to-know)

- `services/jsonDb.js`: in-memory mirror of every "real" collection (`_`-prefixed collections are internal bookkeeping, excluded — see `_isInternalCollectionName`/`listRealCollectionNames`), hydrated from MongoDB on boot, writes applied in-memory immediately and queued asynchronously per-collection (`_saveQueue`/`_queueWrite()`, tracked via `_pendingWrites`). `saveCollection()` wraps deleteMany+insertMany in a real MongoDB transaction (Phase 2). `close()` closes the MongoDB client (used by graceful shutdown, Phase 3).
- `services/mongoBackup.js` (Phase 2): backup/restore engine, safe per-collection swap. See PHASE_2_REPORT.md, including an Atlas Free-tier storage/collection-limit note.
- `utils/gracefulShutdown.js` (Phase 3): SIGTERM/SIGINT handling — stop accepting requests → drain in-flight writes → close Mongo → flush any queued external logs (Phase 4) → exit. Extracted so it's unit-testable with fake deps.
- `config/index.js` (Phase 3): `PERSISTENT_ROOT_DIR` — every upload directory resolves under `PERSISTENT_DATA_DIR` if set, otherwise `ROOT_DIR` (unchanged default). Needs a Render Persistent Disk actually attached to matter.
- `utils/logShipper.js` (Phase 4): provider-agnostic HTTP log shipper, off by default (`LOG_SHIP_URL` unset = no-op). Batches, retries once, caps queue size, flushes on graceful shutdown. See PHASE_4_REPORT.md for config and the real end-to-end verification performed.
- `server.js` boots: `validateConfig()` → `db.connect()` → `createApp()` → `app.listen()` → wires up `gracefulShutdown`. Cron jobs for scheduled backup live here too.
- Routes: one file per resource under `routes/` (public) and `routes/admin/` (authenticated). Uploads go through `middleware/upload.js` (7 multer configs), served via `express.static()` (public content) or ~8 authenticated `res.sendFile()`/`res.download()` calls (private content).
- Tests: Jest + supertest. `jest.mock('../../services/jsonDb')` for anything not testing jsonDb's own behavior. For real driver behavior without a live server, point a real client at something unreachable. For orchestration logic needing realistic end states, a small in-memory fake beats a call-assertion mock (`mongoBackup.test.js`'s `FakeMongoDb`). For anything reading `process.env` at require time, use `jest.isolateModules()` — **restore env only after every function that reads `process.env` live (not just at require time) has been called**, not right after the require (Phase 3 had a real bug here). **Where the sandbox allows it (no real external dependency needed), prefer a real end-to-end check over a mock** — Phase 3's spawned `node server.js` + real SIGTERM, and Phase 4's real local HTTP server receiving real log POSTs, both caught real bugs unit tests with mocks didn't (a destructuring-timing bug, and a test's wrong assumption about which log lines would ship). This has been worth the extra effort every time it's been done.

## Sandbox testing constraints — still apply

**No real MongoDB, no AWS/Cloudinary credentials, no real external logging service** are reachable from this sandbox — held across all 4 phases. Where a real local stand-in was possible (an HTTP server on localhost, a spawned child process, an unreachable port for driver events), it's been used in preference to mocking — that pattern is worth continuing. Whoever picks up Phase 5 should expect the same constraints for #8 (no live MongoDB to test a background queue's actual job-processing against, though the queue mechanics themselves are testable) and should plan verification accordingly: real tests for anything logic-testable, real local end-to-end checks where feasible, an honest note on what can't be verified, a staging smoke-test checklist for what can't.

## Phases 1–4 — done

See PHASE_1 through PHASE_4_REPORT.md. Summary: JWT_SECRET fail-fast, banner XSS validation, health endpoint, log rotation, Mongo status visibility (Phase 1); MongoDB-native backup/restore, atomic saveCollection, backups off ephemeral storage (Phase 2); graceful shutdown, persistent upload storage via Render Persistent Disk (Phase 3); external log shipping (Phase 4). Plus bonus fixes found via testing along the way: a stale package-lock.json breaking `npm ci`, 2 of 7 upload directories missing an auto-create guard.

**Action items for Rohit, not code:**
1. Attach a Render Persistent Disk and set `PERSISTENT_DATA_DIR` to its mount path (Phase 3) — uploads don't actually persist until this is done.
2. Pick an external logging provider and set the `LOG_SHIP_*` env vars (Phase 4) — logs don't actually ship anywhere until this is done. Check the provider's dashboard after deploying to confirm the payload format matches what it expects (see PHASE_4_REPORT.md's note on this).

**Explicitly declined, not forgotten:** issue #4's S3/Cloudinary branch — Rohit confirmed Persistent Disk is sufficient. Don't revisit unless asked.

## Proposed Phase 5 (whenever it's useful — no urgency)

- #8 — Marketing campaign sending: currently synchronous inside the HTTP request (`routes/admin/marketing-campaigns.js`'s `/send` route loops over contacts and sends inside the request). Move to: create campaign → save → return 202 → process in the background → update progress → mark completed. Campaign history must always be saved even if sending fails partway.
- #11 — Replace linear searches in `jsonDb` with indexed lookups wherever feasible. Scope honestly: the in-memory-mirror design (full collection loaded into a plain array, filtered with `.filter()`/`.find()`) inherently limits how much this can achieve without a bigger redesign — likely a partial win (e.g., a Map-based secondary index for the most common lookup patterns) rather than a full fix. Worth identifying the actual hot paths (which collections/queries are called most) before optimizing blindly.
- #13 — General memory usage improvements. Similarly, identify actual pressure points first (the in-memory-mirror design means baseline memory use scales with total data volume by design — that's an architectural fact, not a bug to fix) rather than optimizing speculatively.

## Starter prompt for Phase 5

Paste this to start the next session:

---

> Continuing the Chawla Classes MongoDB production-hardening work. This is Phase 5. Please read HANDOFF.md and PHASE_1 through PHASE_4_REPORT.md first. Implement issue #8 (marketing campaign background queue — see HANDOFF.md for the target flow) and, time permitting, look at #11/#13 (jsonDb indexed lookups / memory usage) — but for those two, start by identifying actual hot paths/pressure points rather than optimizing speculatively, and scope honestly given the in-memory-mirror architecture's inherent limits. Same approach as Phases 1-4: real diffs, real automated tests, real local end-to-end verification wherever the sandbox allows it (prefer this over mocks when a real local stand-in is feasible — see HANDOFF.md's note on why this has caught real bugs every time it's been done), an honest accounting of what can't be verified, and a staging smoke-test checklist for what can't. Deliver as an updated project zip, a PHASE_5_REPORT.md in the same format as the earlier reports, and an updated HANDOFF.md.

---

## File map touched so far

**Phase 1:** `services/auth.js`, `utils/validators.js`, `utils/logger.js`, `services/jsonDb.js` (status/reconnect), `routes/health.js` (new), `app.js`, `package-lock.json`, 5 test files.

**Phase 2:** `services/mongoBackup.js` (new), `services/jsonDb.js` (transactions + internal-collection exclusion + reload), `routes/settings.js` (backup/restore endpoints), `server.js` (scheduled backup), 4 test files.

**Phase 3:** `utils/gracefulShutdown.js` (new), `server.js` (shutdown wiring), `config/index.js` (PERSISTENT_ROOT_DIR, IMAGES_DIR centralized), `middleware/upload.js` (mkdir guards + fs require reorg), `routes/settings.js` (IMAGES_DIR import), 3 test files.

**Phase 4:** `utils/logShipper.js` (new), `utils/logger.js` (shipper wiring + flush export), `utils/gracefulShutdown.js` (flush-on-exit), 2 test files (`logShipper.test.js`, plus 2 added tests in `gracefulShutdown.test.js`).
