// Set DATABASE_URL before requiring anything else
process.env.DATABASE_URL = "postgresql://postgres.ksnqvngdnbhkwzdeyzdw:wHpXzP0jDdIkhWVu@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
process.argv[1] = 'test';

console.log('=== Test 1: Loading db-pg.js ===');
try {
  const db = require('../lib/db-pg');
  console.log('db-pg.js loaded OK');
  console.log('fixProfilesTable:', typeof db.fixProfilesTable);
  console.log('initDb:', typeof db.initDb);
  console.log('getProfile:', typeof db.getProfile);
} catch(e) {
  console.log('FAILED to load db-pg.js:', e.message);
  console.log(e.stack);
}

// Wait for module-level initDb to complete, then check
setTimeout(async () => {
  console.log('\n=== Test 2: Testing profiles table schema ===');
  try {
    const db = require('../lib/db-pg');
    const result = await db.db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY ordinal_position"
    );
    console.log('profiles columns:');
    result.rows.forEach(r => console.log('  ' + r.column_name + ' (' + r.data_type + ')'));
  } catch(e) {
    console.log('Query FAILED:', e.message);
  }

  console.log('\n=== Test 3: Test getProfile(2) ===');
  try {
    const db = require('../lib/db-pg');
    const profile = await db.getProfile(2);
    console.log('Profile for user_id=2:', profile ? 'found' : 'null');
  } catch(e) {
    console.log('getProfile FAILED:', e.message);
  }

  console.log('\n=== Test 4: Run fixProfilesTable ===');
  try {
    const db = require('../lib/db-pg');
    if (typeof db.fixProfilesTable === 'function') {
      await db.fixProfilesTable();
      console.log('fixProfilesTable completed OK');
    } else {
      console.log('fixProfilesTable not a function');
    }
  } catch(e) {
    console.log('fixProfilesTable FAILED:', e.message);
  }

  console.log('\n=== Test 5: Re-check profiles table schema after fix ===');
  try {
    const db = require('../lib/db-pg');
    const result = await db.db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY ordinal_position"
    );
    console.log('profiles columns:');
    result.rows.forEach(r => console.log('  ' + r.column_name + ' (' + r.data_type + ')'));
  } catch(e) {
    console.log('Query FAILED:', e.message);
  }

  console.log('\n=== Test 6: Test getProfile(2) after fix ===');
  try {
    const db = require('../lib/db-pg');
    const profile = await db.getProfile(2);
    console.log('Profile for user_id=2:', profile ? JSON.stringify(profile) : 'null');
  } catch(e) {
    console.log('getProfile FAILED:', e.message);
  }

  process.exit(0);
}, 5000);
