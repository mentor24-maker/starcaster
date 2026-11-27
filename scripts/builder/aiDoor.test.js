'use strict';

/**
 * The AI door (lib/aiClient.js generate(), AI switch 1, SC-843): every rule it
 * makes about falling through, proved with recorded provider replies — no
 * network, no key, no database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// The meter's storage layer, stubbed before anything reaches for it.
const observePath = require.resolve('../../lib/observeStore');
require.cache[observePath] = {
  id: observePath, filename: observePath, loaded: true, children: [], paths: [],
  exports: { logUsage: async () => {} },
};

const {
  generate, envProviderOrder, orderFromSettings, buildRequest, parseJsonReply, AI_PROVIDERS, NOTICE_EVERY_MS, CANNOT_READ, _resetNoticeMemory,
} = require('../../lib/aiClient');
const { generateAlt } = require('../../lib/altTextProviders');

// ── Recorded replies, in each provider's own shape ─────────────────────────

const REPLIES = {
  anthropicOk: (text = 'from claude') => ({ status: 200, body: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } }),
  anthropicNoCredit: () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } } }),
  anthropicBadRequest: () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' } } }),
  anthropicBadKey: () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }),
  anthropicBusy: () => ({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' } } }),
  openaiOk: (text = 'from gpt') => ({ status: 200, body: { model: 'gpt-5.5-2026-04-23', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } } }),
  openaiNoCredit: () => ({ status: 429, body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } } }),
  geminiOk: (text = 'from gemini') => ({ status: 200, body: { modelVersion: 'gemini-2.5-pro', candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 } } }),
};

function fakeResponse({ status, body, headers = {} }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, text: async () => text, headers: { get: (n) => lower[String(n).toLowerCase()] ?? '' } };
}

/**
 * A door with everything injected. `script` maps a provider id to the reply
 * it gives (a function, so each call can differ). Records every request sent,
 * every meter row and every bus post.
 */
function harness({ order = 'anthropic,openai,gemini', keys = { anthropic: 'k-a', openai: 'k-o', gemini: 'k-g', kimi: 'k-k' }, script = {}, now = 1_000_000, dns = {} } = {}) {
  const sent = [];
  const metered = [];
  const posts = [];
  const clock = { now };
  const providerOf = (url) => {
    if (url.includes('anthropic.com')) return 'anthropic';
    if (url.includes('openai.com')) return 'openai';
    if (url.includes('googleapis.com')) return 'gemini';
    if (url.includes('moonshot.ai')) return 'kimi';
    if (url.includes('deepseek.com')) return 'deepseek';
    if (url.includes('openrouter.ai')) return 'openrouter';
    if (url.includes('x.ai')) return 'xai';
    if (url.includes('mistral.ai')) return 'mistral';
    if (url.includes('groq.com')) return 'groq';
    return 'unknown';
  };
  const deps = {
    order: () => envProviderOrder({ env: { AI_PROVIDER_ORDER: order } }),
    getKey: (def) => keys[def.id] || '',
    // A GET is the door reading a web page (SC-897): scripted by `script.page(url)`.
    fetchImpl: async (url, init) => {
      const provider = init.method === 'GET' ? 'page' : providerOf(url);
      sent.push({ provider, url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers, init });
      const reply = script[provider];
      if (!reply) throw new Error(`test: no scripted reply for ${provider}`);
      const r = reply(url);
      if (r instanceof Error) throw r;
      return fakeResponse(r);
    },
    recordUsage: async (row) => { metered.push(row); },
    postBus: async (text) => { posts.push(text); return { ok: true }; },
    now: () => clock.now,
    // Every name is public unless the test says otherwise; never real DNS.
    lookup: async (host) => {
      const answer = dns[host] || [{ address: '93.184.216.34', family: 4 }];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { deps, sent, metered, posts, clock };
}

const ASK = { feature: 'test-feature', tier: 'strong', system: 'Be brief.', messages: 'Hello' };

test.beforeEach(() => _resetNoticeMemory());

// ── Falling through ────────────────────────────────────────────────────────

test('the first provider out of credit falls through to the second, and the meter names the one that answered', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicNoCredit, openai: () => REPLIES.openaiOk('hi') } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.text, 'hi');
  assert.equal(r.model, 'gpt-5.5-2026-04-23');
  assert.deepEqual(h.sent.map((s) => s.provider), ['anthropic', 'openai']);
  assert.equal(h.metered.length, 1, 'exactly one meter row: the call that was served');
  assert.equal(h.metered[0].provider, 'openai');
  assert.equal(h.metered[0].model, 'gpt-5.5-2026-04-23');
  assert.equal(h.metered[0].feature, 'test-feature');
  assert.equal(h.metered[0].usage.totalTokens, 16);
  assert.equal(r.skipped[0].provider, 'anthropic');
  assert.equal(r.skipped[0].verdict, 'OUT OF CREDIT');
});

test('a refused key falls through too', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicBadKey, openai: REPLIES.openaiOk } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.provider, 'openai');
  assert.equal(r.skipped[0].verdict, 'INVALID');
});

test("OpenAI's own out-of-quota reply (a 429 with insufficient_quota) counts as out of credit, not as busy", async () => {
  const h = harness({ order: 'openai,anthropic', script: { openai: REPLIES.openaiNoCredit, anthropic: REPLIES.anthropicOk } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.skipped[0].verdict, 'OUT OF CREDIT');
});

test('a 400 bad request does NOT fall through: it is returned, and the next provider is never billed', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicBadRequest, openai: REPLIES.openaiOk } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'provider_error');
  assert.equal(r.status, 400);
  assert.match(r.error, /Anthropic refused the request \(400\): messages: text content blocks must be non-empty/);
  assert.deepEqual(h.sent.map((s) => s.provider), ['anthropic']);
  assert.equal(h.metered.length, 0);
});

test('a rate limit (429 without a quota message) does not fall through', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicBusy, openai: REPLIES.openaiOk } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.code, 'provider_error');
  assert.deepEqual(h.sent.map((s) => s.provider), ['anthropic']);
});

test('no answer at all (a timeout) does not fall through', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const h = harness({ script: { anthropic: () => timeout, openai: REPLIES.openaiOk } });
  const r = await generate({ ...ASK, timeoutMs: 5000 }, h.deps);
  assert.equal(r.code, 'no_answer');
  assert.match(r.error, /Anthropic did not answer: no answer within 5s/);
  assert.deepEqual(h.sent.map((s) => s.provider), ['anthropic']);
});

test('a provider with no key is skipped without a request', async () => {
  const h = harness({ keys: { openai: 'k-o' }, script: { openai: REPLIES.openaiOk } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.provider, 'openai');
  assert.deepEqual(h.sent.map((s) => s.provider), ['openai']);
  assert.equal(r.skipped[0].verdict, 'NOT SET');
  assert.match(r.skipped[0].reason, /add ANTHROPIC_API_KEY/);
});

test('when every provider is out, the error names each one and its reason', async () => {
  const h = harness({ keys: { anthropic: 'k-a', openai: 'k-o' }, script: { anthropic: REPLIES.anthropicNoCredit, openai: REPLIES.openaiNoCredit } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_provider');
  assert.match(r.error, /^No AI provider could answer\./);
  assert.match(r.error, /Anthropic: anthropic answered 400 — "Your credit balance is too low/);
  assert.match(r.error, /OpenAI: openai answered 429 — "You exceeded your current quota/);
  assert.match(r.error, /Google Gemini: no key set \(add GEMINI_API_KEY\)/);
  assert.equal(h.metered.length, 0);
});

test('an unknown name in AI_PROVIDER_ORDER is reported, never silently dropped', async () => {
  const h = harness({ order: 'openia,openai', script: { openai: REPLIES.openaiOk } });
  const r = await generate(ASK, h.deps);
  assert.equal(r.provider, 'openai');
  assert.equal(r.skipped[0].provider, 'openia');
  assert.match(r.skipped[0].reason, /not a provider this door knows/);
});

test('a tier that is not fast or strong is refused before anything is sent', async () => {
  const h = harness({ script: {} });
  const r = await generate({ ...ASK, tier: 'turbo' }, h.deps);
  assert.equal(r.code, 'bad_request');
  assert.equal(h.sent.length, 0);
});

// ── Prose and JSON on every adapter ────────────────────────────────────────

for (const [provider, reply] of [['anthropic', REPLIES.anthropicOk], ['openai', REPLIES.openaiOk], ['gemini', REPLIES.geminiOk]]) {
  test(`json: false returns prose from ${provider}, and asks for no JSON`, async () => {
    const h = harness({ order: provider, script: { [provider]: () => reply('Plain words.') } });
    const r = await generate({ ...ASK, json: false }, h.deps);
    assert.equal(r.ok, true);
    assert.equal(r.text, 'Plain words.');
    assert.equal(r.json, undefined);
    const wire = JSON.stringify(h.sent[0].body);
    assert.doesNotMatch(wire, /json_object|application\/json|single JSON object/);
  });

  test(`json: true asks ${provider} for JSON and returns it parsed`, async () => {
    const h = harness({ order: provider, script: { [provider]: () => reply('```json\n{"a": 1}\n```') } });
    const r = await generate({ ...ASK, json: true }, h.deps);
    assert.equal(r.ok, true);
    assert.deepEqual(r.json, { a: 1 });
    assert.match(JSON.stringify(h.sent[0].body), /single JSON object/);
  });

  test(`json: true with a prose reply from ${provider} is a named failure, not a crash`, async () => {
    const h = harness({ order: provider, script: { [provider]: () => reply('Sorry, I cannot.') } });
    const r = await generate({ ...ASK, json: true }, h.deps);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'bad_json');
    assert.match(r.error, /answered, but not with JSON/);
    assert.equal(r.text, 'Sorry, I cannot.');
  });
}

test('each adapter asks for JSON the way its provider understands', () => {
  const ask = { system: 's', messages: 'm', json: true, maxTokens: 50 };
  const openai = buildRequest(AI_PROVIDERS.openai, 'gpt-5.5', 'k', ask);
  assert.deepEqual(openai.body.response_format, { type: 'json_object' });
  const gemini = buildRequest(AI_PROVIDERS.gemini, 'gemini-2.5-pro', 'k', ask);
  assert.equal(gemini.body.generationConfig.responseMimeType, 'application/json');
  const claude = buildRequest(AI_PROVIDERS.anthropic, 'claude-sonnet-5-5', 'k', ask);
  assert.match(claude.body.system, /single JSON object/);
});

test('Kimi is an OpenAI-style service: its own address, OpenAI chat shape, max_completion_tokens', async () => {
  const h = harness({ order: 'kimi', script: { kimi: () => REPLIES.openaiOk('kimi says hi') } });
  const r = await generate({ ...ASK, tier: 'fast', maxTokens: 77 }, h.deps);
  assert.equal(r.provider, 'kimi');
  assert.equal(h.sent[0].url, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(h.sent[0].body.model, 'kimi-k3.1-pro-highspeed');
  assert.equal(h.sent[0].body.max_completion_tokens, 77);
  assert.equal(h.sent[0].headers.authorization, 'Bearer k-k');
  // The meter cannot read a "kimi" usage block by name, so the door hands it one.
  assert.equal(h.metered[0].provider, 'kimi');
  assert.equal(h.metered[0].usage.totalTokens, 16);
});

test('Kimi is off unless the order names it', () => {
  assert.equal(envProviderOrder({ env: {} }).providers.some((p) => p.id === 'kimi'), false);
});

// ── DeepSeek and the other services added 2026-11-19 (SC-903) ──────────────

test('DeepSeek: its own address, max_tokens (the only length setting it takes), its current models', async () => {
  const h = harness({ order: 'deepseek', keys: { deepseek: 'k-d' }, script: { deepseek: () => REPLIES.openaiOk('deepseek says hi') } });
  const r = await generate({ ...ASK, tier: 'strong', maxTokens: 90 }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.text, 'deepseek says hi');
  assert.equal(h.sent[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(h.sent[0].headers.authorization, 'Bearer k-d');
  assert.equal(h.sent[0].body.model, 'deepseek-v4-pro');
  assert.equal(h.sent[0].body.max_tokens, 90);
  assert.equal('max_completion_tokens' in h.sent[0].body, false, 'DeepSeek documents only max_tokens');
  // The strong tier keeps DeepSeek's default thinking.
  assert.equal('thinking' in h.sent[0].body, false);
});

test('DeepSeek fast tier switches its default thinking off, so a fast call is fast', () => {
  const fast = buildRequest(AI_PROVIDERS.deepseek, 'deepseek-flash', 'k', { messages: 'm', maxTokens: 50, tier: 'fast' });
  assert.deepEqual(fast.body.thinking, { type: 'disabled' });
  assert.equal(fast.body.model, 'deepseek-flash');
  const strong = buildRequest(AI_PROVIDERS.deepseek, 'deepseek-v4-pro', 'k', { messages: 'm', maxTokens: 50, tier: 'strong' });
  assert.equal('thinking' in strong.body, false);
});

test('each new service is sent the length setting its own docs name', () => {
  const ask = { messages: 'm', maxTokens: 64, tier: 'fast' };
  const expected = { deepseek: 'max_tokens', openrouter: 'max_tokens', mistral: 'max_tokens', xai: 'max_completion_tokens', groq: 'max_completion_tokens', openai: 'max_completion_tokens', kimi: 'max_completion_tokens' };
  for (const [id, param] of Object.entries(expected)) {
    const req = buildRequest(AI_PROVIDERS[id], AI_PROVIDERS[id].models.fast, 'k', ask);
    const other = param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    assert.equal(req.body[param], 64, `${id} should get ${param}`);
    assert.equal(other in req.body, false, `${id} must not also get ${other}`);
    assert.equal(req.url, `${AI_PROVIDERS[id].baseUrl}/chat/completions`);
  }
});

test('asking for JSON names JSON in the prompt, which DeepSeek, Mistral and Groq require', () => {
  for (const id of ['deepseek', 'mistral', 'groq']) {
    const req = buildRequest(AI_PROVIDERS[id], 'm', 'k', { system: 'Be brief.', messages: 'm', json: true, maxTokens: 50, tier: 'strong' });
    assert.deepEqual(req.body.response_format, { type: 'json_object' });
    assert.match(req.body.messages[0].content, /JSON/);
  }
});

test('OpenRouter: vendor/model ids, its reasoning text not downloaded', () => {
  const req = buildRequest(AI_PROVIDERS.openrouter, AI_PROVIDERS.openrouter.models.strong, 'k', { messages: 'm', maxTokens: 50, tier: 'strong' });
  assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(req.body.model, '~deepseek/deepseek-pro-latest');
  assert.deepEqual(req.body.reasoning, { exclude: true });
});

test('Mistral answering as a list of pieces: the answer is the text pieces, never the thinking', async () => {
  const pieces = { status: 200, body: { model: 'mistral-large-4', choices: [{ message: { content: [
    { type: 'thinking', thinking: [{ type: 'text', text: 'let me think about it' }] },
    { type: 'text', text: 'The answer ' },
    { type: 'text', text: 'is 4.' },
  ] }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 } } };
  const h = harness({ order: 'mistral', keys: { mistral: 'k-m' }, script: { mistral: () => pieces } });
  const r = await generate({ ...ASK }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'The answer is 4.');
  assert.equal(h.sent[0].url, 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(h.sent[0].body.max_tokens, 4096);
});

test('a refused DeepSeek key falls through to the next provider like any other', async () => {
  const h = harness({
    order: 'deepseek,openai',
    keys: { deepseek: 'k-d', openai: 'k-o' },
    script: {
      deepseek: () => ({ status: 401, body: { error: { message: 'Authentication Fails, Your api key: ****abcd is invalid', type: 'authentication_error' } } }),
      openai: () => REPLIES.openaiOk('from gpt'),
    },
  });
  const r = await generate({ ...ASK }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.skipped[0].provider, 'deepseek');
  assert.equal(r.skipped[0].verdict, 'INVALID');
});

test('the five new services are off unless switched on, and each names its own key setting', () => {
  const ids = ['deepseek', 'openrouter', 'xai', 'mistral', 'groq'];
  const { providers } = envProviderOrder({ env: {} });
  for (const id of ids) {
    assert.equal(providers.some((p) => p.id === id), false, `${id} must be off by default`);
    assert.match(AI_PROVIDERS[id].keyEnv, /^[A-Z]+_API_KEY$/);
    assert.equal(AI_PROVIDERS[id].kind, 'openai-style');
    assert.match(AI_PROVIDERS[id].baseUrl, /^https:\/\//);
  }
  assert.equal(new Set(Object.values(AI_PROVIDERS).map((p) => p.keyEnv)).size, Object.keys(AI_PROVIDERS).length, 'no two providers share a key setting');
});

// ── The order and its models ───────────────────────────────────────────────

test('the default order is today\'s behaviour: Anthropic first', () => {
  const { providers, source } = envProviderOrder({ env: {} });
  assert.equal(source, 'default');
  assert.deepEqual(providers.map((p) => p.id), ['anthropic', 'openai', 'gemini']);
});

test('AI_PROVIDER_ORDER and AI_MODEL_<PROVIDER>_<TIER> override it', () => {
  const { providers, source, ignored } = envProviderOrder({ env: { AI_PROVIDER_ORDER: ' OpenAI , anthropic,openai,nope', AI_MODEL_OPENAI_FAST: 'gpt-5.4-nano' } });
  assert.equal(source, 'AI_PROVIDER_ORDER');
  assert.deepEqual(providers.map((p) => p.id), ['openai', 'anthropic']);
  assert.equal(providers[0].models.fast, 'gpt-5.4-nano');
  assert.equal(providers[0].models.strong, 'gpt-5.5');
  assert.deepEqual(ignored, ['nope']);
});

test('callers never name a model: the tier picks it', async () => {
  const h = harness({ order: 'anthropic', script: { anthropic: REPLIES.anthropicOk } });
  await generate({ ...ASK, tier: 'fast' }, h.deps);
  await generate({ ...ASK, tier: 'strong' }, h.deps);
  assert.deepEqual(h.sent.map((s) => s.body.model), ['claude-haiku-4-5', 'claude-sonnet-5-5']);
});

// ── The bus notice ─────────────────────────────────────────────────────────

test('a fall-through posts to the bus once per 6 hours per provider, and again after', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicNoCredit, openai: REPLIES.openaiOk } });
  await generate(ASK, h.deps);
  await generate(ASK, h.deps);
  assert.equal(h.posts.length, 1);
  assert.match(h.posts[0], /^AI calls are using OpenAI: Anthropic is out of credit\./);
  h.clock.now += NOTICE_EVERY_MS - 1;
  await generate(ASK, h.deps);
  assert.equal(h.posts.length, 1, 'still inside the 6 hours');
  h.clock.now += 1;
  await generate(ASK, h.deps);
  assert.equal(h.posts.length, 2, '6 hours later it says so again');
});

test('the notice clears the first time that provider works again', async () => {
  let anthropicFunded = false;
  const h = harness({ script: { anthropic: () => (anthropicFunded ? REPLIES.anthropicOk() : REPLIES.anthropicNoCredit()), openai: REPLIES.openaiOk } });
  await generate(ASK, h.deps);
  anthropicFunded = true;
  await generate(ASK, h.deps); // Anthropic answers: the notice is cleared
  anthropicFunded = false;
  await generate(ASK, h.deps); // ...so running dry again is news straight away
  assert.equal(h.posts.length, 2);
});

test('a missing key alone is not news: no bus post', async () => {
  const h = harness({ keys: { openai: 'k-o' }, script: { openai: REPLIES.openaiOk } });
  await generate(ASK, h.deps);
  assert.equal(h.posts.length, 0);
});

test('a notice that was not delivered is tried again on the next fall-through', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicNoCredit, openai: REPLIES.openaiOk } });
  let deliver = false;
  const tries = [];
  h.deps.postBus = async (text) => { tries.push(text); return deliver ? { ok: true } : { ok: false, why: 'tracker down' }; };
  await generate(ASK, h.deps);
  deliver = true;
  await generate(ASK, h.deps);
  assert.equal(tries.length, 2);
});

// ── The first caller: alt text ─────────────────────────────────────────────

test('alt text goes through the door on the fast tier and returns trimmed text', async () => {
  const asked = [];
  const text = await generateAlt({ prompt: 'a photo', scope: { projectId: 'p1' } }, {
    door: async (opts) => { asked.push(opts); return { ok: true, text: '  A tennis coach serving.  ', provider: 'openai' }; },
  });
  assert.equal(text, 'A tennis coach serving.');
  assert.equal(asked[0].feature, 'seo_alt_text');
  assert.equal(asked[0].tier, 'fast');
  assert.equal(asked[0].maxTokens, 128);
  assert.deepEqual(asked[0].scope, { projectId: 'p1' });
});

test('alt text throws with the door\'s reason when nothing could answer, so the image is noted as skipped', async () => {
  await assert.rejects(
    generateAlt({ prompt: 'a photo' }, { door: async () => ({ ok: false, code: 'no_provider', error: 'No AI provider could answer. Anthropic: out of credit.' }) }),
    /Alt text could not be written: No AI provider could answer\. Anthropic: out of credit\./,
  );
  await assert.rejects(
    generateAlt({ prompt: 'a photo' }, { door: async () => ({ ok: true, text: '  ', provider: 'openai', providerLabel: 'OpenAI', stopReason: 'length' }) }),
    /OpenAI answered with nothing \(finish: length\)/,
  );
});

test('parseJsonReply tolerates code fences and names a failure', () => {
  assert.deepEqual(parseJsonReply('```json\n{"x":2}\n```').value, { x: 2 });
  assert.equal(parseJsonReply('nope').ok, false);
});

// ── Pictures and PDFs sent with the prompt (SC-895) ────────────────────────

const PNG = { mimeType: 'image/png', base64: 'iVBORw0KGgo=' };
const PDF = { mimeType: 'application/pdf', base64: 'JVBERi0xLjQ=' };
const withFiles = (files, content = 'What does this say?') => [{ role: 'user', content, files }];

test('Anthropic: a picture and a PDF go as image and document blocks before the words', () => {
  const req = buildRequest(AI_PROVIDERS.anthropic, 'claude-sonnet-5-5', 'k', { messages: withFiles([PNG, PDF]), maxTokens: 50 });
  assert.deepEqual(req.body.messages, [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } },
      { type: 'text', text: 'What does this say?' },
    ],
  }]);
});

test('Anthropic: a file by web address goes as a url source', () => {
  const req = buildRequest(AI_PROVIDERS.anthropic, 'claude-sonnet-5-5', 'k', {
    messages: withFiles([{ url: 'https://example.com/logo.png' }, { url: 'https://example.com/flyer.pdf' }]), maxTokens: 50,
  });
  assert.deepEqual(req.body.messages[0].content.slice(0, 2), [
    { type: 'image', source: { type: 'url', url: 'https://example.com/logo.png' } },
    { type: 'document', source: { type: 'url', url: 'https://example.com/flyer.pdf' } },
  ]);
});

test('OpenAI-style: a picture goes as an image_url part, a PDF as a file part carrying its bytes', () => {
  const req = buildRequest(AI_PROVIDERS.openai, 'gpt-5.5', 'k', { system: 's', messages: withFiles([PNG, PDF]), maxTokens: 50 });
  assert.deepEqual(req.body.messages, [
    { role: 'system', content: 's' },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
        { type: 'file', file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQ=' } },
        { type: 'text', text: 'What does this say?' },
      ],
    },
  ]);
  const byAddress = buildRequest(AI_PROVIDERS.kimi, 'kimi-k3.1-pro', 'k', { messages: withFiles([{ url: 'https://example.com/a.jpg' }]), maxTokens: 50 });
  assert.deepEqual(byAddress.body.messages[0].content[0], { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } });
});

test('Gemini: a picture and a PDF go as inlineData parts', () => {
  const req = buildRequest(AI_PROVIDERS.gemini, 'gemini-3.1-pro-preview', 'k', { messages: withFiles([PNG, PDF]), maxTokens: 50 });
  assert.deepEqual(req.body.contents, [{
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
      { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQ=' } },
      { text: 'What does this say?' },
    ],
  }]);
});

test('files with no words send only the files (Anthropic refuses an empty text block)', () => {
  const req = buildRequest(AI_PROVIDERS.anthropic, 'claude-sonnet-5-5', 'k', { messages: withFiles([PNG], ''), maxTokens: 50 });
  assert.equal(req.body.messages[0].content.length, 1);
  assert.equal(req.body.messages[0].content[0].type, 'image');
});

test('a text-only request is exactly what it was before files existed', () => {
  const ask = { system: 's', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }], maxTokens: 50, tier: 'fast' };
  const emptyFiles = { ...ask, messages: ask.messages.map((m) => ({ ...m, files: [] })) };
  for (const id of Object.keys(AI_PROVIDERS)) {
    const def = AI_PROVIDERS[id];
    const plain = buildRequest(def, 'm', 'k', ask);
    assert.equal(JSON.stringify(buildRequest(def, 'm', 'k', emptyFiles)), JSON.stringify(plain), `${id}: an empty files list changes nothing`);
  }
  assert.deepEqual(buildRequest(AI_PROVIDERS.anthropic, 'm', 'k', ask).body.messages, [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }]);
  assert.deepEqual(buildRequest(AI_PROVIDERS.openai, 'm', 'k', ask).body.messages[1], { role: 'user', content: 'hi' });
  assert.deepEqual(buildRequest(AI_PROVIDERS.gemini, 'm', 'k', ask).body.contents[0], { role: 'user', parts: [{ text: 'hi' }] });
});

test('a PDF with Kimi first: Kimi is skipped with a reason naming it and PDFs, and the next provider answers', async () => {
  const h = harness({ order: 'kimi,openai', script: { kimi: () => REPLIES.openaiOk('wrong'), openai: () => REPLIES.openaiOk('read it') } });
  const r = await generate({ ...ASK, messages: withFiles([PDF]) }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.text, 'read it');
  assert.deepEqual(h.sent.map((s) => s.provider), ['openai'], 'Kimi is never sent the request');
  assert.equal(r.skipped[0].provider, 'kimi');
  assert.equal(r.skipped[0].verdict, CANNOT_READ);
  assert.equal(r.skipped[0].reason, 'Kimi cannot read PDFs');
  assert.equal(h.posts.length, 0, 'a provider that cannot read a PDF is not news for the bus');
});

test('a provider that cannot read the PDF is not announced as out of credit when another one really is', async () => {
  // A clock no earlier test used, so no provider's 6-hour stamp is still running.
  const h = harness({
    order: 'kimi,anthropic,openai',
    now: 50_000_000_000,
    script: { kimi: () => REPLIES.openaiOk('wrong'), anthropic: REPLIES.anthropicNoCredit, openai: () => REPLIES.openaiOk('read it') },
  });
  const r = await generate({ ...ASK, messages: withFiles([PDF]) }, h.deps);
  assert.equal(r.provider, 'openai');
  assert.deepEqual(r.skipped.map((s) => [s.provider, s.verdict]), [['kimi', CANNOT_READ], ['anthropic', 'OUT OF CREDIT']]);
  assert.equal(h.posts.length, 1, 'Anthropic being out of credit is news');
  assert.match(h.posts[0], /^AI calls are using OpenAI: Anthropic is out of credit\. /);
  assert.doesNotMatch(h.posts[0], /Kimi/, 'Kimi is not out of credit; it just cannot read PDFs');

  // Kimi's notice clock was not stamped: a real Kimi outage straight after is still announced.
  const h2 = harness({ order: 'kimi,openai', now: 50_000_000_001, script: { kimi: () => ({ status: 429, body: { error: { type: 'insufficient_quota', message: 'You exceeded your current quota' } } }), openai: () => REPLIES.openaiOk('ok') } });
  const r2 = await generate(ASK, h2.deps);
  assert.equal(r2.provider, 'openai');
  assert.equal(r2.skipped[0].verdict, 'OUT OF CREDIT');
  assert.equal(h2.posts.length, 1, 'a real Kimi outage inside the same 6 hours is announced');
  assert.match(h2.posts[0], /Kimi is out of credit/);
});

test('a picture type a provider does not read, or an address it cannot fetch, is a named skip too', async () => {
  const heic = { mimeType: 'image/heic', base64: 'AAAA' };
  const h = harness({ order: 'anthropic,gemini', script: { gemini: () => REPLIES.geminiOk('a photo') } });
  const r = await generate({ ...ASK, messages: withFiles([heic]) }, h.deps);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.skipped[0].reason, 'Anthropic cannot read image/heic images');

  const h2 = harness({ order: 'gemini,anthropic', script: { anthropic: () => REPLIES.anthropicOk('fetched') } });
  const r2 = await generate({ ...ASK, messages: withFiles([{ url: 'https://example.com/flyer.pdf' }]) }, h2.deps);
  assert.equal(r2.provider, 'anthropic');
  assert.match(r2.skipped[0].reason, /^Google Gemini cannot fetch PDFs from a web address/);
});

test('when no provider in the order can read the file, ok is false and the error lists each provider and why', async () => {
  const h = harness({ order: 'kimi,deepseek,groq', keys: { kimi: 'k', deepseek: 'k', groq: 'k' } });
  const r = await generate({ ...ASK, messages: withFiles([PDF]) }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_provider');
  assert.equal(h.sent.length, 0, 'nothing is sent anywhere');
  assert.match(r.error, /could both read the file sent and answer/);
  assert.match(r.error, /Kimi: Kimi cannot read PDFs/);
  assert.match(r.error, /DeepSeek: DeepSeek cannot read PDFs/);
  assert.match(r.error, /Groq: Groq cannot read PDFs/);
  assert.deepEqual(r.skipped.map((s) => s.verdict), [CANNOT_READ, CANNOT_READ, CANNOT_READ]);
});

test('a text-only service cannot read pictures either, including an added one', async () => {
  const { providers } = orderFromSettings({
    providers: [{ id: 'my-llm', enabled: true, strong: 'x' }, { id: 'anthropic', enabled: true }],
    customProviders: [{ id: 'my-llm', label: 'My LLM', baseUrl: 'https://llm.example.com/v1', keyEnv: 'AI_SERVICE_MY_LLM_API_KEY' }],
  });
  const h = harness({ script: { anthropic: () => REPLIES.anthropicOk('a logo') } });
  h.deps.order = () => ({ providers, ignored: [] });
  h.deps.getKey = () => 'k';
  const r = await generate({ ...ASK, messages: withFiles([PNG]) }, h.deps);
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.skipped[0].reason, 'My LLM cannot read images');
  assert.equal(providers[1].reads.pdf, true, 'a provider from the Settings order keeps what it can read');
});

test('a file the door cannot send to anyone is refused before anything is sent', async () => {
  const cases = [
    [[{ mimeType: 'text/plain', base64: 'aGk=' }], /"text\/plain"; the door sends images and PDFs only/],
    [[{ mimeType: 'image/png' }], /has no bytes/],
    [[{ mimeType: 'image/png', base64: 'aGk=', url: 'https://example.com/a.png' }], /both bytes and an address/],
    [[{ url: 'ftp://example.com/a.png' }], /must start with http/],
    [[{ url: 'https://example.com/download' }], /of no stated type/],
  ];
  for (const [files, why] of cases) {
    const h = harness({ script: { anthropic: REPLIES.anthropicOk } });
    const r = await generate({ ...ASK, messages: withFiles(files) }, h.deps);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'bad_request');
    assert.match(r.error, why);
    assert.equal(h.sent.length, 0);
  }
  const h = harness({ script: { anthropic: REPLIES.anthropicOk } });
  const r = await generate({ ...ASK, messages: [{ role: 'assistant', content: 'x', files: [PNG] }] }, h.deps);
  assert.equal(r.code, 'bad_request');
  assert.match(r.error, /only the asker's messages can carry files/);
});

test('a picture sent through generate reaches the provider that answers', async () => {
  const h = harness({ order: 'anthropic,gemini', script: { anthropic: REPLIES.anthropicNoCredit, gemini: () => REPLIES.geminiOk('a tennis ball') } });
  const r = await generate({ ...ASK, messages: withFiles([PNG]) }, h.deps);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.skipped[0].verdict, 'OUT OF CREDIT');
  assert.deepEqual(h.sent[1].body.contents[0].parts[0], { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } });
});

// ── An exact JSON shape, and reading a named web page (SC-897) ─────────────

const { schemaMismatch, isPrivateAddress, pageText } = require('../../lib/aiClient');

const SHAPE = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    colours: { type: 'array', items: { type: 'object', properties: { hex: { type: 'string' } }, required: ['hex'], additionalProperties: false } },
  },
  required: ['label', 'colours'],
  additionalProperties: false,
};
const FITS = JSON.stringify({ label: 'Calm', colours: [{ hex: '#123456' }] });

test('buildRequest with a schema sets each provider\'s own structured-answer field', () => {
  const ask = { system: 's', messages: 'm', maxTokens: 50, schema: SHAPE };
  const claude = buildRequest(AI_PROVIDERS.anthropic, 'claude-sonnet-5-5', 'k', ask);
  assert.deepEqual(claude.body.output_config, { format: { type: 'json_schema', schema: SHAPE } });
  const openai = buildRequest(AI_PROVIDERS.openai, 'gpt-5.5', 'k', ask);
  assert.deepEqual(openai.body.response_format, { type: 'json_schema', json_schema: { name: 'answer', schema: SHAPE, strict: true } });
  const gemini = buildRequest(AI_PROVIDERS.gemini, 'gemini-3.1-pro-preview', 'k', ask);
  assert.equal(gemini.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(gemini.body.generationConfig.responseJsonSchema, SHAPE);
  // A provider not known to hold a schema gets plain JSON mode and the schema in words.
  const deepseek = buildRequest(AI_PROVIDERS.deepseek, 'deepseek-v4-pro', 'k', ask);
  assert.deepEqual(deepseek.body.response_format, { type: 'json_object' });
  assert.ok(deepseek.body.messages[0].content.includes(JSON.stringify(SHAPE)), 'the schema is in its instructions');
  // A provider that holds the schema itself is not also sent it in words.
  assert.ok(!openai.body.messages[0].content.includes(JSON.stringify(SHAPE)));
});

test('no new option means the request is byte-for-byte what it was before', () => {
  const asks = [
    { system: 's', messages: 'm', maxTokens: 50 },
    { system: 's', messages: 'm', json: true, maxTokens: 50, tier: 'fast' },
  ];
  const expected = {
    anthropic: [
      '{"model":"m","max_tokens":50,"system":"s","messages":[{"role":"user","content":"m"}]}',
      '{"model":"m","max_tokens":50,"system":"s\\n\\nReply with a single JSON object and nothing else: no prose, no code fences.","messages":[{"role":"user","content":"m"}]}',
    ],
    openai: [
      '{"model":"m","max_completion_tokens":50,"messages":[{"role":"system","content":"s"},{"role":"user","content":"m"}]}',
      '{"model":"m","max_completion_tokens":50,"messages":[{"role":"system","content":"s\\n\\nReply with a single JSON object and nothing else: no prose, no code fences."},{"role":"user","content":"m"}],"response_format":{"type":"json_object"}}',
    ],
    gemini: [
      '{"systemInstruction":{"parts":[{"text":"s"}]},"contents":[{"role":"user","parts":[{"text":"m"}]}],"generationConfig":{"maxOutputTokens":50}}',
      '{"systemInstruction":{"parts":[{"text":"s\\n\\nReply with a single JSON object and nothing else: no prose, no code fences."}]},"contents":[{"role":"user","parts":[{"text":"m"}]}],"generationConfig":{"maxOutputTokens":50,"responseMimeType":"application/json"}}',
    ],
  };
  for (const [id, bodies] of Object.entries(expected)) {
    asks.forEach((ask, i) => {
      assert.equal(JSON.stringify(buildRequest(AI_PROVIDERS[id], 'm', 'k', ask).body), bodies[i], `${id}, ask ${i + 1}`);
      assert.equal(JSON.stringify(buildRequest(AI_PROVIDERS[id], 'm', 'k', { ...ask, schema: undefined, pages: undefined }).body), bodies[i]);
    });
  }
});

test('an answer that fits the schema comes back parsed, saying who held it to the shape', async () => {
  const h = harness({ order: 'deepseek', keys: { deepseek: 'k-d' }, script: { deepseek: () => REPLIES.openaiOk(FITS) } });
  const r = await generate({ ...ASK, schema: SHAPE }, h.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.json, JSON.parse(FITS));
  assert.equal(r.schemaBy, 'door');
  const h2 = harness({ order: 'openai', script: { openai: () => REPLIES.openaiOk(FITS) } });
  assert.equal((await generate({ ...ASK, schema: SHAPE }, h2.deps)).schemaBy, 'provider');
});

test('an answer that does not fit the schema is bad_json naming the field', async () => {
  const cases = [
    [{ label: 'Calm' }, /colours is missing/],
    [{ label: 7, colours: [] }, /label should be string, but is integer/],
    [{ label: 'Calm', colours: [{ hex: 1 }] }, /colours\[0\]\.hex should be string/],
    [{ label: 'Calm', colours: [], extra: true }, /extra is not a field the shape allows/],
  ];
  for (const [answer, why] of cases) {
    const h = harness({ order: 'anthropic', script: { anthropic: () => REPLIES.anthropicOk(JSON.stringify(answer)) } });
    const r = await generate({ ...ASK, schema: SHAPE }, h.deps);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'bad_json');
    assert.match(r.error, why);
    assert.match(r.field, why);
    assert.equal(r.provider, 'anthropic');
    assert.equal(h.metered.length, 1, 'the call was still served, so it is still metered');
  }
});

test('schemaMismatch covers enums, numbers, lengths, anyOf and local $ref', () => {
  assert.equal(schemaMismatch({ enum: ['a', 'b'] }, 'a'), '');
  assert.match(schemaMismatch({ enum: ['a', 'b'] }, 'c'), /one of "a", "b"/);
  assert.match(schemaMismatch({ type: 'integer' }, 1.5), /should be integer, but is number/);
  assert.equal(schemaMismatch({ type: 'number' }, 3), '');
  assert.match(schemaMismatch({ type: 'array', maxItems: 1 }, [1, 2]), /more than 1/);
  assert.match(schemaMismatch({ type: 'string', minLength: 3 }, 'ab'), /shorter than 3/);
  assert.match(schemaMismatch({ anyOf: [{ type: 'string' }, { type: 'null' }] }, 4), /fits none/);
  const withRef = { type: 'object', properties: { c: { $ref: '#/$defs/c' } }, $defs: { c: { type: 'string' } } };
  assert.match(schemaMismatch(withRef, { c: 2 }), /^c should be string/);
  assert.equal(schemaMismatch({ type: 'string', format: 'email' }, 'not an email'), '', 'an unchecked keyword is never a failure');
});

test('a schema that is not an object is refused before anything is sent', async () => {
  const h = harness({ script: { anthropic: REPLIES.anthropicOk } });
  const r = await generate({ ...ASK, schema: 'object' }, h.deps);
  assert.equal(r.code, 'bad_request');
  assert.equal(h.sent.length, 0);
});

const PAGE_HTML = '<!doctype html><html><head><title>Delray Tennis</title><meta name="description" content="Courts &amp; lessons"><style>.x{}</style></head>'
  + '<body><script>alert(1)</script><h1>Welcome</h1><p>Junior&nbsp;camps &mdash; all summer.</p></body></html>';
const pageOk = () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: PAGE_HTML });

test('a provider that fetches pages itself is given the address and its fetch tool, not the page', () => {
  const req = buildRequest(AI_PROVIDERS.anthropic, 'claude-sonnet-5-5', 'k', { messages: 'Describe them.', maxTokens: 50, pages: [{ url: 'https://example.com/' }] });
  assert.deepEqual(req.body.tools, [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }]);
  assert.match(req.body.messages[0].content, /^Describe them\.\n\nRead this web page with your web fetch tool before answering:\n- https:\/\/example\.com\/$/);
});

test('a provider without its own fetch is sent the page text the door read, and the reply says so', async () => {
  const h = harness({ order: 'openai', script: { openai: () => REPLIES.openaiOk('a tennis club'), page: pageOk } });
  const r = await generate({ ...ASK, messages: 'Describe them.', pages: ['https://example.com/'] }, h.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(h.sent.map((s) => s.provider), ['page', 'openai']);
  assert.equal(h.sent[0].init.redirect, 'manual', 'redirects are followed by the door, each one checked');
  const said = h.sent[1].body.messages[1].content;
  assert.match(said, /^Describe them\.\n\nThe text of the web page https:\/\/example\.com\/, read for you:/);
  assert.match(said, /Title: Delray Tennis/);
  assert.match(said, /Description: Courts & lessons/);
  assert.match(said, /Junior camps — all summer\./);
  assert.ok(!/alert|\.x\{\}/.test(said), 'scripts and styles are not page text');
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].readBy, 'door');
  assert.equal(r.pages[0].url, 'https://example.com/');
  assert.ok(r.pages[0].chars > 0);
});

test('Anthropic out of credit: the next provider gets the page text the door read', async () => {
  const h = harness({ order: 'anthropic,openai', script: { anthropic: REPLIES.anthropicNoCredit, openai: REPLIES.openaiOk, page: pageOk } });
  const r = await generate({ ...ASK, pages: ['https://example.com/'] }, h.deps);
  assert.equal(r.provider, 'openai');
  assert.deepEqual(h.sent.map((s) => s.provider), ['anthropic', 'page', 'openai']);
  assert.ok(h.sent[0].body.tools, 'Anthropic was asked to fetch it itself');
  assert.equal(r.pages[0].readBy, 'door');
});

test('a page that cannot be read fails clearly and is never sent empty', async () => {
  const cases = [
    [() => ({ status: 404, body: 'gone' }), /answered 404/],
    [() => ({ status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF' }), /is application\/pdf, not a web page \(send it as a file instead\)/],
    [() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><script>x()</script></body></html>' }), /has no readable text/],
    [() => new Error('socket hang up'), /could not be read: socket hang up/],
  ];
  for (const [page, why] of cases) {
    const h = harness({ order: 'openai', script: { openai: REPLIES.openaiOk, page } });
    const r = await generate({ ...ASK, pages: ['https://example.com/'] }, h.deps);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'page_unreadable');
    assert.match(r.error, why);
    assert.equal(r.pages[0].readBy, 'door');
    assert.deepEqual(h.sent.map((s) => s.provider), ['page'], 'no AI request was made');
  }
});

test('the door never reads a private network address, by name, by number or by redirect', async () => {
  for (const url of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/']) {
    const h = harness({ order: 'openai', script: { openai: REPLIES.openaiOk, page: pageOk } });
    const r = await generate({ ...ASK, pages: [url] }, h.deps);
    assert.equal(r.code, 'page_unreadable', url);
    assert.match(r.error, /private network/, url);
    assert.equal(h.sent.length, 0, `${url}: nothing was fetched`);
  }
  const byName = harness({ order: 'openai', dns: { 'intranet.example.com': [{ address: '192.168.1.4', family: 4 }] }, script: { openai: REPLIES.openaiOk, page: pageOk } });
  const r1 = await generate({ ...ASK, pages: ['https://intranet.example.com/'] }, byName.deps);
  assert.match(r1.error, /intranet\.example\.com is on a private network \(192\.168\.1\.4\)/);
  assert.equal(byName.sent.length, 0);
  const redirect = harness({ order: 'openai', script: { openai: REPLIES.openaiOk, page: () => ({ status: 302, headers: { location: 'http://localhost:3001/admin' }, body: '' }) } });
  redirect.deps.lookup = async (host) => (host === 'localhost' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);
  const r2 = await generate({ ...ASK, pages: ['https://example.com/'] }, redirect.deps);
  assert.equal(r2.code, 'page_unreadable');
  assert.match(r2.error, /localhost:3001\/admin localhost is on a private network/);
  assert.equal(redirect.sent.length, 1, 'the redirect target was never fetched');
});

test('a redirect to a public page is followed, and the reply names where it landed', async () => {
  const h = harness({
    order: 'openai',
    script: { openai: REPLIES.openaiOk, page: (url) => (url === 'https://example.com/' ? { status: 301, headers: { location: '/home' }, body: '' } : pageOk()) },
  });
  const r = await generate({ ...ASK, pages: ['https://example.com/'] }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(r.pages[0].finalUrl, 'https://example.com/home');
  assert.match(h.sent[2].body.messages[1].content, /\(it moved to https:\/\/example\.com\/home\)/);
});

test('pages that are not web addresses, or too many, are refused before anything is sent', async () => {
  for (const [pages, why] of [['https://e.com', /a list of web addresses/], [['ftp://e.com/'], /must be an address starting with http/], [Array(6).fill('https://e.com/'), /at most 5 pages/]]) {
    const h = harness({ script: { anthropic: REPLIES.anthropicOk } });
    const r = await generate({ ...ASK, pages }, h.deps);
    assert.equal(r.code, 'bad_request');
    assert.match(r.error, why);
    assert.equal(h.sent.length, 0);
  }
});

test("Anthropic's own fetch: an answer reached without reading the page is page_unreadable", async () => {
  const withFetch = (resultContent, text = 'They teach tennis.') => () => ({
    status: 200,
    body: {
      model: 'claude-sonnet-5-5',
      content: [
        { type: 'server_tool_use', id: 't1', name: 'web_fetch', input: { url: 'https://example.com/' } },
        { type: 'web_fetch_tool_result', tool_use_id: 't1', content: resultContent },
        { type: 'text', text },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });
  const read = harness({ order: 'anthropic', script: { anthropic: withFetch({ type: 'web_fetch_result', url: 'https://example.com/', content: {} }) } });
  const ok = await generate({ ...ASK, pages: ['https://example.com/'] }, read.deps);
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'They teach tennis.');
  assert.deepEqual(ok.pages, [{ url: 'https://example.com/', readBy: 'provider' }]);

  const failed = harness({ order: 'anthropic', script: { anthropic: withFetch({ type: 'web_fetch_tool_error', error_code: 'url_not_accessible' }) } });
  const bad = await generate({ ...ASK, pages: ['https://example.com/'] }, failed.deps);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'page_unreadable');
  assert.match(bad.error, /its page reader failed \(url_not_accessible\)/);

  const never = harness({ order: 'anthropic', script: { anthropic: () => REPLIES.anthropicOk('I guess they teach tennis.') } });
  const none = await generate({ ...ASK, pages: ['https://example.com/'] }, never.deps);
  assert.equal(none.code, 'page_unreadable');
  assert.match(none.error, /did not read any of them/);
});

test('isPrivateAddress: loopback, private, link-local and mapped addresses are private; public ones are not', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:7f00:1', '::ffff:10.0.0.1', 'not-an-ip']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(a), false, a);
});

test('pageText keeps plain text as it is', () => {
  assert.equal(pageText('Hello\r\nthere', 'text/plain'), 'Hello\nthere');
});

test('the live page reader refuses a private address at connect time, even when the first look-up said public', async () => {
  const http = require('node:http');
  const { readPage, livePageFetch } = require('../../lib/aiClient');
  const server = http.createServer((req, res) => res.end('<p>admin only</p>'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://localhost:${server.address().port}/`;
    // A name that answers "public" to the door's check and "127.0.0.1" a moment later.
    const fooled = async () => [{ address: '93.184.216.34', family: 4 }];
    const r = await readPage(url, { fetchImpl: livePageFetch, lookup: fooled });
    assert.equal(r.ok, false);
    // Linux answers ::1 first, macOS 127.0.0.1: either is the loopback being refused.
    assert.match(r.error, /localhost is on a private network \((127\.0\.0\.1|::1)\)/);
  } finally {
    server.close();
  }
});
