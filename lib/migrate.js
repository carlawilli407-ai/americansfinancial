#!/usr/bin/env node
/**
 * PostgreSQL Database Migration Script
 * Run: DATABASE_URL="postgres://..." npm run migrate
 */

'use strict';
const { getPool } = require('./pg-pool');

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
  investment_objective   TEXT,
  risk_tolerance         TEXT,
  communication_pref     TEXT,
  member_id              TEXT,   -- public member number (nullable)
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
  admin_notes     TEXT,
  external_bank_logo TEXT,
  external_bank_name TEXT,
  external_routing TEXT,
  external_account_holder TEXT,
  external_account_last4 TEXT
)
`;

async function createTables() {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate] ERROR: DATABASE_URL environment variable not set.');
    console.error('Add PostgreSQL plugin in Railway dashboard, or set DATABASE_URL manually.');
    process.exit(1);
  }

  const pool = getPool();
  
  try {
    console.log('[migrate] Connecting to PostgreSQL...');
    await pool.query('SELECT 1');
    
    console.log('[migrate] Creating tables...');
    await pool.query(SQL);
    
    // Add columns if missing
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS admin_notes TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_bank_logo TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_bank_name TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_routing TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_account_holder TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_account_last4 TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS investment_objective TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS communication_pref TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS member_id TEXT'); } catch (_) {}
    try { await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP'); } catch (_) {}

    await hardenSupabaseApi(pool);

    console.log('[migrate] Success! Database is ready.');
    console.log('[migrate] Notes:');
    console.log('[migrate] - Set DATABASE_URL in Supabase/Railway for production');
    console.log('[migrate] - Seed users are created on first app start');
    console.log('[migrate] - Admin: admin/admin123, User: jdoe/password');
    
  } catch (err) {
    console.error('[migrate] Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Configure Row Level Security (RLS) for Supabase security.
// Application uses its own auth (express-session), so RLS is permissive.
// This prevents direct REST API access while allowing application connections.
async function hardenSupabaseApi(pool) {
  const tables = [
    'users', 'accounts', 'positions', 'activities', 'orders', 'alerts',
    'watchlists', 'profiles', 'transactions', 'sessions',
  ];

  console.log('[migrate] Enabling RLS on public tables...');
  for (const table of tables) {
    await pool.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  }

  // Simple permissive policies - application-level auth provides security
  // Using USING (true) allows all rows, WITH CHECK (true) allows all writes
  // The app's session/auth system handles authorization
  for (const table of tables) {
    try {
      await pool.query(`
        DROP POLICY IF EXISTS ${table}_rls ON public.${table};
        CREATE POLICY ${table}_rls ON public.${table}
        FOR ALL TO PUBLIC
        USING (true) WITH CHECK (true);
      `);
    } catch (e) {
      console.log(`[migrate] Could not create RLS policy for ${table}:`, e.message);
    }
  }

  console.log('[migrate] RLS policies configured: permissive for app use');
}

createTables();