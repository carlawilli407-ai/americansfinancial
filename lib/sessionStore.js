'use strict';
// SQLite-backed session store (express-session compatible) using better-sqlite3.
// Reuses the existing DB connection so no extra native dependency is needed.
const session = require('express-session');
const { db } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
)`);

const _get  = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?');
const _set  = db.prepare(`INSERT INTO sessions (sid, sess, expire) VALUES (@sid, @sess, @expire)
                          ON CONFLICT(sid) DO UPDATE SET sess=@sess, expire=@expire`);
const _del  = db.prepare('DELETE FROM sessions WHERE sid = ?');
const _clean = db.prepare('DELETE FROM sessions WHERE expire < ?');
const _len  = db.prepare('SELECT COUNT(*) c FROM sessions');

class SqliteStore extends session.Store {
  constructor() { super(); }

  get(sid, cb) {
    try { const r = _get.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); }
    catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = (sess.cookie && sess.cookie.expires)
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 28800000;
      _set.run({ sid, sess: JSON.stringify(sess), expire: exp });
      cb(null);
    } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  destroy(sid, cb) { try { _del.run(sid); cb(null); } catch (e) { cb(e); } }
  clear(cb) { try { db.prepare('DELETE FROM sessions').run(); cb(null); } catch (e) { cb(e); } }
  length(cb) { try { cb(null, _len.get().c); } catch (e) { cb(e); } }
}

// periodically drop expired sessions
const timer = setInterval(() => { try { _clean.run(Date.now()); } catch (_) {} }, 3600000);
if (timer.unref) timer.unref();

module.exports = new SqliteStore();
