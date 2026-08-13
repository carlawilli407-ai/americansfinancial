require('dotenv').config();
const {Pool} = require('pg');
new Pool({connectionString: process.env.DATABASE_URL})
  .query("SELECT * FROM users WHERE username = 'admin'")
  .then(r => {
    console.log(r.rows[0]);
    process.exit(0);
  })
  .catch(e => {
    console.log(e.message);
    process.exit(1);
  });
