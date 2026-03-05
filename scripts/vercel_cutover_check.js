'use strict';

try { require('dotenv').config(); } catch (_) {}

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'CHANNELS_ENCRYPTION_KEY',
  'BLOB_READ_WRITE_TOKEN',
];

const optional = [
  ['ASSET_STORAGE_PROVIDER', 'vercel_blob'],
  ['BLOB_ASSETS_ROOT', 'APP/Assets'],
];

function has(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function showEnv() {
  console.log('== Required Environment Variables ==');
  required.forEach((name) => {
    console.log(`${has(name) ? 'OK  ' : 'MISS'} ${name}`);
  });
  console.log('\n== Recommended Environment Variables ==');
  optional.forEach(([name, rec]) => {
    const val = String(process.env[name] || '').trim();
    console.log(`${val ? 'SET ' : 'UNSET'} ${name}${val ? `=${val}` : ` (recommended: ${rec})`}`);
  });
}

async function showAssetSummary() {
  const { listAssets, rowToAsset } = require('../lib/assetsStore');
  const res = await listAssets();
  if (!res.ok) {
    console.log(`\nAsset summary unavailable: ${res.error || 'unknown error'}`);
    return;
  }
  const items = (Array.isArray(res.data) ? res.data : []).map(rowToAsset);
  const blob = items.filter((a) => String(a.location || '').includes('.public.blob.vercel-storage.com')).length;
  const drive = items.filter((a) => {
    const loc = String(a.location || '');
    return loc.includes('drive.google.com')
      || loc.includes('googleusercontent.com')
      || loc.includes('/api/assets/drive-file/');
  }).length;
  console.log('\n== Asset Location Summary ==');
  console.log(`total: ${items.length}`);
  console.log(`blob_assets: ${blob}`);
  console.log(`drive_assets: ${drive}`);
}

async function main() {
  showEnv();
  await showAssetSummary();
  console.log('\nNext:');
  console.log('1) npm install');
  console.log('2) npm run migrate:assets-drive-to-blob:dry-run');
  console.log('3) npm run migrate:assets-drive-to-blob:apply');
  console.log('4) vercel link');
  console.log('5) vercel env pull .env.vercel.local');
  console.log('6) vercel --prod');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});

