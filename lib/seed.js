'use strict';
require('dotenv').config();
const db = require('./db');

async function seed() {
  // Skip seeding if DATABASE_URL is set (PostgreSQL/Supabase)
  if (process.env.DATABASE_URL) {
    console.log('[seed] PostgreSQL/Supabase mode - skip seeding, create users via /admin/new');
    return;
  }

  const adminPass = process.env.ADMIN_PASS || 'admin123';
  
  // Check if admin exists
  const existingAdmin = db.getUserByUsernameOrEmail('admin');
  if (!existingAdmin) {
    const id = db.createUser({
      username: 'admin',
      email: 'admin@americansfinancial.local',
      password: adminPass,
      full_name: 'Site Administrator',
      role: 'admin',
      status: 'active',
    });
    console.log(`[seed] admin created -> username: admin  password: ${adminPass}`);
  } else {
    console.log('[seed] admin already exists');
  }

  // Check if demo user exists
  const demo = db.getUserByUsernameOrEmail('jdoe');
  if (!demo) {
    const id = db.createUser({
      username: 'jdoe',
      email: 'jane.doe@example.com',
      password: 'password',
      full_name: 'Jane Doe',
      role: 'user',
      status: 'active',
    });
    db.seedDefaultPortfolio(id);
    db.seedUserExtras(id);
    db.seedTransactions(id);
    console.log('[seed] demo user created -> username: jdoe  password: password');
  } else {
    db.seedUserExtras(demo.id);
    db.seedTransactions(demo.id);
    console.log('[seed] demo user already exists');
  }
  
  console.log('[seed complete! Login: admin/admin123 or jdoe/password');
}

if (require.main === module) {
  seed().catch(err => {
    console.error('[seed] Error:', err.message);
  });
}

module.exports = seed;