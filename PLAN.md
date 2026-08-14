# PLAN — Dashboard, profile, admin controls, security hardening (SRI + CSRF)

Architecture note (supersedes the original "separate page routes" plan):
The dashboard is an **inline panel dashboard** (`views/dashboard.ejs` +
`public/js/dashboard.js`), NOT a set of separate `/dashboard/*` pages. Money
actions render as `.action-card` panels toggled by `data-panel` buttons and
submit via standard POST back to `/dashboard?open=...&...=1`. This is the shape
the application evolved to and is what is tested below. The original
"convert to separate page routes" / `partials/_dash_shell.ejs` refactor is
**deferred** (would be a high-risk rewrite for no functional gain; the inline
panel design already covers the same interactions).

## Goal
1. External bank transfers: let users send cash to an external bank, capturing
   bank logo, bank name, routing number, account holder, and the destination
   account number — stored safely (last-4 only, never the full PAN).
2. Profile persistence correct on BOTH SQLite (local) and PostgreSQL (Supabase).
3. Admin controls stay working after changes.
4. Harden per Google security best practices: SRI on stylesheet includes, CSRF
   tokens on all state-changing POSTs, input validation in form handlers.

## Scope notes / findings
- Active DB locally = SQLite (`lib/db-sqlite.js`) — correct and used for tests.
- Active DB in production = PostgreSQL (`lib/db-pg.js`, Supabase/Railway).
- Schema (`lib/migrate.js`, `lib/seed-postgres.js`) idempotent: all ALTERs use
  `IF NOT EXISTS`; dev `data/app.db` self-heals on startup via the db-sqlite.js
  migrate IIFE. No destructive migrations.
- `external_account_last4` stores ONLY the last 4 digits — full account numbers
  are reduced to last4 server-side in `POST /external-transfer`.
- `lib/db-pg.js` mirrors `lib/db-sqlite.js` for money ops, profiles, and admin tx
  operations (approval workflow included).

## Completed work (checked off)
- [x] 4. Schema: external-transfer columns + profile columns
      (`investment_objective`, `communication_pref`) + accounts `created_at`
      added idempotently to `lib/migrate.js` and `lib/seed-postgres.js`.
      (Note: `member_id` was in the original item wording but is referenced
      nowhere in the codebase; adding it would be dead schema → dropped.)
- [x] 3. Data layer: `externalTransfer()` added to `lib/db-pg.js` and
      `lib/db-sqlite.js` (mirrors `withdrawCash` — pending, available-funds
      check, amount negative). Exports updated. `createTransaction` already
      persists the 5 external columns on both layers.
- [x] External transfer feature (spans the items above):
      - `server.js`: `POST /external-transfer` — account ownership guard,
        9-digit routing validation, last-4-only persistence, redirect with
        `externaltransferred=1` / `externalerror=1`.
      - `views/dashboard.ejs`: quick-action button + external-transfer card
        (bank logo, bank name, routing, account holder, destination account#,
        amount, date, reference).
      - `public/js/dashboard.js`: `externaltransfer` registered in the
        hash->panel map.
      - Tested end-to-end on SQLite: 19/19 checks pass.
- [x] CSRF (cookie-based double-submit, no new dependencies): issue + validate
      middleware in `server.js`; auto-inject hidden `_csrf` into every form via
      `views/partials/head.ejs` (covers dashboard, login, profile, admin).
      Token-less POST returns 403.
- [x] SRI: `integrity` + `crossorigin` added to both stylesheet `<link>`s in
      `views/partials/head.ejs` (sha384 hashes; recompute on CSS change).

## Remaining work
- [ ] 2. PLAN.md — this file kept current.
- [ ] 8. Test on SQLite: full login -> dashboard -> external transfer -> CSRF
      rejection -> SRI presence -> profile/admin smoke.
