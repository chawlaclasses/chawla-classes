# jsonDb → MongoDB Migration

## Kya badla

- `services/jsonDb.js` ab MongoDB se backed hai (pehle `Data/*.json` files
  padhta-likhta tha). **Koi bhi controller/route/service file change nahi hui**
  — sab `db.find()`, `db.findById()`, `db.insertOne()` etc. bilkul pehle jaise
  hi kaam karte hain, kyunki adapter ab bhi in-memory mirror rakhta hai jisse
  sab reads synchronous hi hain. Sirf persistence layer disk se MongoDB shift
  hui hai.
- `server.js` ab boot par `db.connect()` await karta hai (MongoDB se connect +
  saare collections in-memory load) — uske baad hi server `listen` karta hai.
  Agar MongoDB unreachable ho to server boot hi nahi hoga (fail fast).
- 4 standalone scripts jo pehle jsonDb ko sync-ready maan ke chalte the
  (`create-admin.js`, `create-student.js`, `assign-class.js`,
  `reset-student-password.js`) ab pehle `db.connect()` karte hain.

## Setup steps

1. **MongoDB Atlas connection string** `.env` me daalo:
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/chawla_classes?retryWrites=true&w=majority
   ```
   (Atlas URI me database name usually path me hi hota hai — agar nahi hai to
   `MONGODB_DB_NAME` bhi set kar dena.)

2. **Dependencies install karo** (naya `mongodb` driver package.json me add
   ho chuka hai):
   ```
   npm install
   ```

3. **Purana data migrate karo** (agar `Data/*.json` ya `backups/backup-*/`
   me existing data hai):
   ```
   npm run migrate-to-mongo
   ```
   Ye script safe hai re-run karne ke liye — jo collection MongoDB me pehle
   se non-empty hai use skip kar deta hai (`--force` flag se overwrite kar
   sakte ho). Agar `Data/` folder repo me nahi hai (jaisa is zip me tha), to
   ye `backups/backup-2026-07-03T19-53-10-495Z/` se import karega.

4. **Server start karo**:
   ```
   npm start
   ```

## Jo cheezein isse touch nahi hui (follow-up ke liye)

- **Scheduled backups** (`server.js` me cron jobs, `scripts/backup.js`) abhi
  bhi `Data/` folder ko disk pe copy karte hain — ab woh folder live data
  nahi rakhta (MongoDB rakhta hai), isliye ye backups ab kaam ke nahi rahenge.
  Agar backups chahiye to inhe `mongodump`/Atlas ke built-in backup pe shift
  karna hoga (alag task).
- `scripts/fix-json.js`, `scripts/check-json.js`, `scripts/init-data.js`,
  `scripts/seed.js` — ye sab abhi bhi purane JSON-file-based tooling hain,
  in par haath nahi lagaya (in par bhi similar `db.connect()` wiring chahiye
  agar future me use karne hain).
- Jest tests (`__tests__/`) abhi MongoDB se connect nahi hote — agar CI me
  chalane hain to test setup me ek test MongoDB URI (ya `mongodb-memory-server`,
  jiske liye is sandbox me binary download blocked tha network restriction
  ki wajah se, par tumhare machine/CI pe kaam karega) wire karna hoga.
