# Basic Email Marketing Tool (Mailchimp-style MVP)

This project now has:
- Static frontend in `public/`
- Vercel API route in `api/[...slug].js`

## What changed for Vercel

- API requests to `/api/*` are handled by serverless function code in `api/[...slug].js`.
- Frontend remains in `public/index.html`, `public/app.js`, and `public/styles.css`.
- A `vercel.json` rewrite is included for `/api/*`.

## Important limitation right now

The API currently uses **in-memory storage** in Vercel (`api/[...slug].js`).
That means data resets on new deployments/cold starts.

Next production step is replacing that with a database (Vercel Postgres/Supabase/Neon).

## Local run (old Node server)

```bash
node server.js
```

Then open `http://localhost:3000`.

## Deploy to Vercel from GitHub

1. Commit and push:
```bash
git add .
git commit -m "Convert API to Vercel function"
git push origin main
```

2. In Vercel dashboard:
- New Project -> Import your GitHub repo
- Framework Preset: Other
- Root Directory: project root
- Deploy

3. Open your Vercel URL and test:
- `/api/health`
- contact creation/import
- segment creation
- campaign creation/send

## API Endpoints

- `GET /api/health`
- `GET /api/contacts`
- `POST /api/contacts`
- `POST /api/contacts/import`
- `GET /api/segments`
- `POST /api/segments`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `POST /api/campaigns/:id/send`

## Supabase Promo Leads Mode

To enable custom fields + bulk upload to your real `promo_leads` table:

1. Run SQL in `data/promo_leads_setup.sql` in Supabase.
2. Set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - optional: `SUPABASE_PROMO_LEADS_TABLE` (default `promo_leads`)
   - optional: `SUPABASE_PROMO_LEAD_FIELDS_TABLE` (default `promo_lead_field_configs`)

### New endpoints

- `GET /api/promo-leads/fields`
- `POST /api/promo-leads/fields`
- `PUT /api/promo-leads/fields/:id`
- `DELETE /api/promo-leads/fields/:id`
- `POST /api/promo-leads/import`
- `GET /api/promo-leads`
- `POST /api/promo-leads`
- `PUT /api/promo-leads/:id`
- `DELETE /api/promo-leads/:id`
- `GET /api/settings/database/tables`
- `POST /api/settings/database/fields`
- `GET /api/settings/apis/schema`
- `GET /api/settings/apis`
- `POST /api/settings/apis`

API credentials saved from **Settings > APIs** are stored locally at:
- `data/api_settings.json` (permission mode `600`)

Supabase API settings (from that file) are automatically used by promo leads routes when env vars are not set.

These are wired to both `server.js` and `api/[...slug].js`.

### Frontend capabilities added

- CSV upload + column mapper
- Per-column include/exclude mapping before import
- Per-column type assignment + optional custom field creation
- Promo leads grid editor:
  - sort every column
  - filter every column
  - inline cell edit/save
  - add row
  - delete row

## Channels password encryption

Channel passwords are now stored encrypted at rest (AES-256-GCM) and can be decrypted server-side for API integrations.

Required environment variable:

- `CHANNELS_ENCRYPTION_KEY` = base64-encoded 32-byte key

Generate one locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then run SQL migration:

```sql
-- docs/channels_password_encryption_migration.sql
```

Optional one-time backfill for existing plaintext channel passwords:

```bash
node scripts/backfill_channels_password_encryption.js --apply
```
