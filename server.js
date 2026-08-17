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

const ROOT = process.env.LAMBDA_TASK_ROOT ? process.cwd() : __dirname;
const CLONE = path.join(ROOT, 'main');
const PUBLIC = path.join(ROOT, 'public');

// --- session secret: env override, else a stable random secret persisted to disk --
// On Vercel/serverless (read-only filesystem), fall back to a derived secret.
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Serverless / read-only FS: derive a stable secret so sessions survive cold starts
  if (process.env.VERCEL || process.env.LAMBDA_TASK_ROOT) {
    const derived = crypto.createHash('sha256').update(process.env.DATABASE_URL || process.env.VERCEL || 'afa-prod').digest('hex');
    console.warn('[startup] SESSION_SECRET not set — using derived secret. Set SESSION_SECRET for production.');
    return derived;
  }
  const secFile = path.join(ROOT, '.session_secret');
  try {
    if (fs.existsSync(secFile)) return fs.readFileSync(secFile, 'utf8').trim();
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secFile, s, { mode: 0o600 });
    return s;
  } catch (_) {
    const s = crypto.randomBytes(32).toString('hex');
    console.warn('[startup] Could not persist session secret to disk — using ephemeral secret.');
    return s;
  }
}

// --- DB initialization ---
// On Vercel serverless (cold start), seed()/initDb() would race with the first
// request. Tables may not exist yet when the first query hits PostgreSQL,
// causing 500 errors. Instead, lazily initialize on the first request and
// cache the result so warm starts skip the overhead entirely.
let dbReady = false;
let initPromise = null;
function ensureDbReady() {
  if (dbReady) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      if (typeof db.initDb === 'function') await db.initDb();
      if (typeof db.fixProfilesTable === 'function') await db.fixProfilesTable();
      await seed();
    } catch (err) {
      console.error('[init] DB initialization error:', err.message);
      initPromise = null;
      throw err;
    }
    dbReady = true;
  })();
  return initPromise;
}

const app = express();

// --- Auto-catch async errors in route handlers ---
// Express 4 does NOT automatically forward rejected promises from async
// middleware/handlers to next(err). Without this, any unhandled DB query
// rejection hangs the request until Vercel times out (returns 500).
// We wrap every function registered via app.get/post/use/… so that rejected
// promises become err-forwarded to the error handler below.
// Error-handling middleware (4-arg fn) is excluded via length < 4 check.
(function autoCatchAsyncErrors(app) {
  const wrap = fn => function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
  ['get', 'post', 'put', 'delete', 'patch', 'use'].forEach(method => {
    const orig = app[method].bind(app);
    app[method] = function (...args) {
      return orig(...args.map(arg =>
        (typeof arg === 'function' && arg.length < 4) ? wrap(arg) : arg
      ));
    };
  });
})(app);

// Catch unhandled promise rejections at the process level (Vercel Serverless)
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));

app.set('trust proxy', 1); // Trust first proxy for secure cookies
app.use(express.urlencoded({ extended: false }));
// --- Ensure DB schema + seed data are ready before serving requests ---
// Must run BEFORE session middleware (which queries the PG store on cold
// starts with existing session cookies). After first request, dbReady === true
// and this is a zero-cost next().
app.use((req, res, next) => {
  if (dbReady) return next();
  ensureDbReady().then(() => next()).catch(next);
});
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

// --- CSRF: cookie-based double-submit (no extra dependencies) ---
// A random token is issued as a `csrf_token` cookie on every response and
// exposed to templates via res.locals.csrfToken. Every state-changing request
// (POST/PUT/DELETE) must echo that token back as `req.body._csrf` (injected into
// every form by the auto-injector in partials/head.ejs). Login/signup are
// covered too, because the token is issued before any session exists.
const CSRF_COOKIE = 'csrf_token';
function readCookie(req, name) {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.split(';').map(s => s.trim()).find(s => s.indexOf(name + '=') === 0);
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/static')) return next(); // don't tag asset requests
  let token = readCookie(req, CSRF_COOKIE);
  if (!token) token = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = token;
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8,
  });
  next();
});
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const cookieToken = readCookie(req, CSRF_COOKIE);
  const bodyToken = req.body && req.body._csrf;
  if (!cookieToken || !bodyToken || cookieToken !== bodyToken) {
    return res.status(403).type('text/plain').send('Invalid or missing CSRF token');
  }
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
app.get('/', async (req, res) => {
  const user = req.session && req.session.userId ? await db.getUserById(req.session.userId) : null;
  fs.readFile(path.join(CLONE, 'index.html'), 'utf8', (err, html) => {
    if (err) return res.sendStatus(404);
    const payload = JSON.stringify({
      loggedIn: !!user,
      name: user && user.full_name ? String(user.full_name).split(' ')[0] : null,
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
  if (req.session.userId) return res.redirect((res.locals.user && res.locals.user.role === 'admin') ? '/admin' : '/dashboard');
  res.render('login', { error: null, layout: false });
});

app.post('/login', async (req, res) => {
  const username = ((req.body && req.body.username) || '').trim();
  const key = username.toLowerCase();
  const locked = loginLock.check(key);
  if (locked) {
    return res.render('login', {
      error: `Too many failed attempts. This account is temporarily locked — try again in ${locked}.`,
      layout: false,
    });
  }
  const u = username ? await db.getUserByUsernameOrEmail(username) : null;
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
// ---------- research & planning (conditional: dashboard for logged-in, public for visitors) ----------
app.get('/research', async (req, res) => {
  if (!req.session.userId) {
    return res.render('research', { title: 'News & Research - American Financial Associates' });
  }
  const data = await buildPageData(req.session.userId);
  res.render('dash_research', { ...data, title: 'Research - American Financial Associates' });
});
app.get('/planning', async (req, res) => {
  if (!req.session.userId) {
    return res.render('planning', { title: 'Financial Planning - American Financial Associates' });
  }
  const data = await buildPageData(req.session.userId);
  res.render('dash_planning', { ...data, title: 'Planning - American Financial Associates' });
});

app.get('/profile', auth.requireAuth, async (req, res) => {
  const profile = await db.getProfile(req.session.userId);
  const transactions = await db.listTransactions(req.session.userId);
  res.render('profile', { profile, transactions, user: res.locals.user, pendingCount: await db.pendingTransactionCount(req.session.userId), pw_error: req.query.pw_error, pw_success: req.query.pw_success });
});

// ---------- change password ----------
app.post('/profile/password', auth.requireAuth, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};
  const u = await db.getUserById(req.session.userId);
  if (!u || !bcrypt.compareSync(current_password || '', u.password_hash)) {
    return res.redirect('/profile?pw_error=1');
  }
  if (!new_password || new_password.length < 6) {
    return res.redirect('/profile?pw_error=2');
  }
  if (new_password !== confirm_password) {
    return res.redirect('/profile?pw_error=3');
  }
  await db.setPassword(req.session.userId, new_password);
  res.redirect('/profile?pw_success=1');
});
app.post('/profile', auth.requireAuth, async (req, res) => {
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
    investment_objective: req.body.investment_objective,
    risk_tolerance: req.body.risk_tolerance,
    citizenship: req.body.citizenship || 'US',
    tax_id_type: req.body.tax_id_type || 'SSN',
    tax_id: req.body.tax_id,
    communication_pref: req.body.communication_pref || null,
  };
  await db.upsertProfile(req.session.userId, data);
  res.redirect('/profile');
});

// ---------- user dashboard ----------
app.get('/dashboard', auth.requireAuth, async (req, res) => {
  const data = await dash.buildDashboard(req.session.userId);
  // attach per-account cash balances for the in-dashboard money-action forms
  for (const a of data.accounts) {
    const c = await db.getCashPosition(a.id);
    a.cash = c ? c.price : 0;
  }
  const defaultAccount = data.accounts.find(function (a) { return a.type === 'Cash Management'; }) || data.accounts[0] || { id: '', type: '', cash: 0, number: '' };
  // load transaction history for the History toggle panel
  const transactions = await db.listTransactions(req.session.userId);
  res.render('dashboard', {
    ...data,
    defaultAccount: defaultAccount,
    openPanel: req.query.open || null,
    transferred: req.query.transferred === '1',
    deposited: req.query.deposited === '1',
    paid: req.query.paid === '1',
    moved: req.query.moved === '1',
    payError: req.query.error === '1',
    externaltransferred: req.query.externaltransferred === '1',
    externalError: req.query.externalerror === '1',
    orderPlaced: req.query.order === '1',
    transactions: transactions,
    pendingCount: await db.pendingTransactionCount(req.session.userId),
  });
});

// ---------- helper: build dashboard data for standalone pages ----------
async function buildPageData(userId) {
  const data = await dash.buildDashboard(userId);
  for (const a of data.accounts) {
    const c = await db.getCashPosition(a.id);
    a.cash = c ? c.price : 0;
  }
  const defaultAccount = data.accounts.find(function (a) { return a.type === 'Cash Management'; }) || data.accounts[0] || { id: '', type: '', cash: 0, number: '' };
  const transactions = await db.listTransactions(userId);
  const pendingCount = await db.pendingTransactionCount(userId);
  return {
    ...data,
    defaultAccount,
    transactions,
    pendingCount,
    openPanel: null,
    transferred: false,
    deposited: false,
    paid: false,
    moved: false,
    payError: false,
    externaltransferred: false,
    externalError: false,
    orderPlaced: false,
  };
}

// ---------- standalone dashboard pages ----------
app.get('/portfolio', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('portfolio', data);
});

app.get('/trading', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('trading', { ...data, orderPlaced: req.query.order === '1' });
});

app.get('/watchlists', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('watchlists', data);
});

app.get('/charting', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('charting', data);
});

app.get('/activity', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('activity', data);
});

app.get('/alerts', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('alerts', data);
});

app.get('/accounts', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('accounts', data);
});

app.get('/fixed-income', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('fixed-income', data);
});

app.get('/transfer', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('transfer', {
    ...data,
    transferred: req.query.transferred === '1',
    error: req.query.error === '1',
  });
});

app.get('/deposit', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('deposit', {
    ...data,
    deposited: req.query.deposited === '1',
    error: req.query.error === '1',
  });
});

app.get('/pay-bills', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('pay-bills', {
    ...data,
    paid: req.query.paid === '1',
    error: req.query.error === '1',
  });
});

app.get('/move-money', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('move-money', {
    ...data,
    moved: req.query.moved === '1',
    error: req.query.error === '1',
  });
});

app.get('/external-transfer', auth.requireAuth, async (req, res) => {
  const data = await buildPageData(req.session.userId);
  res.render('external-transfer', {
    ...data,
    topBanks: dash.TOP_BANKS,
    externaltransferred: req.query.externaltransferred === '1',
    externalError: req.query.externalerror === '1',
  });
});
app.post('/orders', auth.requireAuth, async (req, res) => {
  const { symbol, side, type, quantity, limit_price } = req.body || {};
  if (symbol && quantity && Number(quantity) > 0) {
    await db.createOrder(req.session.userId, {
      symbol, side: side === 'SELL' ? 'SELL' : 'BUY',
      type: type || 'Market', quantity,
      limit_price: limit_price ? Number(limit_price) : null,
    });
  }
  res.redirect('/trading?order=1');
});

app.post('/orders/:id/cancel', auth.requireAuth, async (req, res) => {
  await db.cancelOrder(req.session.userId, Number(req.params.id));
  res.redirect('/trading');
});

// ---------- alerts ----------
app.post('/alerts', auth.requireAuth, async (req, res) => {
  const { kind, symbol, trigger } = req.body || {};
  if (kind && trigger) {
    await db.createAlert(req.session.userId, { kind, symbol: symbol || null, trigger });
  }
  res.redirect('/alerts');
});

app.post('/alerts/:id/delete', auth.requireAuth, async (req, res) => {
  await db.deleteAlert(req.session.userId, Number(req.params.id));
  res.redirect('/alerts');
});

// ---------- order fill (simulated execution -> updates holdings) ----------
app.post('/orders/:id/fill', auth.requireAuth, async (req, res) => {
  const o = await db.getOrderForUser(req.session.userId, Number(req.params.id));
  if (o && o.status === 'Open') {
    const q = dash.QUOTES[o.symbol];
    const price = q ? q.price : (o.limit_price || 0);
    await db.fillOrder(req.session.userId, o.id, price);
  }
  res.redirect('/trading?order=1');
});

// ---------- account transfer (moves cash between accounts) ----------
app.post('/transfer', auth.requireAuth, async (req, res) => {
  const { from, to, amount } = req.body || {};
  const ok = await db.transferCash(req.session.userId, from, to, amount);
  res.redirect(ok ? '/transfer?transferred=1' : '/transfer?error=1');
});

// ---------- money movement: deposits, bill pay, external transfers ----------
app.post('/deposit', auth.requireAuth, async (req, res) => {
  const { account_id, amount } = req.body || {};
  const ok = await db.depositCash(req.session.userId, Number(account_id), amount, 'deposit');
  res.redirect(ok ? '/deposit?deposited=1' : '/deposit?error=1');
});

app.post('/pay-bills', auth.requireAuth, async (req, res) => {
  const { account_id, amount, payee } = req.body || {};
  const ok = await db.withdrawCash(req.session.userId, Number(account_id), amount, 'withdrawal', `Bill payment to ${payee || 'payee'}`);
  res.redirect(ok ? '/pay-bills?paid=1' : '/pay-bills?error=1');
});

app.post('/move-money', auth.requireAuth, async (req, res) => {
  const { account_id, amount, external_bank } = req.body || {};
  const ok = await db.withdrawCash(req.session.userId, Number(account_id), amount, 'transfer', `Transfer to external bank ${external_bank || ''}`);
  res.redirect(ok ? '/move-money?moved=1' : '/move-money?error=1');
});

// ---------- external transfer (rich destination-bank details) ----------
// Mirrors /move-money but captures and stores structured external-bank info:
// bank logo, bank name, routing number, account holder, and the last 4 of
// the destination account number. Only the last 4 digits are persisted (never
// the full PAN) per least-privilege / PCI guidance; the full number entered by
// the user is reduced to last4 server-side before storage.
app.post('/external-transfer', auth.requireAuth, async (req, res) => {
  const b = req.body || {};
  const { account_id, amount, date, bank_logo, bank_name, routing, account_holder, account_number, reference } = b;
  const accId = Number(account_id);
  const amt = Number(amount);
  // input validation — never persist the full external account number
  const routingDigits = String(routing || '').replace(/\D/g, '');
  const acctDigits = String(account_number || '').replace(/\D/g, '');
  const last4 = acctDigits.slice(-4);
  // destination routing must be exactly 9 digits; account number must carry >=4 digits
  if (!accId || !(amt > 0) || routingDigits.length !== 9 || acctDigits.length < 4) {
    return res.redirect('/external-transfer?externalerror=1');
  }
  const tdate = date || null;
  const desc = reference ? `External transfer to ${bank_name || 'bank'} — ${reference}` : null;
  const ok = await db.externalTransfer(req.session.userId, {
    account_id: accId,
    amount: amt,
    tdate: tdate,
    external_bank_logo: bank_logo || null,
    external_bank_name: bank_name || null,
    external_routing: routingDigits || null,
    external_account_holder: account_holder || null,
    external_account_last4: last4,
    description: desc,
  });
  res.redirect(ok ? '/external-transfer?externaltransferred=1' : '/external-transfer?externalerror=1');
});

// ---------- watchlists (per-user, editable) ----------
app.post('/watchlists/new', auth.requireAuth, async (req, res) => {
  const name = ((req.body && req.body.name) || '').trim();
  if (name) await db.createWatchlist(req.session.userId, name, []);
  res.redirect('/watchlists');
});
app.post('/watchlists/:id/add', auth.requireAuth, async (req, res) => {
  const sym = ((req.body && req.body.symbol) || '').trim().toUpperCase();
  if (sym) await db.addSymbol(req.session.userId, Number(req.params.id), sym);
  res.redirect('/watchlists');
});
app.post('/watchlists/:id/remove', auth.requireAuth, async (req, res) => {
  const sym = ((req.body && req.body.symbol) || '').trim().toUpperCase();
  if (sym) await db.removeSymbol(req.session.userId, Number(req.params.id), sym);
  res.redirect('/watchlists');
});
app.post('/watchlists/:id/delete', auth.requireAuth, async (req, res) => {
  await db.deleteWatchlist(req.session.userId, Number(req.params.id));
  res.redirect('/watchlists');
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
  const dates = asArray(body.tx_date);
  const accts = asArray(body.tx_account_id);
  const syms  = asArray(body.tx_symbol);
  const qtys  = asArray(body.tx_quantity);
  const prics = asArray(body.tx_price);
  const n = Math.max(types.length, descs.length, amts.length, dates.length, accts.length, syms.length, qtys.length, prics.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push({
    type: types[i] || '',
    description: descs[i] || '',
    amount: amts[i] || '',
    tdate: dates[i] || '',
    account_id: accts[i] || '',
    symbol: syms[i] || '',
    quantity: qtys[i] || '',
    price: prics[i] || '',
  });
  return out;
}

app.get('/admin', auth.requireAdmin, async (req, res) => {
  const usersList = await db.listUsers();
  const users = await Promise.all(usersList.map(async u => {
    const accounts = await db.listAccounts(u.id);
    let aum = 0;
    for (const a of accounts) {
      const positions = await db.listPositions(a.id);
      for (const p of positions) aum += p.quantity * p.price;
    }
    let txCount = 0;
    try { txCount = await db.getTransactionCount(u.id); } catch (_) {}
    return { ...u, accountCount: accounts.length, aum, txCount };
  }));
  const totalUsers = users.length;
  const totalAum = users.reduce((s, u) => s + u.aum, 0);
  res.render('admin', { users, totalUsers, totalAum });
});

app.get('/admin/new', auth.requireAdmin, (req, res) => {
  res.render('admin_form', { user: null, error: null, action: '/admin/new' });
});

app.post('/admin/new', auth.requireAdmin, async (req, res) => {
  const { username, email, full_name, password, role, initial_deposit, account_date } = req.body || {};
  if (!username || !email || !password) {
    return res.render('admin_form', { user: null, error: 'Username, email and password are required.', action: '/admin/new' });
  }
  const check1 = await db.getUserByUsernameOrEmail(username.trim());
  const check2 = await db.getUserByUsernameOrEmail(email.trim());
  if (check1 || check2) {
    return res.render('admin_form', { user: null, error: 'Username or email already exists.', action: '/admin/new' });
  }
  const id = await db.createUser({
    username: username.trim(), email: email.trim(), full_name: full_name.trim() || username.trim(),
    password, role: role === 'admin' ? 'admin' : 'user', status: 'active',
  });
  const cash = Number(initial_deposit) || 0;
  const acctDate = (account_date || '').trim() || new Date().toISOString().slice(0, 10);
  // Backdate account creation: pass acctDate through to createAccount.
  await db.seedDefaultPortfolio(id, cash > 0 ? cash : undefined, acctDate);
  await db.seedUserExtras(id);
  await db.seedTransactions(id);
  if (cash > 0) await db.seedInitialDeposit(id, cash);
  await db.addCustomTransactions(id, asTransactionRows(req.body));
  res.redirect('/admin');
});

app.get('/admin/:id/edit', auth.requireAdmin, async (req, res) => {
  const u = await db.getUserById(Number(req.params.id));
  if (!u) return res.redirect('/admin');
  res.render('admin_form', { user: u, error: null, action: `/admin/${u.id}/edit` });
});

app.post('/admin/:id/edit', auth.requireAdmin, async (req, res) => {
  const u = await db.getUserById(Number(req.params.id));
  if (!u) return res.redirect('/admin');
  const { username, email, full_name, role, status } = req.body || {};
  await db.updateUser(u.id, {
    username: username.trim(), email: email.trim(), full_name: full_name.trim() || u.full_name,
    role: role === 'admin' ? 'admin' : 'user', status: status === 'disabled' ? 'disabled' : 'active',
  });
  res.redirect('/admin');
});

app.post('/admin/:id/delete', auth.requireAdmin, async (req, res) => {
  const u = await db.getUserById(Number(req.params.id));
  if (u && u.username !== 'admin') await db.deleteUser(u.id); // never delete the seed admin
  res.redirect('/admin');
});

app.post('/admin/:id/reset', auth.requireAdmin, async (req, res) => {
  const u = await db.getUserById(Number(req.params.id));
  if (u) await db.setPassword(u.id, (req.body && req.body.password) || 'password');
  res.redirect('/admin');
});

// ---------- admin: impersonate user ----------
// Admin can log in as any user to see exactly what they see.
app.get('/admin/:id/impersonate', auth.requireAdmin, async (req, res) => {
  const u = await db.getUserById(Number(req.params.id));
  if (!u || u.username === 'admin') return res.redirect('/admin');
  req.session.adminUserId = req.session.userId;
  req.session.userId = u.id;
  req.session.impersonating = true;
  res.redirect('/dashboard');
});

app.get('/admin/stop-impersonate', (req, res) => {
  if (req.session.impersonating && req.session.adminUserId) {
    req.session.userId = req.session.adminUserId;
    delete req.session.adminUserId;
    delete req.session.impersonating;
  }
  res.redirect('/admin');
});

// ---------- admin: view user accounts & balances ----------
app.get('/admin/:id/accounts', auth.requireAdmin, async (req, res) => {
  const target = await db.getUserById(Number(req.params.id));
  if (!target) return res.redirect('/admin');
  const accounts = await db.listAccounts(target.id);
  const accountsWithBalances = await Promise.all(accounts.map(async a => {
    const positions = await db.listPositions(a.id);
    let balance = 0;
    for (const p of positions) {
      if (p.is_cash) balance = p.price;
      else balance += (p.quantity * p.price);
    }
    return { ...a, balance, positionCount: positions.length };
  }));
  const totalAum = accountsWithBalances.reduce((s, a) => s + a.balance, 0);
  res.render('admin_accounts', { target, accounts: accountsWithBalances, totalAum, user: res.locals.user });
});

// ---------- admin: quick status toggle ----------
app.post('/admin/:id/toggle-status', auth.requireAdmin, async (req, res) => {
  const u = await db.getUserById(Number(req.params.id));
  if (!u || u.username === 'admin') return res.redirect('/admin');
  const newStatus = u.status === 'active' ? 'disabled' : 'active';
  await db.updateUser(u.id, { username: u.username, email: u.email, full_name: u.full_name, role: u.role, status: newStatus });
  res.redirect('/admin');
});

// ---------- admin: cross-user transaction management ----------
// Admin can view, modify, and delete ANY transaction across all user accounts.
app.get('/admin/transactions', auth.requireAdmin, async (req, res) => {
  const usersList = await db.listUsers();
  const users = await Promise.all(usersList.map(async u => {
    const accs = await db.listAccounts(u.id);
    const pend = await db.pendingTransactionCount(u.id);
    let txCount = 0;
    try { txCount = await db.getTransactionCount(u.id); } catch (_) {}
    return { ...u, accountCount: accs.length, pendingCount: pend, txCount };
  }));
  res.render('admin_transactions', { users, user: res.locals.user });
});

app.get('/admin/users/:userId/transactions', auth.requireAdmin, async (req, res) => {
  const target = await db.getUserById(Number(req.params.userId));
  if (!target) return res.redirect('/admin/transactions');
  const txs = await db.listUserTransactions(target.id);
  const accounts = await db.listAccounts(target.id);
  res.render('admin_transactions_user', { target, txs, accounts, user: res.locals.user });
});

// ---------- admin: add a transaction to an EXISTING user's account ----------
// Supports backdating (tdate) and choosing which account the transaction lands on.
app.get('/admin/users/:userId/transactions/new', auth.requireAdmin, async (req, res) => {
  const target = await db.getUserById(Number(req.params.userId));
  if (!target) return res.redirect('/admin/transactions');
  const accounts = await db.listAccounts(target.id);
  res.render('admin_tx_new', { target, accounts, user: res.locals.user, error: null });
});

app.post('/admin/users/:userId/transactions/new', auth.requireAdmin, async (req, res) => {
  const target = await db.getUserById(Number(req.params.userId));
  if (!target) return res.redirect('/admin/transactions');
  const a = req.body || {};
  if (!a.description || !a.description.trim() || !Number(a.amount)) {
    const accounts = await db.listAccounts(target.id);
    return res.render('admin_tx_new', { target, accounts, user: res.locals.user, error: 'Description and a non-zero amount are required.' });
  }
  const tdate = (a.tdate || new Date().toISOString().slice(0, 10));
  await db.createTransaction(target.id, {
    account_id: a.account_id ? Number(a.account_id) : null,
    tdate,
    type: a.type || 'deposit',
    symbol: a.symbol || null,
    description: a.description.trim(),
    quantity: a.quantity != null ? Number(a.quantity) : null,
    price: a.price != null ? Number(a.price) : null,
    amount: Number(a.amount),
    balance_after: a.balance_after != null ? Number(a.balance_after) : null,
    status: a.status || 'settled',
    reference_id: a.reference_id || null,
  });
  res.redirect(`/admin/users/${target.id}/transactions`);
});

app.get('/admin/transactions/:id/edit', auth.requireAdmin, async (req, res) => {
  const tx = await db.getTransaction(Number(req.params.id));
  if (!tx) return res.redirect('/admin/transactions');
  const target = await db.getUserById(tx.user_id);
  const accounts = target ? await db.listAccounts(target.id) : [];
  res.render('admin_tx_form', { tx, accounts, user: res.locals.user });
});

app.post('/admin/transactions/:id/edit', auth.requireAdmin, async (req, res) => {
  const tx = await db.getTransaction(Number(req.params.id));
  if (!tx) return res.redirect('/admin/transactions');
  const { tdate, type, symbol, description, quantity, price, amount, balance_after, status, reference_id } = req.body || {};
  await db.updateTransaction(tx.id, {
    tdate, type: type || 'deposit', symbol: symbol || null,
    description, quantity: quantity || null, price: price || null,
    amount, balance_after: balance_after || null, status: status || 'settled',
    reference_id: reference_id || null,
  });
  res.redirect(`/admin/users/${tx.user_id}/transactions`);
});

app.post('/admin/transactions/:id/delete', auth.requireAdmin, async (req, res) => {
  const tx = await db.getTransaction(Number(req.params.id));
  if (!tx) return res.redirect('/admin/transactions');
  await db.deleteTransaction(tx.id);
  res.redirect(`/admin/users/${tx.user_id}/transactions`);
});

// ---------- admin: pending transaction review (approval workflow) ----------
app.get('/admin/transactions/pending', auth.requireAdmin, async (req, res) => {
  const pending = await db.listPendingTransactions();
  res.render('admin_pending', { pending, user: res.locals.user });
});

app.post('/admin/transactions/:id/approve', auth.requireAdmin, async (req, res) => {
  const notes = (req.body && req.body.admin_notes) || '';
  const ok = await db.approveTransaction(Number(req.params.id), req.session.userId, notes);
  if (!ok) return res.redirect('/admin/transactions/pending');
  res.redirect('/admin/transactions/pending');
});

app.post('/admin/transactions/:id/decline', auth.requireAdmin, async (req, res) => {
  const notes = (req.body && req.body.admin_notes) || '';
  await db.declineTransaction(Number(req.params.id), req.session.userId, notes || 'Declined by admin');
  res.redirect('/admin/transactions/pending');
});

// --- Global error handler ---
// Catches all errors forwarded via next(err) (including auto-caught async
// rejections from the wrapper above) and returns a clean 500 response instead
// of Express's default HTML stack trace or a hung request.
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.path, err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  const isProd = process.env.NODE_ENV === 'production';
  const showDetails = req.query && req.query.debug === '1';
  res.status(err.status || 500);
  if (req.path && req.path.startsWith('/static')) {
    res.type('text/plain').send(isProd && !showDetails ? 'Error' : (err.message || 'Error'));
  } else {
    res.type('html').send(
      (isProd && !showDetails)
        ? '<h1>Internal Server Error</h1><p>An unexpected error occurred. Please try again later.</p>'
        : '<h1>Internal Server Error</h1><pre>' + (err.message || err) + '\n\n' + (err.stack || '') + '</pre>'
    );
  }
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`American Financial Associates app listening on port ${PORT}`));
}
