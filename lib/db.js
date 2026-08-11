'use strict';

/**
 * Database Module - Automatic PostgreSQL/SQLite Selection
 * 
 * Environment:
 * - DATABASE_URL set: Uses PostgreSQL (Railway)
 * - No DATABASE_URL: Uses SQLite (local dev)
 * 
 * PostgreSQL module: Requires 'pg' package
 */

const isPostgres = !!process.env.DATABASE_URL;

if (isPostgres) {
  // Use PostgreSQL adapter
  module.exports = require('./db-pg');
} else {
  // Use SQLite adapter
  module.exports = require('./db-sqlite');
}