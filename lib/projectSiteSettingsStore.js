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
 *   PLATFORM_SETTINGS Platform-written. Edited by Alphire in StarCaster under
 *                     Settings > Projects > Edit, via PATCH /api/projects/:id.
 *                     A tenant admin can never WRITE these — the tenant PATCH
 *                     considers only KNOWN_SETTINGS, and /api/projects is in
 *                     PROJECT_ADMIN_SESSION_DENY_PREFIXES so a tenant session
 *                     cannot reach the platform route at all. Entries marked
 *                     `tenantReadable` are returned by the tenant read, because
 *                     the tenant's own Support page has to display them.
 *
 * supportEmail / supportPhone are platform-only on purpose. They are how the
 * client reaches Alphire when their site misbehaves, so the client must not be
 * able to rewrite the address and number their own staff are told to use.
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

/** Most recipients one contact form may notify. */
const MAX_CONTACT_ALERT_RECIPIENTS = 10;

/**
 * Coerce whatever is stored or submitted into a clean list of addresses.
 *
 * Accepts an array (current shape), a single string (the shape this setting
 * had before multiple recipients, still sitting in older project rows), or a
 * comma/semicolon/newline-separated string (what someone pasting a list of
 * addresses into one box will produce). Blanks are dropped and duplicates
 * collapsed, so an empty row in the UI is simply ignored rather than being an
 * error the user has to go and find.
 */
function normalizeEmailList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const email = String(entry ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Tenant-writable settings. */
const KNOWN_SETTINGS = Object.freeze({
  // Addresses notified when a public CRM form is submitted. An empty list is
  // meaningful: it turns notifications off.
  //
  // Stored as an array. Older rows hold a bare string from when this took one
  // address; normalizeEmailList reads both, so no migration is needed — a row
  // upgrades itself the next time it is saved.
  contactAlertEmail: {
    normalize: normalizeEmailList,
    validate: (list) => {
      if (list.length > MAX_CONTACT_ALERT_RECIPIENTS) {
        return `Contact Alert Email accepts at most ${MAX_CONTACT_ALERT_RECIPIENTS} recipients`;
      }
      const bad = list.filter((email) => !isEmailish(email));
      if (!bad.length) return null;
      return bad.length === 1
        ? `"${bad[0]}" is not a valid email address`
        : `These are not valid email addresses: ${bad.join(', ')}`;
    },
  },
});

/**
 * Platform-only settings: writable ONLY via PATCH /api/projects/:id.
 *
 * `tenantReadable` marks the ones a tenant may see. Some of these exist
 * precisely to be displayed on the client's own Support page (the address and
 * phone number they should contact). Readable is not writable — the tenant
 * PATCH only ever considers KNOWN_SETTINGS.
 */
const PLATFORM_SETTINGS = Object.freeze({
  // How the client reaches whoever maintains their website (Alphire). Shown on
  // their Support page, and also where a submitted support request is
  // delivered — so a client gets to the same place whether they use the form
  // or just hit reply. Blank falls back to the SUPPORT_ALERT_EMAIL env var;
  // see resolveSupportDeliveryEmail() below.
  //
  // NOT to be confused with contactAlertEmail above, which points the other
  // way: that is the client's own inbox for enquiries from their public site's
  // visitors, and the client sets it themselves.
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
  const out = { contactAlertEmail: [] };
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
 * clobber the tenant's own keys) and by resolveSupportDeliveryEmail. Never
 * wire this to a tenant-reachable route.
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
 * Returns the COMPLETE merged object to write. Writing `{ supportEmail }`
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
  // the support details every time a tenant saved their contact address.
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
 * Every address to notify about a public form submission, as an array.
 *
 * Convenience read for the public form-submission path. Never throws and never
 * reports an error — a settings lookup failure must not fail the visitor's
 * form submission, it just means no alert goes out. An empty array means
 * alerts are off.
 */
async function getContactAlertEmails(projectId) {
  try {
    const result = await getSiteSettings(projectId);
    if (!result.ok) return [];
    return normalizeEmailList(result.data?.contactAlertEmail);
  } catch {
    return [];
  }
}

/**
 * Where this project's support requests should be emailed: the project's
 * Support Email, then the SUPPORT_ALERT_EMAIL env var as a platform-wide
 * default.
 *
 * Same address the client is shown on their Support page, on purpose — a
 * client reaches the same inbox whether they file the form or just email you.
 *
 * Returns '' when neither is set, which the caller must treat as "save the
 * request, skip the email" rather than as an error.
 *
 * Same never-throws contract as getContactAlertEmail: a settings lookup
 * failure must not fail the submission it is attached to.
 */
async function resolveSupportDeliveryEmail(projectId) {
  const fallback = String(process.env.SUPPORT_ALERT_EMAIL || '').trim().toLowerCase();
  try {
    const result = await readRawSiteSettings(projectId);
    if (!result.ok) return fallback;
    return String(result.data?.supportEmail || '').trim().toLowerCase() || fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  getSiteSettings,
  updateSiteSettings,
  getContactAlertEmails,
  normalizeEmailList,
  resolveSupportDeliveryEmail,
  MAX_CONTACT_ALERT_RECIPIENTS,
  readRawSiteSettings,
  mergePlatformSiteSettings,
  readPlatformSettingsFromRow,
  KNOWN_SETTINGS,
  PLATFORM_SETTINGS,
  TENANT_READABLE_PLATFORM_KEYS,
  SITE_SETTINGS_COLUMN: COLUMN,
};
