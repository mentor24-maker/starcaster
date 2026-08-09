'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { callClaude } = require('../../lib/themeWizardGenerator');

/**
 * These guard the reply-reading half of the generator: the cases where the API
 * answers HTTP 200 and the answer is still not usable. Each one used to look
 * like a different bug than it was, which is the whole reason they are here.
 */

/** Stub global.fetch with one canned Anthropic payload. */
function withResponse(payload, status = 200) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
  return () => { global.fetch = original; };
}

const SCHEMA = { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] };

const call = (extra = {}) => callClaude({
  model: 'claude-opus-5',
  system: 'system',
  prompt: 'prompt',
  schema: SCHEMA,
  maxTokens: 2000,
  apiKey: 'sk-test',
  ...extra,
});

test('a truncated answer is reported as running out of room, not as bad JSON', async () => {
  // Output size varies run to run for identical input, so this arrives as an
  // intermittent failure on a prompt that worked minutes earlier. "Not valid
  // JSON" sent the last investigation hunting for a malformed request that was
  // fine; the ceiling has to be named.
  const restore = withResponse({
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: '{"directions": [{"label": "Clay dust and har' }],
    usage: { output_tokens: 2000 },
  });
  try {
    const result = await call();
    assert.equal(result.ok, false);
    assert.match(result.error, /ran out of room/);
    assert.match(result.error, /2000-token limit/, 'the actual ceiling is named');
    assert.doesNotMatch(result.error, /not valid JSON/);
  } finally {
    restore();
  }
});

test('genuinely malformed JSON still says so', async () => {
  const restore = withResponse({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Sure! Here are three directions:' }],
  });
  try {
    const result = await call();
    assert.equal(result.ok, false);
    assert.match(result.error, /not valid JSON/);
  } finally {
    restore();
  }
});

test('a complete answer parses through', async () => {
  const restore = withResponse({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"ok":"yes"}' }],
    usage: { output_tokens: 12 },
    model: 'claude-opus-5',
  });
  try {
    const result = await call();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { ok: 'yes' });
  } finally {
    restore();
  }
});

test('a refusal is not read as content', async () => {
  // §6.6 — a refusal is HTTP 200 with empty content. Reading content[0]
  // without checking throws on a successful response.
  const restore = withResponse({ stop_reason: 'refusal', stop_details: { category: 'other' }, content: [] });
  try {
    const result = await call();
    assert.equal(result.ok, false);
    assert.match(result.error, /declined/);
  } finally {
    restore();
  }
});

test('prose callers are not held to the JSON rules', async () => {
  // The web-fetch adapter reads a page and returns prose; a truncated
  // description is degraded but still usable, and it is normalised by a second
  // schema'd call afterwards.
  const restore = withResponse({
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: 'A tennis club in Delray Beach that' }],
  });
  try {
    const result = await callClaude({
      model: 'claude-opus-5',
      system: 'system',
      prompt: 'prompt',
      expectText: true,
      apiKey: 'sk-test',
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /Delray Beach/);
  } finally {
    restore();
  }
});
