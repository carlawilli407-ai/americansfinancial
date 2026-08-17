'use strict';
// Express-session store using connect-pg-simple for PostgreSQL

const session = require('express-session');
const { getPool } = require('./pg-pool');

// Auto-create the sessions table (lazy, called on first use)
let sessionsTableInitialized = false;
async function ensureSessionsTable() {
  if (sessionsTableInitialized) return;
  const p = getPool();
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    TEXT PRIMARY KEY,
        sess   JSONB NOT NULL,
        expire BIGINT NOT NULL
      )
    `);
    const col = await p.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'expire'"
    );
    const dtype = col.rows[0] && col.rows[0].data_type;
    if (dtype && String(dtype).indexOf('timestamp') !== -1) {
      await p.query("ALTER TABLE sessions ALTER COLUMN expire TYPE BIGINT USING (EXTRACT(EPOCH FROM expire) * 1000)::BIGINT");
    }
    sessionsTableInitialized = true;
  } catch (err) {
    console.error('Error creating sessions table:', err.message);
  }
}

class PgSessionStore extends session.Store {
  constructor(options) {
    super(options);
    this.pool = getPool();
    this.tableName = options?.tableName || 'sessions';
  }

  async get(sid, callback) {
    try {
      await ensureSessionsTable();
      const res = await this.pool.query(
        'SELECT sess FROM ' + this.tableName + ' WHERE sid = $1 AND expire > $2',
        [sid, Date.now()]
      );
      const row = res.rows[0];
      let sess = row ? row.sess : null;
      if (typeof sess === 'string') {
        try { sess = JSON.parse(sess); } catch (_) { sess = null; }
      }
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      await ensureSessionsTable();
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
      await ensureSessionsTable();
      await this.pool.query('DELETE FROM ' + this.tableName + ' WHERE sid = $1', [sid]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async clear(callback) {
    try {
      await ensureSessionsTable();
      await this.pool.query('DELETE FROM ' + this.tableName);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async length(callback) {
    try {
      await ensureSessionsTable();
      const res = await this.pool.query('SELECT COUNT(*) as count FROM ' + this.tableName);
      callback(null, res.rows[0].count);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = new PgSessionStore();