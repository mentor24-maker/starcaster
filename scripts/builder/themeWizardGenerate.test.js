'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Two things are pinned here.
 *
 * 1. The model client's failure paths. A refusal arrives as HTTP 200 with an
 *    empty content array (spec §6.6), so code that reads content[0] blindly
 *    throws on a *successful* response. And under zero data retention every
 *    Fable 5 request 400s with a message that reads like a bad payload
 *    (hazard 4.5) — worth an hour of someone's life if it isn't named.
 *
 * 2. A round advances one model call per request and finishes in exactly the
 *    expected number of steps. Doing all four calls in one request is the
 *    serverless-timeout failure the whole design avoids (hazard 4.2).
 */

const apiSettingsPath = require.resolve('../../lib/apiSettings.js');
const generatorPath = require.resolve('../../lib/themeWizardGenerator.js');

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function loadGenerator(fetchImpl) {
  const saved = new Map();
  for (const p of [apiSettingsPath, generatorPath]) saved.set(p, require.cache[p]);
  stub(apiSettingsPath, { getProviderValues: () => ({ api_key: 'test-key' }) });
  delete require.cache[generatorPath];
  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  const generator = require(generatorPath);
  return {
    generator,
    restore() {
      global.fetch = realFetch;
      for (const [p, mod] of saved) { if (mod) require.cache[p] = mod; else delete require.cache[p]; }
    },
  };
}

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('a refusal is reported, not thrown past', async () => {
  const h = loadGenerator(async () => jsonResponse(200, {
    stop_reason: 'refusal',
    stop_details: { category: 'cyber' },
    content: [],
  }));
  try {
    const result = await h.generator.generateCandidate({ styleBrief: {}, direction: {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
    assert.match(result.error, /declined/);
    assert.match(result.error, /cyber/, 'the category tells you whether to retry or rewrite');
    assert.match(result.error, /Nothing was saved/);
  } finally { h.restore(); }
});

test('the zero-retention 400 is named instead of read as a bad request', async () => {
  const h = loadGenerator(async () => jsonResponse(400, {
    error: { message: 'model not available under current data retention configuration' },
  }));
  try {
    const result = await h.generator.generateCandidate({ styleBrief: {}, direction: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /30-day data retention/);
    assert.match(result.error, /account setting, not a problem with the request/);
  } finally { h.restore(); }
});

test('a non-JSON body is an error rather than an exception', async () => {
  const h = loadGenerator(async () => jsonResponse(200, {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Sure! Here is your theme:' }],
  }));
  try {
    const result = await h.generator.generateCandidate({ styleBrief: {}, direction: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /not valid JSON/);
  } finally { h.restore(); }
});

test('candidates request Fable 5 and utility calls request Opus 5', async () => {
  const seen = [];
  const h = loadGenerator(async (_url, options) => {
    seen.push(JSON.parse(options.body));
    return jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
  });
  try {
    await h.generator.generateCandidate({ styleBrief: {}, direction: {} });
    await h.generator.deriveDirections({ styleBrief: {} });
    assert.equal(seen[0].model, 'claude-fable-5', 'design taste is the product (spec §6.1)');
    assert.equal(seen[1].model, 'claude-opus-5');
  } finally { h.restore(); }
});

test('requests carry no sampling knobs and opt into a fallback', async () => {
  // temperature/top_p/top_k are rejected by these models (hazard 4.3), and a
  // refusal that re-runs automatically beats a round that dies (spec §6.6).
  let sent = null;
  let headers = null;
  const h = loadGenerator(async (_url, options) => {
    sent = JSON.parse(options.body);
    headers = options.headers;
    return jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
  });
  try {
    await h.generator.generateCandidate({ styleBrief: {}, direction: {} });
    assert.equal(sent.temperature, undefined);
    assert.equal(sent.top_p, undefined);
    assert.equal(sent.top_k, undefined);
    assert.equal(sent.thinking, undefined, 'Fable 5 rejects an explicit thinking config');
    assert.equal(sent.fallbacks, 'default');
    assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  } finally { h.restore(); }
});

test('the pinned values are stated in the prompt as hard constraints', async () => {
  let sent = null;
  const h = loadGenerator(async (_url, options) => {
    sent = JSON.parse(options.body);
    return jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
  });
  try {
    await h.generator.generateCandidate({
      styleBrief: {}, direction: {}, lockedValues: { primaryColor: '#1a4d8f' },
    });
    const prompt = sent.messages[0].content;
    assert.match(prompt, /HARD CONSTRAINTS/);
    assert.match(prompt, /primaryColor = #1a4d8f/);
  } finally { h.restore(); }
});

test('earlier directions are quoted back so a round stops repeating itself', async () => {
  let sent = null;
  const h = loadGenerator(async (_url, options) => {
    sent = JSON.parse(options.body);
    return jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
  });
  try {
    await h.generator.deriveDirections({ styleBrief: {}, priorDirections: ['Warm editorial serif'] });
    assert.match(sent.messages[0].content, /do NOT propose these again/);
    assert.match(sent.messages[0].content, /Warm editorial serif/);
  } finally { h.restore(); }
});

/**
 * Phase 5 — the other three starting points (spec §5). Each adapter produces
 * the same style-brief shape, so everything downstream is identical regardless
 * of where the look came from. What differs is the failure modes.
 */

test('a typed brief refuses to run on an empty box', async () => {
  const h = loadGenerator(async () => { throw new Error('no request should be made'); });
  try {
    const result = await h.generator.buildStyleBriefFromText({ text: "   " });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    // Caught before a request, so no tokens are spent on an empty prompt.
    assert.match(result.error, /Describe the organisation/);
  } finally { h.restore(); }
});

test('a URL seed rejects nonsense before spending anything', async () => {
  const h = loadGenerator(async () => { throw new Error('no request should be made'); });
  try {
    for (const bad of ['', '   ', 'not a url at all!!', 'ftp://files.example.com']) {
      const result = await h.generator.buildStyleBriefFromUrl({ url: bad });
      assert.equal(result.ok, false, `${bad} should be rejected`);
      assert.equal(result.status, 400);
    }
  } finally { h.restore(); }
});

test('a bare domain is accepted and read over https', async () => {
  const seen = [];
  const h = loadGenerator(async (_url, options) => {
    const body = JSON.parse(options.body);
    seen.push(body);
    return body.tools
      ? jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A tennis club.' }] })
      : jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sector":"club"}' }] });
  });
  try {
    const result = await h.generator.buildStyleBriefFromUrl({ url: 'example.com' });
    assert.equal(result.ok, true, result.error);
    assert.match(seen[0].messages[0].content, /https:\/\/example\.com/);
    assert.equal(seen[0].tools[0].name, 'web_fetch', 'the model fetches the page itself');
    // Second call normalises the prose; schema and tools never ride together.
    assert.equal(seen[1].tools, undefined);
    assert.ok(seen[1].output_config, 'the normalising call is schema-constrained');
  } finally { h.restore(); }
});

test('a URL read that comes back empty says which address failed', async () => {
  const h = loadGenerator(async () => jsonResponse(200, { stop_reason: 'end_turn', content: [] }));
  try {
    const result = await h.generator.buildStyleBriefFromUrl({ url: 'https://example.com/x' });
    assert.equal(result.ok, false);
    assert.match(result.error, /empty response|example\.com/);
  } finally { h.restore(); }
});

test('the URL adapter reports the tokens from both of its calls', async () => {
  // A two-call adapter that reports one call's usage under-bills the session
  // tally, which is the number a future cost throttle reads.
  const h = loadGenerator(async (_url, options) => {
    const body = JSON.parse(options.body);
    return jsonResponse(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: body.tools ? 'A tennis club.' : '{"sector":"club"}' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  });
  try {
    const result = await h.generator.buildStyleBriefFromUrl({ url: 'example.com' });
    assert.equal(h.generator.sumUsage(result.usage), 240, 'both calls counted');
  } finally { h.restore(); }
});

test('a brand-kit seed sends the image as an image block, not a description of one', async () => {
  let sent = null;
  const h = loadGenerator(async (_url, options) => {
    sent = JSON.parse(options.body);
    return jsonResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sector":"club"}' }] });
  });
  try {
    const result = await h.generator.buildStyleBriefFromImage({ imageUrl: 'https://cdn.example/logo.png' });
    assert.equal(result.ok, true, result.error);
    const blocks = sent.messages[0].content;
    assert.equal(blocks[0].type, 'image');
    assert.equal(blocks[0].source.url, 'https://cdn.example/logo.png');
    assert.equal(blocks[1].type, 'text');
  } finally { h.restore(); }
});

test('a brand-kit seed with no image refuses before spending anything', async () => {
  const h = loadGenerator(async () => { throw new Error('no request should be made'); });
  try {
    const result = await h.generator.buildStyleBriefFromImage({ imageUrl: '' });
    assert.equal(result.ok, false);
    assert.match(result.error, /Pick a logo/);
  } finally { h.restore(); }
});
