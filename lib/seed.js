'use strict';
const db = require('./db');

async function seed() {
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  
  // Check if admin exists
  const existingAdmin = await db.getUserByUsernameOrEmail('admin');
  if (!existingAdmin) {
    const id = await db.createUser({
      username: 'admin',
      email: 'admin@fidelity.local',
      password: adminPass,
      full_name: 'Site Administrator',
      role: 'admin',
      status: 'active',
    });
    console.log(`[seed] admin created  -> username: admin  password: ${adminPass}`);
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
    await db.seedDefaultPortfolio(id);
    await db.seedUserExtras(id);
    await db.seedTransactions(id);
    console.log('[seed] demo user created -> username: jdoe  password: password');
  } else {
    await db.seedUserExtras(demo.id);
    await db.seedTransactions(demo.id);
    console.log('[seed] demo user already exists');
  }
  
  console.log('[seed] Seed complete! Login: admin/admin123 or jdoe/password');
}

if (require.main === module) {
  seed().catch(err => {
    console.error('[seed] Error:', err.message);
    process.exit(1);
  });
}

module.exports = seed;