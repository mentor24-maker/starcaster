'use strict';

/**
 * The AI provider switch's one row (AI switch 2, SC-844): which AI providers
 * the door in lib/aiClient.js tries, in what order, which are switched off,
 * which model each uses per tier, and any extra OpenAI-style services Dane has
 * added. Table: docs/SQL/ai_provider_settings_setup.sql.
 *
 * One row for the whole platform, because the bill it decides is the whole
 * platform's. Every function returns `{ ok, status, data }` / `{ ok: false,
 * error }`, never the row (CLAUDE.md landmine 12).
 *
 * No fallback in here: when the database refuses, the caller hears it refused
 * (landmine 15). The fallback to the AI_PROVIDER_ORDER setting lives in
 * lib/aiClient.js, where it is reported as a fallback, not as a save.
 *
 * NO KEY VALUE EVER PASSES THROUGH HERE (docs/DOCTRINE.md §4.1). A custom
 * service names the SETTING that holds its key (`keyEnv`), and the name is
 * held to a shape no real key has, so a key pasted into that box is refused.
 */

const ROW_ID = 'platform';
const TIERS = Object.freeze(['fast', 'strong']);
const MAX_CUSTOM = 10;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
// An added service's key setting lives in its own namespace, AI_SERVICE_*.
// The rule lives in lib/aiClient.js, which enforces it again on read.
function customKeyEnvRe() {
  return require('./aiClient').CUSTOM_KEY_ENV_RE;
}

function sbQuery(req) {
  return require('./supabase').sbQuery(req);
}
function table() {
  return require('./supabase').tableConfig().aiProviderSettings;
}
function builtInProviders() {
  return require('./aiClient').AI_PROVIDERS;
}

/** A display name as the id a custom service is stored under: "Groq Cloud" → "custom-groq-cloud". */
function customIdFor(label) {
  const slug = String(label || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug ? `custom-${slug}` : '';
}

/** A row (or no row yet) as the settings the door and the screen work with. */
function normaliseRow(row) {
  const r = row && typeof row === 'object' ? row : null;
  const providers = Array.isArray(r?.providers) ? r.providers.filter((p) => p && typeof p.id === 'string').map(normaliseProviderEntry) : [];
  const custom = Array.isArray(r?.custom_providers) ? r.custom_providers.filter((c) => c && typeof c.id === 'string').map((c) => ({
    id: c.id,
    label: String(c.label || c.id),
    baseUrl: String(c.baseUrl || ''),
    keyEnv: String(c.keyEnv || ''),
  })) : [];
  const { groupOrders, groupErrors } = normaliseGroupOrders(r?.group_orders);
  return {
    exists: Boolean(r),
    providers,
    customProviders: custom,
    groupOrders,
    groupErrors,
    updatedAt: r?.updated_at || null,
    savedByUserId: r?.owner_user_id || null,
  };
}

function normaliseProviderEntry(p) {
  return {
    id: p.id,
    enabled: p.enabled !== false,
    fast: String(p.fast || '').trim(),
    strong: String(p.strong || '').trim(),
  };
}

/**
 * The `group_orders` column (AI provider groups 1, SC-872) as
 * `{ groupOrders: { <groupId>: [entries] }, groupErrors: { <groupId>: why } }`.
 * A group with no entry follows the main order. A column that is missing
 * (docs/SQL/ai_provider_groups_setup.sql not run yet) or empty means every
 * group follows the main order, which is SC-844's behaviour. A group whose
 * entry cannot be read is named in `groupErrors`, so the door can say why it
 * used the main order instead, never guess.
 */
function normaliseGroupOrders(raw) {
  const groupOrders = {};
  const groupErrors = {};
  if (raw === undefined || raw === null) return { groupOrders, groupErrors };
  const { GROUP_IDS } = require('./aiFeatureGroups');
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    for (const id of GROUP_IDS) groupErrors[id] = 'the saved group settings are not in the expected shape';
    return { groupOrders, groupErrors };
  }
  for (const id of GROUP_IDS) {
    const value = raw[id];
    if (value === undefined || value === null) continue; // follows the main order
    if (!Array.isArray(value)) { groupErrors[id] = 'its saved order is not a list of providers'; continue; }
    groupOrders[id] = value.filter((p) => p && typeof p.id === 'string').map(normaliseProviderEntry);
  }
  return { groupOrders, groupErrors };
}

function refuse(error) {
  return { ok: false, status: 400, error };
}

/**
 * Check what the screen sent. Refuses rather than repairs: an order the server
 * quietly rewrote is an order Dane did not set.
 *
 * body: { providers: [{ id, enabled, fast, strong }], customProviders: [{ label, baseUrl, keyEnv, id? }] }
 */
function validateInput(body, { builtIns = builtInProviders() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const rawCustom = Array.isArray(b.customProviders) ? b.customProviders : [];
  if (rawCustom.length > MAX_CUSTOM) return refuse(`At most ${MAX_CUSTOM} extra services.`);

  const customProviders = [];
  const customIds = new Set();
  for (const c of rawCustom) {
    const label = String(c?.label || '').trim();
    if (!label || label.length > 40) return refuse('Each added service needs a name of 1 to 40 characters.');
    const id = String(c?.id || '').trim() || customIdFor(label);
    if (!/^custom-[a-z0-9-]{1,40}$/.test(id)) return refuse(`"${label}" cannot be used as a service name: use letters and numbers.`);
    if (builtIns[id] || customIds.has(id)) return refuse(`There is already a service called "${label}".`);
    let url;
    try { url = new URL(String(c?.baseUrl || '').trim()); } catch { url = null; }
    if (!url || url.protocol !== 'https:') return refuse(`"${label}" needs an address starting https:// (for example https://api.groq.com/openai/v1).`);
    if (url.username || url.password || url.search || url.hash) return refuse(`"${label}"'s address must be a plain address, with no sign-in details or "?" part.`);
    const keyEnv = String(c?.keyEnv || '').trim();
    // An allowlist, not a blocklist (SC-844 review): no existing secret's
    // name starts AI_SERVICE_, so no existing key (a built-in provider's, an
    // alias of one like GOOGLE_GEMINI_API_KEY, or YOUTUBE_API_KEY) can ever be
    // sent to an address someone typed. A pasted key cannot pass either:
    // real keys are mixed-case or carry dashes.
    const builtInOwner = Object.values(builtIns).find((p) => p.keyEnv === keyEnv);
    if (builtInOwner) return refuse(`${keyEnv} is ${builtInOwner.label}'s key, so it cannot be sent to "${label}". Give "${label}" its own setting, named AI_SERVICE_<NAME>_API_KEY.`);
    if (!customKeyEnvRe().test(keyEnv)) {
      return refuse(`"${label}" needs the NAME of its own key setting, in capitals, starting AI_SERVICE_ and ending _API_KEY (for example AI_SERVICE_GROQ_API_KEY). An added service cannot use any other setting, so it can never be handed a key that belongs to something else. Never type the key itself here.`);
    }
    customIds.add(id);
    customProviders.push({ id, label, baseUrl: url.toString().replace(/\/+$/, ''), keyEnv });
  }

  const list = validateProviderList(b.providers, { builtIns, customProviders });
  if (!list.ok) return list;
  return { ok: true, status: 200, data: { providers: list.data, customProviders } };
}

/**
 * One ordered provider list, the shape the main order and every group's own
 * order share: every known provider exactly once, a valid model per tier, at
 * least one switched on. Refuses rather than repairs.
 */
function validateProviderList(rawProviders, { builtIns = builtInProviders(), customProviders = [], what = '' } = {}) {
  const prefix = what ? `${what}: ` : '';
  if (!Array.isArray(rawProviders)) return refuse(`${prefix}The provider list is missing.`);
  const customIds = new Set(customProviders.map((c) => c.id));
  const known = new Set([...Object.keys(builtIns), ...customIds]);
  const seen = new Set();
  const providers = [];
  for (const p of rawProviders) {
    const id = String(p?.id || '').trim();
    if (!known.has(id)) return refuse(`${prefix}"${id}" is not a provider this screen knows.`);
    if (seen.has(id)) return refuse(`${prefix}"${id}" is listed twice.`);
    seen.add(id);
    const entry = { id, enabled: p?.enabled === true };
    for (const tier of TIERS) {
      const model = String(p?.[tier] || '').trim();
      if (!MODEL_RE.test(model)) {
        const name = builtIns[id]?.label || customProviders.find((c) => c.id === id)?.label || id;
        return refuse(`${prefix}${name} needs a ${tier} model name (letters, numbers, dots, dashes; no spaces).`);
      }
      entry[tier] = model;
    }
    providers.push(entry);
  }
  // Every known provider appears exactly once, so a provider cannot drop off
  // the screen by being left out of a save.
  for (const id of known) {
    if (!seen.has(id)) return refuse(`${prefix}"${builtIns[id]?.label || customProviders.find((c) => c.id === id)?.label || id}" is missing from the list.`);
  }
  if (!providers.some((p) => p.enabled)) {
    return refuse(`${prefix}Switch at least one provider on, or every AI feature stops.`);
  }
  return { ok: true, status: 200, data: providers };
}

/**
 * Check a set of group orders (AI provider groups 1, SC-872):
 * `{ <groupId>: null | [entries] }`. `null` (or a group left out) means
 * "follows the main order". Needs the saved custom services, because a
 * group's order lists them too.
 */
function validateGroupOrders(body, { builtIns = builtInProviders(), customProviders = [] } = {}) {
  const { GROUP_IDS, groupById } = require('./aiFeatureGroups');
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return refuse('The group settings are missing.');
  const out = {};
  for (const key of Object.keys(b)) {
    if (!GROUP_IDS.includes(key)) return refuse(`"${key}" is not a feature group.`);
  }
  for (const id of GROUP_IDS) {
    const value = b[id];
    if (value === undefined || value === null) { out[id] = null; continue; }
    const list = validateProviderList(value, { builtIns, customProviders, what: groupById(id).label });
    if (!list.ok) return list;
    out[id] = list.data;
  }
  return { ok: true, status: 200, data: out };
}

/** Write the group orders alone; the main order and the services are left as they are. */
async function saveGroupOrders(groupOrders, scope) {
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=id',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      id: ROW_ID,
      project_id: String(scope?.projectId || '').trim() || null,
      owner_user_id: String(scope?.userId || '').trim() || null,
      group_orders: groupOrders,
      updated_at: new Date().toISOString(),
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `The AI feature group settings could not be saved: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
  }
  return { ok: true, status: 200, data: true };
}


async function readSettings() {
  if (!require('./supabase').isConfigured()) {
    return { ok: false, status: 503, error: 'the database is not configured here' };
  }
  const res = await sbQuery({ method: 'GET', table: table(), query: `select=*&id=eq.${ROW_ID}&limit=1` });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `the AI provider settings could not be read: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
  }
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return { ok: true, status: 200, data: normaliseRow(row) };
}

/** Insert-or-merge the one row, stamping who saved it from which project. */
async function saveSettings(input, scope) {
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=id',
    // Without this header the second save is a 409, not an update (landmine 15).
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      id: ROW_ID,
      project_id: String(scope?.projectId || '').trim() || null,
      owner_user_id: String(scope?.userId || '').trim() || null,
      providers: input.providers,
      custom_providers: input.customProviders,
      updated_at: new Date().toISOString(),
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `The AI provider settings could not be saved: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
  }
  return { ok: true, status: 200, data: true };
}

/** True when what was read back is what was sent: order, switches, models and services. */
function sameSettings(sent, read) {
  const shape = (x) => JSON.stringify({
    providers: (x.providers || []).map((p) => [p.id, Boolean(p.enabled), p.fast, p.strong]),
    custom: (x.customProviders || []).map((c) => [c.id, c.label, c.baseUrl, c.keyEnv]),
  });
  return shape(sent) === shape(read);
}

module.exports = {
  ROW_ID,
  TIERS,
  customIdFor,
  normaliseRow,
  normaliseGroupOrders,
  validateInput,
  validateProviderList,
  validateGroupOrders,
  saveGroupOrders,
  readSettings,
  saveSettings,
  sameSettings,
};
