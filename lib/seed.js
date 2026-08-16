'use strict';
require('dotenv').config();
const db = require('./db');

// Helper: call db method only if it exists (db-pg.js and db-sqlite.js may not
// export seedDefaultPortfolio / seedUserExtras / seedTransactions).
function maybe(name, ...args) {
  if (typeof db[name] === 'function') return db[name](...args);
  return Promise.resolve();
}

async function seed() {
  // In PostgreSQL mode, ensure schema tables exist before seeding users.
  // db.initDb is only exported by db-pg.js (idempotent CREATE TABLE IF NOT EXISTS).
  if (typeof db.initDb === 'function') {
    try { await db.initDb(); } catch (e) { console.error('[seed] initDb failed:', e.message); }
  }

  const adminPass = process.env.ADMIN_PASS || 'admin123';

  // Check if admin exists
  const existingAdmin = await db.getUserByUsernameOrEmail('admin');
  if (!existingAdmin) {
    const id = await db.createUser({
      username: 'admin',
      email: 'admin@americansfinancial.local',
      password: adminPass,
      full_name: 'Site Administrator',
      role: 'admin',
      status: 'active',
    });
    if (id) {
      await maybe('seedDefaultPortfolio', id);
      await maybe('seedUserExtras', id);
      await maybe('seedTransactions', id);
    }
    console.log(`[seed] admin created -> username: admin  password: ${adminPass}`);
  } else {
    console.log('[seed] admin already exists');
  }

  // Check if demo user exists
  const demo = await db.getUserByUsernameOrEmail('jdoe');
  if (!demo) {
    const id = await db.createUser({
      username: 'jdoe',
      email: 'jane.doe@example.com',
      password: 'password',
      full_name: 'Jane Doe',
      role: 'user',
      status: 'active',
    });
    if (id) {
      await maybe('seedDefaultPortfolio', id);
      await maybe('seedUserExtras', id);
      await maybe('seedTransactions', id);
    }
    console.log('[seed] demo user created -> username: jdoe  password: password');
  } else {
    await maybe('seedUserExtras', demo.id);
    await maybe('seedTransactions', demo.id);
    console.log('[seed] demo user already exists');
  }

  console.log('[seed] complete! Login: admin/admin123 or jdoe/password');
}

if (require.main === module) {
  seed().catch(err => {
    console.error('[seed] Error:', err.message);
  });
}

module.exports = seed;
