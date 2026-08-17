'use strict';
/**
 * Shared PostgreSQL pool for Supabase / Railway.
 * Use one pool across db-pg.js and sessionStore-pg.js to avoid connection
 * exhaustion on serverless (Vercel) cold starts.
 */
const { Pool } = require('pg');

let pool = null;

function usesPgBouncer(connectionString) {
  if (!connectionString) return false;
  const url = connectionString.toLowerCase();
  return url.includes('pgbouncer=true') || url.includes(':6543/');
}

function getPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  const pgbouncer = usesPgBouncer(connectionString);
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    // Transaction pooler (Supabase port 6543) does not support prepared statements.
    prepare: pgbouncer ? false : undefined,
    max: process.env.VERCEL ? 5 : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    pool.on('error', (err) => {
      console.error('[pg-pool] idle client error:', err.message);
    });
  }
  return pool;
}

module.exports = { getPool, getPoolConfig, usesPgBouncer };
