'use strict';

/**
 * The AI provider switch on Settings › APIs (AI switch 2, SC-844).
 *
 *   GET /api/settings/ai-providers   the order, switches, models and added services,
 *                                    and which one the door is actually using
 *   PUT /api/settings/ai-providers   save them; answered only after reading them back
 *   GET /api/settings/ai-providers/models?provider=<id>
 *                                    the models that provider's key can use, to choose from (SC-903)
 *
 * Owner or admin only: the setting decides which account EVERY AI call bills,
 * the website's and the Mac Mini's. The row lives in
 * lib/aiProviderSettingsStore.js; lib/aiClient.js reads it.
 *
 * No key value is ever accepted or returned (docs/DOCTRINE.md §4.1): each
 * provider carries the NAME of its key setting and whether that key is set.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');

const PATH = '/api/settings/ai-providers';
const manifest = { id: 'aiProviders', label: 'AI provider switch', prefixes: [PATH] };

/**
 * A PLATFORM owner or admin. A tenant site's admin session also arrives with
 * a role (often "admin") but marked `isProjectAdmin`; it runs one client's
 * site, not the platform's AI bill, so it is refused here.
 */
function isAdmin(req) {
  const user = req?.authUser;
  if (!user || user.isProjectAdmin) return false;
  const role = String(user.role || '').trim().toLowerCase();
  return role === 'owner' || role === 'admin';
}

/**
 * What the screen shows: every provider, built-in and added, in the saved
 * order (or the fallback order when nothing is saved), each with its models,
 * its switch and whether its key is set. Pure apart from `keyIsSet`.
 */
function screenRows({ settings, fallback, builtIns, keyIsSet }) {
  const custom = new Map((settings?.customProviders || []).map((c) => [c.id, c]));
  const defOf = (id) => {
    if (builtIns[id]) return { ...builtIns[id], custom: false };
    const c = custom.get(id);
    return c ? { id: c.id, label: c.label, keyEnv: c.keyEnv, baseUrl: c.baseUrl, models: {}, custom: true } : null;
  };
  let entries;
  if (settings?.exists) {
    entries = settings.providers.map((p) => ({ ...p }));
  } else {
    // Nothing saved: show the order the door is using now, switched on, then
    // the rest switched off (Kimi among them).
    entries = fallback.providers.map((p) => ({ id: p.id, enabled: true, fast: p.models.fast, strong: p.models.strong }));
  }
  const listed = new Set(entries.map((e) => e.id));
  for (const id of [...Object.keys(builtIns), ...custom.keys()]) {
    if (!listed.has(id)) {
      const def = defOf(id);
      entries.push({ id, enabled: false, fast: def.models.fast || '', strong: def.models.strong || '' });
    }
  }
  return entries.map((e) => {
    const def = defOf(e.id);
    if (!def) return null;
    return {
      id: e.id,
      label: def.label,
      enabled: Boolean(e.enabled),
      fast: e.fast,
      strong: e.strong,
      defaultFast: def.models.fast || '',
      defaultStrong: def.models.strong || '',
      keyEnv: def.keyEnv,
      keySet: Boolean(keyIsSet(def)),
      custom: Boolean(def.custom),
      baseUrl: def.custom ? def.baseUrl : '',
    };
  }).filter(Boolean);
}

async function readForScreen() {
  const ai = require('../lib/aiClient');
  const store = require('../lib/aiProviderSettingsStore');
  const read = await store.readSettings();
  const settings = read.ok ? read.data : null;
  const fallback = ai.envProviderOrder();
  const using = await ai.getAiProviderOrder({ fresh: true });
  return {
    status: 'ok',
    // Which order the door is following right now, and why, in words.
    source: using.source,
    fallbackReason: using.fallbackReason || '',
    readError: read.ok ? '' : read.error,
    updatedAt: settings?.updatedAt || null,
    customProviders: settings?.customProviders || [],
    providers: screenRows({
      settings,
      fallback,
      builtIns: ai.AI_PROVIDERS,
      keyIsSet: (def) => ai.providerKeyFor(def),
    }),
  };
}

/**
 * The provider a "List models" click names: a built-in one, or a service
 * added on this screen (read from the saved row). An added service whose key
 * setting breaks the AI_SERVICE_ rule is refused, exactly as the door refuses
 * it, so a list request can never send another provider's key to a typed
 * address. Returns { def } or { status, error }.
 */
async function providerForList(id, { ai = require('../lib/aiClient'), readSettings } = {}) {
  if (ai.AI_PROVIDERS[id]) return { def: ai.AI_PROVIDERS[id] };
  if (!/^custom-[a-z0-9-]{1,40}$/.test(id)) return { status: 404, error: `"${id}" is not a provider this screen knows` };
  const read = await (readSettings || require('../lib/aiProviderSettingsStore').readSettings)();
  if (!read.ok) return { status: 502, error: `could not read the added services (${read.error})` };
  const c = (read.data.customProviders || []).find((x) => x.id === id);
  if (!c) return { status: 404, error: `"${id}" is not a saved service; click Save first, then list its models` };
  if (!ai.CUSTOM_KEY_ENV_RE.test(String(c.keyEnv || ''))) {
    return { status: 400, error: `"${c.label}"'s key setting ${c.keyEnv} does not start AI_SERVICE_, so it is never sent anywhere` };
  }
  return { def: { id: c.id, label: c.label, kind: 'openai-style', settingsKey: '', keyEnv: c.keyEnv, baseUrl: c.baseUrl, models: {}, custom: true } };
}

/**
 * GET /api/settings/ai-providers/models?provider=<id>: the models this
 * provider's key can use, for the screen to offer as choices (SC-903). The
 * key never leaves the server. A provider that cannot list (no key, key
 * refused) answers 200 with listed:false and the reason in words, because
 * that is a reading for the screen to show, not a failure of the request.
 */
async function handleModels(req, res) {
  const { checkEndpointLimit } = require('../lib/rateLimiter');
  if (checkEndpointLimit(req, res, 'aiProviders.models')) return true;
  const id = String(new URL(req.url || '/', 'http://local').searchParams.get('provider') || '').trim();
  if (!id) return sendErr(res, 400, 'Say which provider: ?provider=<id>', { code: 'INVALID_AI_PROVIDER' }), true;
  const ai = require('../lib/aiClient');
  const found = await providerForList(id, { ai });
  if (!found.def) return sendErr(res, found.status, found.error, { code: 'INVALID_AI_PROVIDER' }), true;
  const listed = await require('../lib/aiModelList').listModels(found.def, { key: ai.providerKeyFor(found.def) });
  return sendOk(res, 200, listed.ok
    ? { provider: id, listed: true, models: listed.models, checkedAt: new Date().toISOString() }
    : { provider: id, listed: false, models: [], verdict: listed.verdict || '', reason: listed.reason }), true;
}

async function handle(req, res, pathname, method) {
  if (pathname !== PATH && pathname !== `${PATH}/models`) return false;
  if (!isAdmin(req)) {
    return sendErr(res, 403, 'Only an owner or admin can change which AI providers StarCaster uses', { code: 'FORBIDDEN' }), true;
  }

  if (pathname === `${PATH}/models`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    return handleModels(req, res);
  }

  if (method === 'GET') {
    return sendOk(res, 200, await readForScreen()), true;
  }

  if (method === 'PUT') {
    const store = require('../lib/aiProviderSettingsStore');
    const body = await parseJsonBody(req);
    const input = store.validateInput(body);
    if (!input.ok) return sendErr(res, 400, input.error, { code: 'INVALID_AI_PROVIDERS' }), true;
    const saved = await store.saveSettings(input.data, {
      projectId: req?.projectContext?.project?.id,
      userId: req?.authUser?.id,
    });
    if (!saved.ok) return sendErr(res, saved.status || 500, saved.error, { code: 'AI_PROVIDERS_NOT_SAVED' }), true;
    // Read it back before saying it saved: the reply is what the database
    // holds, not an echo of what was sent (landmine 15).
    const back = await store.readSettings();
    if (!back.ok) {
      return sendErr(res, 502, `The save was sent, but reading it back failed (${back.error}), so it is not confirmed. Reload to see what is stored.`, { code: 'AI_PROVIDERS_UNCONFIRMED' }), true;
    }
    if (!back.data.exists || !store.sameSettings(input.data, back.data)) {
      return sendErr(res, 502, 'The save was sent, but the stored setting does not match what was sent, so it is not confirmed. Reload to see what is stored.', { code: 'AI_PROVIDERS_MISMATCH' }), true;
    }
    require('../lib/aiClient').forgetProviderOrder();
    try {
      require('../lib/activityLog').logActivity({
        action: 'settings.ai_providers_saved',
        entityType: 'settings',
        summary: `AI provider order saved: ${input.data.providers.filter((p) => p.enabled).map((p) => p.id).join(' → ')}`,
      });
    } catch { /* the log is a record, not a gate */ }
    return sendOk(res, 200, { ...(await readForScreen()), saved: true }), true;
  }

  return sendErr(res, 405, 'Method not allowed'), true;
}

module.exports = { handle, manifest, screenRows, isAdmin, providerForList };
