'use strict';

/**
 * `npm run ai-keys` checks every key OpenClaw holds and names its model
 * (SC-873). Until then it read only ANTHROPIC_API_KEY, while SC-871 had made
 * OpenAI the key OpenClaw actually spends from.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { openclawReport, exitCode, comparePairs, liveModels } = require('../../lib/openclawKeys');
const openclawModels = require('../../lib/openclawModels');
const aiKeys = require('../../lib/aiKeys');

const COMMITTED = openclawModels.load();
const KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const config = (model) => JSON.stringify({ agents: { defaults: { model } } });
const MATCHING = config({ primary: COMMITTED.primary, fallbacks: COMMITTED.fallbacks });
const SECRET_A = 'sk-ant-SECRETVALUE-aaaa';
const SECRET_O = 'sk-proj-SECRETVALUE-oooo';
const ENV = `OPENCLAW_GATEWAY_TOKEN=gw-SECRETVALUE\nANTHROPIC_API_KEY=${SECRET_A}\nexport OPENAI_API_KEY="${SECRET_O}"\n`;

const report = (over = {}) => openclawReport({
  envText: ENV, configText: MATCHING, committed: COMMITTED, committedKeys: KEYS, ...over,
});
const allText = (r) => [r.model, ...r.findings, ...r.blind, ...r.entries.map((e) => `${e.place} ${e.job} ${e.source} ${e.unreadable || ''}`)].join('\n');

test('one entry per OpenClaw key, OpenAI and Anthropic, each read from the .env', () => {
  const r = report();
  assert.deepEqual(r.entries.map((e) => e.id), ['openclaw-openai', 'openclaw-anthropic']);
  assert.equal(r.entries[0].key, SECRET_O);
  assert.equal(r.entries[1].key, SECRET_A);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.blind, []);
  assert.equal(exitCode(0, r), 0);
});

test('names the primary model and its fallbacks', () => {
  assert.match(report().model, /^OpenClaw model: openai\/gpt-5\.5 \(fallback anthropic\/claude-sonnet-5-5\)/);
  assert.deepEqual(liveModels(config('openai/gpt-5.5')), { primary: 'openai/gpt-5.5', fallbacks: [] });
});

test('no key value ever reaches the text, and the printed rows show fingerprints only', async () => {
  const r = report();
  assert.doesNotMatch(allText(r), /SECRETVALUE/);
  const rows = await aiKeys.checkKeys(r.entries, { probe: async () => ({ status: 200, body: {}, account: '' }) });
  const printed = rows.map((row) => aiKeys.rowLine(row)).join('\n');
  assert.doesNotMatch(printed, /SECRETVALUE/);
  assert.deepEqual(rows.map((row) => row.verdict), [aiKeys.VERDICT.WORKS, aiKeys.VERDICT.WORKS]);
});

test('a key the model list needs but the .env lacks is reported missing, never skipped', async () => {
  const r = report({ envText: `ANTHROPIC_API_KEY=${SECRET_A}\n` });
  const openai = r.entries.find((e) => e.id === 'openclaw-openai');
  assert.ok(openai, 'the OpenAI row was skipped');
  assert.equal(openai.key, '');
  assert.match(r.findings.join('\n'), /MISSING: .*openai.*OPENAI_API_KEY/);
  const rows = await aiKeys.checkKeys(r.entries, { probe: async () => ({ status: 200, body: {} }) });
  assert.equal(rows.find((row) => row.id === 'openclaw-openai').verdict, aiKeys.VERDICT.NOT_SET);
  assert.equal(exitCode(aiKeys.exitCode(rows), r), 1);
});

test('a Mini whose model differs from the committed list is a DRIFT finding', () => {
  const r = report({ configText: config({ primary: 'anthropic/claude-sonnet-5-5', fallbacks: [] }) });
  assert.match(r.findings.join('\n'), /DRIFT: .*anthropic\/claude-sonnet-5-5 \(no fallback\).*openai\/gpt-5\.5/);
  assert.equal(exitCode(0, r), 1);
});

test('a file it cannot read is CANNOT TELL, never a pass', async () => {
  const noEnv = report({ envText: null, envError: '/x/.env could not be read (EACCES)' });
  assert.equal(noEnv.entries.length, 2, 'every provider the list needs still gets a row');
  const rows = await aiKeys.checkKeys(noEnv.entries, { probe: async () => assert.fail('nothing to probe') });
  assert.ok(rows.every((row) => row.verdict === aiKeys.VERDICT.CANNOT_TELL));
  assert.equal(exitCode(aiKeys.exitCode(rows), noEnv), 2);

  const noConfig = report({ configText: null, configError: '/x/openclaw.json could not be read (ENOENT)' });
  assert.equal(noConfig.model, null);
  assert.match(noConfig.blind.join('\n'), /OpenClaw model: CANNOT TELL/);
  assert.equal(exitCode(0, noConfig), 2);

  const badConfig = report({ configText: '{ not json' });
  assert.match(badConfig.blind.join('\n'), /CANNOT TELL/);

  const noList = report({ committed: { unreadable: 'gone' } });
  assert.match(noList.blind.join('\n'), /matches the repo: CANNOT TELL/);
  // A finding still outranks a blind spot.
  assert.equal(exitCode(1, noList), 1);
});

test('another provider key in the .env is checked too, marked as not in the model list', () => {
  const r = report({ envText: `${ENV}GEMINI_API_KEY=g-SECRETVALUE\n` });
  const gemini = r.entries.find((e) => e.id === 'openclaw-gemini');
  assert.ok(gemini);
  assert.match(gemini.job, /not in OpenClaw's model list/);
});

test('each OpenClaw key is compared with the website key for the same provider', () => {
  assert.deepEqual(comparePairs(report().entries), [['website-openai', 'openclaw-openai'], ['website-anthropic', 'openclaw-anthropic']]);
});
