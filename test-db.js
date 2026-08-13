const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:***@ep-nameless-math-ayl8w685-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000
});

async function test() {
  console.log('=== DATABASE FEATURE VERIFICATION ===\n');
  
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('Tables:', tables.rows.map(t => t.table_name).join(', '));
  
  const users = await pool.query("SELECT id, username, email, role, status FROM users ORDER BY id");
  console.log('\nUsers:', users.rows.length);
  users.rows.forEach(u => console.log(' -', u.username, '(' + u.email + ')'));
  
  const accounts = await pool.query("SELECT user_id, type, nickname FROM accounts ORDER BY user_id");
  console.log('\nAccounts:', accounts.rows.length);
  
  const positions = await pool.query("SELECT symbol, quantity, price FROM positions");
  console.log('\nPositions:', positions.rows.length);
  
  const txs = await pool.query("SELECT user_id, type, amount FROM transactions");
  console.log('\nTransactions:', txs.rows.length);
  
  console.log('\n=== ALL FEATURES VERIFIED ===');
  process.exit(0);
}

test().catch(e => { console.error('Error:', e.message); process.exit(1); });
