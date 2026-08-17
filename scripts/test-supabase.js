#!/usr/bin/env node
'use strict';
/**
 * Quick Supabase/PostgreSQL health check.
 * Usage: DATABASE_URL="postgresql://..." npm run test:supabase
 */
require('dotenv').config();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[test:supabase] DATABASE_URL is not set.');
    process.exit(1);
  }

  const db = require('../lib/db-pg');
  const { usesPgBouncer } = require('../lib/pg-pool');

  console.log('[test:supabase] Connecting...');
  console.log('[test:supabase] PgBouncer mode:', usesPgBouncer(process.env.DATABASE_URL));

  await db.initDb();
  if (typeof db.fixProfilesTable === 'function') await db.fixProfilesTable();

  const users = await db.listUsers();
  console.log('[test:supabase] Users:', users.length, users.map(u => u.username).join(', '));

  const admin = await db.getUserByUsernameOrEmail('admin');
  const demo = await db.getUserByUsernameOrEmail('jdoe');
  if (!admin) console.warn('[test:supabase] WARN: admin user missing — run npm run seed');
  if (!demo) console.warn('[test:supabase] WARN: jdoe user missing — run npm run seed');

  if (demo) {
    const profile = await db.getProfile(demo.id);
    console.log('[test:supabase] jdoe profile:', profile ? 'exists' : 'empty (OK for new user)');
    const accounts = await db.listAccounts(demo.id);
    console.log('[test:supabase] jdoe accounts:', accounts.length);
  }

  const { getPool } = require('../lib/pg-pool');
  const rls = await getPool().query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('users','accounts','profiles','sessions','transactions')
    ORDER BY c.relname
  `);
  console.log('[test:supabase] RLS status:');
  rls.rows.forEach(row => console.log('  ', row.table_name + ':', row.rls_enabled ? 'enabled' : 'DISABLED'));

  await getPool().end();
  console.log('[test:supabase] All checks passed.');
}

main().catch(err => {
  console.error('[test:supabase] FAILED:', err.message);
  process.exit(1);
});
