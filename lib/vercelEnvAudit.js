'use strict';

/**
 * Answers the question that cost an hour on 2026-07-29: "did I change this
 * environment variable after the running deployment was built?"
 *
 * Vercel bakes env vars into a deployment at build time. Editing one in the
 * dashboard leaves the live deployment untouched, so a credential can be
 * correct in Vercel and still wrong in production. lib/buildInfo.js knows when
 * the deployment was built; this module asks the Vercel API when each variable
 * was last modified. A variable newer than the build is not live yet.
 *
 * Requires a Vercel API token with read scope in VERCEL_API_TOKEN. Without it
 * every function here returns { checked: false, reason } and callers fall back
 * to the generic redeploy warning — the feature is inert, never broken.
 *
 * Reads metadata only: the Vercel envs endpoint is queried without decryption,
 * so this never handles a secret's value. Names and timestamps only.
 */

const { getBuildInfo } = require('./buildInfo');

const API_BASE = 'https://api.vercel.com';
/** Vercel's own limits are generous, but a per-click API call is still waste. */
const CACHE_TTL_MS = 60 * 1000;

let cache = { at: 0, key: '', data: null };

function envText(name) {
  return String(process.env[name] || '').trim();
}

function token() {
  return envText('VERCEL_API_TOKEN');
}

/**
 * Which Vercel project to ask about. VERCEL_PROJECT_ID is not injected at
 * runtime by Vercel, so it must be set explicitly; the package name is a
 * reasonable last resort because the API accepts a project name here.
 */
function projectRef() {
  return envText('VERCEL_PROJECT_ID') || envText('VERCEL_PROJECT_NAME') || 'starcaster';
}

function teamQuery() {
  const team = envText('VERCEL_TEAM_ID');
  return team ? `?teamId=${encodeURIComponent(team)}` : '';
}

/**
 * Fetch env var metadata: name -> { updatedAt, targets, id }.
 * Never throws; returns { checked: false, reason } when unavailable.
 */
async function fetchEnvMetadata() {
  const apiToken = token();
  if (!apiToken) {
    return {
      checked: false,
      reason: 'No VERCEL_API_TOKEN is set, so StarCaster cannot tell when a variable was last edited.',
      vars: {},
    };
  }

  const ref = projectRef();
  const cacheKey = `${ref}::${envText('VERCEL_TEAM_ID')}`;
  if (cache.data && cache.key === cacheKey && (Date.now() - cache.at) < CACHE_TTL_MS) {
    return cache.data;
  }

  const url = `${API_BASE}/v9/projects/${encodeURIComponent(ref)}/env${teamQuery()}`;
  let response;
  let payload = null;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    });
    payload = await response.json().catch(() => null);
  } catch (err) {
    return { checked: false, reason: `Could not reach the Vercel API: ${err.message || err}`, vars: {} };
  }

  if (!response.ok) {
    const detail = String(payload?.error?.message || response.statusText || '').trim();
    const hint = response.status === 403
      ? ' The token may lack access to this project, or VERCEL_TEAM_ID may be needed.'
      : (response.status === 404 ? ' Check VERCEL_PROJECT_ID — the project name or id was not found.' : '');
    return { checked: false, reason: `Vercel API returned ${response.status}: ${detail}.${hint}`, vars: {} };
  }

  const list = Array.isArray(payload?.envs) ? payload.envs : [];
  const vars = {};
  for (const entry of list) {
    const name = String(entry?.key || '').trim();
    if (!name) continue;
    const updatedAt = Number(entry?.updatedAt || entry?.createdAt || 0) || 0;
    // A variable can exist once per target (production/preview/development).
    // Keep the newest, since that is the one most likely to surprise someone.
    if (!vars[name] || updatedAt > vars[name].updatedAt) {
      vars[name] = {
        updatedAt,
        updatedAtIso: updatedAt ? new Date(updatedAt).toISOString() : null,
        targets: Array.isArray(entry?.target) ? entry.target : [],
      };
    }
  }

  const data = { checked: true, reason: '', vars };
  cache = { at: Date.now(), key: cacheKey, data };
  return data;
}

/**
 * For the given env var names, which were edited after the running deployment
 * was built — i.e. which changes are not live yet.
 *
 * @param {string[]} envVarNames
 * @returns {Promise<{checked: boolean, reason: string, stale: Array, buildBuiltAt: string|null}>}
 */
async function findStaleEnvVars(envVarNames = []) {
  const names = (Array.isArray(envVarNames) ? envVarNames : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);

  const build = getBuildInfo();
  if (!names.length) {
    return { checked: true, reason: '', stale: [], buildBuiltAt: build.builtAt };
  }

  // Token first, deliberately. Both the token and the build stamp are required,
  // but only the token is something the operator has to supply — the stamp is
  // written by `npm run build` on every deploy. Reporting the missing token
  // first gives the more actionable reason when neither is present.
  const meta = await fetchEnvMetadata();
  if (!meta.checked) {
    return { checked: false, reason: meta.reason, stale: [], buildBuiltAt: build.builtAt };
  }

  if (!build.known) {
    return {
      checked: false,
      reason: 'The running deployment has no build stamp, so there is nothing to compare against.',
      stale: [],
      buildBuiltAt: null,
    };
  }

  const builtAtMs = Date.parse(build.builtAt);
  const stale = [];
  for (const name of names) {
    const entry = meta.vars[name];
    if (!entry || !entry.updatedAt) continue;
    if (entry.updatedAt > builtAtMs) {
      stale.push({ name, updatedAt: entry.updatedAtIso, targets: entry.targets });
    }
  }
  return { checked: true, reason: '', stale, buildBuiltAt: build.builtAt };
}

/**
 * One sentence naming the variables whose edits have not shipped. Empty when
 * there is nothing to say, so callers can append blindly.
 */
function describeStaleEnvVars(result) {
  if (!result || !result.checked || !Array.isArray(result.stale) || !result.stale.length) return '';
  const names = result.stale.map((entry) => entry.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const plural = names.length === 1 ? 'was' : 'were';
  return `${list} ${plural} edited in Vercel AFTER this deployment was built, so the current value is not live yet. `
    + 'Redeploy to pick it up.';
}

/** Test seam: drop the cached Vercel response. */
function clearCache() {
  cache = { at: 0, key: '', data: null };
}

module.exports = {
  fetchEnvMetadata,
  findStaleEnvVars,
  describeStaleEnvVars,
  clearCache,
};
