'use strict';
require('dotenv').config(); // Load .env file
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./lib/db');
const sessionStore = db.sessionStore;
const auth = require('./lib/auth');
const seed = require('./lib/seed');
const dash = require('./lib/dashboard');

const ROOT = __dirname;
const CLONE = path.join(ROOT, 'main');
const PUBLIC = path.join(ROOT, 'public');

// --- session secret: env override, else a stable random secret persisted to disk ---
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secFile = path.join(ROOT, '.session_secret');
  try {
    if (fs.existsSync(secFile)) return fs.readFileSync(secFile, 'utf8').trim();
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secFile, s, { mode: 0o600 });
    return s;
  } catch (_) {
    return crypto.randomBytes(32).toString('hex');
  }
}

seed(); // ensure admin + demo user exist

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: sessionStore,
  secret: getSessionSecret(),
  resave: false, saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));
app.use(auth.loadUser);

// basic security headers (clickjacking / MIME-sniffing protection)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// formatting helpers available in all templates
app.locals.h = {
  money(n) {
    const v = Number(n) || 0;
    const a = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v < 0 ? `(${a})` : `$${a}`;
  },
  signedMoney(n) {
    const v = Number(n) || 0;
    return (v >= 0 ? '+' : '-') + app.locals.h.money(Math.abs(v)).replace('$', '$');
  },
  pct(n) { const v = Number(n) || 0; return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; },
  num(n) { return (Number(n) || 0).toLocaleString('en-US'); },
  cls(n) { return Number(n) >= 0 ? 'pos' : 'neg'; },
};

// --- marketing homepage: serve the static clone with auth state injected so the
// nav/CTA reflects login state in a single request (no flash, no extra fetch).
app.get('/', (req, res) => {
  const user = req.session && req.session.userId ? db.getUserById(req.session.userId) : null;
  fs.readFile(path.join(CLONE, 'index.html'), 'utf8', (err, html) => {
    if (err) return res.sendStatus(404);
    const payload = JSON.stringify({
      loggedIn: !!user,
      name: user ? user.full_name.split(' ')[0] : null,
      role: user ? user.role : null,
    }).replace(/</g, '\\u003c');
    res.type('html').send(html.replace('</body>', `<script>window.__APP__=${payload}</script></body>`));
  });
});

// --- consolidated site information page (replaces the stale /pages/* clones) ---
app.get('/legal', (req, res) => res.render('legal', { title: 'Site information - American Financial Associates' }));

// static: cloned marketing site at '/', app assets at '/static'
app.use('/static', express.static(PUBLIC));
app.use(express.static(CLONE));

// ---------- brute-force lockout for login ----------
const loginLock = (() => {
  const MAX = 5;                  // allowed failures before lock
  const WINDOW = 15 * 60 * 1000;  // 15-minute lockout
  const fails = new Map();        // key -> { count, first, until }
  function check(key) {
    const r = fails.get(key);
    if (!r || !r.until) return null;
    if (r.until > Date.now()) {
      const mins = Math.ceil((r.until - Date.now()) / 60000);
      return `${mins} minute${mins === 1 ? '' : 's'}`;
    }
    fails.delete(key);
    return null;
  }
  function registerFail(key) {
    const now = Date.now();
    let r = fails.get(key);
    if (!r || now - r.first > WINDOW) r = { count: 0, first: now, until: 0 };
    r.count++;
    let remaining = MAX - r.count;
    if (r.count >= MAX) { r.until = now + WINDOW; remaining = 0; }
    fails.set(key, r);
    return remaining;
  }
  function clear(key) { fails.delete(key); }
  return { check, registerFail, clear };
})();

// ---------- auth routes ----------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect(res.locals.user.role === 'admin' ? '/admin' : '/dashboard');
  res.render('login', { error: null, layout: false });
});

app.post('/login', (req, res) => {
  const username = ((req.body && req.body.username) || '').trim();
  const key = username.toLowerCase();
  const locked = loginLock.check(key);
  if (locked) {
    return res.render('login', {
      error: `Too many failed attempts. This account is temporarily locked — try again in ${locked}.`,
      layout: false,
    });
  }
  const u = username && db.getUserByUsernameOrEmail(username);
  const ok = u && u.status === 'active' &&
    bcrypt.compareSync((req.body && req.body.password) || '', u.password_hash);
  if (!ok) {
    const remaining = loginLock.registerFail(key);
    const msg = remaining > 0
      ? `The username or password you entered is incorrect. ${remaining} attempt(s) remaining before this account is temporarily locked.`
      : 'The username or password you entered is incorrect.';
    return res.render('login', { error: msg, layout: false });
  }
  loginLock.clear(key);
  req.session.userId = u.id;
  res.redirect(u.role === 'admin' ? '/admin' : '/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- self-service signup (account opening currently unavailable) ----------
// New self-service account applications are not accepted in this deployment.
app.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('signup', { layout: false });
});

app.post('/signup', (req, res) => {
  res.status(403).render('signup', { unavailable: true, layout: false });
});

// ---------- local guidance hub ----------
app.get('/guidance', (req, res) => {
  res.render('guidance', { title: 'Guidance - American Financial Associates' });
});

// ---------- local content pages (informational, no auth required) ----------
app.get('/investing', (req, res) => {
  res.render('investing', { title: 'Investing & Trading - American Financial Associates' });
});
app.get('/retirement', (req, res) => {
  res.render('retirement', { title: 'Retirement Planning - American Financial Associates' });
});
app.get('/wealth', (req, res) => {
  res.render('wealth', { title: 'Wealth Management - American Financial Associates' });
});
app.get('/research', (req, res) => {
  res.render('research', { title: 'News & Research - American Financial Associates' });
});
app.get('/planning', (req, res) => {
  res.render('planning', { title: 'Financial Planning - American Financial Associates' });
});

app.get('/profile', auth.requireAuth, (req, res) => {
  const profile = db.getProfile(req.session.userId);
  const transactions = db.listTransactions(req.session.userId);
  res.render('profile', { profile, transactions, user: res.locals.user, pendingCount: db.pendingTransactionCount(req.session.userId), pw_error: req.query.pw_error, pw_success: req.query.pw_success });
});

// ---------- change password ----------
app.post('/profile/password', auth.requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};
  const u = db.getUserById(req.session.userId);
  if (!u || !bcrypt.compareSync(current_password || '', u.password_hash)) {
    return res.redirect('/profile?pw_error=1');
  }
  if (!new_password || new_password.length < 6) {
    return res.redirect('/profile?pw_error=2');
  }
  if (new_password !== confirm_password) {
    return res.redirect('/profile?pw_error=3');
  }
  db.setPassword(req.session.userId, new_password);
  res.redirect('/profile?pw_success=1');
});
app.post('/profile', auth.requireAuth, (req, res) => {
  const data = {
    phone: req.body.phone,
    address_line1: req.body.address_line1,
    address_line2: req.body.address_line2,
    city: req.body.city,
    state: req.body.state,
    zip_code: req.body.zip_code,
    country: req.body.country || 'USA',
    date_of_birth: req.body.date_of_birth,
    employment_status: req.body.employment_status,
    employer_name: req.body.employer_name,
    employer_address: req.body.employer_address,
    job_title: req.body.job_title,
    annual_income: req.body.annual_income,
    net_worth: req.body.net_worth,
    investment_experience: req.body.investment_experience,
    risk_tolerance: req.body.risk_tolerance,
    citizenship: req.body.citizenship || 'US',
    tax_id_type: req.body.tax_id_type || 'SSN',
    tax_id: req.body.tax_id
  };
  db.upsertProfile(req.session.userId, data);
  res.redirect('/profile');
});

// ---------- user dashboard ----------
app.get('/dashboard', auth.requireAuth, (req, res) => {
  const data = dash.buildDashboard(req.session.userId);
  // attach per-account cash balances for the in-dashboard money-action forms
  data.accounts.forEach(function (a) {
    const c = db.getCashPosition(a.id);
    a.cash = c ? c.price : 0;
  });
  const defaultAccount = data.accounts.find(function (a) { return a.type === 'Cash Management'; }) || data.accounts[0];
  // load transaction history for the History toggle panel
  const transactions = db.listTransactions(req.session.userId);
  res.render('dashboard', {
    ...data,
    defaultAccount: defaultAccount,
    openPanel: req.query.open || null,
    transferred: req.query.transferred === '1',
    deposited: req.query.deposited === '1',
    paid: req.query.paid === '1',
    moved: req.query.moved === '1',
    payError: req.query.error === '1',
    orderPlaced: req.query.order === '1',
    transactions: transactions,
    pendingCount: db.pendingTransactionCount(req.session.userId),
  });
});

// ---------- trading: place / cancel orders ----------
app.post('/orders', auth.requireAuth, (req, res) => {
  const { symbol, side, type, quantity, limit_price } = req.body || {};
  if (symbol && quantity && Number(quantity) > 0) {
    db.createOrder(req.session.userId, {
      symbol, side: side === 'SELL' ? 'SELL' : 'BUY',
      type: type || 'Market', quantity,
      limit_price: limit_price ? Number(limit_price) : null,
    });
  }
  res.redirect('/dashboard?order=1#trading');
});

app.post('/orders/:id/cancel', auth.requireAuth, (req, res) => {
  db.cancelOrder(req.session.userId, Number(req.params.id));
  res.redirect('/dashboard#trading');
});

// ---------- alerts ----------
app.post('/alerts', auth.requireAuth, (req, res) => {
  const { kind, symbol, trigger } = req.body || {};
  if (kind && trigger) {
    db.createAlert(req.session.userId, { kind, symbol: symbol || null, trigger });
  }
  res.redirect('/dashboard#alerts');
});

app.post('/alerts/:id/delete', auth.requireAuth, (req, res) => {
  db.deleteAlert(req.session.userId, Number(req.params.id));
  res.redirect('/dashboard#alerts');
});

// ---------- order fill (simulated execution -> updates holdings) ----------
app.post('/orders/:id/fill', auth.requireAuth, (req, res) => {
  const o = db.getOrderForUser(req.session.userId, Number(req.params.id));
  if (o && o.status === 'Open') {
    const q = dash.QUOTES[o.symbol];
    const price = q ? q.price : (o.limit_price || 0);
    db.fillOrder(req.session.userId, o.id, price);
  }
  res.redirect('/dashboard?order=1#trading');
});

// ---------- account transfer (moves cash between accounts) ----------
app.post('/transfer', auth.requireAuth, (req, res) => {
  const { from, to, amount } = req.body || {};
  const ok = db.transferCash(req.session.userId, from, to, amount);
  res.redirect(ok ? '/dashboard?open=transfer&transferred=1' : '/dashboard?open=transfer&error=1');
});

// ---------- money movement: deposits, bill pay, external transfers ----------
app.post('/deposit', auth.requireAuth, (req, res) => {
  const { account_id, amount } = req.body || {};
  const ok = db.depositCash(req.session.userId, Number(account_id), amount, 'deposit');
  res.redirect(ok ? '/dashboard?open=deposit&deposited=1' : '/dashboard?open=deposit&error=1');
});

app.post('/pay-bills', auth.requireAuth, (req, res) => {
  const { account_id, amount, payee } = req.body || {};
  const ok = db.withdrawCash(req.session.userId, Number(account_id), amount, 'withdrawal', `Bill payment to ${payee || 'payee'}`);
  res.redirect(ok ? '/dashboard?open=paybills&paid=1' : '/dashboard?open=paybills&error=1');
});

app.post('/move-money', auth.requireAuth, (req, res) => {
  const { account_id, amount, external_bank } = req.body || {};
  const ok = db.withdrawCash(req.session.userId, Number(account_id), amount, 'transfer', `Transfer to external bank ${external_bank || ''}`);
  res.redirect(ok ? '/dashboard?open=movemoney&moved=1' : '/dashboard?open=movemoney&error=1');
});

// ---------- watchlists (per-user, editable) ----------
app.post('/watchlists/new', auth.requireAuth, (req, res) => {
  const name = ((req.body && req.body.name) || '').trim();
  if (name) db.createWatchlist(req.session.userId, name, []);
  res.redirect('/dashboard#watchlists');
});
app.post('/watchlists/:id/add', auth.requireAuth, (req, res) => {
  const sym = ((req.body && req.body.symbol) || '').trim().toUpperCase();
  if (sym) db.addSymbol(req.session.userId, Number(req.params.id), sym);
  res.redirect('/dashboard#watchlists');
});
app.post('/watchlists/:id/remove', auth.requireAuth, (req, res) => {
  const sym = ((req.body && req.body.symbol) || '').trim().toUpperCase();
  if (sym) db.removeSymbol(req.session.userId, Number(req.params.id), sym);
  res.redirect('/dashboard#watchlists');
});
app.post('/watchlists/:id/delete', auth.requireAuth, (req, res) => {
  db.deleteWatchlist(req.session.userId, Number(req.params.id));
  res.redirect('/dashboard#watchlists');
});

// ---------- admin ----------
// Normalize a possibly-repeated/singular form field into an array.
// express.urlencoded({extended:false}) collects same-named repeated fields into an array.
function asArray(v) { if (v == null) return []; return Array.isArray(v) ? v : [v]; }

// Collapse repeated transaction fields (tx_type/tx_desc/tx_amount) into objects.
function asTransactionRows(body) {
  const types = asArray(body.tx_type);
  const descs = asArray(body.tx_desc);
  const amts  = asArray(body.tx_amount);
  const n = Math.max(types.length, descs.length, amts.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ type: types[i] || '', description: descs[i] || '', amount: amts[i] || '' });
  return out;
}

app.get('/admin', auth.requireAdmin, (req, res) => {
  const users = db.listUsers().map(u => {
    const accounts = db.listAccounts(u.id);
    let aum = 0;
    for (const a of accounts) for (const p of db.listPositions(a.id)) aum += p.quantity * p.price;
    let txCount = 0;
    try { txCount = db.getTransactionCount(u.id); } catch (_) {}
    return { ...u, accountCount: accounts.length, aum, txCount };
  });
  const totalUsers = users.length;
  const totalAum = users.reduce((s, u) => s + u.aum, 0);
  res.render('admin', { users, totalUsers, totalAum });
});

app.get('/admin/new', auth.requireAdmin, (req, res) => {
  res.render('admin_form', { user: null, error: null, action: '/admin/new' });
});

app.post('/admin/new', auth.requireAdmin, (req, res) => {
  const { username, email, full_name, password, role, initial_deposit } = req.body || {};
  if (!username || !email || !password) {
    return res.render('admin_form', { user: null, error: 'Username, email and password are required.', action: '/admin/new' });
  }
  if (db.getUserByUsernameOrEmail(username.trim()) || db.getUserByUsernameOrEmail(email.trim())) {
    return res.render('admin_form', { user: null, error: 'Username or email already exists.', action: '/admin/new' });
  }
  const id = db.createUser({
    username: username.trim(), email: email.trim(), full_name: full_name.trim() || username.trim(),
    password, role: role === 'admin' ? 'admin' : 'user', status: 'active',
  });
  const cash = Number(initial_deposit) || 0;
  // seed portfolio (initial_deposit overrides the default Cash Management cash balance)
  db.seedDefaultPortfolio(id, cash > 0 ? cash : undefined);
  db.seedUserExtras(id);
  db.seedTransactions(id);
  // optional initial deposit transaction + any admin-supplied custom transactions
  if (cash > 0) db.seedInitialDeposit(id, cash);
  db.addCustomTransactions(id, asTransactionRows(req.body));
  res.redirect('/admin');
});

app.get('/admin/:id/edit', auth.requireAdmin, (req, res) => {
  const u = db.getUserById(Number(req.params.id));
  if (!u) return res.redirect('/admin');
  res.render('admin_form', { user: u, error: null, action: `/admin/${u.id}/edit` });
});

app.post('/admin/:id/edit', auth.requireAdmin, (req, res) => {
  const u = db.getUserById(Number(req.params.id));
  if (!u) return res.redirect('/admin');
  const { username, email, full_name, role, status } = req.body || {};
  db.updateUser(u.id, {
    username: username.trim(), email: email.trim(), full_name: full_name.trim() || u.full_name,
    role: role === 'admin' ? 'admin' : 'user', status: status === 'disabled' ? 'disabled' : 'active',
  });
  res.redirect('/admin');
});

app.post('/admin/:id/delete', auth.requireAdmin, (req, res) => {
  const u = db.getUserById(Number(req.params.id));
  if (u && u.username !== 'admin') db.deleteUser(u.id); // never delete the seed admin
  res.redirect('/admin');
});

app.post('/admin/:id/reset', auth.requireAdmin, (req, res) => {
  const u = db.getUserById(Number(req.params.id));
  if (u) db.setPassword(u.id, (req.body && req.body.password) || 'password');
  res.redirect('/admin');
});

// ---------- admin: cross-user transaction management ----------
// Admin can view, modify, and delete ANY transaction across all user accounts.
app.get('/admin/transactions', auth.requireAdmin, (req, res) => {
  const users = db.listUsers().map(u => ({ ...u, accountCount: db.listAccounts(u.id).length, pendingCount: db.pendingTransactionCount(u.id) }));
  res.render('admin_transactions', { users, user: res.locals.user });
});

app.get('/admin/users/:userId/transactions', auth.requireAdmin, (req, res) => {
  const target = db.getUserById(Number(req.params.userId));
  if (!target) return res.redirect('/admin/transactions');
  const txs = db.listUserTransactions(target.id);
  const accounts = db.listAccounts(target.id);
  res.render('admin_transactions_user', { target, txs, accounts, user: res.locals.user });
});

app.get('/admin/transactions/:id/edit', auth.requireAdmin, (req, res) => {
  const tx = db.getTransaction(Number(req.params.id));
  if (!tx) return res.redirect('/admin/transactions');
  const target = db.getUserById(tx.user_id);
  const accounts = target ? db.listAccounts(target.id) : [];
  res.render('admin_tx_form', { tx, accounts, user: res.locals.user });
});

app.post('/admin/transactions/:id/edit', auth.requireAdmin, (req, res) => {
  const tx = db.getTransaction(Number(req.params.id));
  if (!tx) return res.redirect('/admin/transactions');
  const { tdate, type, symbol, description, quantity, price, amount, balance_after, status, reference_id } = req.body || {};
  db.updateTransaction(tx.id, {
    tdate, type: type || 'deposit', symbol: symbol || null,
    description, quantity: quantity || null, price: price || null,
    amount, balance_after: balance_after || null, status: status || 'settled',
    reference_id: reference_id || null,
  });
  res.redirect(`/admin/users/${tx.user_id}/transactions`);
});

app.post('/admin/transactions/:id/delete', auth.requireAdmin, (req, res) => {
  const tx = db.getTransaction(Number(req.params.id));
  if (!tx) return res.redirect('/admin/transactions');
  db.deleteTransaction(tx.id);
  res.redirect(`/admin/users/${tx.user_id}/transactions`);
});

// ---------- admin: pending transaction review (approval workflow) ----------
app.get('/admin/transactions/pending', auth.requireAdmin, (req, res) => {
  const pending = db.listPendingTransactions();
  res.render('admin_pending', { pending, user: res.locals.user });
});

app.post('/admin/transactions/:id/approve', auth.requireAdmin, (req, res) => {
  const notes = (req.body && req.body.admin_notes) || '';
  const ok = db.approveTransaction(Number(req.params.id), req.session.userId, notes);
  if (!ok) return res.redirect('/admin/transactions/pending');
  res.redirect('/admin/transactions/pending');
});

app.post('/admin/transactions/:id/decline', auth.requireAdmin, (req, res) => {
  const notes = (req.body && req.body.admin_notes) || '';
  db.declineTransaction(Number(req.params.id), req.session.userId, notes || 'Declined by admin');
  res.redirect('/admin/transactions/pending');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Fidelity clone app listening on port ${PORT}`));
