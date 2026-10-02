# Chawla Classes — Messaging Layer (SMS / WhatsApp, provider-agnostic)

Status: **mock mode only.** No real SMS/WhatsApp provider is integrated. Every message is printed to the server
console and stored in `NotificationLog`. Going live later = implement one provider class + set env vars.
Business code (OTP, fees, notices …) never changes.

---------------------------------------------------------------------------------------------------

## 1. Folder structure

```
messaging/
├── index.js                     init() / get() / shutdown()  — the module's public face
├── container.js                 composition root (wires everything, no globals)
├── mount.js                     503-until-ready gateway used by app.js
├── constants.js                 channels, purposes, categories, statuses
├── config/messaging.config.js   ALL env vars, parsed once
├── providers/
│   ├── BaseProvider.js          ★ provider interface (contract + DTO docs)
│   ├── MockProvider.js          ★ console provider (dev / CI / today's production)
│   ├── ProviderRegistry.js      env → provider instance per channel
│   └── stubs/                   fast2sms.js · msg91.js · whatsappCloud.js  (plug-in templates, no HTTP)
├── models/                      MessageTemplate · NotificationLog (also the queue) · OtpRequest · OptOut · Campaign
├── services/
│   ├── MessagingService.js      ★ render → policy → log → dispatch → retry/fallback
│   ├── TemplateService.js       cached lookup, versioned upsert, seed defaults
│   ├── OtpService.js            request / verify / verification token
│   ├── EnquiryFollowUpService.js  FeeReminderService.js  StudentNoticeService.js
│   ├── ParentNotificationService.js  BulkMessagingService.js  RecipientResolver.js
│   ├── DeliveryReceiptService.js  RateLimiter.js
├── queue/DispatchWorker.js      Mongo-backed worker (atomic claim, backoff, stuck-job reclaim)
├── adapters/hostDataAdapter.js  ★ the ONLY file that knows how students/fees/enquiries are stored
├── controllers/                 otp · workflows · admin · webhook
├── routes/index.js              /api/messaging/*
├── templates/defaultTemplates.js  14 starter templates (seeded on boot, never overwritten)
├── utils/                       phone · renderTemplate · errors · log
├── testing/fakeMongoose.js      in-memory storage for tests (no MongoDB needed in CI)
└── __tests__/                   24 tests: full flows in mock mode
```

## 2. Architecture

```
 React / Admin UI / existing routes
            │  (HTTP or direct call)
            ▼
 Controllers ─► Workflow services ──────────────┐
   (OTP, Enquiry, Fee, Notice, Parent, Bulk)    │   only talk to ↓
                                                ▼
                                       MessagingService   ← templates, opt-outs, quiet hours, idempotency
                                                │ writes
                                                ▼
                                   NotificationLog (status=queued)  ◄── durable queue (outbox)
                                                ▲ atomic claim            │
                                    DispatchWorker (N instances OK)       │ OTP: dispatched inline, never stored/retried
                                                │
                                                ▼
                                 ProviderRegistry ─► provider for channel (env)
                                   mock │ fast2sms │ msg91 │ whatsapp_cloud │ …
                                                │
                                      delivery webhook ─► DeliveryReceiptService ─► NotificationLog / Campaign stats
```

Rules that keep it plug-and-play:
1. Workflow code calls `messaging.send({ templateKey, to, variables })`. It never sees a vendor.
2. Vendor specifics live in **one provider class** + `template.providerRefs.<vendor>` (DLT id / WhatsApp template name).
3. Student/fee/enquiry storage is hidden behind `hostDataAdapter` (V2 can swap jsonDb → Mongoose models by editing one file).
4. Everything is a **queued row first** → survives restarts, retryable, auditable, schedulable.

## 3. MongoDB schemas (mongoose, in `models/`)

| Model | Purpose | Key fields / indexes |
|---|---|---|
| `MessageTemplate` | canonical text + per-vendor registrations | `key, channel, language` **unique**; `category` (transactional/service/promotional); `body` with `{{vars}}`; `providerRefs{vendor:{templateId,…}}`; `sensitive`; `version` |
| `NotificationLog` | audit log **and** queue | `messageId` unique; `purpose, channel, provider, recipient{phone,name,userId,type}`; `status` queued→processing→sent→delivered/read/failed/cancelled/skipped; `attempts, maxAttempts, nextAttemptAt, lockedAt/By`; `providerMessageId`; `campaignId`; `related{type,id}`; `idempotencyKey` unique (partial); `events[]`; TTL by `createdAt` (180d) |
| `OtpRequest` | OTP state | `phone, purpose, codeHash (HMAC), expiresAt, attempts, consumed`; TTL cleanup |
| `MessagingOptOut` | consent registry | `phone, channel, scope` unique(phone,channel) |
| `MessagingCampaign` | bulk send | `audience{kind,filter}`, `templateKey`, `status`, `stats{total,queued,skipped,sent,delivered,failed}` |

Worker claim index: `{status, nextAttemptAt, priority}`. Details in the files.

## 4. Provider interface (`providers/BaseProvider.js`)

```js
class MyProvider extends BaseProvider {
  get name()         { return "msg91"; }            // = MESSAGING_*_PROVIDER value
  get channels()     { return ["sms"]; }
  get capabilities() { return { requiresRegisteredTemplate: true, bulk: true, maxBatchSize: 200, deliveryReceipts: "webhook", unicode: true }; }
  async send(msg)    { /* msg = { messageId, channel, to(E.164), body, template:{key,language,variables,providerRef}, metadata } */
                       return { providerMessageId, status: "sent", cost }; }   // throw new ProviderError(msg,{retryable})
  async sendBulk(msgs) {}                           // optional (default: parallel send)
  verifyWebhook(req) {}  parseWebhook(req) {}       // → [{ providerMessageId, status, error }]
}
```
`ProviderError.retryable = true` → exponential backoff; `false` (bad number, template rejected) → fail immediately.

### Going live later — the whole procedure
1. Open `providers/stubs/fast2sms.js` (or msg91 / whatsappCloud) — the header comment lists endpoint, payload mapping and env vars. Replace the `throw` in `send()` with the HTTP call.
2. `ProviderRegistry.js` already has the name registered.
3. Register your templates with the vendor, then store ids: `PUT /api/messaging/templates` with `providerRefs: { fast2sms: { templateId: "…", variableOrder: ["name","amount"] } }`.
4. Set `MESSAGING_SMS_PROVIDER=fast2sms` + the vendor's credentials. Restart. Done — no service/controller edits.
   Switching MSG91 ↔ Fast2SMS later is the same two-step.

## 5. Environment variables
See `env.additions.txt` (bottom section). Highlights: `MESSAGING_SMS_PROVIDER`, `MESSAGING_WHATSAPP_PROVIDER`,
`MESSAGING_*_FALLBACK_CHANNEL`, `MESSAGING_OTP_*`, `MESSAGING_FEE_REMINDER_DAYS`, `MESSAGING_ENQUIRY_FOLLOWUP_HOURS`,
`MESSAGING_QUIET_HOURS`, `MESSAGING_WORKER_*`, `MOCK_PROVIDER_*`.
> Because production currently has no real provider, set `MESSAGING_ALLOW_MOCK_IN_PRODUCTION=true` on Render, otherwise the registry
> refuses to start (deliberate guard so you can't forget to switch providers after launch).

## 6. Routes (`/api/messaging`)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /otp/request` `{phone,purpose}` | public, rate-limited | send OTP |
| `POST /otp/verify` `{phone,purpose,code}` | public, rate-limited | → `{verified, verificationToken}` |
| `POST /webhooks/:provider` | provider signature | delivery receipts |
| `GET /status` · `GET /logs` · `POST /logs/:id/retry` · `POST /test` | admin | health, audit, retry, test send |
| `GET/PUT /templates` · `PATCH /templates/:id/active` | admin | template CRUD |
| `POST /enquiries/:id/follow-up` · `/cancel-follow-ups` · `GET /enquiries/:id/timeline` | admin | admission follow-up |
| `POST /fees/sweep` `{dryRun}` · `POST /fees/:feeId/remind` | admin | fee reminders |
| `POST /notices` · `POST /parents/notify` · `POST /parents/absences` | admin | notices, parent alerts |
| `GET/POST /campaigns` · `/:id` · `/:id/preview` · `/:id/launch` · `/:id/cancel` | admin | bulk |
| `GET/POST/DELETE /opt-outs` | admin | consent |
| `GET/DELETE /dev/outbox` | admin, non-prod | see mock messages as JSON |

Controllers use the `handle()` wrapper (`controllers/helpers.js`): `MessagingError → {success:false, code, message}`, anything else → generic 500.

## 7–10. Workflows

**OTP** (`OtpService`): normalise phone → cooldown (45s) + hourly cap (5) → HMAC-hash 6-digit code (`crypto.randomInt`) → store hash only →
send **inline** via `MessagingService` (template is `sensitive`: log stores `[REDACTED]`, no retry) → verify: atomic attempt counter (max 5),
constant-time compare, single-use → returns a 15-min signed `verificationToken`.
The protected endpoint (admission submit) calls `otp.assertVerified(token, phone, "admission_form")`.

**Admission enquiry** (`EnquiryFollowUpService`): `onEnquiryCreated(enquiry)` schedules `enquiry_welcome` (t+0), `enquiry_followup_1` (t+24h),
`enquiry_followup_2` (t+72h) as queued rows (idempotent per enquiry+step). A **guard** re-reads the enquiry before each send and cancels if it is
`converted/closed/admitted`, so nobody is nagged after enrolling. Admin can send manually or cancel the sequence.

**Fee reminder** (`FeeReminderService`): daily sweep (10:00 IST, `MESSAGING_FEE_SWEEP_HOUR`) over pending `fees-v2`; offset = today − dueDate;
if offset ∈ `-3,0,3,7` → `fee_due_upcoming / fee_due_today / fee_overdue` to the parent (student if no parent phone).
`idempotencyKey = fee:<id>:d<offset>:<parent|student>` → re-running the sweep, or running on 2 instances, never double-sends.
"Remind now" button is limited to one per fee per day. `sendPaymentReceived(feeId)` confirms payment.

**Bulk** (`BulkMessagingService`): `create (draft)` → `preview` (recipient count, invalid numbers, SMS segment estimate, rendered samples, **no sends**) →
`launch` (atomic status claim, recipients de-duplicated by phone, opt-outs skipped, chunked insert of queued rows with `campaign:<id>:<phone>` keys) →
worker drains at the provider's rate limit → `cancel` any time → status flips to `completed` automatically. Bulk priority < OTP/transactional.
Hard cap `MESSAGING_BULK_MAX_RECIPIENTS`.

Notices (`StudentNoticeService`) and parent alerts (`ParentNotificationService`) reuse these: notices are campaigns; parent alerts are single sends.

## 11. Integration snippets for existing routes (not auto-applied)

```js
// routes/publicEnquiry.js — after the enquiry is saved
const messaging = require("../messaging");
try { messaging.get().enquiry.onEnquiryCreated(enquiry); } catch (_) {}      // fire-and-forget, never breaks the form

// routes/admin/enquiries.js — status update handler
if (["converted","closed"].includes(status)) messaging.get().enquiry.cancelPending(req.params.id);

// routes/admin/fees.js — mark-paid handler
messaging.get().fees.sendPaymentReceived(fee._id).catch(() => {});

// admission form submit — require phone proof
messaging.get().otp.assertVerified(req.body.verifyToken, req.body.phone, "admission_form");
```
React: `await api.post('/api/messaging/otp/request',{phone,purpose:'admission_form'})` → `…/verify` → send `verificationToken` with the form.
In mock mode set `MESSAGING_OTP_EXPOSE_CODE_DEV=true` (non-production only) and the request response contains `devCode`, or read the server console / `GET /dev/outbox`.

## 12. Scalability & best practices

- **Outbox/queue in Mongo**: HTTP requests only insert rows; sending is async. Add worker instances (or a dedicated Render worker with `MESSAGING_WORKER_ENABLED=false` on web) — atomic `findOneAndUpdate` claims prevent double sends; stuck jobs are reclaimed after 2 min.
- **Idempotency keys** on every automated send (fees, enquiries, campaigns, absence alerts) → cron overlap / retries / double-clicks are harmless.
- **Rate limiting** per channel in the worker to stay inside vendor TPS (divide by instance count when scaling out).
- **Retry** with exponential backoff, retryable vs permanent errors, optional channel fallback (WhatsApp → SMS).
- **Compliance**: transactional/service/promotional categories, opt-out registry, quiet hours (21:00–08:00 IST) for non-transactional, DLT/WhatsApp template registration via `providerRefs`.
- **Security**: OTP hashed + capped + single-use + not logged; rate-limited public routes; webhook authentication per provider; phone masked in console output; log TTL.
- **Observability**: every transition is appended to `events[]`; `/status` shows queue depth per status; `/logs` is filterable.
- **Growth path**: replace `DispatchWorker` with BullMQ/Redis (you already have `connect-redis`) calling the same `messaging.dispatch(row)`; move `NotificationLog` to a time-series/archival collection if volume exceeds millions; add a provider-level circuit breaker/health check in `ProviderRegistry`.
- **Templates are data**, versioned, activatable — marketing copy changes need no deploy.
- **Testing**: `npm run test:messaging` (no DB needed); `npm run messaging:smoke` (real Mongo, still mock provider).

## Notes about this codebase
- `jsonDb` uses the native MongoDB driver, but nothing connected **mongoose** at runtime. `messaging.init()` now opens a mongoose connection to the same `MONGODB_URI` (only if none is open). This also means the existing `models/DeviceToken.js` has a connection now.
- The older `utils/sms.js` (Twilio) and `utils/whatsapp.js` are untouched; migrate `routes/admin/communication.js` to this layer when you're ready.
- `sift` was added to `devDependencies` (tests only). Run `npm install`.
