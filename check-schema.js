require('dotenv').config();
const {Pool} = require('pg');
new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}})
  .query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users'")
  .then(r => { console.log(r.rows); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
