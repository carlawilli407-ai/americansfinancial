const { Pool } = require('pg');
const connectionString = 'postgresql://neondb_owner:***@ep-nameless-math-ayl8w685-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000
});
pool.query('SELECT NOW() as now, CURRENT_USER as user, current_database() as db')
  .then(r => { 
    console.log('SUCCESS');
    console.log('DB:', r.rows[0].db);
    pool.end();
    process.exit(0); 
  })
  .catch(e => { console.error('ERROR:', e.message); pool.end(); process.exit(1); });
