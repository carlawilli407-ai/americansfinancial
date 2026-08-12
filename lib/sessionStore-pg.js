'use strict';
// Express-session store using connect-pg-simple for PostgreSQL

const session = require('express-session');
const Pool = require('pg').Pool;

// PostgreSQL pool will be created when DATABASE_URL is set
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

class PgSessionStore extends session.Store {
  constructor(options) {
    super(options);
    this.pool = getPool();
    this.tableName = options?.tableName || 'sessions';
  }

  async get(sid, callback) {
    try {
      const res = await this.pool.query(
        'SELECT sess FROM ' + this.tableName + ' WHERE sid = $1 AND expire > $2',
        [sid, Date.now()]
      );
      const row = res.rows[0];
      callback(null, row ? row.sess : null);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const expire = (sess.cookie && sess.cookie.expires)
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 28800000;
      
      await this.pool.query(
        'INSERT INTO ' + this.tableName + ' (sid, sess, expire) VALUES ($1, $2, $3) ' +
        'ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3',
        [sid, sess, expire]
      );
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.pool.query('DELETE FROM ' + this.tableName + ' WHERE sid = $1', [sid]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async clear(callback) {
    try {
      await this.pool.query('DELETE FROM ' + this.tableName);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async length(callback) {
    try {
      const res = await this.pool.query('SELECT COUNT(*) as count FROM ' + this.tableName);
      callback(null, res.rows[0].count);
    } catch (err) {
      callback(err);
    }
  }
}

// Auto-create the sessions table
async function initSessionsTable() {
  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    TEXT PRIMARY KEY,
        sess   JSONB NOT NULL,
        expire BIGINT NOT NULL
      )
    `);
  } catch (err) {
    console.error('Error creating sessions table:', err.message);
  }
}

initSessionsTable();

module.exports = new PgSessionStore();