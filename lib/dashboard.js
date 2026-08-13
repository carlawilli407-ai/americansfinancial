'use strict';
// All dashboard data assembly lives here so server.js stays focused on routing.
const db = require('./db');

// ---------- per-symbol daily change (deterministic mock) ----------
const DAY_PCT = { FXAIX: 0.62, FSKAX: 0.55, GOOGL: 1.18, AAPL: -0.43, FZROX: 0.41, FXNAX: 0.08, CASH: 0 };

function buildPerformance(total, userId) {
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const factors = [0.86, 0.89, 0.88, 0.94, 0.97, 1.0];
  const off = (userId % 3) * 0.01;
  return months.map((m, i) => ({ month: m, value: Math.round(total * factors[i] * (1 + off)) }));
}
function buildDocuments(user) {
  return [
    { name: `July 2026 Account Statement — ${user.full_name}`, date: 'Aug 01, 2026', type: 'Statement' },
    { name: 'Q2 2026 Performance Report', date: 'Jul 15, 2026', type: 'Report' },
    { name: '2025 Year-End Tax Statement (1099)', date: 'Jan 31, 2026', type: 'Tax' },
    { name: 'Roth IRA Contribution Confirmation', date: 'Jun 20, 2026', type: 'Confirmation' },
  ];
}

const ASSET_CLASS = {
  FXAIX: 'US Equity', FSKAX: 'US Equity', FZROX: 'US Equity',
  GOOGL: 'US Equity', AAPL: 'US Equity',
  FXNAX: 'Bonds',
  CASH: 'Cash',
};
const CLASS_COLOR = { 'US Equity': '#368727', 'Bonds': '#0F5319', 'Cash': '#7BC47F', 'International': '#1C7A3F' };

function allocationOf(rows) {
  const sums = {};
  for (const r of rows) {
    const cls = ASSET_CLASS[r.symbol] || 'US Equity';
    sums[cls] = (sums[cls] || 0) + r.marketValue;
  }
  const total = Object.values(sums).reduce((a, b) => a + b, 0) || 1;
  return Object.keys(sums).map(c => ({
    cls: c, value: Math.round(sums[c]), pct: (sums[c] / total) * 100, color: CLASS_COLOR[c] || '#368727',
  })).sort((a, b) => b.value - a.value);
}

function accountBreakdown(accounts, total) {
  return accounts.map(a => ({
    type: a.type, number: a.number, value: Math.round(a._marketValue),
    pct: total ? (a._marketValue / total) * 100 : 0,
  })).sort((a, b) => b.value - a.value);
}

function valueTrend(total, userId) {
  const labels = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const factors = [0.80, 0.82, 0.81, 0.85, 0.84, 0.87, 0.86, 0.89, 0.88, 0.94, 0.97, 1.0];
  const off = (userId % 3) * 0.012;
  return labels.map(m => ({ month: m, value: Math.round(total * factors[labels.indexOf(m)] * (1 + off)) }));
}

// ---------- base market quotes (deterministic mock) ----------
const QUOTES = {
  AAPL:  { name: 'Apple Inc',            price: 225.10, change: 1.18,  changePct: 0.53,  volume: 52344800,  bid: 225.05, ask: 225.15, sector: 'Technology' },
  MSFT:  { name: 'Microsoft Corp',       price: 432.85, change: -2.40, changePct: -0.55, volume: 22103500,  bid: 432.80, ask: 432.90, sector: 'Technology' },
  NVDA:  { name: 'NVIDIA Corp',          price: 124.30, change: 3.10,  changePct: 2.56,  volume: 31204500,  bid: 124.25, ask: 124.35, sector: 'Technology' },
  AMZN:  { name: 'Amazon.com Inc',       price: 186.40, change: 0.92,  changePct: 0.50,  volume: 38410200,  bid: 186.35, ask: 186.45, sector: 'Consumer' },
  GOOGL: { name: 'Alphabet Inc',         price: 175.20, change: 1.18,  changePct: 0.68,  volume: 25600100,  bid: 175.15, ask: 175.25, sector: 'Technology' },
  TSLA:  { name: 'Tesla Inc',            price: 248.30, change: 5.62,  changePct: 2.31,  volume: 91234500,  bid: 248.20, ask: 248.40, sector: 'Auto' },
  SPY:   { name: 'SPDR S&P 500 ETF',     price: 548.20, change: 0.94,  changePct: 0.17,  volume: 61234000,  bid: 548.15, ask: 548.25, sector: 'ETF' },
  QQQ:   { name: 'Invesco QQQ Trust',    price: 478.60, change: 1.20,  changePct: 0.25,  volume: 33120000,  bid: 478.55, ask: 478.65, sector: 'ETF' },
  VTI:   { name: 'Vanguard Total Mkt',   price: 271.10, change: 0.55,  changePct: 0.20,  volume: 4120000,   bid: 271.05, ask: 271.15, sector: 'ETF' },
  FXAIX: { name: 'Fidelity 500 Index',   price: 188.42, change: 0.62,  changePct: 0.33,  volume: 0,         bid: 188.40, ask: 188.44, sector: 'Mutual Fund' },
  FSKAX: { name: 'Fidelity Total Mkt',  price: 112.34, change: 0.55,  changePct: 0.49,  volume: 0,         bid: 112.32, ask: 112.36, sector: 'Mutual Fund' },
  BTC:   { name: 'Bitcoin',              price: 64210.00, change: -1320.00, changePct: -2.01, volume: 0,    bid: 64180,  ask: 64240,  sector: 'Crypto' },
  ETH:   { name: 'Ethereum',             price: 3420.00, change: -55.00, changePct: -1.58, volume: 0,       bid: 3415,   ask: 3425,   sector: 'Crypto' },
};

function quoteRow(sym) { return Object.assign({ symbol: sym }, QUOTES[sym]); }
// safe quote for user-added tickers that may not be in the mock universe
function safeQuote(sym) {
  const q = QUOTES[sym];
  if (q) return Object.assign({ symbol: sym }, q);
  return { symbol: sym, name: sym, price: 0, change: 0, changePct: 0, volume: 0, bid: 0, ask: 0, sector: '' };
}

function multiWatchlists() {
  return [
    { name: 'My Favorites', symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL'] },
    { name: 'ETFs & Funds', symbols: ['SPY', 'QQQ', 'VTI', 'FXAIX', 'FSKAX'] },
    { name: 'Crypto', symbols: ['BTC', 'ETH'] },
  ].map(w => ({ name: w.name, items: w.symbols.map(quoteRow) }));
}

// ---------- candlestick series (deterministic per seed) ----------
function genCandles(seed, n) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  let price = 150 + (seed % 60);
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = Math.max(10, o + (rnd() - 0.48) * 7);
    const h = Math.max(o, c) + rnd() * 2.5;
    const l = Math.min(o, c) - rnd() * 2.5;
    const v = Math.round(8e5 * (0.4 + rnd()));
    out.push({ o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v });
    price = c;
  }
  return out;
}

// ---------- research ----------
function researchData() {
  const rows = Object.keys(QUOTES).filter(k => k !== 'BTC' && k !== 'ETH')
    .map(k => { const q = QUOTES[k]; return { symbol: k, name: q.name, price: q.price, changePct: q.changePct, rating: ['Buy', 'Overweight', 'Hold', 'Buy', 'Outperform'][k.length % 5], target: +(q.price * (1 + (k.length % 4) * 0.08)).toFixed(2) }; });
  return {
    tabs: {
      Stocks: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'TSLA'].map(quoteRow),
      ETFs: ['SPY', 'QQQ', 'VTI', 'FXAIX', 'FSKAX'].map(quoteRow),
      'Mutual funds': ['FXAIX', 'FSKAX', 'FZROX'].map(quoteRow),
      Options: [
        { symbol: 'AAPL 240920C225', name: 'AAPL Sep20 225 Call', price: 6.85, changePct: 4.2 },
        { symbol: 'SPY 240920P545', name: 'SPY Sep20 545 Put', price: 3.40, changePct: -1.1 },
        { symbol: 'TSLA 240920C250', name: 'TSLA Sep20 250 Call', price: 9.10, changePct: 6.8 },
      ],
      Bonds: [
        { symbol: 'UST10Y', name: 'US Treasury 10Y', price: 98.42, changePct: -0.12, yld: 4.18 },
        { symbol: 'UST30Y', name: 'US Treasury 30Y', price: 94.10, changePct: -0.21, yld: 4.36 },
      ],
    },
    universe: rows,
    news: [
      { src: 'Reuters', t: 'Fed holds rates steady, signals one cut later this year', when: '2h ago' },
      { src: 'Bloomberg', t: 'Tech megacaps lead broad rally as earnings beat estimates', when: '4h ago' },
      { src: 'WSJ', t: 'Bond yields tick lower ahead of jobs report', when: '6h ago' },
      { src: 'CNBC', t: 'Apple unveils expanded buyback, dividend hike', when: '8h ago' },
      { src: 'MarketWatch', t: 'Bitcoin slips below 65K as crypto pulls back', when: '11h ago' },
    ],
    analyst: rows.slice(0, 5).map(r => ({ symbol: r.symbol, rating: r.rating, target: r.target })),
    screeners: [
      { name: 'Large-cap growth', matches: 142 },
      { name: 'Dividend aristocrats', matches: 67 },
      { name: 'Low volatility ETFs', matches: 23 },
      { name: 'High momentum', matches: 88 },
    ],
  };
}

// ---------- planning ----------
function planningData(totalValue) {
  const yrs = [10, 20, 30];
  const rate = 0.07;
  const proj = yrs.map(y => ({ years: y, value: Math.round(totalValue * Math.pow(1 + rate, y)) }));
  return {
    retirement: {
      current: Math.round(totalValue),
      assume: '7% annual return',
      projection: proj,
    },
    goals: [
      { name: 'Emergency fund', target: 25000, current: 18700, by: '2026' },
      { name: 'Home down payment', target: 80000, current: 41000, by: '2028' },
      { name: 'Child education', target: 120000, current: 22000, by: '2034' },
      { name: 'Retirement', target: 1500000, current: Math.round(totalValue), by: '2055' },
    ],
    netWorth: Math.round(totalValue),
    cashFlow: [
      { label: 'Income', value: 8200, kind: 'pos' },
      { label: 'Expenses', value: -5400, kind: 'neg' },
      { label: 'Investments', value: -1500, kind: 'neg' },
      { label: 'Net monthly', value: 1300, kind: 'pos' },
    ],
    tools: ['Retirement calculator', 'College savings planner', 'Budget builder', 'Social Security estimator'],
  };
}

// ---------- fixed income ----------
function fixedIncomeData() {
  return {
    bonds: [
      { symbol: 'UST10Y', name: 'US Treasury Note 10Y', yld: 4.18, maturity: '2036', price: 98.42, freq: 'Semi' },
      { symbol: 'UST30Y', name: 'US Treasury Bond 30Y', yld: 4.36, maturity: '2056', price: 94.10, freq: 'Semi' },
      { symbol: 'MUNI-CA', name: 'CA GO Bond 5Y', yld: 3.21, maturity: '2031', price: 100.10, freq: 'Semi' },
      { symbol: 'CORP-AAA', name: 'Apple 3.85% 2034', yld: 4.02, maturity: '2034', price: 99.30, freq: 'Semi' },
    ],
    cds: [
      { term: '6 mo', apy: 4.75, min: 1000 },
      { term: '1 yr', apy: 4.90, min: 1000 },
      { term: '3 yr', apy: 4.30, min: 1000 },
      { term: '5 yr', apy: 4.10, min: 1000 },
    ],
    ladder: [
      { year: '2027', amount: 10000, yld: 4.75 },
      { year: '2028', amount: 10000, yld: 4.55 },
      { year: '2029', amount: 10000, yld: 4.35 },
      { year: '2030', amount: 10000, yld: 4.15 },
    ],
  };
}

// ---------- web personalization ----------
function personalizationData() {
  return {
    savedViews: ['My default', 'Income focus', 'Growth tilt'],
    widgets: [
      { name: 'Account balances', on: true },
      { name: 'Positions', on: true },
      { name: 'Watchlists', on: true },
      { name: 'Chart', on: true },
      { name: 'Activity', on: true },
      { name: 'News', on: false },
    ],
    columns: ['Symbol', 'Last', 'Change', 'Change %', 'Volume', 'Bid', 'Ask'],
    accountFilters: ['All accounts', 'Brokerage', 'Roth IRA', 'Cash Management'],
  };
}

async function buildDashboard(userId) {
  const accounts = await db.listAccounts(userId);
  let totalValue = 0, totalCost = 0, totalDay = 0, cash = 0;
  const rows = [];
  const allPos = [];
  for (const acc of accounts) {
    const positions = await db.listPositions(acc.id);
    let mv = 0, cv = 0, day = 0;
    for (const p of positions) {
      const m = p.quantity * p.price;
      const c = p.quantity * p.cost_basis;
      mv += m; cv += c;
      if (p.is_cash) { cash += m; }
      else {
        day += m * ((DAY_PCT[p.symbol] || 0.3) / 100);
        rows.push({
          symbol: p.symbol, name: p.name, account: acc.type,
          quantity: p.quantity, price: p.price, marketValue: m,
          gainLoss: m - c, gainLossPct: c ? ((m - c) / c) * 100 : 0,
        });
      }
      allPos.push({ symbol: p.symbol, marketValue: m });
    }
    acc._marketValue = mv; acc._costValue = cv;
    acc._gainLoss = mv - cv; acc._gainLossPct = cv ? ((mv - cv) / cv) * 100 : 0;
    acc._dayChange = day;
    totalValue += mv; totalCost += cv; totalDay += day;
  }

  const activities = await db.listActivities(userId);
  const dividendsIncome = activities.filter(a => a.type === 'Dividend').reduce((s, a) => s + (a.amount || 0), 0);
  const openOrders = await db.listOpenOrders(userId);
  const orderHistory = await db.listOrderHistory(userId);
  const alerts = await db.listAlerts(userId);
  const candles = genCandles(userId + 7, 120);
  const dbWatch = await db.listWatchlists(userId);
  const watchlists = dbWatch.length
    ? dbWatch.map(function (w) {
        const syms = (w.symbols || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
        return { id: w.id, name: w.name, items: syms.map(safeQuote) };
      })
    : multiWatchlists();

  const userDoc = await db.getUserById(userId);
  return {
    accounts,
    positions: rows.sort((a, b) => b.marketValue - a.marketValue),
    totalValue, totalCost,
    totalGainLoss: totalValue - totalCost,
    totalGainLossPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    totalDayChange: totalDay,
    cashAvailable: Math.round(cash),
    buyingPower: Math.round(cash * 2),
    dividendsIncome: Math.round(dividendsIncome * 100) / 100,
    activities,
    performance: buildPerformance(totalValue, userId),
    documents: buildDocuments(userDoc),
    allocation: allocationOf(allPos),
    accountBreakdown: accountBreakdown(accounts, totalValue),
    valueTrend: valueTrend(totalValue, userId),
    watchlist: watchlists[0].items,
    watchlists,
    candles,
    research: researchData(),
    planning: planningData(totalValue),
    fixedIncome: fixedIncomeData(),
    personalization: personalizationData(),
    openOrders, orderHistory, alerts,
    clientData: { candles, watchlists },
  };
}

module.exports = { buildDashboard, QUOTES };
