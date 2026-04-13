'use strict';

/**
 * lib/config.js  —  Single source of truth for all environment configuration.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   Priority (highest wins):
 *     1. Vercel environment variables   (process.env, set via Vercel dashboard)
 *     2. Local .env file                (loaded by dotenv in server.js, dev only)
 *     3. Hard-coded defaults below      (safe fallbacks, never secrets)
 *
 *   The api_settings.json / Settings UI continues to work for API credentials
 *   (lib/apiSettings.js is unchanged), but CORE infrastructure config — Supabase
 *   URL/key, server port, etc. — now lives exclusively in environment variables.
 *   That means no committed secrets, no split sources of truth.
 *
 * ── Adding a new config value ────────────────────────────────────────────────
 *   1. Add it to the SCHEMA below with the env var name, a description, and
 *      whether it is secret (masked in GET responses).
 *   2. Reference it via config.get('myKey').
 *   Never hard-code process.env.MY_VAR anywhere else — always go through here.
 *
 * ── Vercel production ────────────────────────────────────────────────────────
 *   Set each variable in: Vercel dashboard → Project → Settings → Environment Variables
 *   Or via CLI: vercel env add SUPABASE_URL
 *
 * ── Local development ────────────────────────────────────────────────────────
 *   Copy .env.example to .env and fill in values.
 *   .env is gitignored — never commit it.
 */

// ---------------------------------------------------------------------------
// Schema — every recognised config key is declared here.
// ---------------------------------------------------------------------------

/**
 * @typedef  {object} ConfigEntry
 * @property {string}   env         - process.env key name
 * @property {string}   description - human-readable label shown in the UI
 * @property {boolean}  [secret]    - if true, value is masked (***) in GET responses
 * @property {string}   [default]   - safe default; never use for secrets
 * @property {string}   [group]     - logical grouping for the Settings UI
 */

/** @type {Record<string, ConfigEntry>} */
const SCHEMA = {
  // ── Supabase ──────────────────────────────────────────────────────────────
  supabaseUrl: {
    env: 'SUPABASE_URL',
    description: 'Supabase project URL',
    group: 'Supabase',
  },
  supabaseKey: {
    env: 'SUPABASE_SERVICE_KEY',
    description: 'Supabase service-role key',
    secret: true,
    group: 'Supabase',
  },
  supabaseAnonKey: {
    env: 'SUPABASE_ANON_KEY',
    description: 'Supabase anon / public key for WebSockets',
    group: 'Supabase',
    secret: false,
  },

  // ── Server ────────────────────────────────────────────────────────────────
  port: {
    env: 'PORT',
    description: 'Local dev server port',
    default: '3000',
    group: 'Server',
  },
  nodeEnv: {
    env: 'NODE_ENV',
    description: 'Runtime environment (development | production)',
    default: 'development',
    group: 'Server',
  },
  channelsEncryptionKey: {
    env: 'CHANNELS_ENCRYPTION_KEY',
    description: 'Base64 32-byte key for encrypting channel passwords',
    secret: true,
    group: 'Security',
  },

  // ── Vercel ────────────────────────────────────────────────────────────────
  vercelToken: {
    env: 'VERCEL_TOKEN',
    description: 'Vercel personal access token (used to write env vars via API)',
    secret: true,
    group: 'Vercel',
  },
  vercelProjectId: {
    env: 'VERCEL_PROJECT_ID',
    description: 'Vercel project ID',
    group: 'Vercel',
  },
  vercelTeamId: {
    env: 'VERCEL_TEAM_ID',
    description: 'Vercel team ID (leave blank for personal accounts)',
    group: 'Vercel',
  },
  blobReadWriteToken: {
    env: 'BLOB_READ_WRITE_TOKEN',
    description: 'Vercel Blob read-write token',
    secret: true,
    group: 'Storage',
  },
  blobAssetsRoot: {
    env: 'BLOB_ASSETS_ROOT',
    description: 'Vercel Blob asset root path (default: APP/Assets)',
    default: 'APP/Assets',
    group: 'Storage',
  },
  assetStorageProvider: {
    env: 'ASSET_STORAGE_PROVIDER',
    description: 'Preferred asset storage provider (vercel_blob | google_drive)',
    default: 'google_drive',
    group: 'Storage',
  },
};

// ---------------------------------------------------------------------------
// Core accessors
// ---------------------------------------------------------------------------

/**
 * Get a config value by schema key.
 * @param   {string} key  - Schema key (e.g. 'supabaseUrl')
 * @returns {string|undefined}
 */
function get(key) {
  const entry = SCHEMA[key];
  if (!entry) {
    console.warn(`[config] Unknown config key: "${key}"`);
    return undefined;
  }
  return process.env[entry.env] || entry.default;
}

/**
 * Get all config values, masking secrets.
 * Used by the Settings UI to show current configuration state.
 * @returns {Array<{ key: string, env: string, value: string, secret: boolean, description: string, group: string }>}
 */
function listMasked() {
  return Object.entries(SCHEMA).map(([key, entry]) => {
    const raw = process.env[entry.env] || entry.default || '';
    const value = (entry.secret && raw) ? '***' : raw;
    return {
      key,
      env:         entry.env,
      value,
      isSet:       Boolean(process.env[entry.env]),
      secret:      Boolean(entry.secret),
      description: entry.description,
      group:       entry.group || 'General',
    };
  });
}

/**
 * Return schema metadata (no values) — safe to send to the browser.
 */
function getSchema() {
  return Object.entries(SCHEMA).map(([key, entry]) => ({
    key,
    env:         entry.env,
    description: entry.description,
    secret:      Boolean(entry.secret),
    hasDefault:  Boolean(entry.default),
    group:       entry.group || 'General',
  }));
}

// ---------------------------------------------------------------------------
// Validation helper — called at startup
// ---------------------------------------------------------------------------

/**
 * Warn about missing required config at startup (non-fatal).
 * Required keys are those with no default and not secret-optional.
 */
function validateAtStartup() {
  const missing = [];

  // Supabase is required for full functionality
  if (!get('supabaseUrl'))  missing.push('SUPABASE_URL');
  if (!get('supabaseKey'))  missing.push('SUPABASE_SERVICE_KEY');

  if (missing.length) {
    console.warn(
      `[config] ⚠  Missing environment variables: ${missing.join(', ')}\n` +
      `         Copy .env.example to .env and set them, or add them in Vercel's\n` +
      `         dashboard under Project → Settings → Environment Variables.`
    );
  } else {
    console.log('[config] ✓ All required environment variables are set.');
  }

  if (!get('channelsEncryptionKey')) {
    console.warn(
      '[config] ⚠  CHANNELS_ENCRYPTION_KEY is not set. Channel passwords cannot be encrypted until this is configured.'
    );
  }
}

// ---------------------------------------------------------------------------
// Vercel env var writer
// ---------------------------------------------------------------------------

/**
 * Write a key/value pair to Vercel's environment variables via the Vercel API.
 * Requires VERCEL_TOKEN and VERCEL_PROJECT_ID to be set.
 *
 * @param   {string} envName  - The process.env key (e.g. 'SUPABASE_URL')
 * @param   {string} value    - The value to set
 * @param   {string[]} [targets] - Deployment targets (default: all three)
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function writeToVercel(envName, value, targets = ['production', 'preview', 'development']) {
  const token     = get('vercelToken');
  const projectId = get('vercelProjectId');
  const teamId    = get('vercelTeamId');

  if (!token)     return { ok: false, error: 'VERCEL_TOKEN is not configured' };
  if (!projectId) return { ok: false, error: 'VERCEL_PROJECT_ID is not configured' };

  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`
  );
  if (teamId) url.searchParams.set('teamId', teamId);

  try {
    const resp = await fetch(url.toString(), {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: envName, value, type: 'encrypted', target: targets }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: data.error?.message || `Vercel API error: ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { get, listMasked, getSchema, validateAtStartup, writeToVercel, SCHEMA };
