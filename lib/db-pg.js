'use strict';
/**
 * PostgreSQL data layer for American Financial Associates.
 *
 * Mirrors lib/db-sqlite.js exactly: identical function names, signatures and
 * return shapes. server.js / lib/dashboard.js depend only on the shared
 * contract, so both back-ends must expose the same surface. Production runs
 * PostgreSQL (Railway / Supabase); local development runs SQLite.
 */
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // TLS always on for PostgreSQL (Supabase/Railway pooler requires TLS)
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

function query(sql, params = []) {
  return pool.query(sql, params).then(r => r.rows);
}

// ---------- schema bootstrap (safety net; `npm run migrate` is the source of truth) ----------
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
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    phone               TEXT,
    address_line1       TEXT,
    address_line2       TEXT,
    city                TEXT,
    state               TEXT,
    zip_code            TEXT,
    country             TEXT DEFAULT 'USA',
    date_of_birth       TEXT,
    ssn_last4           TEXT,
    employment_status   TEXT,
    employer_name       TEXT,
    employer_address    TEXT,
    job_title           TEXT,
    annual_income       TEXT,
    net_worth           TEXT,
    investment_experience TEXT,
    investment_objective TEXT,
    risk_tolerance      TEXT,
    communication_pref  TEXT,
    member_id           TEXT,   -- public member number (nullable)
    citizenship         TEXT DEFAULT 'US',
    tax_id_type         TEXT DEFAULT 'SSN',
    tax_id              TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    JSONB NOT NULL,
    expire  BIGINT NOT NULL
  );
  `;
  await pool.query(SQL);

  // Add columns if missing (idempotent alterations for existing databases)
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
}

// ---------- users ----------
function getUserByUsernameOrEmail(identifier) {
  return query('SELECT * FROM users WHERE username = $1 OR email = $2', [identifier, identifier])
    .then(rows => rows[0] || null);
}
function getUserById(id) {
  return query('SELECT * FROM users WHERE id = $1', [id]).then(rows => rows[0] || null);
}
function listUsers() {
  return query('SELECT id,username,email,full_name,role,status,created_at FROM users ORDER BY id');
}
function createUser({ username, email, password, full_name, role = 'user', status = 'active' }) {
  const password_hash = bcrypt.hashSync(password, 10);
  return query(
    'INSERT INTO users (username, email, password_hash, full_name, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [username, email, password_hash, full_name, role, status]
  ).then(rows => rows[0] && rows[0].id);
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

// ---------- accounts & positions ----------
function createAccount(userId, type, nickname, number, createdAt) {
  return query(
    'INSERT INTO accounts (user_id, type, nickname, number, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userId, type, nickname || null, number, createdAt || new Date().toISOString()]
  ).then(rows => rows[0] && rows[0].id);
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
    .then(rows => Number(rows[0].count) > 0);
}
function getAccount(id) {
  return query('SELECT * FROM accounts WHERE id = $1', [id]).then(rows => rows[0] || null);
}

// ---------- activities ----------
const _actIns = (userId, adate, description, amount, type) =>
  query('INSERT INTO activities (user_id, adate, description, amount, type) VALUES ($1, $2, $3, $4, $5)',
    [userId, adate, description, amount, type]);

function listActivities(userId) {
  return query('SELECT adate, description, amount, type FROM activities WHERE user_id = $1 ORDER BY adate DESC LIMIT 8', [userId]);
}
function getActivity(userId) {
  return query('SELECT * FROM activities WHERE user_id = $1 ORDER BY adate DESC LIMIT 8', [Number(userId)]);
}
async function seedActivities(userId) {
  const rows = await query('SELECT COUNT(*) as count FROM activities WHERE user_id = $1', [userId]);
  if (Number(rows[0].count) > 0) return;
  const activityRows = [
    ['2026-08-04', 'Dividend — FSKAX', 42.18, 'Dividend'],
    ['2026-07-29', 'Buy 5 AAPL @ 224.10', -1120.50, 'Trade'],
  ];
  await Promise.all(activityRows.map(r =>
    _actIns(userId, r[0], r[1], r[2], r[3])));
}
function addActivity(userId, description, amount, type) {
  const today = new Date().toISOString().slice(0, 10);
  return _actIns(Number(userId), today, description, amount != null ? Number(amount) : null, type || null);
}

// ---------- orders ----------
function createOrder(userId, o) {
  return query(
    'INSERT INTO orders (user_id, symbol, side, type, quantity, limit_price, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [userId, (o.symbol || '').toUpperCase(), o.side, o.type, Number(o.quantity) || 0,
     o.limit_price != null ? Number(o.limit_price) : null, 'Open']
  ).then(rows => rows[0] && rows[0].id);
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
function getOrderForUser(userId, id) {
  return query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId])
    .then(rows => rows[0] || null);
}
async function fillOrder(userId, orderId, price) {
  const o = await getOrderForUser(userId, orderId);
  if (!o || o.status !== 'Open') return null;
  const accounts = await listAccounts(userId);
  if (!accounts.length) return null;
  if (o.side === 'BUY') {
    const acc = accounts.find(a => a.type === 'Brokerage') || accounts[0];
    const existing = (await listPositions(acc.id)).find(p => p.symbol === o.symbol && !p.is_cash);
    if (existing) {
      const totQ = existing.quantity + o.quantity;
      const avg = totQ ? ((existing.cost_basis * existing.quantity) + price * o.quantity) / totQ : price;
      await updatePosition(existing.id, totQ, price, avg);
    } else {
      await createPosition(acc.id, { symbol: o.symbol, name: o.symbol, quantity: o.quantity, price: price, cost_basis: price });
    }
  } else {
    for (const acc of accounts) {
      const pos = (await listPositions(acc.id)).find(p => p.symbol === o.symbol && !p.is_cash);
      if (pos) {
        const remain = Math.max(0, pos.quantity - o.quantity);
        if (remain <= 0.0001) await query('DELETE FROM positions WHERE id = $1', [pos.id]);
        else await updatePosition(pos.id, remain, pos.price, pos.cost_basis);
        break;
      }
    }
  }
  await query("UPDATE orders SET status = 'Filled' WHERE id = $1 AND user_id = $2", [o.id, userId]);
  await _actIns(userId, '2026-08-08', (o.side === 'BUY' ? 'Buy ' : 'Sell ') + o.quantity + ' ' + o.symbol + ' @ ' + (price || 0).toFixed(2),
    o.side === 'BUY' ? -(price * o.quantity) : (price * o.quantity), 'Trade');
  return o;
}

// ---------- alerts ----------
function createAlert(userId, a) {
  return query('INSERT INTO alerts (user_id, kind, symbol, trigger, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userId, a.kind, a.symbol || null, a.trigger || '', 'Active']).then(rows => rows[0] && rows[0].id);
}
function listAlerts(userId) {
  return query('SELECT id, kind, symbol, trigger, status, created_at FROM alerts WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}
function deleteAlert(userId, id) {
  return query('DELETE FROM alerts WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ---------- watchlists ----------
function listWatchlists(userId) {
  return query('SELECT * FROM watchlists WHERE user_id = $1 ORDER BY position, id', [userId]);
}
function getWatchlist(userId, id) {
  return query('SELECT * FROM watchlists WHERE id = $1 AND user_id = $2', [id, userId])
    .then(rows => rows[0] || null);
}
async function createWatchlist(userId, name, symbols) {
  const rows = await query('SELECT COUNT(*) as count FROM watchlists WHERE user_id = $1', [userId]);
  const pos = Number(rows[0].count);
  const r = await query('INSERT INTO watchlists (user_id, name, symbols, position) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, (name || 'New list').trim().slice(0, 60), (symbols || []).join(','), pos]);
  return r[0] && r[0].id;
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
async function addSymbol(userId, id, sym) {
  const wl = await getWatchlist(userId, id);
  if (!wl) return;
  const set = new Set((wl.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  set.add(sym.trim().toUpperCase());
  return query('UPDATE watchlists SET symbols = $1 WHERE id = $2 AND user_id = $3',
    [Array.from(set).join(','), id, userId]);
}
async function removeSymbol(userId, id, sym) {
  const wl = await getWatchlist(userId, id);
  if (!wl) return;
  const set = new Set((wl.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  set.delete(sym.trim().toUpperCase());
  return query('UPDATE watchlists SET symbols = $1 WHERE id = $2 AND user_id = $3',
    [Array.from(set).join(','), id, userId]);
}

// ---------- position update (order fills / transfers) ----------
function updatePosition(id, quantity, price, cost_basis) {
  return query('UPDATE positions SET quantity = $1, price = $2, cost_basis = $3 WHERE id = $4',
    [quantity, price, cost_basis, id]);
}

// ---------- cash position ----------
// getCashPosition(accountId) -> the CASH position row for an account (.price = balance).
function getCashPosition(accountId) {
  return query('SELECT * FROM positions WHERE account_id = $1 AND is_cash = true LIMIT 1', [accountId])
    .then(rows => rows[0] || null);
}

// ---------- cash transfer between accounts ----------
const _cashMgmtByU = (userId) =>
  query("SELECT id FROM accounts WHERE user_id=$1 AND type='Cash Management' ORDER BY id LIMIT 1", [userId]);

async function transferCash(userId, fromType, toType, amount) {
  amount = Number(amount) || 0;
  if (amount <= 0 || !fromType || !toType || fromType === toType) return false;
  const accounts = await listAccounts(userId);
  const from = accounts.find(a => a.type === fromType);
  const to = accounts.find(a => a.type === toType);
  if (!from || !to) return false;
  const fromCash = (await listPositions(from.id)).find(p => p.is_cash);
  const avail = fromCash ? fromCash.price : 0;
  if (amount > avail + 0.001) return false;
  if (fromCash) {
    const rem = fromCash.price - amount;
    if (rem <= 0.001) await query('DELETE FROM positions WHERE id = $1', [fromCash.id]);
    else await updatePosition(fromCash.id, 1, rem, rem);
  }
  const toCash = (await listPositions(to.id)).find(p => p.is_cash);
  const toBalance = (toCash ? toCash.price : 0) + amount;
  if (toCash) await updatePosition(toCash.id, 1, toBalance, toBalance);
  else await createPosition(to.id, { symbol: 'CASH', name: 'Cash', quantity: 1, price: amount, cost_basis: amount, is_cash: true });
  await _actIns(userId, new Date().toISOString().slice(0, 10),
    'Transfer ' + amount.toFixed(2) + ' from ' + fromType + ' to ' + toType, null, 'Transfer');
  const ref = 'XFR-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  const today = new Date().toISOString().slice(0, 10);
  const fromBalance = (fromCash ? fromCash.price : 0) - amount;
  await createTransaction(userId, {
    account_id: from.id, tdate: today, type: 'transfer', symbol: null,
    description: 'Transfer to ' + toType, quantity: null, price: null,
    amount: -amount, balance_after: fromBalance, status: 'settled', reference_id: ref,
  });
  await createTransaction(userId, {
    account_id: to.id, tdate: today, type: 'transfer', symbol: null,
    description: 'Transfer from ' + fromType, quantity: null, price: null,
    amount: amount, balance_after: toBalance, status: 'settled', reference_id: ref,
  });
  return true;
}

// ---------- cash deposit / withdrawal ----------
async function depositCash(userId, accountId, amount, type) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const acc = await getAccount(accountId);
  if (!acc || acc.user_id !== Number(userId)) return null;
  const cash = await getCashPosition(accountId);
  const currentBalance = cash ? cash.price : 0;
  const today = new Date().toISOString().slice(0, 10);
  const ref = 'D-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  return createTransaction(userId, {
    account_id: accountId, tdate: today, type: type || 'deposit',
    description: (type === 'transfer' ? 'Transfer received' : 'ACH Deposit'),
    quantity: null, price: null, amount: amt, balance_after: currentBalance,
    status: 'pending', reference_id: ref,
  });
}

async function withdrawCash(userId, accountId, amount, txType, description) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const acc = await getAccount(accountId);
  if (!acc || acc.user_id !== Number(userId)) return null;
  const cash = await getCashPosition(accountId);
  const avail = cash ? cash.price : 0;
  if (amt > avail + 0.001) return null;
  const today = new Date().toISOString().slice(0, 10);
  const ref = 'W-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  return createTransaction(userId, {
    account_id: accountId, tdate: today, type: txType || 'withdrawal',
    description: description || (txType === 'transfer' ? 'Transfer to external bank' : 'Bill payment'),
    quantity: null, price: null, amount: -amt, balance_after: avail - amt,
    status: 'pending', reference_id: ref,
  });
}

// External transfer: send cash to an external bank account.
// Records a pending 'external_transfer' transaction that carries the
// destination bank details (routing / account holder / last4). Cash is NOT
// debited until an admin approves the pending transaction — same model as
// move-money / bill pay. Stores only the last 4 digits of the external
// account number (never the full PAN) per security best practice.
async function externalTransfer(userId, opts) {
  const { account_id, amount, tdate, external_bank_logo, external_bank_name,
          external_routing, external_account_holder, external_account_last4, description } = opts || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const acc = await getAccount(account_id);
  if (!acc || acc.user_id !== Number(userId)) return null;
  const cash = await getCashPosition(account_id);
  const avail = cash ? cash.price : 0;
  if (amt > avail + 0.001) return null;
  const today = tdate || new Date().toISOString().slice(0, 10);
  const ref = 'EXT-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  return createTransaction(userId, {
    account_id: account_id, tdate: today, type: 'external_transfer',
    description: description || ('External transfer to ' + (external_bank_name || 'external bank') + ' (••••' + (external_account_last4 || '') + ')'),
    quantity: null, price: null, amount: -amt, balance_after: avail - amt,
    status: 'pending', reference_id: ref,
    external_bank_logo: external_bank_logo || null,
    external_bank_name: external_bank_name || null,
    external_routing: external_routing || null,
    external_account_holder: external_account_holder || null,
    external_account_last4: external_account_last4 || null,
  });
}

// ---------- profiles ----------
const PROFILE_FIELDS = ['phone','address_line1','address_line2','city','state','zip_code','country',
  'date_of_birth','ssn_last4','employment_status','employer_name','employer_address','job_title',
  'annual_income','net_worth','investment_experience','investment_objective','risk_tolerance',
  'citizenship','tax_id_type','tax_id','communication_pref'];

function getProfile(userId) {
  return query('SELECT * FROM profiles WHERE user_id = $1', [userId])
    .then(rows => rows[0] || null);
}
async function upsertProfile(userId, data) {
  const vals = PROFILE_FIELDS.map(f => data[f] != null ? data[f] : null);
  const existing = await query('SELECT id FROM profiles WHERE user_id = $1', [userId]);
  if (existing.length) {
    const set = PROFILE_FIELDS.map((f, i) => f + ' = $' + (i + 1));
    return query(
      'UPDATE profiles SET ' + set.join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE user_id = $' + (PROFILE_FIELDS.length + 1),
      [...vals, userId]
    );
  }
  const cols = PROFILE_FIELDS.join(', ');
  const placeholders = PROFILE_FIELDS.map((f, i) => '$' + (i + 1)).join(', ');
  return query(
    'INSERT INTO profiles (user_id, ' + cols + ') VALUES ($' + (PROFILE_FIELDS.length + 1) + ', ' + placeholders + ')',
    [userId, ...vals]
  );
}

// ---------- transactions ----------
const _txJoin = 'FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id';
const _txCols = 't.*, a.type as account_type';

// createTransaction(userId, tx) — tx is an object (matches db-sqlite.js; supports backdated tdate).
function createTransaction(userId, tx) {
  return query(
    'INSERT INTO transactions (user_id, account_id, tdate, type, symbol, description, quantity, price, amount, balance_after, status, reference_id, external_bank_logo, external_bank_name, external_routing, external_account_holder, external_account_last4) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id',
    [userId, tx.account_id || null, tx.tdate, tx.type, tx.symbol || null, tx.description,
      tx.quantity != null ? Number(tx.quantity) : null,
      tx.price != null ? Number(tx.price) : null,
      Number(tx.amount) || 0,
      tx.balance_after != null ? Number(tx.balance_after) : null,
      tx.status || 'settled',
      tx.reference_id || null,
      tx.external_bank_logo || null,
      tx.external_bank_name || null,
      tx.external_routing || null,
      tx.external_account_holder || null,
      tx.external_account_last4 || null]
  ).then(rows => rows[0] && rows[0].id);
}
// listTransactions(userId[, accountId]) — all of a user's transactions (account_id optional).
function listTransactions(userId, accountId) {
  if (accountId != null) {
    return query('SELECT ' + _txCols + ' ' + _txJoin + ' WHERE t.user_id = $1 AND t.account_id = $2 ORDER BY tdate DESC, t.id DESC LIMIT 100',
      [userId, accountId]);
  }
  return query('SELECT ' + _txCols + ' ' + _txJoin + ' WHERE t.user_id = $1 ORDER BY tdate DESC, t.id DESC LIMIT 100', [userId]);
}
function listAccountTransactions(accountId) {
  return query('SELECT * FROM transactions WHERE account_id = $1 ORDER BY tdate DESC, id DESC LIMIT 50', [accountId]);
}
function getTransactionCount(userId) {
  return query('SELECT COUNT(*) as count FROM transactions WHERE user_id = $1', [userId])
    .then(rows => Number(rows[0].count));
}

// ---------- seed ----------
async function seedTransactions(userId) {
  const rows = await query('SELECT COUNT(*) as count FROM transactions WHERE user_id = $1', [userId]);
  if (Number(rows[0].count) > 0) return;
  const accounts = await listAccounts(userId);
  const brokerage = accounts.find(a => a.type === 'Brokerage');
  const ira = accounts.find(a => a.type === 'Roth IRA');
  const cash = accounts.find(a => a.type === 'Cash Management');
  const seedRows = [
    { account_id: brokerage ? brokerage.id : null, tdate: '2026-07-29', type: 'trade_buy', symbol: 'AAPL', description: 'Buy 5 AAPL @ 224.10', quantity: 5, price: 224.10, amount: -1120.50, balance_after: 6250.00, status: 'settled', reference_id: 'ORD-1001' },
    { account_id: brokerage ? brokerage.id : null, tdate: '2026-07-15', type: 'deposit', symbol: null, description: 'ACH Deposit', quantity: null, price: null, amount: 1500.00, balance_after: 7370.50, status: 'settled', reference_id: 'DEP-2001' },
    { account_id: brokerage ? brokerage.id : null, tdate: '2026-07-02', type: 'dividend', symbol: 'FXAIX', description: 'Dividend — FSKAX', quantity: null, price: null, amount: 42.18, balance_after: 7412.68, status: 'settled', reference_id: 'DIV-3001' },
    { account_id: brokerage ? brokerage.id : null, tdate: '2026-06-20', type: 'transfer', symbol: null, description: 'Transfer to Roth IRA', quantity: null, price: null, amount: -600.00, balance_after: 6812.68, status: 'settled', reference_id: 'XFR-4001' },
    { account_id: brokerage ? brokerage.id : null, tdate: '2026-06-05', type: 'trade_sell', symbol: 'GOOGL', description: 'Sell 10 GOOGL @ 171.40', quantity: 10, price: 171.40, amount: 1714.00, balance_after: 8526.68, status: 'settled', reference_id: 'ORD-1002' },
    { account_id: ira ? ira.id : null, tdate: '2026-06-20', type: 'transfer', symbol: null, description: 'Transfer from Brokerage', quantity: null, price: null, amount: 600.00, balance_after: 2420.00, status: 'settled', reference_id: 'XFR-4001' },
    { account_id: ira ? ira.id : null, tdate: '2026-05-15', type: 'deposit', symbol: null, description: 'IRA Contribution 2026', quantity: null, price: null, amount: 1000.00, balance_after: 1820.00, status: 'settled', reference_id: 'DEP-2002' },
    { account_id: cash ? cash.id : null, tdate: '2026-07-15', type: 'deposit', symbol: null, description: 'ACH Deposit', quantity: null, price: null, amount: 1500.00, balance_after: 4700.00, status: 'settled', reference_id: 'DEP-2003' },
    { account_id: cash ? cash.id : null, tdate: '2026-07-01', type: 'interest', symbol: null, description: 'Interest Payment', quantity: null, price: null, amount: 12.50, balance_after: 3212.50, status: 'settled', reference_id: 'INT-5001' },
    { account_id: cash ? cash.id : null, tdate: '2026-06-20', type: 'withdrawal', symbol: null, description: 'ATM Withdrawal', quantity: null, price: null, amount: -200.00, balance_after: 3012.50, status: 'settled', reference_id: 'WDR-6001' },
  ];
  for (const r of seedRows) {
    if (r.account_id) await createTransaction(userId, r);
  }
}
async function seedInitialDeposit(userId, amount) {
  const amt = Number(amount) || 0;
  if (!amt) return null;
  const acc = (await _cashMgmtByU(userId))[0];
  const today = new Date().toISOString().slice(0, 10);
  const ref = 'INIT-' + String(userId).padStart(5, '0');
  await _actIns(userId, today, 'Initial deposit', amt, 'Deposit');
  return createTransaction(userId, {
    account_id: acc ? acc.id : null, tdate: today, type: 'deposit',
    description: 'Initial deposit', quantity: null, price: null,
    amount: amt, balance_after: amt, status: 'settled', reference_id: ref,
  });
}
async function addCustomTransactions(userId, txs) {
  const today = new Date().toISOString().slice(0, 10);
  const acc = (await _cashMgmtByU(userId))[0];
  const out = [];
  for (const t of txs) {
    const desc = ((t.description || '').trim());
    const amt = Number(t.amount);
    if (!desc || !amt) continue;
    out.push(await createTransaction(userId, {
      account_id: t.account_id ? Number(t.account_id) : (acc ? acc.id : null),
      tdate: t.tdate || today, type: t.type || 'deposit',
      symbol: t.symbol || null, description: desc,
      quantity: t.quantity != null ? Number(t.quantity) : null,
      price: t.price != null ? Number(t.price) : null,
      amount: amt, balance_after: null, status: 'settled',
      reference_id: t.reference_id || null,
    }));
  }
  return out;
}

// ---------- default portfolio / user extras ----------
const PORTFOLIO_TEMPLATE = [
  {
    type: 'Brokerage', nickname: 'Brokerage', number: () => acctNumber('Z'),
    positions: [
      { symbol: 'FXAIX', name: 'S&P 500 Index Fund',          quantity: 85,  price: 188.42, cost_basis: 165.10 },
      { symbol: 'FSKAX', name: 'Total Market Index Fund',   quantity: 120, price: 112.34, cost_basis: 98.20 },
      { symbol: 'GOOGL', name: 'Alphabet Inc Class A',            quantity: 15,  price: 175.20, cost_basis: 148.00 },
      { symbol: 'AAPL',  name: 'Apple Inc',                        quantity: 20,  price: 225.10, cost_basis: 182.50 },
      { symbol: 'CASH',  name: 'Cash',                             quantity: 1,   price: 6250.00, cost_basis: 6250.00, is_cash: true },
    ],
  },
  {
    type: 'Roth IRA', nickname: 'Roth IRA', number: () => acctNumber('X'),
    positions: [
      { symbol: 'FZROX', name: 'Total Market Index Fund',       quantity: 210, price: 18.55, cost_basis: 16.20 },
      { symbol: 'FXNAX', name: 'U.S. Bond Index Fund',           quantity: 140, price: 8.72,  cost_basis: 8.40 },
      { symbol: 'CASH',  name: 'Cash',                             quantity: 1,   price: 1820.00, cost_basis: 1820.00, is_cash: true },
    ],
  },
  {
    type: 'Cash Management', nickname: 'Cash Management', number: () => acctNumber('C'),
    positions: [
      { symbol: 'CASH', name: 'Cash', quantity: 1, price: 3200.00, cost_basis: 3200.00, is_cash: true },
    ],
  },
];

function acctNumber(prefix) {
  let s = '';
  for (let i = 0; i < 9; i++) s += Math.floor(Math.random() * 10);
  return prefix + s;
}

async function seedDefaultPortfolio(userId, initialCash) {
  for (const acc of PORTFOLIO_TEMPLATE) {
    const accId = await createAccount(userId, acc.type, acc.nickname, acc.number());
    for (const p of acc.positions) {
      let price = p.price, cost = p.cost_basis;
      if (initialCash != null && acc.type === 'Cash Management' && p.is_cash) {
        const v = Number(initialCash);
        if (v > 0) { price = v; cost = v; }
      }
      await createPosition(accId, { symbol: p.symbol, name: p.name, quantity: p.quantity, price, cost_basis: cost, is_cash: p.is_cash });
    }
  }
}

async function seedDefaultWatchlists(userId) {
  const rows = await listWatchlists(userId);
  if (rows.length > 0) return;
  await createWatchlist(userId, 'My Favorites', ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL']);
  await createWatchlist(userId, 'ETFs & Funds', ['SPY', 'QQQ', 'VTI', 'FXAIX', 'FSKAX']);
  await createWatchlist(userId, 'Crypto', ['BTC', 'ETH']);
}

async function seedUserExtras(userId) {
  await seedDefaultWatchlists(userId);
  const alertRows = await listAlerts(userId);
  if (alertRows.length === 0) await createAlert(userId, { kind: 'Price', symbol: 'AAPL', trigger: 'Above 230.00' });
  const hist = await listOrderHistory(userId);
  if (hist.length === 0) await query(
    'INSERT INTO orders (user_id, symbol, side, type, quantity, limit_price, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [userId, 'MSFT', 'BUY', 'Market', 5, null, 'Filled']);
}

// ---------- admin: cross-user transaction access & modification ----------
// Admin reads/modifies/deletes ANY transaction.
async function getTransaction(id) {
  const rows = await query('SELECT * FROM transactions WHERE id = $1', [Number(id)]);
  return rows[0] || null;
}
function updateTransaction(id, fields) {
  return query(
    'UPDATE transactions SET tdate=$1, type=$2, symbol=$3, description=$4, quantity=$5, price=$6, amount=$7, balance_after=$8, status=$9, reference_id=$10 WHERE id=$11',
    [fields.tdate || '', fields.type || 'deposit', fields.symbol || null,
      fields.description || '', fields.quantity != null ? Number(fields.quantity) : null,
      fields.price != null ? Number(fields.price) : null, Number(fields.amount) || 0,
      fields.balance_after != null ? Number(fields.balance_after) : null,
      fields.status || 'settled', fields.reference_id || null, Number(id)]
  );
}
function deleteTransaction(id) {
  return query('DELETE FROM transactions WHERE id = $1', [Number(id)]);
}
function listUserTransactions(userId) {
  return query('SELECT t.*, a.type as account_type FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id WHERE t.user_id = $1 ORDER BY tdate DESC, t.id DESC',
    [Number(userId)]);
}

// ---------- admin: transaction approval workflow ----------
const _txPending = `SELECT t.*, u.username, u.full_name, a.type as account_type
  FROM transactions t
  JOIN users u ON t.user_id = u.id
  LEFT JOIN accounts a ON t.account_id = a.id
  WHERE t.status = 'pending'
  ORDER BY t.created_at DESC`;
const _txSettle = `UPDATE transactions SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, admin_notes = $3 WHERE id = $4 AND status = $5`;

function listPendingTransactions() {
  return query(_txPending);
}
async function approveTransaction(id, adminId, notes) {
  const tx = await getTransaction(Number(id));
  if (!tx || tx.status !== 'pending') return false;
  if (tx.amount > 0) {
    const cash = await getCashPosition(tx.account_id);
    const newBal = (cash ? cash.price : 0) + Math.abs(tx.amount);
    if (cash) await updatePosition(cash.id, 1, newBal, (cash.cost_basis || 0) + Math.abs(tx.amount));
    else await createPosition(tx.account_id, { symbol: 'CASH', name: 'Cash', quantity: 1, price: newBal, cost_basis: newBal, is_cash: true });
  } else {
    const cash = await getCashPosition(tx.account_id);
    if (cash) {
      const newBal = cash.price - Math.abs(tx.amount);
      if (newBal <= 0.001) await query('DELETE FROM positions WHERE id = $1', [cash.id]);
      else await updatePosition(cash.id, 1, newBal, cash.cost_basis || newBal);
    }
  }
  await query(_txSettle, ['settled', Number(adminId), notes || null, Number(id), 'pending']);
  await addActivity(tx.user_id, 'Approved: ' + tx.description, null, 'approval');
  return true;
}

async function declineTransaction(id, adminId, notes) {
  const tx = await getTransaction(Number(id));
  if (!tx || tx.status !== 'pending') return false;
  await query(_txSettle, ['cancelled', Number(adminId), notes || 'Declined by admin', Number(id), 'pending']);
  await addActivity(tx.user_id, 'Declined: ' + tx.description, null, 'decline');
  return true;
}

// ---------- pending-count helper ----------
const _txPendingCount = 'SELECT COUNT(*) as count FROM transactions WHERE user_id = $1 AND status = $2';
function pendingTransactionCount(userId) {
  return query(_txPendingCount, [Number(userId), 'pending']).then(rows => Number(rows[0].count));
}

// ---------- admin: prune a user's entire client dataset ----------
async function pruneAdminClientData(userId) {
  const stmts = [
    'DELETE FROM watchlists WHERE user_id = $1',
    'DELETE FROM alerts WHERE user_id = $1',
    'DELETE FROM orders WHERE user_id = $1',
    'DELETE FROM activities WHERE user_id = $1',
    'DELETE FROM transactions WHERE user_id = $1',
    'DELETE FROM positions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1)',
    'DELETE FROM accounts WHERE user_id = $1',
    'DELETE FROM profiles WHERE user_id = $1',
  ];
  let n = 0;
  for (const s of stmts) {
    const res = await pool.query(s, [Number(userId)]);
    n += res.rowCount || 0;
  }
  return n;
}

// ---------- exports ----------
module.exports = {
  db: pool,
  getUserByUsernameOrEmail, getUserById, listUsers,
  createUser, updateUser, deleteUser, setPassword,
  listAccounts, listPositions, hasPortfolio, getAccount,
  listActivities, getActivity, seedActivities, addActivity,
  createOrder, listOpenOrders, listOrderHistory, cancelOrder, getOrderForUser, fillOrder,
  createAlert, listAlerts, deleteAlert,
  listWatchlists, getWatchlist, createWatchlist, renameWatchlist, deleteWatchlist,
  setWatchlistSymbols, addSymbol, removeSymbol, updatePosition,
  transferCash, getCashPosition, depositCash, withdrawCash, externalTransfer,
  getProfile, upsertProfile,
  createTransaction, listTransactions, listAccountTransactions, getTransactionCount, seedTransactions,
  seedInitialDeposit, addCustomTransactions,
  getTransaction, updateTransaction, deleteTransaction, listUserTransactions,
  listPendingTransactions, approveTransaction, declineTransaction, pendingTransactionCount,
  seedDefaultPortfolio, seedUserExtras, seedDefaultWatchlists,
  createAccount, createPosition,
  pruneAdminClientData,
  initDb,
};

// Bootstrap schema on load (safety net; `npm run migrate` is the source of truth).
// Only effective when DATABASE_URL is set; errors are non-fatal at startup.
if (process.env.DATABASE_URL) {
  initDb().catch(err => console.error('[db-pg] schema bootstrap failed:', err.message));
}
