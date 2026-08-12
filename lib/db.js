'use strict';

/**
 * Database Module - Automatic PostgreSQL/SQLite Selection
 * Environment:
 * - DATABASE_URL set: Uses PostgreSQL (or Supabase PostgreSQL database)
 * - No DATABASE_URL: Uses SQLite
 * 
 * Usage:
 *   const db = require('./lib/db');
 *   const user = db.getUserByUsernameOrEmail('admin');
 */

const isPostgres = !!process.env.DATABASE_URL;

let db;
let sessionStore;

if (isPostgres) {
  // PostgreSQL mode (works with Supabase PostgreSQL database)
  db = require('./db-pg');
  sessionStore = require('./sessionStore-pg');
} else {
  // SQLite mode
  db = require('./db-sqlite');
  sessionStore = require('./sessionStore-sqlite');
}

// Attach sessionStore as property
db.sessionStore = sessionStore;

module.exports = db;