'use strict';

/**
 * Per-project settings stored as a jsonb blob on app_projects, following the
 * same pattern as enabled_modules so adding a setting needs no migration.
 * Requires docs/SQL/project_site_settings.sql to be applied.
 *
 * TWO AUDIENCES, TWO WHITELISTS — the distinction is the whole point of this
 * file:
 *
 *   KNOWN_SETTINGS    Tenant-writable. Edited by the site owner on their own
 *                     admin area (brandonmarinoff.com/admin-settings) via
 *                     GET/PATCH /api/admin/site-settings.
 *
 *   PLATFORM_SETTINGS Platform-only. Edited by Alphire in StarCaster under
 *                     Settings > Projects > Edit, via PATCH /api/projects/:id.
 *                     A tenant admin can neither read nor write these: the
 *                     tenant read returns only KNOWN_SETTINGS keys, the tenant
 *                     PATCH drops everything else, and /api/projects is in
 *                     PROJECT_ADMIN_SESSION_DENY_PREFIXES so a tenant session
 *                     cannot reach the platform route at all.
 *
 * supportAlertEmail is platform-only on purpose. It decides where a client's
 * "my site is broken" requests are delivered, so the client must not be able
 * to point it somewhere else — including at themselves.
 *
 * Unknown keys from a request body are dropped rather than persisted, so no
 * caller can stuff arbitrary JSON onto the project row.
 */

const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const PROJECTS_TABLE = 'app_projects';
const COLUMN = 'site_settings';

/** Reasonable-shape check only — real deliverability is Resend's problem. */
function isEmailish(value) {
  const v = String(value || '').trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Tenant-writable settings. */
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

/**
 * Platform-only settings: writable ONLY via PATCH /api/projects/:id.
 *
 * `tenantReadable` marks the ones a tenant may see. Some of these exist
 * precisely to be displayed on the client's own Support page (the address and
 * phone number they should contact), while supportAlertEmail is internal
 * routing and must never leave the platform. Readable is not writable either
 * way — the tenant PATCH only ever considers KNOWN_SETTINGS.
 */
const PLATFORM_SETTINGS = Object.freeze({
  // Where a support request from this site's admin area is DELIVERED — the
  // people who maintain the site, i.e. Alphire. The opposite direction from
  // contactAlertEmail above, which is the owner's own inbox for visitor
  // enquiries. Blank falls back to the SUPPORT_ALERT_EMAIL env var; see
  // resolveSupportAlertEmail() below.
  //
  // Deliberately NOT tenantReadable: showing the intake inbox to a client
  // invites them to email it directly, bypassing the form and the record it
  // creates.
  supportAlertEmail: {
    tenantReadable: false,
    normalize: (value) => String(value ?? '').trim().toLowerCase(),
    validate: (value) => (value === '' || isEmailish(value)
      ? null
      : 'Support Alert Email must be a valid email address (or blank to use the platform default)'),
  },
  // Public-facing support address, DISPLAYED on the client's Support page.
  // Often the same as supportAlertEmail, but kept separate so the intake
  // inbox can be a routing address without the client ever seeing it.
  supportEmail: {
    tenantReadable: true,
    normalize: (value) => String(value ?? '').trim().toLowerCase(),
    validate: (value) => (value === '' || isEmailish(value)
      ? null
      : 'Support Email must be a valid email address (or blank to hide it)'),
  },
  // Displayed alongside supportEmail. Free text on purpose — real numbers
  // carry extensions, country codes and punctuation no format check survives.
  supportPhone: {
    tenantReadable: true,
    normalize: (value) => String(value ?? '').trim().slice(0, 60),
    validate: () => null,
  },
});

/** Platform keys a tenant is allowed to read, for display on their own site. */
const TENANT_READABLE_PLATFORM_KEYS = Object.freeze(
  Object.keys(PLATFORM_SETTINGS).filter((key) => PLATFORM_SETTINGS[key].tenantReadable === true)
);

function defaults() {
  const out = { contactAlertEmail: '' };
  for (const key of TENANT_READABLE_PLATFORM_KEYS) out[key] = '';
  return out;
}

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, error: 'Site settings require Supabase configuration' };
  }
  return null;
}

function rawBlob(row) {
  return (row && row[COLUMN] && typeof row[COLUMN] === 'object' && !Array.isArray(row[COLUMN]))
    ? row[COLUMN]
    : {};
}

/**
 * Tenant-facing view: everything the tenant is allowed to see — their own
 * KNOWN_SETTINGS plus the platform keys flagged tenantReadable. Platform keys
 * appear here read-only; updateSiteSettings will not write them back.
 */
function rowToSettings(row) {
  const raw = rawBlob(row);
  const out = defaults();
  for (const key of Object.keys(KNOWN_SETTINGS)) {
    if (raw[key] !== undefined) out[key] = KNOWN_SETTINGS[key].normalize(raw[key]);
  }
  for (const key of TENANT_READABLE_PLATFORM_KEYS) {
    if (raw[key] !== undefined) out[key] = PLATFORM_SETTINGS[key].normalize(raw[key]);
  }
  return out;
}

/**
 * Read the stored blob verbatim, platform keys included.
 *
 * Internal: used by the platform update path (which must merge rather than
 * clobber the tenant's own keys) and by resolveSupportAlertEmail. Never wire
 * this to a tenant-reachable route.
 */
async function readRawSiteSettings(projectIdInput) {
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

  return { ok: true, status: 200, data: rawBlob(row) };
}

/**
 * Validate a platform-only patch and merge it over an existing blob.
 *
 * Pure and synchronous: the caller supplies the current blob, because the
 * project row may come from Supabase or from the local file store, and this
 * module should not need to know which.
 *
 * Returns the COMPLETE merged object to write. Writing `{ supportAlertEmail }`
 * on its own would silently erase contactAlertEmail — this is one jsonb
 * column, not a row per setting.
 */
function mergePlatformSiteSettings(currentBlob, patch) {
  const incoming = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  const clean = {};
  for (const [key, spec] of Object.entries(PLATFORM_SETTINGS)) {
    if (incoming[key] === undefined) continue;
    const value = spec.normalize(incoming[key]);
    const problem = spec.validate(value);
    if (problem) return { ok: false, status: 400, error: problem };
    clean[key] = value;
  }
  if (!Object.keys(clean).length) {
    return { ok: false, status: 400, error: 'No recognized platform settings to update' };
  }

  const base = (currentBlob && typeof currentBlob === 'object' && !Array.isArray(currentBlob))
    ? currentBlob
    : {};
  return { ok: true, status: 200, data: { ...base, ...clean } };
}

/** Platform-facing view of the platform-only keys, for the Projects screen. */
function readPlatformSettingsFromRow(row) {
  const raw = rawBlob(row);
  const out = {};
  for (const [key, spec] of Object.entries(PLATFORM_SETTINGS)) {
    out[key] = raw[key] !== undefined ? spec.normalize(raw[key]) : '';
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

  // Merge over the RAW blob, not the tenant-facing view. The view omits
  // platform-only keys, so merging over it would silently delete
  // supportAlertEmail every time a tenant saved their contact address.
  const current = await readRawSiteSettings(projectId);
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
  // Always return the tenant-facing view — never echo platform keys back to
  // a caller who may be a tenant admin.
  return { ok: true, status: 200, data: rowToSettings(row || { [COLUMN]: merged }) };
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

/**
 * Where this project's support requests should be emailed.
 *
 * The per-project platform setting first, then the SUPPORT_ALERT_EMAIL env var
 * as the platform-wide default. Returns '' when neither is set, which the
 * caller must treat as "save the request, skip the email" rather than as an
 * error.
 *
 * Reads the raw blob, not the tenant-facing view — supportAlertEmail is
 * deliberately absent from that view.
 *
 * Same never-throws contract as getContactAlertEmail: a settings lookup
 * failure must not fail the submission it is attached to.
 */
async function resolveSupportAlertEmail(projectId) {
  const fallback = String(process.env.SUPPORT_ALERT_EMAIL || '').trim().toLowerCase();
  try {
    const result = await readRawSiteSettings(projectId);
    if (!result.ok) return fallback;
    return String(result.data?.supportAlertEmail || '').trim().toLowerCase() || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  getSiteSettings,
  updateSiteSettings,
  getContactAlertEmail,
  resolveSupportAlertEmail,
  readRawSiteSettings,
  mergePlatformSiteSettings,
  readPlatformSettingsFromRow,
  KNOWN_SETTINGS,
  PLATFORM_SETTINGS,
  TENANT_READABLE_PLATFORM_KEYS,
  SITE_SETTINGS_COLUMN: COLUMN,
};
