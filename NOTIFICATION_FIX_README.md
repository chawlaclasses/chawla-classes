# Push Notification Fix — Chawla Classes

## Root cause (confirmed, reproduced in isolated tests — 15/15 pass)

`services/fcm.js` queried device tokens through a **Mongoose model**
(`models/DeviceToken.js`), but **Mongoose is never connected anywhere in
this app** — `app.js`/`server.js`/`services/jsonDb.js` only use the native
`mongodb` driver directly, never `mongoose.connect()`. The only two files
in the whole codebase that call `mongoose.connect()` are one-off migration
scripts (`scripts/backfill-r2.js`, `scripts/fix-marketing-banner-urls.js`),
neither of which runs inside the web server process.

Mongoose queues ("buffers") any query issued before a connection exists,
and by default gives up after 10 seconds — which is **exactly** the
`Operation devicetokens.find() buffering timed out after 10000ms` error in
your logs. The earlier `Cast to ObjectId failed ... at path "userId"` error
was a *different*, already-fixed instance of the same root problem (the
Mongoose schema used to type `userId` as `ObjectId`; it's `String` now) —
it stopped happening once the schema was changed, but the underlying
"Mongoose has no connection" problem was never actually fixed, it just
started failing a different way (timeout instead of cast error).

Meanwhile, the device token your student's phone actually registers is
saved via `routes/studentRoutes.js` → `services/jsonDb.js` (your real,
connected MongoDB layer) into the same `deviceTokens` collection — so the
data was always there ("`deviceTokens` collection contains records" — you
were right), `services/fcm.js` was just asking a *different, non-existent*
database connection for it.

## Files changed

1. **services/fcm.js** — the fix. Reads device tokens via `services/jsonDb.js`
   (the same connected store the token-registration route writes to)
   instead of the disconnected Mongoose model. Also fixes 3 smaller bugs
   found during the audit (see report below): missing `sendToUser` export,
   `type`/`id` silently dropped for the `{data:{type,id}}` payload shape
   `services/notifications.js` actually sends, and a bad-payload FCM error
   that would have wiped every student's device token.
2. **server.js** — now actually calls `fcm.verifyAtStartup()` at boot (it
   previously only existed in `server-startup-snippet.js.example`, a file
   nothing required), so a broken Firebase credential shows up loudly in
   your Render logs at deploy time instead of silently at the next notice.
3. **routes/admin/communication.js** — the admin Communication Center's
   "Push" channel previously only wrote the in-app notification row and
   never called FCM at all (separate bug from the Mongoose one, same
   symptom). Now sends a real push too.
4. **.env.example** — documents the Firebase env vars that were missing
   from it entirely (your Render env already has working credentials —
   confirmed by the fact that the error trace reaches the *token lookup*,
   which only runs after credentials check out).

## What to do

1. Copy these 4 files into your repo at the same paths, overwriting the
   existing ones.
2. Deploy. Watch the Render boot log for:
   `✅ [FCM] Firebase credentials verified — push notifications enabled`
3. Send a test Notice. You should see in the logs:
   `[FCM] notice/<id>: devices=N ok=N fail=0 pruned=0`
   with `devices` > 0 this time (previously the `find()` call never
   returned, so this line never even printed).

## Recommended cleanup (not required, didn't touch these)

`models/DeviceToken.js` and `routes/deviceTokens.js` are Mongoose-based
leftovers from an earlier attempt at this feature — `routes/deviceTokens.js`
is never mounted in `app.js` at all, and after this fix nothing requires
`models/DeviceToken.js` anymore either. Safe to delete both once you've
confirmed the fix works, to avoid a future engineer (or AI) getting misled
by them again the way this bug happened in the first place.
