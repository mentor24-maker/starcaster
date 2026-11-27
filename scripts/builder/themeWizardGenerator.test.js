'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const generator = require('../../lib/themeWizardGenerator');
const { fakeDoor, anthropicSays, openaiSays, ANTHROPIC_OUT_OF_CREDIT } = require('./fixtures/themeWizardDoor');

const { callModel } = generator;

/**
 * These guard the reply-reading half of the generator: the cases where a
 * provider answers HTTP 200 and the answer is still not usable. Each one used
 * to look like a different bug than it was, which is the whole reason they are
 * here. Since SC-898 every call goes through the AI door, so the replies are
 * fed to the real door and read back through it.
 */

const SCHEMA = { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] };

const call = (extra = {}) => callModel({ system: 'system', prompt: 'prompt', schema: SCHEMA, maxTokens: 2000, ...extra });

test('a truncated answer is reported as running out of room, not as bad JSON', async (t) => {
  // Output size varies run to run for identical input, so this arrives as an
  // intermittent failure on a prompt that worked minutes earlier. "Not valid
  // JSON" sent the last investigation hunting for a malformed request that was
  // fine; the ceiling has to be named.
  const door = fakeDoor({ answer: () => anthropicSays('{"directions": [{"label": "Clay dust and har', 'max_tokens') });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, false);
  assert.match(result.error, /ran out of room/);
  assert.match(result.error, /2000-token limit/, 'the actual ceiling is named');
  assert.doesNotMatch(result.error, /not valid JSON/);
});

test('a truncated answer from OpenAI reads the same way', async (t) => {
  const door = fakeDoor({ order: ['openai'], answer: () => openaiSays('{"ok": "ye', 'length') });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, false);
  assert.match(result.error, /^OpenAI ran out of room/);
});

test('genuinely malformed JSON still says so', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays('Sure! Here are three directions:') });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/);
});

test('a complete answer parses through and says who made it', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays('{"ok":"yes"}') });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.data, { ok: 'yes' });
  assert.equal(result.providerLabel, 'Anthropic');
  assert.equal(generator.sumUsage(result.usage), 120);
  assert.equal(door.usage[0].feature, 'theme_wizard', 'the spend is metered under the same name as before');
});

test('a refusal is not read as content', async (t) => {
  // §6.6 — a refusal is HTTP 200 with empty content. Reading content[0]
  // without checking throws on a successful response.
  const door = fakeDoor({ answer: () => anthropicSays(null, 'refusal', { stop_details: { category: 'other' } }) });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.error, /declined/);
  assert.match(result.error, /Nothing was saved/);
});

test('prose callers are not held to the JSON rules', async (t) => {
  // The page-reading adapter returns prose; a truncated description is
  // degraded but still usable, and it is normalised by a second schema'd call.
  const door = fakeDoor({ answer: () => anthropicSays('A tennis club in Delray Beach that', 'max_tokens') });
  t.after(door.restore);
  const result = await callModel({ system: 'system', prompt: 'prompt' });
  assert.equal(result.ok, true, result.error);
  assert.match(result.text, /Delray Beach/);
});

// ── Dane's pick on SC-898: B, whichever provider is first ─────────────────────

test('with Anthropic out of credit, a candidate still comes back, from the next provider', async (t) => {
  const door = fakeDoor({
    order: ['anthropic', 'openai'],
    answer: (def) => (def.id === 'anthropic' ? ANTHROPIC_OUT_OF_CREDIT : openaiSays('{"ok":"yes"}')),
  });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.data, { ok: 'yes' });
  assert.equal(result.provider, 'openai');
  assert.deepEqual(door.sent.map((s) => s.provider), ['anthropic', 'openai'], 'Anthropic was asked first and passed over');
});

test('with OpenAI first, Anthropic is never asked at all', async (t) => {
  const door = fakeDoor({ order: ['openai', 'anthropic'], answer: () => openaiSays('{"ok":"yes"}') });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(door.sent.map((s) => s.provider), ['openai']);
  assert.equal(door.sent[0].body.response_format.type, 'json_schema', 'OpenAI holds the answer to the schema itself');
  assert.equal(door.sent[0].body.model, 'gpt-5.5', 'the strong tier, not a model the wizard names');
});

test('with every provider out of credit, the wizard says so plainly and names each one', async (t) => {
  const door = fakeDoor({
    order: ['anthropic', 'openai'],
    answer: (def) => (def.id === 'anthropic' ? ANTHROPIC_OUT_OF_CREDIT
      : { status: 429, json: { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota.' } } }),
  });
  t.after(door.restore);
  const result = await call();
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /No AI provider could make the designs/);
  assert.match(result.error, /Anthropic is out of credit/);
  assert.match(result.error, /OpenAI is out of credit/);
  assert.match(result.error, /Settings › APIs › AI provider/);
});
