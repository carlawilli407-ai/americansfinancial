'use strict';
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function query(sql, params = []) {
  return pool.query(sql, params).then(r => r.rows);
}

function getUserByUsernameOrEmail(identifier) {
  return query('SELECT * FROM users WHERE username = $1 OR email = $2', [identifier, identifier])
    .then(rows => rows[0] || null);
}

function getUserById(id) {
  return query('SELECT * FROM users WHERE id = $1', [id]).then(rows => rows[0] || null);
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

function getCashPosition(userId) {
  return query('SELECT * FROM accounts WHERE user_id = $1 AND type = \'Cash Management\'', [userId])
    .then(rows => rows[0] || null);
}

function transferCash(userId, fromType, toType, amount) {
  return Promise.resolve(true);
}

function depositCash(userId, accountId, amount, type) {
  return Promise.resolve(true);
}

function withdrawCash(userId, accountId, amount, type, description) {
  return Promise.resolve(true);
}

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
      ];
      return Promise.all(activityRows.map(r =>
        query('INSERT INTO activities (user_id, adate, description, amount, type) VALUES ($1, $2, $3, $4, $5)',
          [userId, r[0], r[1], r[2], r[3]])
      ));
    });
}

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

function fillOrder(userId, orderId, quantity) {
  return query('UPDATE orders SET status = \'Filled\' WHERE id = $1 AND user_id = $2', [orderId, userId]);
}

function getOrderForUser(userId, id) {
  return query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId])
    .then(rows => rows[0] || null);
}

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

function updatePosition(id, quantity, price, cost_basis) {
  return query('UPDATE positions SET quantity = $1, price = $2, cost_basis = $3 WHERE id = $4',
    [quantity, price, cost_basis, id]);
}

function getProfile(userId) {
  return query('SELECT * FROM profiles WHERE user_id = $1', [userId])
    .then(rows => rows[0] || null);
}

function upsertProfile(userId, profile) {
  return query('SELECT id FROM profiles WHERE user_id = $1', [userId])
    .then(rows => {
      if (rows[0]) {
        return query('UPDATE profiles SET phone = $1, city = $2, state = $3, zip_code = $4, country = $5 WHERE user_id = $6',
          [profile.phone, profile.city, profile.state, profile.zip_code, profile.country || 'USA', userId]);
      }
      return query('INSERT INTO profiles (user_id, phone, city, state, zip_code, country) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, profile.phone, profile.city, profile.state, profile.zip_code, profile.country || 'USA']);
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

function approveTransaction(userId, id, notes) {
  return query('UPDATE transactions SET status = \'settled\', admin_notes = $1 WHERE id = $2 AND user_id = $3',
    [notes, id, userId]);
}

function seedDefaultPortfolio(userId, cash) { return Promise.resolve(true); }
function seedTransactions(userId, accountId) { return Promise.resolve(true); }
function seedInitialDeposit(userId, amount) { return Promise.resolve(true); }
function addCustomTransactions(userId, txs) { return Promise.resolve(true); }
function seedUserExtras(userId) { return Promise.resolve(true); }

async function initDb() {
  const SQL = `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, nickname TEXT, number TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess JSONB NOT NULL, expire BIGINT NOT NULL);`;
  await pool.query(SQL);
}

initDb().catch(console.error);

module.exports = {
  getUserByUsernameOrEmail, getUserById, listUsers, createUser, updateUser, deleteUser, setPassword,
  getCashPosition, transferCash, depositCash, withdrawCash,
  createAccount, createPosition, listAccounts, listPositions, hasPortfolio,
  listActivities, getActivity, seedActivities,
  createOrder, listOpenOrders, listOrderHistory, cancelOrder, fillOrder, getOrderForUser,
  createAlert, listAlerts, deleteAlert,
  listWatchlists, getWatchlist, createWatchlist, renameWatchlist, deleteWatchlist,
  setWatchlistSymbols, addSymbol, removeSymbol, updatePosition,
  getProfile, upsertProfile,
  createTransaction, listTransactions, listUserTransactions, pendingTransactionCount,
  getTransactionCount, getTransaction, updateTransaction, deleteTransaction,
  listPendingTransactions, approveTransaction,
  seedDefaultPortfolio, seedTransactions, seedInitialDeposit, addCustomTransactions, seedUserExtras
};