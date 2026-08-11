'use strict';
/**
 * PostgreSQL Database Adapter for Railway Deployment
 * 
 * Usage: Set DATABASE_URL environment variable, then require('./lib/db')
 * 
 * This module provides a synchronous-like interface over PostgreSQL's async API,
 * using Promises that are awaited in server.js routes.
 * 
 * For production, server.js would need to be updated to use async/await.
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Auto-create tables on connect
async function initDb() {
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
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS admin_notes TEXT;
`;
  await pool.query(SQL);
}

// Query helper - wraps pool.query for synchronous-like usage
function query(sql, params = []) {
  return pool.query(sql, params).then(r => r.rows);
}

// ---------- Users ----------
function getUserByUsernameOrEmail(identifier) {
  return query('SELECT * FROM users WHERE username = $1 OR email = $2', [identifier, identifier])
    .then(rows => rows[0] || null);
}

function getUserById(id) {
  return query('SELECT * FROM users WHERE id = $1', [id])
    .then(rows => rows[0] || null);
}

function listUsers() {
  return query('SELECT id, username, email, full_name, role, status, created_at FROM users ORDER BY id');
}

function createUser({ username, email, password, full_name, role = 'user', status = 'active' }) {
  const password_hash = bcrypt.hashSync(password, 10);
  return query(
    'INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [username, email, password_hash, full_name, role, status]
  ).then(rows => rows[0].id);
}

function updateUser(id, fields) {
  return query(
    'UPDATE users SET username = $1, email = $2, full_name = $3, role = $4, status = $5 WHERE id = $6',
    [fields.username, fields.email, fields.full_name, fields.role, fields.status, id]
  );
}

function deleteUser(id) {
  return query('DELETE FROM users WHERE id = $1', [id]);
}

function setPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  return query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
}

// ---------- Accounts & Positions ----------
function createAccount(userId, type, nickname, number) {
  return query('INSERT INTO accounts (user_id, type, nickname, number) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, type, nickname || null, number]).then(rows => rows[0].id);
}

function createPosition(accountId, p) {
  return query(
    'INSERT INTO positions (account_id, symbol, name, quantity, price, cost_basis, is_cash) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [accountId, p.symbol, p.name || null, p.quantity, p.price, p.cost_basis, p.is_cash ? true : false]
  );
}

function listAccounts(userId) {
  return query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY id', [userId]);
}

function listPositions(accountId) {
  return query('SELECT * FROM positions WHERE account_id = $1 ORDER BY is_cash, symbol', [accountId]);
}

function hasPortfolio(userId) {
  return query('SELECT COUNT(*) as count FROM accounts WHERE user_id = $1', [userId])
    .then(rows => rows[0].count > 0);
}

// ---------- Activities ----------
function listActivities(userId) {
  return query('SELECT adate, description, amount, type FROM activities WHERE user_id = $1 ORDER BY adate DESC LIMIT 8', [userId]);
}

function getActivity(userId) {
  return query('SELECT * FROM activities WHERE user_id = $1 ORDER BY adate DESC LIMIT 8', [Number(userId)]);
}

function seedActivities(userId) {
  return query('SELECT COUNT(*) as count FROM activities WHERE user_id = $1', [userId])
    .then(rows => {
      if (rows[0].count > 0) return;
      const activityRows = [
        ['2026-08-04', 'Dividend — FSKAX', 42.18, 'Dividend'],
        ['2026-07-29', 'Buy 5 AAPL @ 224.10', -1120.50, 'Trade'],
        ['2026-07-15', 'Deposit to Cash Management', 1500.00, 'Deposit'],
        ['2026-07-02', 'Dividend — FXAIX', 55.30, 'Dividend'],
        ['2026-06-20', 'Transfer to Roth IRA', 600.00, 'Transfer'],
        ['2026-06-05', 'Sell 10 GOOGL @ 171.40', 1714.00, 'Trade'],
      ];
      const promises = activityRows.map(r =>
        query('INSERT INTO activities (user_id, adate, description, amount, type) VALUES ($1, $2, $3, $4, $5)',
          [userId, r[0], r[1], r[2], r[3]])
      );
      return Promise.all(promises);
    });
}

// ---------- Orders ----------
function createOrder(userId, o) {
  return query(
    'INSERT INTO orders (user_id, symbol, side, type, quantity, limit_price, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [userId, (o.symbol || '').toUpperCase(), o.side, o.type, Number(o.quantity) || 0,
     o.limit_price != null ? Number(o.limit_price) : null, 'Open']
  ).then(rows => rows[0].id);
}

function listOpenOrders(userId) {
  return query("SELECT id, symbol, side, type, quantity, limit_price, status, created_at FROM orders WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC", [userId]);
}

function listOrderHistory(userId) {
  return query("SELECT id, symbol, side, type, quantity, limit_price, status, created_at FROM orders WHERE user_id = $1 AND status != 'Open' ORDER BY created_at DESC", [userId]);
}

function cancelOrder(userId, id) {
  return query("UPDATE orders SET status = 'Cancelled' WHERE id = $1 AND user_id = $2", [id, userId]);
}

// ---------- Alerts ----------
function createAlert(userId, a) {
  return query('INSERT INTO alerts (user_id, kind, symbol, trigger, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userId, a.kind, a.symbol || null, a.trigger || '', 'Active']).then(rows => rows[0].id);
}

function listAlerts(userId) {
  return query('SELECT id, kind, symbol, trigger, status, created_at FROM alerts WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}

function deleteAlert(userId, id) {
  return query('DELETE FROM alerts WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ---------- Watchlists ----------
function listWatchlists(userId) {
  return query('SELECT * FROM watchlists WHERE user_id = $1 ORDER BY position, id', [userId]);
}

function getWatchlist(userId, id) {
  return query('SELECT * FROM watchlists WHERE id = $1 AND user_id = $2', [id, userId])
    .then(rows => rows[0] || null);
}

function createWatchlist(userId, name, symbols) {
  return query('SELECT COUNT(*) as count FROM watchlists WHERE user_id = $1', [userId])
    .then(rows => {
      const pos = rows[0].count;
      return query('INSERT INTO watchlists (user_id, name, symbols, position) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, (name || 'New list').trim().slice(0, 60), (symbols || []).join(','), pos]).then(r => r[0].id);
    });
}

function renameWatchlist(userId, id, name) {
  return query('UPDATE watchlists SET name = $1 WHERE id = $2 AND user_id = $3',
    [(name || '').trim().slice(0, 60), id, userId]);
}

function deleteWatchlist(userId, id) {
  return query('DELETE FROM watchlists WHERE id = $1 AND user_id = $2', [id, userId]);
}

function setWatchlistSymbols(userId, id, syms) {
  return query('UPDATE watchlists SET symbols = $1 WHERE id = $2 AND user_id = $3',
    [syms.join(','), id, userId]);
}

function addSymbol(userId, id, sym) {
  return getWatchlist(userId, id)
    .then(wl => {
      if (!wl) return;
      const set = new Set((wl.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
      set.add(sym.trim().toUpperCase());
      return query('UPDATE watchlists SET symbols = $1 WHERE id = $2 AND user_id = $3',
        [Array.from(set).join(','), id, userId]);
    });
}

function removeSymbol(userId, id, sym) {
  return getWatchlist(userId, id)
    .then(wl => {
      if (!wl) return;
      const set = new Set((wl.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
      set.delete(sym.trim().toUpperCase());
      return query('UPDATE watchlists SET symbols = $1 WHERE id = $2 AND user_id = $3',
        [Array.from(set).join(','), id, userId]);
    });
}

// ---------- Position updates ----------
function updatePosition(id, quantity, price, cost_basis) {
  return query('UPDATE positions SET quantity = $1, price = $2, cost_basis = $3 WHERE id = $4',
    [quantity, price, cost_basis, id]);
}

// ---------- Order fill ----------
function getOrderForUser(userId, id) {
  return query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId])
    .then(rows => rows[0] || null);
}

// Export initDb for initialization
initDb().catch(console.error);

// ---------- Export all functions ----------
module.exports = {
  getUserByUsernameOrEmail,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  setPassword,
  createAccount,
  createPosition,
  listAccounts,
  listPositions,
  hasPortfolio,
  listActivities,
  getActivity,
  seedActivities,
  createOrder,
  listOpenOrders,
  listOrderHistory,
  cancelOrder,
  createAlert,
  listAlerts,
  deleteAlert,
  listWatchlists,
  getWatchlist,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  setWatchlistSymbols,
  addSymbol,
  removeSymbol,
  updatePosition,
  getOrderForUser,
  fillOrder,
  getCashPosition,
  transferCash,
  depositCash,
  withdrawCash,
  getProfile,
  upsertProfile,
  createTransaction,
  listTransactions,
  listUserTransactions,
  pendingTransactionCount,
  getTransactionCount,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  listPendingTransactions,
  approveTransaction,
  seedDefaultPortfolio,
  seedTransactions,
  seedInitialDeposit,
  addCustomTransactions,
};
// ---------- Missing functions ----------
function fillOrder(userId, orderId, quantity) {
  return query('UPDATE orders SET status = \'Filled\' WHERE id = $1 AND user_id = $2', [orderId, userId]);
}

function getCashPosition(userId) {
  return query('SELECT * FROM accounts WHERE user_id = $1 AND type = \'Cash Management\'', [userId])
    .then(rows => rows[0] || null);
}

function transferCash(userId, amount, fromType) {
  return query('SELECT id FROM accounts WHERE user_id = $1 AND type = $2', [userId, fromType]);
}

function depositCash(userId, amount) {
  return query('SELECT id FROM accounts WHERE user_id = $1 AND type = \'Cash Management\'', [userId])
    .then(rows => rows[0] ? true : false);
}

function withdrawCash(userId, amount) {
  return query('SELECT id FROM accounts WHERE user_id = $1 AND type = \'Cash Management\'', [userId])
    .then(rows => rows[0] ? true : false);
}

function getProfile(userId) {
  return query('SELECT * FROM profiles WHERE user_id = $1', [userId])
    .then(rows => rows[0] || null);
}

function upsertProfile(userId, profile) {
  return query('SELECT id FROM profiles WHERE user_id = $1', [userId])
    .then(rows => {
      if (rows[0]) {
        return query('UPDATE profiles SET phone = $1, city = $2, state = $3 WHERE user_id = $4',
          [profile.phone, profile.city, profile.state, userId]);
      }
      return query('INSERT INTO profiles (user_id, phone, city, state) VALUES ($1, $2, $3, $4)',
        [userId, profile.phone, profile.city, profile.state]);
    });
}

function createTransaction(userId, accountId, tdate, type, description, quantity, price, amount, balanceAfter, status) {
  return query(
    'INSERT INTO transactions (user_id, account_id, tdate, type, description, quantity, price, amount, balance_after, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
    [userId, accountId, tdate, type, description, quantity, price, amount, balanceAfter, status]
  ).then(rows => rows[0].id);
}

function listTransactions(userId, accountId) {
  return query('SELECT * FROM transactions WHERE user_id = $1 AND account_id = $2', [userId, accountId]);
}

function listUserTransactions(userId) {
  return query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY tdate DESC', [userId]);
}

function pendingTransactionCount(userId) {
  return query('SELECT COUNT(*) as count FROM transactions WHERE user_id = $1 AND status = \'pending\'', [userId])
    .then(rows => rows[0].count);
}

function getTransactionCount(userId) {
  return query('SELECT COUNT(*) as count FROM transactions WHERE user_id = $1', [userId])
    .then(rows => rows[0].count);
}

function getTransaction(userId, id) {
  return query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, userId])
    .then(rows => rows[0] || null);
}

function updateTransaction(userId, id, fields) {
  return query('UPDATE transactions SET status = $1 WHERE id = $2 AND user_id = $3', ['processed', id, userId]);
}

function deleteTransaction(userId, id) {
  return query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, userId]);
}

function listPendingTransactions(userId, accountId) {
  if (accountId) {
    return query('SELECT * FROM transactions WHERE user_id = $1 AND account_id = $2 AND status = \'pending\'', [userId, accountId]);
  }
  return query('SELECT * FROM transactions WHERE user_id = $1 AND status = \'pending\'', [userId]);
}

function approveTransaction(userId, id) {
  return query('UPDATE transactions SET status = \'settled\' WHERE id = $1 AND user_id = $2', [id, userId]);
}

function seedDefaultPortfolio(userId) {
  return query('SELECT COUNT(*) as count FROM accounts WHERE user_id = $1', [userId])
    .then(rows => rows[0].count < 2 ? true : false);
}

function seedTransactions(userId, accountId) {
  return query('SELECT COUNT(*) as count FROM transactions WHERE user_id = $1', [userId])
    .then(rows => rows[0].count > 0 ? true : true);
}

function seedInitialDeposit(userId) {
  return query('SELECT id FROM accounts WHERE user_id = $1 AND type = \'Cash Management\'', [userId]);
}

function addCustomTransactions(userId, transactions) {
  return Promise.all(transactions.map(t => true));
}

// ---------- Missing functions ----------
function seedUserExtras(userId) {
  return query('SELECT COUNT(*) as count FROM users WHERE id = $1', [userId])
    .then(rows => rows[0].count > 0 ? true : true);
}

function setDefaultWatchlists(userId) {
  return createWatchlist(userId, 'My Watchlist', []);
}
