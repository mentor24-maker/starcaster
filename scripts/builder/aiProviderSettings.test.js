'use strict';

// AI switch 2 (SC-844): the saved provider order, its validation, the
// 60-second reading, and the fallback to AI_PROVIDER_ORDER when the row is
// missing or unreadable — never "no providers".

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../../lib/aiClient');
const store = require('../../lib/aiProviderSettingsStore');
const { screenRows } = require('../../routes/aiProviders');

const ALL = ['anthropic', 'openai', 'gemini', 'kimi'];
function body(order = ALL, extra = {}) {
  return {
    providers: order.map((id) => ({ id, enabled: id !== 'kimi', fast: ai.AI_PROVIDERS[id]?.models.fast || 'm-fast', strong: ai.AI_PROVIDERS[id]?.models.strong || 'm-strong' })),
    customProviders: [],
    ...extra,
  };
}
const saved = (input) => ({ ok: true, data: { exists: true, ...input } });

// ── Validation ─────────────────────────────────────────────────────────────

test('a full, ordered list with one provider on is accepted as sent', () => {
  const v = store.validateInput(body(['openai', 'anthropic', 'gemini', 'kimi']));
  assert.equal(v.ok, true);
  assert.deepEqual(v.data.providers.map((p) => p.id), ['openai', 'anthropic', 'gemini', 'kimi']);
});

test('every provider must be listed once, so none drops off by being left out', () => {
  assert.match(store.validateInput(body(['openai', 'anthropic', 'gemini'])).error, /Kimi" is missing/);
  assert.match(store.validateInput(body(['openai', 'openai', 'anthropic', 'gemini', 'kimi'])).error, /listed twice/);
  assert.match(store.validateInput(body([...ALL, 'nope'])).error, /not a provider/);
});

test('switching everything off is refused', () => {
  const b = body();
  b.providers.forEach((p) => { p.enabled = false; });
  assert.match(store.validateInput(b).error, /at least one/);
});

test('a model name with a space is refused, not trimmed into something else', () => {
  const b = body();
  b.providers[0].fast = 'claude haiku';
  assert.match(store.validateInput(b).error, /Anthropic needs a fast model/);
});

test('an added service takes a key setting NAME; a pasted key is refused', () => {
  const service = { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'gsk_live_abc123' };
  const b = body(ALL, { customProviders: [service] });
  b.providers.push({ id: 'custom-groq', enabled: false, fast: 'llama-4', strong: 'llama-4' });
  assert.match(store.validateInput(b).error, /NAME of the setting/);
  service.keyEnv = 'GROQ_API_KEY';
  const ok = store.validateInput(b);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.customProviders, [{ id: 'custom-groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' }]);
});

test('a built-in provider\'s key can never be sent to a typed address', () => {
  const b = body(ALL, { customProviders: [{ label: 'Proxy', baseUrl: 'https://example.com/v1', keyEnv: 'ANTHROPIC_API_KEY' }] });
  b.providers.push({ id: 'custom-proxy', enabled: true, fast: 'x', strong: 'x' });
  assert.match(store.validateInput(b).error, /Anthropic's key/);
});

test('an added service needs an https address with no sign-in details', () => {
  for (const baseUrl of ['http://api.groq.com/v1', 'https://user:pw@api.groq.com/v1', 'not a url']) {
    const b = body(ALL, { customProviders: [{ label: 'Groq', baseUrl, keyEnv: 'GROQ_API_KEY' }] });
    b.providers.push({ id: 'custom-groq', enabled: false, fast: 'x', strong: 'x' });
    assert.equal(store.validateInput(b).ok, false, baseUrl);
  }
});

test('the read-back comparison sees a changed order', () => {
  const v = store.validateInput(body()).data;
  assert.equal(store.sameSettings(v, v), true);
  assert.equal(store.sameSettings(v, { ...v, providers: [...v.providers].reverse() }), false);
});

// ── The door's order ───────────────────────────────────────────────────────

test('the saved order wins: OpenAI moved to the top is tried first, switched-off ones are skipped', async () => {
  const v = store.validateInput(body(['openai', 'anthropic', 'gemini', 'kimi'])).data;
  v.providers[2].enabled = false;
  const order = await ai.getAiProviderOrder({ env: {}, readSettings: async () => saved(v) });
  assert.equal(order.source, 'settings');
  assert.deepEqual(order.providers.map((p) => p.id), ['openai', 'anthropic']);
});

test('an added service becomes an OpenAI-style provider with its own key setting', async () => {
  const b = body(ALL, { customProviders: [{ label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' }] });
  b.providers.unshift({ id: 'custom-groq', enabled: true, fast: 'llama-fast', strong: 'llama-big' });
  const v = store.validateInput(b).data;
  const { providers } = await ai.getAiProviderOrder({ env: {}, readSettings: async () => saved(v) });
  assert.equal(providers[0].kind, 'openai-style');
  assert.equal(providers[0].keyEnv, 'GROQ_API_KEY');
  assert.equal(providers[0].models.strong, 'llama-big');
  const req = ai.buildRequest(providers[0], 'llama-big', 'k', { messages: 'hi' });
  assert.equal(req.url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('an unreadable row falls back to AI_PROVIDER_ORDER and says why; never "no providers"', async () => {
  const order = await ai.getAiProviderOrder({
    env: { AI_PROVIDER_ORDER: 'gemini,anthropic' },
    readSettings: async () => ({ ok: false, error: 'HTTP 500' }),
  });
  assert.equal(order.source, 'AI_PROVIDER_ORDER');
  assert.deepEqual(order.providers.map((p) => p.id), ['gemini', 'anthropic']);
  assert.match(order.fallbackReason, /could not be read \(HTTP 500\)/);
});

test('a read that throws is a fallback too', async () => {
  const order = await ai.getAiProviderOrder({ env: {}, readSettings: async () => { throw new Error('socket hang up'); } });
  assert.equal(order.source, 'default');
  assert.equal(order.providers.length, 3);
  assert.match(order.fallbackReason, /socket hang up/);
});

test('no saved row yet is today\'s behaviour, and says nothing is saved', async () => {
  const order = await ai.getAiProviderOrder({ env: {}, readSettings: async () => ({ ok: true, data: { exists: false } }) });
  assert.deepEqual(order.providers.map((p) => p.id), ['anthropic', 'openai', 'gemini']);
  assert.match(order.fallbackReason, /nothing has been saved/);
});

test('the live reading is reused for a minute, then read again', async () => {
  const original = store.readSettings;
  let reads = 0;
  const v = store.validateInput(body(['openai', 'anthropic', 'gemini', 'kimi'])).data;
  // Swap the store's reader the way the door loads it (lazily, by module).
  require.cache[require.resolve('../../lib/aiProviderSettingsStore')].exports.readSettings = async () => { reads += 1; return saved(v); };
  try {
    ai.forgetProviderOrder();
    const t0 = 1_000_000;
    await ai.getAiProviderOrder({ now: t0 });
    await ai.getAiProviderOrder({ now: t0 + ai.ORDER_CACHE_MS - 1 });
    assert.equal(reads, 1, 'second call inside the minute must not read again');
    const later = await ai.getAiProviderOrder({ now: t0 + ai.ORDER_CACHE_MS });
    assert.equal(reads, 2, 'a call after the minute reads again');
    assert.equal(later.providers[0].id, 'openai');
    ai.forgetProviderOrder();
    await ai.getAiProviderOrder({ now: t0 + ai.ORDER_CACHE_MS + 1 });
    assert.equal(reads, 3, 'forgetting (after a save) reads again at once');
  } finally {
    require.cache[require.resolve('../../lib/aiProviderSettingsStore')].exports.readSettings = original;
    ai.forgetProviderOrder();
  }
});

test('generate() follows the saved order', async () => {
  const v = store.validateInput(body(['openai', 'anthropic', 'gemini', 'kimi'])).data;
  const sent = [];
  const res = await ai.generate({ feature: 't', messages: 'hi', tier: 'fast' }, {
    order: () => ai.getAiProviderOrder({ env: {}, readSettings: async () => saved(v) }),
    getKey: () => 'k',
    recordUsage: async () => {},
    postBus: async () => {},
    fetchImpl: async (url) => {
      sent.push(url);
      return new Response(JSON.stringify({ model: 'gpt-5.4-mini', choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }), { status: 200 });
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'openai');
  assert.match(sent[0], /api\.openai\.com/);
});

// ── What the screen shows ──────────────────────────────────────────────────

test('nothing saved: the screen shows the fallback order on, then Kimi off, with key state', () => {
  const rows = screenRows({
    settings: { exists: false, providers: [], customProviders: [] },
    fallback: ai.envProviderOrder({ env: {} }),
    builtIns: ai.AI_PROVIDERS,
    keyIsSet: (def) => def.id === 'anthropic',
  });
  assert.deepEqual(rows.map((r) => [r.id, r.enabled, r.keySet]), [
    ['anthropic', true, true], ['openai', true, false], ['gemini', true, false], ['kimi', false, false],
  ]);
  assert.equal(rows[3].keyEnv, 'MOONSHOT_API_KEY');
  assert.equal(JSON.stringify(rows).includes('"key":'), false, 'no key value field is ever returned');
});

test('only a platform owner or admin may use it; a tenant site admin may not', () => {
  const { isAdmin } = require('../../routes/aiProviders');
  assert.equal(isAdmin({ authUser: { role: 'owner' } }), true);
  assert.equal(isAdmin({ authUser: { role: 'admin' } }), true);
  assert.equal(isAdmin({ authUser: { role: 'user' } }), false);
  assert.equal(isAdmin({ authUser: { role: 'admin', isProjectAdmin: true } }), false);
  assert.equal(isAdmin({}), false);
});
