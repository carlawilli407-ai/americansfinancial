'use strict';

/**
 * Database Module - Automatic PostgreSQL/SQLite Selection
 * 
 * Environment:
 * - DATABASE_URL set: Uses PostgreSQL (Railway)
 * - No DATABASE_URL: Uses SQLite (local dev)
 * 
 * Exports: { db, sessionStore }
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

module.exports = { db, sessionStore };