'use strict';

/**
 * Every OpenClaw request is its own conversation (task 86bcvhy8c). A fixed
 * `user` label makes OpenClaw continue one session across requests, and the
 * sign-in check's grew past 380 messages, emptying the Anthropic account on
 * Oct 29 and 30, 2026. The label is made unique per request in the client.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../../lib/openclawResponsesClient.js');

async function captureBodies(requests) {
  const saved = {
    fetch: global.fetch,
    url: process.env.OPENCLAW_BASE_URL,
    key: process.env.OPENCLAW_API_KEY,
  };
  const bodies = [];
  process.env.OPENCLAW_BASE_URL = 'http://127.0.0.1:18789';
  process.env.OPENCLAW_API_KEY = 'test-token';
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: 'OK' }) };
  };
  try {
    for (const request of requests) {
      // eslint-disable-next-line no-await-in-loop
      const res = await client.callOpenClawResponses(request);
      assert.equal(res.ok, true);
    }
  } finally {
    global.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.OPENCLAW_BASE_URL; else process.env.OPENCLAW_BASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.OPENCLAW_API_KEY; else process.env.OPENCLAW_API_KEY = saved.key;
  }
  return bodies;
}

test('two requests with the same label never share a session', async () => {
  const request = { user: 'starcaster:openclaw-smoke', input: 'Is the browser signed in?' };
  const [first, second] = await captureBodies([request, request]);
  assert.notEqual(first.user, second.user);
  // The job's name survives, so the Mini's log still says who asked.
  assert.match(first.user, /^starcaster:openclaw-smoke:[0-9a-f]{8}$/);
  assert.match(second.user, /^starcaster:openclaw-smoke:[0-9a-f]{8}$/);
});

test('a request with no label sends none, which OpenClaw already treats as fresh', async () => {
  const [body] = await captureBodies([{ input: 'Reply OK.' }]);
  assert.equal('user' in body, false);
});

test('the sign-in check runs every six hours and calls a reading stale after seven', () => {
  const signIn = require('../../lib/openclawSignIn.js');
  const health = require('../../workers/youtube-outreach/health.js');
  assert.equal(signIn.CHECK_EVERY_MS, 6 * 60 * 60 * 1000);
  assert.equal(health.CHECK_EVERY_MS, signIn.CHECK_EVERY_MS);
  assert.equal(signIn.MINI_STALE_MS, 7 * 60 * 60 * 1000);
  assert.equal(require('../../lib/outreachOverview.js').MINI_STALE_MS, signIn.MINI_STALE_MS);
  assert.equal(require('../../lib/redditCommentsStore.js').MINI_STALE_MS, signIn.MINI_STALE_MS);
});
