# Vercel Cutover Checklist

> Project canon: [`AI_AGENT_HANDOFF.md`](AI_AGENT_HANDOFF.md) · Env template: [`.env.example`](../.env.example)


This app is ready for Vercel cutover with Blob-backed assets.

## 1) Set environment variables in Vercel

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `CHANNELS_ENCRYPTION_KEY`
- `BLOB_READ_WRITE_TOKEN`

Recommended:

- `ASSET_STORAGE_PROVIDER=vercel_blob`
- `BLOB_ASSETS_ROOT=APP/Assets`

## 2) Install dependencies

```bash
npm install
```

## 3) Migrate existing Drive assets to Vercel Blob

Dry run:

```bash
npm run migrate:assets-drive-to-blob:dry-run
```

Apply:

```bash
npm run migrate:assets-drive-to-blob:apply
```

## 4) Verify migration state

```bash
node scripts/vercel_cutover_check.js
```

Expected: `drive_assets: 0` and `blob_assets` equals total migrated image/media assets.

## 5) Link and deploy repo to Vercel

```bash
vercel login
vercel link
vercel env pull .env.vercel.local
vercel --prod
```

## 6) Post-deploy smoke tests

- Open `Develop > Pages > Preview` and verify banner/feature/logo images.
- Upload a new asset in `Assets` and confirm `location` is Blob URL.
- Run Screenshot and Thumbnail extensions and confirm new assets are Blob URLs.
- Submit landing form and verify thank-you page icon/link works.

## 7) Final cleanup (optional, recommended)

Once migration is stable and `drive_assets=0`, remove Google Drive proxy fallback code and route usage.

