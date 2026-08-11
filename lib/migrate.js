#!/usr/bin/env node
/**
 * PostgreSQL Database Migration Script
 * Run: DATABASE_URL="postgres://..." npm run migrate
 */

'use strict';
const { Pool } = require('pg');

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  nickname   TEXT,
  number     TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS positions (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  name        TEXT,
  quantity    REAL NOT NULL,
  price       REAL NOT NULL,
  cost_basis  REAL NOT NULL,
  is_cash     BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS activities (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adate       TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      REAL,
  type        TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL,
  type         TEXT NOT NULL,
  quantity     REAL NOT NULL,
  limit_price  REAL,
  status       TEXT NOT NULL DEFAULT 'Open',
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  symbol     TEXT,
  trigger    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlists (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  symbols    TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profiles (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone              TEXT,
  address_line1      TEXT,
  address_line2      TEXT,
  city               TEXT,
  state              TEXT,
  zip_code           TEXT,
  country            TEXT DEFAULT 'USA',
  date_of_birth      TEXT,
  ssn_last4          TEXT,
  employment_status  TEXT,
  employer_name      TEXT,
  employer_address   TEXT,
  job_title          TEXT,
  annual_income      TEXT,
  net_worth          TEXT,
  investment_experience TEXT,
  risk_tolerance     TEXT,
  citizenship        TEXT DEFAULT 'US',
  tax_id_type        TEXT DEFAULT 'SSN',
  tax_id             TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  tdate           TEXT NOT NULL,
  type            TEXT NOT NULL,
  symbol          TEXT,
  description     TEXT NOT NULL,
  quantity        REAL,
  price           REAL,
  amount          REAL NOT NULL,
  balance_after   REAL,
  status          TEXT DEFAULT 'settled',
  reference_id    TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMP WITH TIME ZONE,
  admin_notes     TEXT
)
`;

async function createTables() {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate] ERROR: DATABASE_URL environment variable not set.');
    console.error('Add PostgreSQL plugin in Railway dashboard, or set DATABASE_URL manually.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('[migrate] Connecting to PostgreSQL...');
    await pool.connect();
    
    console.log('[migrate] Creating tables...');
    await pool.query(SQL);
    
    // Add columns if missing
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS admin_notes TEXT'); } catch (_) {}
    
    console.log('[migrate] Success! Database is ready.');
    console.log('[migrate] Notes:');
    console.log('[migrate] - Set DATABASE_URL in Railway for production');
    console.log('[migrate] - Seed users are created on first app start');
    console.log('[migrate] - Admin: admin/admin123, User: jdoe/password');
    
  } catch (err) {
    console.error('[migrate] Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createTables();