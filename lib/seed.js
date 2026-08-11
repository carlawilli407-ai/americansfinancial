'use strict';
const db = require('./db');

function seed() {
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const admin = db.getUserByUsernameOrEmail('admin');
  if (!admin) {
    const id = db.createUser({
      username: 'admin', email: 'admin@fidelity.local',
      password: adminPass, full_name: 'Site Administrator', role: 'admin', status: 'active',
    });
    console.log(`[seed] admin created  -> username: admin  password: ${adminPass}`);
  } else {
    // Ensure admin never carries a stale client portfolio from a previous run
    const removed = db.pruneAdminClientData(admin.id);
    if (removed > 0) console.log(`[seed] admin client data pruned (${removed} rows removed)`);
    console.log('[seed] admin already exists');
  }

  const demo = db.getUserByUsernameOrEmail('jdoe');
  if (!demo) {
    const id = db.createUser({
      username: 'jdoe', email: 'jane.doe@example.com',
      password: 'password', full_name: 'Jane Doe', role: 'user', status: 'active',
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
}

if (require.main === module) seed();
module.exports = seed;
