#!/usr/bin/env node
/**
 * PostgreSQL Seed Script for Render Deployment / Supabase
 * Run: npm run seed-postgres
 */

'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Full schema for PostgreSQL
const SCHEMA = `
-- Users
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

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  nickname   TEXT,
  number     TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Positions
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

-- Activities
CREATE TABLE IF NOT EXISTS activities (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adate       TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      REAL,
  type        TEXT
);

-- Orders
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

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  symbol     TEXT,
  trigger    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  symbols    TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);

-- Profiles
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

-- Transactions
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
);

-- Add transaction columns if missing
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_bank_logo TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_bank_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_routing TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_account_holder TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_account_last4 TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS member_id TEXT;
`;

async function seedPostgres() {
  if (!process.env.DATABASE_URL) {
    console.error('[seed-postgres] ERROR: DATABASE_URL not set');
    console.error('[seed-postgres] Set DATABASE_URL in Render environment variables');
    process.exit(1);
  }

  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('[seed-postgres] Connecting to PostgreSQL...');
    await pool.connect();
    
    console.log('[seed-postgres] Creating tables...');
    await pool.query(SCHEMA);
    
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    
    // Create admin user
    const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (!adminExists.rows.length) {
      const password_hash = bcrypt.hashSync(adminPass, 10);
      const result = await pool.query(
        'INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        ['admin', 'admin@americansfinancial.local', password_hash, 'Site Administrator', 'admin', 'active']
      );
      console.log(`[seed-postgres] admin created -> username: admin, password: ${adminPass}`);
      
      // Create admin account
      const accountId = await pool.query(
        'INSERT INTO accounts (user_id, type, number) VALUES ($1, $2, $3) RETURNING id',
        [result.rows[0].id, 'Cash Management', 'CM-' + Date.now().toString(36).toUpperCase().slice(0,6)]
      );
      console.log('[seed-postgres] Admin account created');
    } else {
      console.log('[seed-postgres] admin already exists');
    }
    
    // Create demo user
    const demoExists = await pool.query('SELECT id FROM users WHERE username = $1', ['jdoe']);
    if (!demoExists.rows.length) {
      const password_hash = bcrypt.hashSync('password', 10);
      const result = await pool.query(
        'INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        ['jdoe', 'jane.doe@example.com', password_hash, 'Jane Doe', 'user', 'active']
      );
      console.log('[seed-postgres] demo user created -> username: jdoe, password: password');
      
      // Create demo accounts
      const cashAcc = await pool.query(
        'INSERT INTO accounts (user_id, type, number) VALUES ($1, $2, $3) RETURNING id',
        [result.rows[0].id, 'Cash Management', 'CM-' + Date.now().toString(36).toUpperCase().slice(0,6)]
      );
      
      const brkAcc = await pool.query(
        'INSERT INTO accounts (user_id, type, number) VALUES ($1, $2, $3) RETURNING id',
        [result.rows[0].id, 'Brokerage', 'BRK-' + Date.now().toString(36).toUpperCase().slice(0,6)]
      );
      
      // Seed initial positions
      const positions = [
        [cashAcc.rows[0].id, 'CASH', 'Cash', 1, 5000.00, 5000.00, true],
        [brkAcc.rows[0].id, 'SPY', 'S&P 500 ETF', 20, 425.50, 400.00, false],
        [brkAcc.rows[0].id, 'AAPL', 'Apple Inc.', 10, 185.00, 180.00, false],
        [brkAcc.rows[0].id, 'GOOGL', 'Google LLC', 5, 140.00, 135.00, false]
      ];
      
      for (const p of positions) {
        await pool.query(
          'INSERT INTO positions (account_id, symbol, name, quantity, price, cost_basis, is_cash) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          p
        );
      }
      console.log('[seed-postgres] Demo portfolio seeded');
    } else {
      console.log('[seed-postgres] jdoe user already exists');
    }
    
    console.log('[seed-postgres] Seed complete!');
    
  } catch (err) {
    console.error('[seed-postgres] Error:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedPostgres();