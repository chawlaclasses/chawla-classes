# Recipient Selection System (Marketing → New Campaign)

Additive module. The existing Marketing "Campaigns" screen and its routes
(`/send`, `/history`, `/targets/preview`) are unchanged — that tab is now
labelled **Quick Send**.

## What admins get (Marketing sidebar → new tabs)

- **New Campaign** — name + channel → *Select Recipients* (All Students,
  Active Students Only, Fee Due Students, New Enquiries, Parents Only,
  Teachers Only, Custom Selection) → *Class Filters* (Class 9, 10,
  11 Commerce, 12 Commerce + any real class/stream from Classes) → recipient
  table (search name/mobile, class + status filters, Select All, Unselect All,
  pagination, live "Selected Recipients: N") → message (+ `{name}`,
  `{student}`, `{class}` placeholders) → exact preview → cost estimate →
  confirmation modal → send.
- **Campaign History** — name, message, total recipients, successful, failed,
  total cost, created by, created at. Search + pagination. Older campaigns
  (sent via Quick Send) appear too; their cost shows "—".
- **Settings → Campaign Costs** — cost per SMS unit (default ₹0.20), WhatsApp
  message, Email.

## Selection model

`effective = (autoKeys − excluded) ∪ (included ∩ pool)`

Ticking a group auto-selects everyone in it; un-ticking a row *excludes* them.
**Custom Selection** only makes everyone available (selects nobody).
The browser sends this compact spec; the server re-evaluates it
(`services/recipientEngine.js`) and that result is what is sent to.

## SMS units & cost

GSM-7: 160 chars = 1 SMS, then 153 per part. Hindi / emoji / the ₹ sign switch
to Unicode: 70, then 67 per part. `cost = total units × cost per unit`.
Only messages the provider accepted are billed in *Total Cost*.

## Validation (server-side, also shown in the UI)

Blocked when: no campaign name, empty message, no recipients selected, none of
the selected have a valid mobile number, channel unavailable, message > 1000
chars, > 1000 recipients. Invalid numbers are skipped (and counted); duplicate
numbers (siblings sharing a parent number) get one message. One send per admin
at a time (double-click / 2nd tab → 409).

## Files

New
- `services/recipientEngine.js` — channel-agnostic directory/filter/selection
- `services/campaignChannels.js` — channel registry (sms, whatsapp, email, push-placeholder) + SMS unit counting
- `services/campaignEngine.js` — plan/estimate, validation, send
- `routes/admin/marketing-recipients.js` — `/api/admin/marketing/recipients/{meta,list,pool,estimate}`
- `public/admin/js/campaign-recipients.js` — New Campaign + Campaign History UI
- `__tests__/services/campaignEngine.test.js`, `__tests__/routes/marketing-recipients.test.js`, `__tests__/routes/settings-campaign-costs.test.js`

Edited (small, additive)
- `routes/admin/marketing-campaigns.js` — appended `POST /send-selected`, `GET /campaign-history`
- `routes/adminRoutes.js` — mounts `/marketing/recipients`
- `services/settings.js`, `routes/settings.js` — `campaignCosts` (+ validation)
- `public/admin/js/settings.js` — Campaign Costs card
- `public/admin/js/marketing.js`, `public/admin/dashboard.html` — tabs + script tag

## Adding a channel later (e.g. Push)

Add one entry to `services/campaignChannels.js` (`address`, `units`, `send`,
`available: true`). Selection, cost, validation, confirmation and history need
no changes. Push needs a device-token audience first (see `services/fcm.js`).

## Run the tests

`npx jest __tests__/services/campaignEngine.test.js __tests__/routes/marketing-recipients.test.js __tests__/routes/settings-campaign-costs.test.js`
