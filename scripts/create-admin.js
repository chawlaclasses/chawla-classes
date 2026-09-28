/**
 * scripts/create-admin.js
 *
 * Creates the admin account if it doesn't exist, OR resets its
 * password/unlocks it if it does.
 *
 * FIX: the old version of this script only ever CREATED the admin once —
 * if a user with that email already existed (e.g. wrong/forgotten
 * password, account got locked after too many failed attempts, or
 * isActive got set to false) it just printed "Admin already exists" and
 * did nothing, leaving login permanently broken with no way to recover
 * short of hand-editing Data/users.json. This is almost certainly why
 * /api/admin/login was returning "Invalid credentials" — there is no
 * separate ADMIN_USERNAME/ADMIN_PASSWORD-based login path (that env-var
 * driven hash in services/auth.js is never actually wired into any
 * route); the ONLY thing /api/admin/login checks is a real record in the
 * 'users' collection with a matching bcrypt password hash.
 *
 * This version now:
 *   - creates the admin if missing (same as before), OR
 *   - resets the password, re-activates the account, and clears any
 *     lockout/failed-attempt counters if it already exists
 *
 * Usage:
 *   npm run create-admin
 *   npm run create-admin -- you@example.com "SomeNewPassword123"
 *
 * (defaults to admin@chawlaclasses.com / admin123 if no args given —
 * change the password immediately after logging in)
 */


require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../services/jsonDb');
const { BCRYPT_ROUNDS } = require('../config');
const { STAFF_ROLES } = require('../config/permissions');

const EMAIL = process.argv[2] || 'admin@chawlaclasses.com';
const PASSWORD = process.argv[3] || 'admin123';

async function createAdmin() {
  if (PASSWORD.length < 8) {
    console.warn('⚠️  Password is shorter than 8 characters — fine for local testing, but pick something stronger for production.');
  }

  const hashedPassword = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  const existing = db.findOne('users', { email: EMAIL });

  if (existing) {
    if (!STAFF_ROLES.includes(existing.role)) {
      console.log(`ℹ️  Existing account has role "${existing.role}" (not a staff role) — setting it to "admin" so it can log in at /admin/login.html.`);
    }

    db.updateById('users', existing._id, {
      password: hashedPassword,
      role: STAFF_ROLES.includes(existing.role) ? existing.role : 'admin',
      isActive: true,
      loginAttempts: 0,
      lockUntil: null,
    });

    console.log('✅ Admin account reset (password updated, unlocked, re-activated):');
    console.log(`   Email: ${EMAIL}`);
    console.log(`   Password: ${PASSWORD}`);
    console.log(`   ID: ${existing._id}`);
    return;
  }

  const admin = db.insertOne('users', {
    name: 'Admin',
    email: EMAIL,
    password: hashedPassword,
    role: 'admin',
    isActive: true,
    loginAttempts: 0,
    lockUntil: null,
  });

  console.log('✅ Admin created:');
  console.log(`   Email: ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   ID: ${admin._id}`);
}


// FIX (jsonDb -> MongoDB migration): this script used to be able to read/
// write the in-memory jsonDb singleton the instant it was require()'d,
// since it hydrated itself synchronously from Data/*.json in its
// constructor. It now needs a real MongoDB connection first, so db.connect()
// is awaited before createAdmin() runs, and the process is exited
// explicitly afterwards since an open MongoClient handle would otherwise
// keep this one-off script running forever.
db.connect()
  .then(createAdmin)
  .catch((err) => {
    console.error('❌ Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());

createAdmin().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
