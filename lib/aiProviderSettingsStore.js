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
// A leading "~" is OpenRouter's "always the newest in this family" form
// (~deepseek/deepseek-flash-latest), so it is a real model name (SC-903).
const MODEL_RE = /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
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
    // A row can exist with no main order in it: saving a group's own order
    // first writes only group_orders, and Postgres fills providers with [].
    // That is "the main order was never saved", not "every provider is off"
    // (the screen refuses that). Every reader asks THIS, never `exists`, so
    // the door, the screen and the AI keys check cannot disagree about it
    // (SC-872 review, SC-876).
    mainSaved: Boolean(r) && providers.length > 0,
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

/**
 * The group orders ALREADY STORED, brought into line with a main save that
 * added or removed a service (SC-872 review item 3, SC-876). Used only when
 * the save did not send group orders of its own (those are validated strictly
 * instead). A removed service leaves every group's order; an added one joins
 * it switched off, with the main order's models. A group whose own order would
 * then have nothing switched on is REFUSED, not quietly sent back to the main
 * order: that would move its bill without anybody choosing it.
 *
 * Returns { ok, data: { <groupId>: list | null } } or a refusal.
 */
function reconcileGroupOrders(stored, mainProviders) {
  const { GROUP_IDS, groupById } = require('./aiFeatureGroups');
  const main = Array.isArray(mainProviders) ? mainProviders : [];
  const known = new Set(main.map((p) => p.id));
  const out = {};
  for (const id of GROUP_IDS) {
    const own = stored && Array.isArray(stored[id]) ? stored[id] : null;
    if (!own) { out[id] = null; continue; }
    const kept = own.filter((p) => known.has(p.id));
    const listed = new Set(kept.map((p) => p.id));
    for (const p of main) {
      if (!listed.has(p.id)) kept.push({ id: p.id, enabled: false, fast: p.fast, strong: p.strong });
    }
    if (!kept.some((p) => p.enabled)) {
      const gone = own.filter((p) => p.enabled && !known.has(p.id)).map((p) => p.id).join(', ');
      return refuse(`${groupById(id).label}'s own order uses only ${gone || 'services being removed'}. Switch another provider on for ${groupById(id).label}, or set it to follow the main setting, then save again.`);
    }
    out[id] = kept;
  }
  return { ok: true, status: 200, data: out };
}

/** True when at least one group has its own order. */
function anyGroupOrder(groupOrders) {
  return Boolean(groupOrders) && Object.values(groupOrders).some((v) => Array.isArray(v) && v.length);
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

/**
 * Insert-or-merge the one row, stamping who saved it from which project.
 * `input.groupOrders`, when given, is written in the SAME write, so the
 * screen's one Save is one save and its "saved by" stamp is true of all of it
 * (SC-872 review item 4). Left out, the group orders are not touched, so the
 * save still works where docs/SQL/ai_provider_groups_setup.sql has not run.
 */
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
      ...(input.groupOrders !== undefined ? { group_orders: input.groupOrders } : {}),
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

/**
 * True when the group orders read back are the ones sent (SC-872 review, loop
 * rule 3): for every group, both follow the main order, or both have the same
 * order, switches and models. `sent` is validateGroupOrders' data; `read` is
 * readSettings' data (its groupOrders leave following groups out).
 */
function sameGroupOrders(sent, read) {
  const { GROUP_IDS } = require('./aiFeatureGroups');
  const readOrders = (read && read.groupOrders) || {};
  if (read && read.groupErrors && Object.keys(read.groupErrors).length) return false;
  const shape = (list) => (Array.isArray(list) && list.length ? JSON.stringify(list.map((p) => [p.id, Boolean(p.enabled), p.fast, p.strong])) : null);
  return GROUP_IDS.every((id) => shape(sent && sent[id]) === shape(readOrders[id]));
}

// ── The fall-through notice's shared six-hour limit (SC-925) ──────────────
//
// One row per provider in docs/SQL/ai_fall_through_notices_setup.sql: when
// lib/aiClient.js last posted "AI calls are using X" about it. Every copy of
// the server reads the same row, so the notice goes out once per provider per
// six hours for the whole platform. No fallback in here either: a refusal is
// reported as one, and the door falls back to its own memory and says so.

function noticeTable() {
  return require('./supabase').tableConfig().aiFallThroughNotices;
}

function notConfigured() {
  return { ok: false, status: 503, error: 'the database is not configured here' };
}

function noticeFailure(what, res) {
  return { ok: false, status: res.status || 500, error: `the fall-through notice limit could not be ${what}: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
}

/** A timestamp as a PostgREST filter value: quoted (it holds ":" and "."), then URL-encoded. */
function stampValue(iso) {
  return encodeURIComponent(`"${iso}"`);
}

/**
 * Claim the right to post a provider's notice: succeeds only when nothing was
 * posted about it in the last `everyMs`. A first-ever notice inserts the row
 * (a duplicate is ignored, never merged, so it cannot overwrite a stamp
 * another copy just wrote); after that it is an update guarded on the stamp
 * being empty or older than `everyMs`, so two copies deciding at the same
 * moment cannot both win.
 *
 * Returns { ok: true, data: { claimed: true, stamp } }
 *         { ok: true, data: { claimed: false, lastPostedAt } }  (another copy posted; when, if known)
 *         { ok: false, status, error }
 */
async function claimFallThroughNotice(provider, { now = Date.now(), everyMs } = {}) {
  if (!require('./supabase').isConfigured()) return notConfigured();
  const id = String(provider || '').trim();
  if (!id || !(everyMs > 0)) return { ok: false, status: 400, error: 'a provider and an interval are required' };
  const stamp = new Date(now).toISOString();
  const cutoff = new Date(now - everyMs).toISOString();

  const inserted = await sbQuery({
    method: 'POST',
    table: noticeTable(),
    query: 'on_conflict=provider',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: { provider: id, project_id: null, owner_user_id: null, last_posted_at: stamp, updated_at: stamp },
  });
  if (!inserted.ok) return noticeFailure('saved', inserted);
  if (Array.isArray(inserted.data) && inserted.data.length) return { ok: true, status: 200, data: { claimed: true, stamp } };

  const updated = await sbQuery({
    method: 'PATCH',
    table: noticeTable(),
    query: `provider=eq.${encodeURIComponent(id)}&or=(last_posted_at.is.null,last_posted_at.lte.${stampValue(cutoff)})`,
    headers: { Prefer: 'return=representation' },
    body: { last_posted_at: stamp, updated_at: stamp },
  });
  if (!updated.ok) return noticeFailure('saved', updated);
  if (Array.isArray(updated.data) && updated.data.length) return { ok: true, status: 200, data: { claimed: true, stamp } };

  // Another copy posted inside the interval. Read when, so this copy knows how
  // long to leave it; a failed read still means "not yours to post".
  const read = await sbQuery({ method: 'GET', table: noticeTable(), query: `select=last_posted_at&provider=eq.${encodeURIComponent(id)}&limit=1` });
  const row = read.ok && Array.isArray(read.data) ? read.data[0] : null;
  const lastPostedAt = row && row.last_posted_at ? Date.parse(row.last_posted_at) : NaN;
  return { ok: true, status: 200, data: { claimed: false, lastPostedAt: Number.isFinite(lastPostedAt) ? lastPostedAt : null } };
}

/** Undo a claim whose notice was not delivered, only while the stamp is still the one it wrote. */
async function releaseFallThroughNotice(provider, stamp) {
  if (!require('./supabase').isConfigured()) return notConfigured();
  const res = await sbQuery({
    method: 'PATCH',
    table: noticeTable(),
    query: `provider=eq.${encodeURIComponent(String(provider))}&last_posted_at=eq.${stampValue(stamp)}`,
    headers: { Prefer: 'return=minimal' },
    body: { last_posted_at: null, updated_at: new Date().toISOString() },
  });
  return res.ok ? { ok: true, status: 200, data: true } : noticeFailure('cleared', res);
}

/** The provider answers again: its next fall-through is news straight away. */
async function clearFallThroughNotice(provider) {
  if (!require('./supabase').isConfigured()) return notConfigured();
  const res = await sbQuery({
    method: 'PATCH',
    table: noticeTable(),
    query: `provider=eq.${encodeURIComponent(String(provider))}&last_posted_at=not.is.null`,
    headers: { Prefer: 'return=minimal' },
    body: { last_posted_at: null, updated_at: new Date().toISOString() },
  });
  return res.ok ? { ok: true, status: 200, data: true } : noticeFailure('cleared', res);
}

module.exports = {
  claimFallThroughNotice,
  releaseFallThroughNotice,
  clearFallThroughNotice,
  sameGroupOrders,
  reconcileGroupOrders,
  anyGroupOrder,
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
