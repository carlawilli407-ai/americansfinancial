'use strict';

/**
 * Database Module - Automatic PostgreSQL/SQLite Selection
 * 
 * Environment:
 * - DATABASE_URL set: Uses PostgreSQL (Railway)
 * - No DATABASE_URL: Uses SQLite (local dev)
 * 
 * Usage:
 *   const db = require('./lib/db');
 *   const { sessionStore } = require('./lib/db');
 */

const isPostgres = !!process.env.DATABASE_URL;

let db, sessionStore;

if (isPostgres) {
  // PostgreSQL adapter
  db = require('./db-pg');
  // Use PostgreSQL session store
  sessionStore = require('./sessionStore-pg');
} else {
  // SQLite adapter
  db = require('./db-sqlite');
  // Use SQLite session store
  sessionStore = require('./sessionStore');
}

// Export db as the main module, with sessionStore as a property
db.sessionStore = sessionStore;

module.exports = db;