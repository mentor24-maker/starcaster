'use strict';

/**
 * scripts/sync_env_to_vercel.js
 *
 * Reads .env.local and pushes a curated set of env vars to Vercel production
 * (and optionally preview/development) via the Vercel REST API.
 *
 * Usage:
 *   node scripts/sync_env_to_vercel.js [--targets production,preview,development] [--dry-run]
 *
 * Prerequisites in .env.local:
 *   VERCEL_TOKEN      — personal access token from vercel.com/account/settings/tokens
 *   VERCEL_PROJECT_ID — (optional) falls back to .vercel/repo.json
 *   VERCEL_TEAM_ID    — (optional) falls back to .vercel/repo.json
 */

try { require('dotenv').config({ path: '.env.local' }); } catch (_) {}
try { require('dotenv').config(); } catch (_) {}

const https = require('https');
const path  = require('path');
const fs    = require('fs');

// ---------------------------------------------------------------------------
// Resolve project + team IDs
// ---------------------------------------------------------------------------

function loadVercelRepo() {
  try {
    const raw  = fs.readFileSync(path.join(__dirname, '..', '.vercel', 'repo.json'), 'utf8');
    const data = JSON.parse(raw);
    const proj = (data.projects || [])[0] || {};
    return { projectId: proj.id, teamId: proj.orgId };
  } catch (_) {
    return {};
  }
}

const repo      = loadVercelRepo();
const TOKEN      = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || repo.projectId;
const TEAM_ID    = process.env.VERCEL_TEAM_ID    || repo.teamId;

// ---------------------------------------------------------------------------
// Keys to sync — everything in the app schema EXCEPT infra-managed vars.
// Add or remove keys here as the project grows.
// ---------------------------------------------------------------------------

const SYNC_KEYS = [
  // Core database
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY',

  // Security
  'CHANNELS_ENCRYPTION_KEY',
  'CRON_SECRET',

  // Storage
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_ASSETS_ROOT',
  'ASSET_STORAGE_PROVIDER',
];

// Keys intentionally excluded (Vercel manages or are local-only):
//   PORT, NODE_ENV, VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const targArg  = args.find((a) => a.startsWith('--targets='));
const TARGETS  = targArg
  ? targArg.replace('--targets=', '').split(',').map((s) => s.trim())
  : ['production'];

// ---------------------------------------------------------------------------
// Vercel API helpers
// ---------------------------------------------------------------------------

function vercelRequest(method, path_, body) {
  return new Promise((resolve, reject) => {
    const qs   = TEAM_ID ? `?teamId=${TEAM_ID}` : '';
    const data = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: 'api.vercel.com',
      path:     path_ + qs,
      method,
      headers: {
        Authorization:  `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (_) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listExisting() {
  const res = await vercelRequest('GET', `/v9/projects/${PROJECT_ID}/env`);
  if (res.status !== 200) throw new Error(`Failed to list env vars: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.envs || [];
}

async function createEnv(key, value) {
  return vercelRequest('POST', `/v10/projects/${PROJECT_ID}/env`, {
    key, value, type: 'encrypted', target: TARGETS,
  });
}

async function updateEnv(id, value) {
  return vercelRequest('PATCH', `/v9/projects/${PROJECT_ID}/env/${id}`, {
    value, type: 'encrypted', target: TARGETS,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Vercel Env Sync ===');
  console.log(`Project : ${PROJECT_ID || '(unknown)'}`);
  console.log(`Team    : ${TEAM_ID    || '(none)'}`);
  console.log(`Targets : ${TARGETS.join(', ')}`);
  console.log(`Dry run : ${DRY_RUN}`);
  console.log('');

  if (!TOKEN)      { console.error('ERROR: VERCEL_TOKEN is not set in .env.local'); process.exit(1); }
  if (!PROJECT_ID) { console.error('ERROR: VERCEL_PROJECT_ID not found'); process.exit(1); }

  // Collect local values
  const localVars = {};
  for (const key of SYNC_KEYS) {
    const val = process.env[key];
    if (val !== undefined && val !== '') localVars[key] = val;
  }

  const missing = SYNC_KEYS.filter((k) => !localVars[k]);
  if (missing.length) {
    console.warn(`WARN: These keys are in SYNC_KEYS but not set locally — skipping:\n  ${missing.join(', ')}\n`);
  }

  if (Object.keys(localVars).length === 0) {
    console.log('Nothing to sync.');
    return;
  }

  // Fetch existing Vercel env vars (needed to decide create vs update)
  let existing = [];
  if (!DRY_RUN) {
    process.stdout.write('Fetching existing Vercel env vars...');
    existing = await listExisting();
    console.log(` ${existing.length} found`);
  }

  const existingByKey = {};
  for (const e of existing) existingByKey[e.key] = e;

  // Push each key
  const results = { created: [], updated: [], skipped: [], errors: [] };

  for (const [key, value] of Object.entries(localVars)) {
    const masked = value.length > 8 ? value.slice(0, 4) + '***' + value.slice(-2) : '***';

    if (DRY_RUN) {
      const action = existingByKey[key] ? 'UPDATE' : 'CREATE';
      console.log(`  [dry-run] ${action.padEnd(6)} ${key} = ${masked}`);
      results.skipped.push(key);
      continue;
    }

    if (existingByKey[key]) {
      const res = await updateEnv(existingByKey[key].id, value);
      if (res.status >= 200 && res.status < 300) {
        console.log(`  UPDATED  ${key}`);
        results.updated.push(key);
      } else {
        console.error(`  ERROR    ${key}: ${JSON.stringify(res.body?.error || res.body)}`);
        results.errors.push(key);
      }
    } else {
      const res = await createEnv(key, value);
      if (res.status >= 200 && res.status < 300) {
        console.log(`  CREATED  ${key}`);
        results.created.push(key);
      } else {
        console.error(`  ERROR    ${key}: ${JSON.stringify(res.body?.error || res.body)}`);
        results.errors.push(key);
      }
    }
  }

  console.log('');
  console.log(`Done. created=${results.created.length} updated=${results.updated.length} errors=${results.errors.length}`);
  if (results.errors.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
