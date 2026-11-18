'use strict';

/**
 * The AI provider switch on Settings › APIs (AI switch 2, SC-844).
 *
 *   GET /api/settings/ai-providers   the order, switches, models and added services,
 *                                    and which one the door is actually using
 *   PUT /api/settings/ai-providers   save them; answered only after reading them back
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

async function handle(req, res, pathname, method) {
  if (pathname !== PATH) return false;
  if (!isAdmin(req)) {
    return sendErr(res, 403, 'Only an owner or admin can change which AI providers StarCaster uses', { code: 'FORBIDDEN' }), true;
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

module.exports = { handle, manifest, screenRows, isAdmin };
