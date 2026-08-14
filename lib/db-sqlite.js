'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  nickname   TEXT,
  number     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  name        TEXT,
  quantity    REAL NOT NULL,
  price       REAL NOT NULL,
  cost_basis  REAL NOT NULL,
  is_cash     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adate       TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      REAL,
  type        TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  side        TEXT NOT NULL,            -- BUY | SELL
  type        TEXT NOT NULL,            -- Market | Limit | Stop
  quantity    REAL NOT NULL,
  limit_price REAL,
  status      TEXT NOT NULL DEFAULT 'Open', -- Open | Filled | Cancelled
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,            -- Price | Portfolio | Market
  symbol      TEXT,
  trigger     TEXT NOT NULL,            -- e.g. "Above 180.00"
  status      TEXT NOT NULL DEFAULT 'Active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS watchlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  symbols    TEXT NOT NULL DEFAULT '',   -- comma-separated tickers
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone           TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT,
  country         TEXT DEFAULT 'USA',
  date_of_birth   TEXT,
  ssn_last4       TEXT,
  employment_status TEXT,           -- employed, self-employed, retired, unemployed, student
  employer_name   TEXT,
  employer_address TEXT,
  job_title       TEXT,
  annual_income   TEXT,             -- range: <50k, 50k-100k, 100k-250k, 250k-500k, 500k-1M, >1M
  net_worth       TEXT,             -- range: <100k, 100k-500k, 500k-1M, 1M-5M, >5M
  investment_experience TEXT,       -- none, limited, moderate, extensive
  investment_objective  TEXT,       -- preservation, income, growth, growth_income, speculation
  risk_tolerance        TEXT,             -- conservative, moderate, aggressive
  communication_pref    TEXT,       -- email, phone, sms, mail
  member_id            TEXT,       -- public member number (nullable)
  citizenship     TEXT DEFAULT 'US',
  tax_id_type     TEXT DEFAULT 'SSN', -- SSN, EIN, ITIN
  tax_id          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  tdate           TEXT NOT NULL,
  type            TEXT NOT NULL,    -- deposit, withdrawal, transfer, dividend, interest, fee, trade_buy, trade_sell
  symbol          TEXT,
  description     TEXT NOT NULL,
  quantity        REAL,
  price           REAL,
  amount          REAL NOT NULL,    -- positive for credit, negative for debit
  balance_after   REAL,
  status          TEXT DEFAULT 'settled', -- pending, settled, cancelled
  reference_id    TEXT,             -- external reference / order id
  external_bank_logo TEXT,          -- logo URL or bank name (external transfers)
  external_bank_name TEXT,
  external_routing   TEXT,
  external_account_holder TEXT,
  external_account_last4 TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// --- migrations: idempotent schema additions on startup ---
(function migrate() {
  let cols = db.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
  if (!cols.includes('approved_by')) db.exec("ALTER TABLE transactions ADD COLUMN approved_by INTEGER REFERENCES users(id)");
  if (!cols.includes('approved_at')) db.exec("ALTER TABLE transactions ADD COLUMN approved_at TEXT");
  if (!cols.includes('admin_notes')) db.exec("ALTER TABLE transactions ADD COLUMN admin_notes TEXT");
  cols = db.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
  if (!cols.includes('external_bank_logo')) db.exec("ALTER TABLE transactions ADD COLUMN external_bank_logo TEXT");
  if (!cols.includes('external_bank_name')) db.exec("ALTER TABLE transactions ADD COLUMN external_bank_name TEXT");
  if (!cols.includes('external_routing')) db.exec("ALTER TABLE transactions ADD COLUMN external_routing TEXT");
  if (!cols.includes('external_account_holder')) db.exec("ALTER TABLE transactions ADD COLUMN external_account_holder TEXT");
  if (!cols.includes('external_account_last4')) db.exec("ALTER TABLE transactions ADD COLUMN external_account_last4 TEXT");
  cols = db.prepare("PRAGMA table_info(profiles)").all().map(c => c.name);
  if (!cols.includes('investment_objective')) db.exec("ALTER TABLE profiles ADD COLUMN investment_objective TEXT");
  if (!cols.includes('communication_pref')) db.exec("ALTER TABLE profiles ADD COLUMN communication_pref TEXT");
  if (!cols.includes('member_id')) db.exec("ALTER TABLE profiles ADD COLUMN member_id TEXT");
  cols = db.prepare("PRAGMA table_info(accounts)").all().map(c => c.name);
  if (!cols.includes('created_at')) db.exec("ALTER TABLE accounts ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
})();

// ---------- users ----------
const txCols = db.prepare('PRAGMA table_info(transactions)').all();
const txColNames = txCols.map(function(c) { return c.name; });
if (!txColNames.includes('approved_by'))   db.prepare('ALTER TABLE transactions ADD COLUMN approved_by INTEGER REFERENCES users(id)').run();
if (!txColNames.includes('approved_at'))   db.prepare('ALTER TABLE transactions ADD COLUMN approved_at TEXT').run();
if (!txColNames.includes('admin_notes'))   db.prepare('ALTER TABLE transactions ADD COLUMN admin_notes TEXT').run();

// ---------- users ----------
const _byCred = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
const _byId   = db.prepare('SELECT * FROM users WHERE id = ?');
const _ins    = db.prepare(`INSERT INTO users (username,email,password_hash,full_name,role,status)
                            VALUES (@username,@email,@password_hash,@full_name,@role,@status)`);
const _upd    = db.prepare(`UPDATE users SET username=@username, email=@email, full_name=@full_name,
                            role=@role, status=@status WHERE id=@id`);
const _del    = db.prepare('DELETE FROM users WHERE id = ?');
const _setPw  = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const _list   = db.prepare('SELECT id,username,email,full_name,role,status,created_at FROM users ORDER BY id');

function getUserByUsernameOrEmail(identifier) {
  return _byCred.get(identifier, identifier) || null;
}
function getUserById(id) {
  return _byId.get(id) || null;
}
function listUsers() {
  return _list.all();
}
function createUser({ username, email, password, full_name, role = 'user', status = 'active' }) {
  const info = _ins.run({
    username, email, password_hash: bcrypt.hashSync(password, 10),
    full_name, role, status,
  });
  return info.lastInsertRowid;
}
function updateUser(id, fields) {
  _upd.run({
    id, username: fields.username, email: fields.email, full_name: fields.full_name,
    role: fields.role, status: fields.status,
  });
}
function deleteUser(id) { _del.run(id); }
function setPassword(id, password) { _setPw.run(bcrypt.hashSync(password, 10), id); }

// ---------- accounts & positions ----------
const _acctIns   = db.prepare(`INSERT INTO accounts (user_id,type,nickname,number,created_at) VALUES (?,?,?,?,?)`);
const _posIns    = db.prepare(`INSERT INTO positions (account_id,symbol,name,quantity,price,cost_basis,is_cash)
                               VALUES (?,?,?,?,?,?,?)`);
const _acctsByU  = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY id');
const _posByA    = db.prepare('SELECT * FROM positions WHERE account_id = ? ORDER BY is_cash, symbol');
const _acctCount = db.prepare('SELECT COUNT(*) c FROM accounts WHERE user_id = ?');

function createAccount(userId, type, nickname, number, createdAt) {
  const info = _acctIns.run(userId, type, nickname || null, number, createdAt || new Date().toISOString());
  return info.lastInsertRowid;
}
function createPosition(accountId, p) {
  _posIns.run(accountId, p.symbol, p.name || null, p.quantity, p.price, p.cost_basis, p.is_cash ? 1 : 0);
}
function listAccounts(userId) { return _acctsByU.all(userId); }
function listPositions(accountId) { return _posByA.all(accountId); }
function hasPortfolio(userId) { return _acctCount.get(userId).c > 0; }

// ---------- activities ----------
const _actIns   = db.prepare('INSERT INTO activities (user_id,adate,description,amount,type) VALUES (?,?,?,?,?)');
const _actList  = db.prepare('SELECT adate,description,amount,type FROM activities WHERE user_id = ? ORDER BY adate DESC LIMIT 8');
const _actCount = db.prepare('SELECT COUNT(*) c FROM activities WHERE user_id = ?');

function listActivities(userId) { return _actList.all(userId); }
function getActivity(userId) { return _actList.all(Number(userId)); }
function seedActivities(userId) {
  if (_actCount.get(userId).c > 0) return;
  const rows = [
    ['2026-08-04', 'Dividend — FSKAX', 42.18, 'Dividend'],
    ['2026-07-29', 'Buy 5 AAPL @ 224.10', -1120.50, 'Trade'],
    ['2026-07-15', 'Deposit to Cash Management', 1500.00, 'Deposit'],
    ['2026-07-02', 'Dividend — FXAIX', 55.30, 'Dividend'],
    ['2026-06-20', 'Transfer to Roth IRA', 600.00, 'Transfer'],
    ['2026-06-05', 'Sell 10 GOOGL @ 171.40', 1714.00, 'Trade'],
  ];
  for (const r of rows) _actIns.run(userId, r[0], r[1], r[2], r[3]);
}

// ---------- orders ----------
const _orderIns    = db.prepare(`INSERT INTO orders (user_id,symbol,side,type,quantity,limit_price,status)
                                 VALUES (?,?,?,?,?,?,?)`);
const _ordersOpen  = db.prepare(`SELECT id,symbol,side,type,quantity,limit_price,status,created_at
                                 FROM orders WHERE user_id=? AND status='Open' ORDER BY created_at DESC`);
const _ordersHist  = db.prepare(`SELECT id,symbol,side,type,quantity,limit_price,status,created_at
                                 FROM orders WHERE user_id=? AND status!='Open' ORDER BY created_at DESC`);
const _orderCancel = db.prepare(`UPDATE orders SET status='Cancelled' WHERE id=? AND user_id=?`);

function createOrder(userId, o) {
  const info = _orderIns.run(userId, (o.symbol || '').toUpperCase(), o.side, o.type,
                             Number(o.quantity) || 0, o.limit_price != null ? Number(o.limit_price) : null, 'Open');
  return info.lastInsertRowid;
}
function listOpenOrders(userId) { return _ordersOpen.all(userId); }
function listOrderHistory(userId) { return _ordersHist.all(userId); }
function cancelOrder(userId, id) { _orderCancel.run(id, userId); }

// ---------- alerts ----------
const _alertIns = db.prepare(`INSERT INTO alerts (user_id,kind,symbol,trigger,status) VALUES (?,?,?,?,?)`);
const _alerts   = db.prepare(`SELECT id,kind,symbol,trigger,status,created_at
                             FROM alerts WHERE user_id=? ORDER BY created_at DESC`);
const _alertDel = db.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?');

function createAlert(userId, a) {
  const info = _alertIns.run(userId, a.kind, (a.symbol || null), a.trigger || '', 'Active');
  return info.lastInsertRowid;
}
function listAlerts(userId) { return _alerts.all(userId); }
function deleteAlert(userId, id) { _alertDel.run(id, userId); }

// ---------- watchlists ----------
const _wlById   = db.prepare('SELECT * FROM watchlists WHERE id = ? AND user_id = ?');
const _wlList   = db.prepare('SELECT * FROM watchlists WHERE user_id = ? ORDER BY position, id');
const _wlIns    = db.prepare('INSERT INTO watchlists (user_id,name,symbols,position) VALUES (?,?,?,?)');
const _wlUpd    = db.prepare('UPDATE watchlists SET symbols = ? WHERE id = ? AND user_id = ?');
const _wlRen    = db.prepare('UPDATE watchlists SET name = ? WHERE id = ? AND user_id = ?');
const _wlDel    = db.prepare('DELETE FROM watchlists WHERE id = ? AND user_id = ?');
const _wlCount  = db.prepare('SELECT COUNT(*) c FROM watchlists WHERE user_id = ?');

function listWatchlists(userId) { return _wlList.all(userId); }
function getWatchlist(userId, id) { return _wlById.get(id, userId); }
function createWatchlist(userId, name, symbols) {
  const pos = _wlCount.get(userId).c;
  const info = _wlIns.run(userId, (name || 'New list').trim().slice(0, 60), (symbols || []).join(','), pos);
  return info.lastInsertRowid;
}
function renameWatchlist(userId, id, name) { _wlRen.run((name || '').trim().slice(0, 60), id, userId); }
function deleteWatchlist(userId, id) { _wlDel.run(id, userId); }
function setWatchlistSymbols(userId, id, syms) { _wlUpd.run(syms.join(','), id, userId); }
function addSymbol(userId, id, sym) {
  const wl = getWatchlist(userId, id); if (!wl) return;
  const set = new Set((wl.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  set.add(sym.trim().toUpperCase());
  _wlUpd.run(Array.from(set).join(','), id, userId);
}
function removeSymbol(userId, id, sym) {
  const wl = getWatchlist(userId, id); if (!wl) return;
  const set = new Set((wl.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  set.delete(sym.trim().toUpperCase());
  _wlUpd.run(Array.from(set).join(','), id, userId);
}

// ---------- position update (for order fills / transfers) ----------
const _posUpd = db.prepare('UPDATE positions SET quantity=?, price=?, cost_basis=? WHERE id=?');
function updatePosition(id, quantity, price, cost_basis) { _posUpd.run(quantity, price, cost_basis, id); }

// ---------- order fill ----------
const _orderById = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?');
const _orderFill = db.prepare("UPDATE orders SET status='Filled' WHERE id = ?");
function getOrderForUser(userId, id) { return _orderById.get(id, userId); }
function fillOrder(userId, orderId, price) {
  const o = _orderById.get(orderId, userId);
  if (!o || o.status !== 'Open') return null;
  const accounts = listAccounts(userId);
  if (!accounts.length) return null;
  if (o.side === 'BUY') {
    const acc = accounts.find(a => a.type === 'Brokerage') || accounts[0];
    const existing = listPositions(acc.id).find(p => p.symbol === o.symbol && !p.is_cash);
    if (existing) {
      const totQ = existing.quantity + o.quantity;
      const avg = totQ ? ((existing.cost_basis * existing.quantity) + price * o.quantity) / totQ : price;
      updatePosition(existing.id, totQ, price, avg);
    } else {
      createPosition(acc.id, { symbol: o.symbol, name: o.symbol, quantity: o.quantity, price: price, cost_basis: price });
    }
  } else {
    for (const acc of accounts) {
      const pos = listPositions(acc.id).find(p => p.symbol === o.symbol && !p.is_cash);
      if (pos) {
        const remain = Math.max(0, pos.quantity - o.quantity);
        if (remain <= 0.0001) db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id);
        else updatePosition(pos.id, remain, pos.price, pos.cost_basis);
        break;
      }
    }
  }
  _orderFill.run(o.id);
  _actIns.run(userId, '2026-08-08', (o.side === 'BUY' ? 'Buy ' : 'Sell ') + o.quantity + ' ' + o.symbol + ' @ ' + (price || 0).toFixed(2), o.side === 'BUY' ? -(price * o.quantity) : (price * o.quantity), 'Trade');
  return o;
}

// ---------- cash transfer between accounts ----------
function transferCash(userId, fromType, toType, amount) {
  amount = Number(amount) || 0;
  if (amount <= 0 || !fromType || !toType || fromType === toType) return false;
  const accounts = listAccounts(userId);
  const from = accounts.find(a => a.type === fromType);
  const to = accounts.find(a => a.type === toType);
  if (!from || !to) return false;
  const fromCash = listPositions(from.id).find(p => p.is_cash);
  const avail = fromCash ? fromCash.price : 0;
  if (amount > avail + 0.001) return false;
  if (fromCash) {
    const rem = fromCash.price - amount;
    if (rem <= 0.001) db.prepare('DELETE FROM positions WHERE id = ?').run(fromCash.id);
    else updatePosition(fromCash.id, 1, rem, rem);
  }
  const toCash = listPositions(to.id).find(p => p.is_cash);
  if (toCash) updatePosition(toCash.id, 1, toCash.price + amount, toCash.price + amount);
  else createPosition(to.id, { symbol: 'CASH', name: 'Cash', quantity: 1, price: amount, cost_basis: amount, is_cash: true });
  _actIns.run(userId, new Date().toISOString().slice(0, 10), 'Transfer ' + amount.toFixed(2) + ' from ' + fromType + ' to ' + toType, null, 'Transfer');
  // record the transfer as transactions on both accounts so it appears in
  // the transaction history (not just the activity feed)
  const ref = 'XFR-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  const today = new Date().toISOString().slice(0, 10);
  const fromBalance = (fromCash ? fromCash.price : 0) - amount;
  const toBalance = (toCash ? toCash.price : 0) + amount;
  createTransaction(userId, {
    account_id: from.id, tdate: today, type: 'transfer', symbol: null,
    description: 'Transfer to ' + toType, quantity: null, price: null,
    amount: -amount, balance_after: fromBalance, status: 'settled', reference_id: ref,
  });
  createTransaction(userId, {
    account_id: to.id, tdate: today, type: 'transfer', symbol: null,
    description: 'Transfer from ' + fromType, quantity: null, price: null,
    amount: amount, balance_after: toBalance, status: 'settled', reference_id: ref,
  });
  return true;
}

// ---------- cash deposit / withdrawal (ACH deposits, bill pay, external transfers) ----------
const _cashByAcct = db.prepare('SELECT * FROM positions WHERE account_id = ? AND is_cash = 1 LIMIT 1');
function getCashPosition(accountId) { return _cashByAcct.get(accountId) || null; }

// Add cash to an account (used by deposits). Returns the created transaction row id.
function depositCash(userId, accountId, amount, type) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const acc = getAccount(accountId);
  if (!acc || acc.user_id !== Number(userId)) return null;
  // admin approval required: do NOT credit cash until approved
  const cash = getCashPosition(accountId);
  const currentBalance = cash ? cash.price : 0;
  const today = new Date().toISOString().slice(0, 10);
  const ref = 'D-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  return createTransaction(userId, {
    account_id: accountId, tdate: today, type: type || 'deposit',
    description: (type === 'transfer' ? 'Transfer received' : 'ACH Deposit'),
    quantity: null, price: null, amount: amt, balance_after: currentBalance, status: 'pending', reference_id: ref,
  });
}

// Remove cash from an account (used by bill pay / external transfers).
// Returns the created transaction row id, or null if funds were insufficient.
// NOTE: cash is NOT deducted until admin approves the pending transaction.
function withdrawCash(userId, accountId, amount, txType, description) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const acc = getAccount(accountId);
  if (!acc || acc.user_id !== Number(userId)) return null;
  const cash = getCashPosition(accountId);
  const avail = cash ? cash.price : 0;
  if (amt > avail + 0.001) return null; // still prevent overdraft attempts
  // admin approval required: do NOT debit cash until approved
  const today = new Date().toISOString().slice(0, 10);
  const ref = 'W-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  return createTransaction(userId, {
    account_id: accountId, tdate: today, type: txType || 'withdrawal',
    description: description || (txType === 'transfer' ? 'Transfer to external bank' : 'Bill payment'),
    quantity: null, price: null, amount: -amt, balance_after: avail - amt, status: 'pending', reference_id: ref,
  });
}

// External transfer: send cash to an external bank account.
// Records a pending 'external_transfer' transaction carrying destination
// bank details. Cash is NOT debited until admin approves (same model as
// move-money / bill pay). Stores only the last 4 of the external account
// number — never the full PAN.
function externalTransfer(userId, opts) {
  const { account_id, amount, tdate, external_bank_logo, external_bank_name,
          external_routing, external_account_holder, external_account_last4, description } = opts || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const acc = getAccount(account_id);
  if (!acc || acc.user_id !== Number(userId)) return null;
  const cash = getCashPosition(account_id);
  const avail = cash ? cash.price : 0;
  if (amt > avail + 0.001) return null;
  const today = tdate || new Date().toISOString().slice(0, 10);
  const ref = 'EXT-' + String(Number(userId)).padStart(5, '0') + '-' + Date.now().toString(36).slice(-6);
  return createTransaction(userId, {
    account_id, tdate: today, type: 'external_transfer',
    description: description || ('External transfer to ' + (external_bank_name || 'external bank') + ' (????' + (external_account_last4 || '') + ')'),
    quantity: null, price: null, amount: -amt, balance_after: avail - amt,
    status: 'pending', reference_id: ref,
    external_bank_logo: external_bank_logo || null,
    external_bank_name: external_bank_name || null,
    external_routing: external_routing || null,
    external_account_holder: external_account_holder || null,
    external_account_last4: external_account_last4 || null,
  });
}

// ---------- per-user extras so every dashboard section is populated ----------
function seedDefaultWatchlists(userId) {
  if (_wlCount.get(userId).c > 0) return;
  createWatchlist(userId, 'My Favorites', ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL']);
  createWatchlist(userId, 'ETFs & Funds', ['SPY', 'QQQ', 'VTI', 'FXAIX', 'FSKAX']);
  createWatchlist(userId, 'Crypto', ['BTC', 'ETH']);
}
function seedUserExtras(userId) {
  seedDefaultWatchlists(userId);
  if (listAlerts(userId).length === 0) createAlert(userId, { kind: 'Price', symbol: 'AAPL', trigger: 'Above 230.00' });
  if (listOrderHistory(userId).length === 0) _orderIns.run(userId, 'MSFT', 'BUY', 'Market', 5, null, 'Filled');
}

// stable pseudo-random account number
function acctNumber(prefix) {
  let s = '';
  for (let i = 0; i < 9; i++) s += Math.floor(Math.random() * 10);
  return prefix + s;
}

// Default portfolio template assigned to every new user (realistic mock data)
const PORTFOLIO_TEMPLATE = [
  {
    type: 'Brokerage', nickname: 'Brokerage', number: () => acctNumber('Z'),
    positions: [
      { symbol: 'FXAIX', name: 'Fidelity 500 Index Fund',          quantity: 85,  price: 188.42, cost_basis: 165.10 },
      { symbol: 'FSKAX', name: 'Fidelity Total Market Index Fund', quantity: 120, price: 112.34, cost_basis: 98.20 },
      { symbol: 'GOOGL', name: 'Alphabet Inc Class A',            quantity: 15,  price: 175.20, cost_basis: 148.00 },
      { symbol: 'AAPL',  name: 'Apple Inc',                        quantity: 20,  price: 225.10, cost_basis: 182.50 },
      { symbol: 'CASH',  name: 'Cash',                             quantity: 1,   price: 6250.00, cost_basis: 6250.00, is_cash: true },
    ],
  },
  {
    type: 'Roth IRA', nickname: 'Roth IRA', number: () => acctNumber('X'),
    positions: [
      { symbol: 'FZROX', name: 'Fidelity ZERO Total Market Index', quantity: 210, price: 18.55, cost_basis: 16.20 },
      { symbol: 'FXNAX', name: 'Fidelity U.S. Bond Index Fund',    quantity: 140, price: 8.72,  cost_basis: 8.40 },
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

    // ---------- profiles ----------
    const _profByU = db.prepare('SELECT * FROM profiles WHERE user_id = ?');
    // Field set mirrors lib/db-pg.js PROFILE_FIELDS so both back-ends persist the
    // exact same columns (incl. investment_objective added to the schema).
    const PROFILE_FIELDS = ['phone','address_line1','address_line2','city','state','zip_code','country',
      'date_of_birth','ssn_last4','employment_status','employer_name','employer_address','job_title',
      'annual_income','net_worth','investment_experience','investment_objective','risk_tolerance',
      'citizenship','tax_id_type','tax_id','communication_pref'];
    const _profIns = db.prepare(`INSERT INTO profiles (user_id, ${PROFILE_FIELDS.join(', ')})\n                                VALUES (?,${PROFILE_FIELDS.map(() => '?').join(',')})`);
    const _profUpd = db.prepare(`UPDATE profiles SET ${PROFILE_FIELDS.map((f,i)=>`${f}=?`).join(', ')}, updated_at=datetime('now') WHERE user_id=?`);

    function getProfile(userId) {
      return _profByU.get(userId) || null;
    }
    function upsertProfile(userId, data) {
      const vals = PROFILE_FIELDS.map(f => data[f] != null ? data[f] : null);
      const existing = _profByU.get(userId);
      if (existing) {
        _profUpd.run(...vals, userId);
      } else {
        _profIns.run(userId, ...vals);
      }
    }

    // ---------- transactions ----------
    const _txIns = db.prepare(`INSERT INTO transactions (user_id, account_id, tdate, type, symbol, description, quantity, price, amount, balance_after, status, reference_id, external_bank_logo, external_bank_name, external_routing, external_account_holder, external_account_last4)\n                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const _txList = db.prepare('SELECT t.*, a.type as account_type FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id WHERE t.user_id = ? ORDER BY tdate DESC, t.id DESC LIMIT 100');
    const _txByAccount = db.prepare('SELECT * FROM transactions WHERE account_id = ? ORDER BY tdate DESC, id DESC LIMIT 50');
    const _txCount = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id = ?');

    function createTransaction(userId, tx) {
      const info = _txIns.run(
        userId,
        tx.account_id || null,
        tx.tdate,
        tx.type,
        tx.symbol || null,
        tx.description,
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
        tx.external_account_last4 || null
      );
      return info.lastInsertRowid;
    }
    function listTransactions(userId) { return _txList.all(userId); }
    function listAccountTransactions(accountId) { return _txByAccount.all(accountId); }
    function getTransactionCount(userId) { return _txCount.get(userId).c; }

    // Seed sample transactions for a user
    function seedTransactions(userId) {
      if (getTransactionCount(userId) > 0) return;
      const accounts = listAccounts(userId);
      const brokerage = accounts.find(a => a.type === 'Brokerage');
      const ira = accounts.find(a => a.type === 'Roth IRA');
      const cash = accounts.find(a => a.type === 'Cash Management');
      const now = new Date();
      const rows = [
        // Brokerage transactions
        { account_id: brokerage?.id, tdate: '2026-07-29', type: 'trade_buy', symbol: 'AAPL', description: 'Buy 5 AAPL @ 224.10', quantity: 5, price: 224.10, amount: -1120.50, balance_after: 6250.00, status: 'settled', reference_id: 'ORD-1001' },
        { account_id: brokerage?.id, tdate: '2026-07-15', type: 'deposit', symbol: null, description: 'ACH Deposit', quantity: null, price: null, amount: 1500.00, balance_after: 7370.50, status: 'settled', reference_id: 'DEP-2001' },
        { account_id: brokerage?.id, tdate: '2026-07-02', type: 'dividend', symbol: 'FXAIX', description: 'Dividend — FSKAX', quantity: null, price: null, amount: 42.18, balance_after: 7412.68, status: 'settled', reference_id: 'DIV-3001' },
        { account_id: brokerage?.id, tdate: '2026-06-20', type: 'transfer', symbol: null, description: 'Transfer to Roth IRA', quantity: null, price: null, amount: -600.00, balance_after: 6812.68, status: 'settled', reference_id: 'XFR-4001' },
        { account_id: brokerage?.id, tdate: '2026-06-05', type: 'trade_sell', symbol: 'GOOGL', description: 'Sell 10 GOOGL @ 171.40', quantity: 10, price: 171.40, amount: 1714.00, balance_after: 8526.68, status: 'settled', reference_id: 'ORD-1002' },
        // Roth IRA transactions
        { account_id: ira?.id, tdate: '2026-06-20', type: 'transfer', symbol: null, description: 'Transfer from Brokerage', quantity: null, price: null, amount: 600.00, balance_after: 2420.00, status: 'settled', reference_id: 'XFR-4001' },
        { account_id: ira?.id, tdate: '2026-05-15', type: 'deposit', symbol: null, description: 'IRA Contribution 2026', quantity: null, price: null, amount: 1000.00, balance_after: 1820.00, status: 'settled', reference_id: 'DEP-2002' },
        // Cash Management transactions
        { account_id: cash?.id, tdate: '2026-07-15', type: 'deposit', symbol: null, description: 'ACH Deposit', quantity: null, price: null, amount: 1500.00, balance_after: 4700.00, status: 'settled', reference_id: 'DEP-2003' },
        { account_id: cash?.id, tdate: '2026-07-01', type: 'interest', symbol: null, description: 'Interest Payment', quantity: null, price: null, amount: 12.50, balance_after: 3212.50, status: 'settled', reference_id: 'INT-5001' },
        { account_id: cash?.id, tdate: '2026-06-20', type: 'withdrawal', symbol: null, description: 'ATM Withdrawal', quantity: null, price: null, amount: -200.00, balance_after: 3012.50, status: 'settled', reference_id: 'WDR-6001' },
      ];
      for (const r of rows) {
        if (r.account_id) _txIns.run(userId, r.account_id, r.tdate, r.type, r.symbol, r.description, r.quantity, r.price, r.amount, r.balance_after, r.status, r.reference_id, null, null, null, null, null);
      }
    }

    // first Cash Management account for a user (used to anchor deposits/transactions)
    const _cashMgmtByU = db.prepare(`SELECT id FROM accounts WHERE user_id=? AND type='Cash Management' ORDER BY id LIMIT 1`);

    // Record an admin-specified initial deposit as a transaction + activity line.
    // Mirrors the starting cash that seedDefaultPortfolio applied to the Cash Management account.
    function seedInitialDeposit(userId, amount) {
      const amt = Number(amount) || 0;
      if (!amt) return null;
      const acc = _cashMgmtByU.get(userId);
      const today = new Date().toISOString().slice(0, 10);
      const ref = 'INIT-' + String(userId).padStart(5, '0');
      _actIns.run(userId, today, 'Initial deposit', amt, 'Deposit');
      return createTransaction(userId, {
        account_id: acc ? acc.id : null, tdate: today, type: 'deposit',
        description: 'Initial deposit', quantity: null, price: null,
        amount: amt, balance_after: amt, status: 'settled', reference_id: ref,
      });
    }

    function addCustomTransactions(userId, txs) {
      const today = new Date().toISOString().slice(0, 10);
      const acc = _cashMgmtByU.get(userId);
      const out = [];
      for (const t of txs) {
        const desc = ((t.description || '').trim());
        const amt = Number(t.amount);
        if (!desc || !amt) continue; // skip blank rows
        out.push(createTransaction(userId, {
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

    // ---------- admin: cross-user transaction access & modification ----------
    // Admin can read, modify, and delete ANY transaction across all user accounts.
    const _txById   = db.prepare('SELECT * FROM transactions WHERE id = ?');
    const _txUpd    = db.prepare(`UPDATE transactions SET tdate=?, type=?, symbol=?, description=?,
      quantity=?, price=?, amount=?, balance_after=?, status=?, reference_id=? WHERE id=?`);
    const _txDel    = db.prepare('DELETE FROM transactions WHERE id = ?');
    const _txByUser = db.prepare(`SELECT t.*, a.type as account_type FROM transactions t
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE t.user_id = ? ORDER BY t.tdate DESC, t.id DESC`);

    function getTransaction(id) { return _txById.get(id) || null; }
    function updateTransaction(id, fields) {
      _txUpd.run(
        fields.tdate || '', fields.type || 'deposit', fields.symbol || null,
        fields.description || '', fields.quantity != null ? Number(fields.quantity) : null,
        fields.price != null ? Number(fields.price) : null, Number(fields.amount) || 0,
        fields.balance_after != null ? Number(fields.balance_after) : null,
        fields.status || 'settled', fields.reference_id || null, Number(id)
      );
    }
    function deleteTransaction(id) { _txDel.run(Number(id)); }
    function listUserTransactions(userId) { return _txByUser.all(Number(userId)); }

    // ---------- admin: transaction approval workflow ----------
    // Clients create pending transactions (deposits, bill pay, external transfers).
    // Admin reviews and either approves (updates cash) or declines (leaves cash untouched).
    const _txPending = db.prepare(`
      SELECT t.*, u.username, u.full_name, a.type as account_type
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE t.status = 'pending'
      ORDER BY t.created_at DESC
    `);
    const _txSettle = db.prepare(`UPDATE transactions SET status = ?, approved_by = ?, approved_at = ?, admin_notes = ?
                                   WHERE id = ? AND status = ?`);
    function listPendingTransactions() { return _txPending.all(); }

    function approveTransaction(id, adminId, notes) {
      const tx = _txById.get(Number(id));
      if (!tx || tx.status !== 'pending') return false;
      // credit or debit the cash position based on transaction direction
      if (tx.amount > 0) {
        // deposit / positive amount: add cash
        const cash = getCashPosition(tx.account_id);
        const newBal = (cash ? cash.price : 0) + Math.abs(tx.amount);
        if (cash) updatePosition(cash.id, 1, newBal, cash.cost_basis + Math.abs(tx.amount));
        else createPosition(tx.account_id, { symbol: 'CASH', name: 'Cash', quantity: 1, price: newBal, cost_basis: newBal, is_cash: true });
      } else {
        // withdrawal / negative amount: remove cash
        const cash = getCashPosition(tx.account_id);
        if (cash) {
          const newBal = cash.price - Math.abs(tx.amount);
          if (newBal <= 0.001) db.prepare('DELETE FROM positions WHERE id = ?').run(cash.id);
          else updatePosition(cash.id, 1, newBal, newBal);
        }
      }
      _txSettle.run('settled', Number(adminId), new Date().toISOString(), notes || null, Number(id), 'pending');
      addActivity(tx.user_id, 'Approved: ' + tx.description, null, 'approval');
      return true;
    }

    function declineTransaction(id, adminId, notes) {
      const tx = _txById.get(Number(id));
      if (!tx || tx.status !== 'pending') return false;
      _txSettle.run('cancelled', Number(adminId), new Date().toISOString(), notes || null, Number(id), 'pending');
      addActivity(tx.user_id, 'Declined: ' + tx.description, null, 'decline');
      return true;
    }

    function addActivity(userId, description, amount, type) {
      const today = new Date().toISOString().slice(0, 10);
      return _actIns.run(Number(userId), today, description, amount != null ? Number(amount) : null, type || null);
    }

    // pending-count helper for UI badge
    const _txPendingCount = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id = ? AND status = ?');
    function pendingTransactionCount(userId) { return _txPendingCount.get(Number(userId), 'pending').c; }

    const _acctById = db.prepare('SELECT * FROM accounts WHERE id = ?');
    function getAccount(id) { return _acctById.get(id) || null; }

    // ---------- admin: prune a user's entire client dataset ----------
    function pruneAdminClientData(userId) {
      db.prepare('DELETE FROM watchlists WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM alerts WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM activities WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM positions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)')
        .run(userId);
      db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId);
      return db.prepare('SELECT changes() as n').get().n;
    }

    module.exports = {
      db,
      getUserByUsernameOrEmail, getUserById, listUsers,
      createUser, updateUser, deleteUser, setPassword,
      listAccounts, listPositions, hasPortfolio, seedDefaultPortfolio, seedUserExtras, listActivities,
      createOrder, listOpenOrders, listOrderHistory, cancelOrder, getOrderForUser, fillOrder,
      createAlert, listAlerts, deleteAlert,
      listWatchlists, getWatchlist, createWatchlist, renameWatchlist, deleteWatchlist,
      addSymbol, removeSymbol, updatePosition, transferCash,
      transferCash, getCashPosition, depositCash, withdrawCash, externalTransfer,
      getProfile, upsertProfile,
      createTransaction, listTransactions, listAccountTransactions, getTransactionCount, seedTransactions,
      seedInitialDeposit, addCustomTransactions,
      getTransaction, updateTransaction, deleteTransaction, listUserTransactions, getAccount,
      listPendingTransactions, approveTransaction, declineTransaction, addActivity, pendingTransactionCount, getActivity,
      pruneAdminClientData,
    };

function seedDefaultPortfolio(userId, initialCash, createdAt) {
  for (const acc of PORTFOLIO_TEMPLATE) {
    const accId = createAccount(userId, acc.type, acc.nickname, acc.number(), createdAt);
    for (const p of acc.positions) {
      let price = p.price, cost = p.cost_basis;
      // An admin-specified initial deposit overrides the default Cash Management balance
      if (initialCash != null && acc.type === 'Cash Management' && p.is_cash) {
        const v = Number(initialCash);
        if (v > 0) { price = v; cost = v; }
      }
      createPosition(accId, { symbol: p.symbol, name: p.name, quantity: p.quantity, price, cost_basis: cost, is_cash: p.is_cash });
    }
  }
}
