'use strict';

/**
 * Per-project settings edited from a tenant's own admin area (the Settings
 * page on brandonmarinoff.com/admin-settings, not the platform Settings
 * screen — those are API credentials and live in lib/apiSettings.js).
 *
 * Stored as a jsonb blob on app_projects, following the same pattern as
 * enabled_modules, so adding a second setting needs no migration.
 * Requires docs/SQL/project_site_settings.sql to be applied.
 *
 * Every value is read and written through KNOWN_SETTINGS below: unknown keys
 * from a request body are dropped rather than persisted, so a caller cannot
 * use this endpoint to stuff arbitrary JSON onto the project row.
 */

const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const PROJECTS_TABLE = 'app_projects';
const COLUMN = 'site_settings';

/** Reasonable-shape check only — real deliverability is Resend's problem. */
function isEmailish(value) {
  const v = String(value || '').trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

const KNOWN_SETTINGS = Object.freeze({
  // Internal address notified when a public CRM form is submitted.
  // Empty string is meaningful: it turns notifications off.
  contactAlertEmail: {
    normalize: (value) => String(value ?? '').trim().toLowerCase(),
    validate: (value) => (value === '' || isEmailish(value)
      ? null
      : 'Contact Alert Email must be a valid email address (or blank to turn alerts off)'),
  },
});

function defaults() {
  return { contactAlertEmail: '' };
}

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, error: 'Site settings require Supabase configuration' };
  }
  return null;
}

function rowToSettings(row) {
  const raw = (row && row[COLUMN] && typeof row[COLUMN] === 'object' && !Array.isArray(row[COLUMN]))
    ? row[COLUMN]
    : {};
  const out = defaults();
  for (const key of Object.keys(KNOWN_SETTINGS)) {
    if (raw[key] !== undefined) out[key] = KNOWN_SETTINGS[key].normalize(raw[key]);
  }
  return out;
}

async function getSiteSettings(projectIdInput) {
  const err = requireSupabase();
  if (err) return err;

  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const result = await sbQuery({
    method: 'GET',
    table: PROJECTS_TABLE,
    query: `select=id,${COLUMN}&id=eq.${encodeURIComponent(projectId)}&limit=1`,
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Failed to read site settings' };

  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  if (!row) return { ok: false, status: 404, error: 'Project not found' };

  return { ok: true, status: 200, data: rowToSettings(row) };
}

/**
 * Merge a partial patch over the stored settings. Only keys in KNOWN_SETTINGS
 * are considered; anything else in the patch is ignored.
 */
async function updateSiteSettings(projectIdInput, patch) {
  const err = requireSupabase();
  if (err) return err;

  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const incoming = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  const clean = {};
  for (const [key, spec] of Object.entries(KNOWN_SETTINGS)) {
    if (incoming[key] === undefined) continue;
    const value = spec.normalize(incoming[key]);
    const problem = spec.validate(value);
    if (problem) return { ok: false, status: 400, error: problem };
    clean[key] = value;
  }
  if (!Object.keys(clean).length) {
    return { ok: false, status: 400, error: 'No recognized settings to update' };
  }

  const current = await getSiteSettings(projectId);
  if (!current.ok) return current;

  const merged = { ...current.data, ...clean };
  const result = await sbQuery({
    method: 'PATCH',
    table: PROJECTS_TABLE,
    query: `id=eq.${encodeURIComponent(projectId)}`,
    body: { [COLUMN]: merged },
    headers: { Prefer: 'return=representation' },
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Failed to save site settings' };

  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  return { ok: true, status: 200, data: row ? rowToSettings(row) : merged };
}

/**
 * Convenience read for the public form-submission path. Never throws and never
 * reports an error — a settings lookup failure must not fail the visitor's
 * form submission, it just means no alert goes out.
 */
async function getContactAlertEmail(projectId) {
  try {
    const result = await getSiteSettings(projectId);
    if (!result.ok) return '';
    return String(result.data?.contactAlertEmail || '').trim();
  } catch {
    return '';
  }
}

module.exports = {
  getSiteSettings,
  updateSiteSettings,
  getContactAlertEmail,
  KNOWN_SETTINGS,
};
