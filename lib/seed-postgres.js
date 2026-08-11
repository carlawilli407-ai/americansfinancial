#!/usr/bin/env node
/**
 * PostgreSQL Seed Script
 * Run: DATABASE_URL="postgres://..." npm run seed-postgres
 * 
 * This creates the default admin and demo users in PostgreSQL.
 */

'use strict';
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const SQL = `
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

-- Other tables (activities, orders, alerts, watchlists, profiles, transactions)
CREATE TABLE IF NOT EXISTS activities (...);
CREATE TABLE IF NOT EXISTS orders (...);
CREATE TABLE IF NOT EXISTS alerts (...);
CREATE TABLE IF NOT EXISTS watchlists (...);
CREATE TABLE IF NOT EXISTS profiles (...);
CREATE TABLE IF NOT EXISTS transactions (...);
`;

async function seedPostgres() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('[seed-postgres] Connecting to PostgreSQL database...');
    await pool.connect();
    
    // Create tables if not exist
    console.log('[seed-postgres] Creating tables if not exist...');
    await pool.query(`CREATE TABLE IF NOT EXISTS users (...);`); // Full schema
    // ... more CREATE TABLE statements
    
    // Check if admin exists
    const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (!adminExists.rows.length) {
      const adminPass = process.env.ADMIN_PASS || 'admin123';
      const password_hash = bcrypt.hashSync(adminPass, 10);
      const result = await pool.query(
        'INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        ['admin', 'admin@fidelity.local', password_hash, 'Site Administrator', 'admin', 'active']
      );
      console.log(`[seed-postgres] admin created -> username: admin, password: ${adminPass}`);
      
      // Create admin account and portfolio
      const accountId = await pool.query(
        'INSERT INTO accounts (user_id, type, number) VALUES ($1, $2, $3) RETURNING id',
        [result.rows[0].id, 'Cash Management', 'CM-' + Date.now().toString(36).toUpperCase().slice(0, 6)]
      );
      console.log('[seed-postgres] Admin Cash Management account created');
    } else {
      console.log('[seed-postgres] admin already exists');
    }
    
    // Check if demo user exists
    const demoExists = await pool.query('SELECT id FROM users WHERE username = $1', ['jdoe']);
    if (!demoExists.rows.length) {
      const password_hash = bcrypt.hashSync('password', 10);
      const result = await pool.query(
        'INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        ['jdoe', 'jane.doe@example.com', password_hash, 'Jane Doe', 'user', 'active']
      );
      console.log('[seed-postgres] demo user created -> username: jdoe, password: password');
      
      // Create demo account and portfolio
      const accountId = await pool.query(
        'INSERT INTO accounts (user_id, type, number) VALUES ($1, $2, $3) RETURNING id',
        [result.rows[0].id, 'Cash Management', 'CM-' + Date.now().toString(36).toUpperCase().slice(0, 6)]
      );
      
      // Seed default portfolio (Cash Management + Brokerage)
      await pool.query(
        'INSERT INTO accounts (user_id, type, number) VALUES ($1, $2, $3)',
        [result.rows[0].id, 'Brokerage', 'BRK-' + Date.now().toString(36).toUpperCase().slice(0, 6)]
      );
      
      // Add initial portfolio positions
      const positions = [
        { symbol: 'SPY', name: 'S&P 500 ETF', qty: 10, price: 450.00, cost: 450.00 },
        { symbol: 'AAPL', name: 'Apple Inc.', qty: 5, price: 180.00, cost: 175.00 },
        { symbol: 'CASH', name: 'Cash', qty: 1, price: 2500.00, cost: 2500.00, is_cash: true }
      ];
      
      for (const p of positions) {
        await pool.query(
          'INSERT INTO positions (account_id, symbol, name, quantity, price, cost_basis, is_cash) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [accountId.rows[0].id, p.symbol, p.name, p.qty, p.price, p.cost, p.is_cash || false]
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