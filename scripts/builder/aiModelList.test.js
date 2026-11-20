'use strict';

// "List models" on Settings › APIs › AI provider (SC-903): which models a
// provider's key can use, asked on the server. No network, no key.

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../lib/aiClient');
const { listModels } = require('../../lib/aiModelList');
const { providerForList } = require('../../routes/aiProviders');
const ai = require('../../lib/aiClient');

function fake(pages) {
  const sent = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    sent.push({ url, headers: init.headers || {} });
    const { status = 200, body } = pages[Math.min(i, pages.length - 1)];
    i += 1;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetchImpl, sent };
}

test('an OpenAI-style service: GET <address>/models with the key, ids sorted', async () => {
  const f = fake([{ body: { object: 'list', data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }] } }]);
  const r = await listModels(AI_PROVIDERS.deepseek, { key: 'k-d', fetchImpl: f.fetchImpl });
  assert.deepEqual(r, { ok: true, models: ['deepseek-flash', 'deepseek-v4-pro'] });
  assert.equal(f.sent[0].url, 'https://api.deepseek.com/models');
  assert.equal(f.sent[0].headers.authorization, 'Bearer k-d');
});

test('no key: nothing is sent, and the screen is told which setting to add', async () => {
  const f = fake([{ body: {} }]);
  const r = await listModels(AI_PROVIDERS.xai, { key: '', fetchImpl: f.fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'NOT SET');
  assert.match(r.reason, /add XAI_API_KEY to Doppler production/);
  assert.equal(f.sent.length, 0);
});

test('OpenRouter lists its models with no key at all', async () => {
  const f = fake([{ body: { data: [{ id: '~deepseek/deepseek-flash-latest' }, { id: 'x-ai/grok-4.7' }] } }]);
  const r = await listModels(AI_PROVIDERS.openrouter, { key: '', fetchImpl: f.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.models.length, 2);
  assert.equal(f.sent[0].url, 'https://openrouter.ai/api/v1/models');
  assert.equal('authorization' in f.sent[0].headers, false);
});

test('a refused key says it was refused, in words', async () => {
  const f = fake([{ status: 401, body: { error: { message: 'Invalid API Key' } } }]);
  const r = await listModels(AI_PROVIDERS.groq, { key: 'bad', fetchImpl: f.fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'INVALID');
  assert.match(r.reason, /Groq would not list its models: Groq refused the key \(401\)/);
});

test('no answer is "did not answer", never an empty list', async () => {
  const r = await listModels(AI_PROVIDERS.mistral, { key: 'k', fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'CANNOT TELL');
  assert.match(r.reason, /Mistral did not answer: getaddrinfo ENOTFOUND/);
});

test('an empty list is said, not shown as a working dropdown', async () => {
  const f = fake([{ body: { data: [] } }]);
  const r = await listModels(AI_PROVIDERS.groq, { key: 'k', fetchImpl: f.fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.reason, /held no models/);
});

test('Anthropic: its own headers, and every page when there is more than one', async () => {
  const f = fake([
    { body: { data: [{ id: 'claude-sonnet-5-5' }], has_more: true, last_id: 'claude-sonnet-5-5' } },
    { body: { data: [{ id: 'claude-haiku-4-5' }], has_more: false, last_id: 'claude-haiku-4-5' } },
  ]);
  const r = await listModels(AI_PROVIDERS.anthropic, { key: 'k-a', fetchImpl: f.fetchImpl });
  assert.deepEqual(r.models, ['claude-haiku-4-5', 'claude-sonnet-5-5']);
  assert.equal(f.sent[0].headers['x-api-key'], 'k-a');
  assert.match(f.sent[1].url, /after_id=claude-sonnet-5-5/);
});

test('Gemini: "models/" taken off, and only models that write text', async () => {
  const f = fake([{ body: { models: [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
  ] } }]);
  const r = await listModels(AI_PROVIDERS.gemini, { key: 'k-g', fetchImpl: f.fetchImpl });
  assert.deepEqual(r.models, ['gemini-3.8-flash']);
  assert.equal(f.sent[0].headers['x-goog-api-key'], 'k-g');
  assert.equal(f.sent[0].url.includes('k-g'), false, 'the key is a header, never in the address');
});

// ── Which provider a list request may ask ──────────────────────────────────

const savedWith = (customProviders) => async () => ({ ok: true, data: { exists: true, providers: [], customProviders } });

test('a built-in provider is found without reading the database', async () => {
  const r = await providerForList('deepseek', { ai, readSettings: async () => { throw new Error('must not read'); } });
  assert.equal(r.def.id, 'deepseek');
});

test('an added service is found from the saved row', async () => {
  const r = await providerForList('custom-together', { ai, readSettings: savedWith([{ id: 'custom-together', label: 'Together', baseUrl: 'https://api.together.xyz/v1', keyEnv: 'AI_SERVICE_TOGETHER_API_KEY' }]) });
  assert.equal(r.def.baseUrl, 'https://api.together.xyz/v1');
  assert.equal(r.def.kind, 'openai-style');
});

test('an added service naming a key outside AI_SERVICE_ is refused, so no other key is sent to its address', async () => {
  const r = await providerForList('custom-evil', { ai, readSettings: savedWith([{ id: 'custom-evil', label: 'Evil', baseUrl: 'https://evil.example/v1', keyEnv: 'OPENAI_API_KEY' }]) });
  assert.equal(r.def, undefined);
  assert.equal(r.status, 400);
});

test('an unknown or unsaved provider is a 404 that says what to do', async () => {
  assert.equal((await providerForList('nope', { ai })).status, 404);
  const r = await providerForList('custom-new', { ai, readSettings: savedWith([]) });
  assert.equal(r.status, 404);
  assert.match(r.error, /click Save first/);
});
