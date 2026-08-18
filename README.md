# American Financial Associates

Account management, trading dashboard, and admin user-management system.

## Deployment

### Vercel Deployment

1. **Set Environment Variables in Vercel Dashboard:**
   - `DATABASE_URL` - PostgreSQL connection string from Supabase (use Transaction pooler port 6543)
   - `SESSION_SECRET` - Random string for session encryption (required for Vercel)

2. **Database Setup (run once):**
   - Connect to your Supabase/Railway database
   - Run `npm run migrate` to create tables and enable RLS
   - The admin user (admin/admin123) will be auto-created on first request

3. **Supabase Transaction Pooler Format:**
   ```
   postgresql://postgres.PROPERTY_REF:PASSWORD@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true
   ```

### Local Development

```bash
# With SQLite (default):
npm start

# With PostgreSQL:
export DATABASE_URL="postgresql://..."
npm start

# Seed demo users:
npm run seed
```

## Features

- User authentication (express-session + bcrypt)
- Admin panel with user impersonation
- Financial dashboard with accounts, positions, orders
- Transaction history and cash transfers
- Alerts and watchlists

## Demo Credentials

- Admin: admin / admin123
- User: jdoe / password