# Notice Push Fix Round 2 — Personalized deep-link id + duplicate notification bug

Two more backend fixes, on top of the earlier FCM-delivery fix
(NOTIFICATION_FIX_README.md). Both verified with isolated unit tests
(21/21 passing) before delivery.

## 1. Notice taps now open the actual Notice (not just the app)

**Problem:** `routes/teacherRoutes.js` sent `deepLinkId: null` for every
Notice push, on purpose, because a Notice has no single shared target the
way a live class or test does — every student's tap needs to open *their
own* notification row (the Flutter app resolves a tap via
`GET /api/notifications/:id`, scoped to that student's own id).

**Fix:**
- **`services/fcm.js`** — new `sendPersonalizedToUsers(userDeepLinkMap, payload)`.
  Unlike `sendToUsers` (one shared message to every token via
  `sendEachForMulticast`), this builds one `Message` per token via
  `sendEach()` — still a single batched Firebase API call per 500-token
  chunk, but each message can carry a *different* `data.id`. Same
  dead-token pruning behavior as `sendToUsers`.
- **`services/notifications.js`** — `notifyManyAndPush()` now checks: if
  the caller passes an explicit `deepLinkId` (live classes, test alerts —
  unchanged, still one shared id for everyone), use the existing
  `sendToUsers` path. If `deepLinkId` is left `null`/`undefined` (Notices),
  it builds a `{userId: theirOwnNotificationId}` map from the
  notifications it just created, and calls `sendPersonalizedToUsers`
  instead.
- **`routes/teacherRoutes.js`** — no call-site change needed here beyond
  the duplicate-loop removal below; it already passes `null` for Notices,
  which now means "use each student's own id" instead of "no id at all."

## 2. Removed the duplicate notification bug

**Problem:** `/notices` called `notificationService.createNotification()`
in its own loop, **and then** called `notifyManyAndPush()` — which
*also* calls `createNotification()` once per student internally. Every
Notice was being written twice into each student's in-app Notifications
list.

**Fix:** removed the standalone loop in `routes/teacherRoutes.js`;
`notifyManyAndPush()` alone now creates each student's notification
(needed anyway for fix #1 above, since it needs each notification's own
id) and sends the push.

## Files changed (on top of the first fix package)

- `services/fcm.js`
- `services/notifications.js`
- `routes/teacherRoutes.js`

Copy these over the versions from the first fix (or over your repo
directly — they include everything from round 1 plus these changes).
No other files need touching; `routes/admin/communication.js`'s broadcast
push was checked and doesn't have either problem (it calls
`createNotification` once per student directly, not through
`notifyManyAndPush`, and its "general" category doesn't use a deep-link id
on the app side either way).
