'use strict';
const db = require('./db');

async function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    res.locals.user = await db.getUserById(req.session.userId);
  } else {
    res.locals.user = null;
  }
  next();
}

async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  const u = await db.getUserById(req.session.userId);
  if (!u || u.status !== 'active') {
    req.session.destroy(() => res.redirect('/login'));
    return;
  }
  // Admin users are routed exclusively to the admin panel — they must not
  // access client dashboards, profile, orders, or trade actions.
  if (u.role === 'admin') {
    return res.redirect('/admin');
  }
  res.locals.user = u;
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const u = await db.getUserById(req.session.userId);
  if (!u || u.role !== 'admin') return res.redirect('/dashboard');
  res.locals.user = u;
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin };
