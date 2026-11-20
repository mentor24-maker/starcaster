'use strict';

/**
 * OpenClaw follows the AI provider switch (SC-874, OpenClaw keys 3).
 *
 * Dane, 2026-11-18: "We need to set up Openclaw so we can point it at any
 * active API in the system." These hold lib/openclawSwitchSync.js to the
 * ticket's acceptance criteria: a changed order changes OpenClaw's primary
 * model, an unchanged one changes (and restarts) nothing, a provider with no
 * key is left out and NAMED, and an unreadable switch is CANNOT TELL with
 * OpenClaw left alone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sync = require('../../lib/openclawSwitchSync');
const models = require('../../lib/openclawModels');
const store = require('../../lib/aiProviderSettingsStore');

const KEYS = new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
const row = (providers, extra = {}) => store.normaliseRow({ id: 'platform', providers, custom_providers: [], ...extra });
const p = (id, enabled = true) => ({ id, enabled, fast: 'f', strong: 's' });
const openclawConfig = (primary, fallbacks) => ({
  gateway: { port: 18789 },
  meta: { addedBy: 'openclaw itself' },
  agents: { defaults: { model: { primary, fallbacks }, models: { [primary]: {} } } },
});

test('the committed map gives every provider OpenClaw can use a model and a key, and names why Kimi is not one', () => {
  const map = sync.loadMap();
  assert.deepEqual(Object.keys(map.providers).sort(), ['anthropic', 'gemini', 'openai']);
  assert.equal(map.providers.openai.model, 'openai/gpt-5.5');
  assert.equal(map.providers.anthropic.model, 'anthropic/claude-sonnet-5-5');
  assert.match(map.unsupported.kimi, /Moonshot/);
  // The installer's default list must be reachable from the map, or a synced order and a fresh install disagree.
  for (const ref of models.load().order) {
    assert.ok(Object.values(map.providers).some((m) => m.model === ref), `${ref} is in lib/openclawModels.json but not the map`);
  }
});

test('Anthropic first on the switch puts Anthropic first in OpenClaw; OpenAI first puts it back', () => {
  let plan = sync.planModels({ settings: row([p('anthropic'), p('openai'), p('gemini', false), p('kimi', false)]), keysPresent: KEYS });
  assert.equal(plan.verdict, 'ORDER');
  assert.equal(plan.primary, 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(plan.fallbacks, ['openai/gpt-5.5']);
  assert.deepEqual(plan.problems, []);
  assert.equal(sync.needsChange(openclawConfig('openai/gpt-5.5', ['anthropic/claude-sonnet-5-5']), plan), true);

  plan = sync.planModels({ settings: row([p('openai'), p('anthropic'), p('gemini', false), p('kimi', false)]), keysPresent: KEYS });
  assert.equal(plan.primary, 'openai/gpt-5.5');
  assert.equal(sync.exitCode(plan), 0);
});

test('no change on the switch means no change to OpenClaw, so no restart', () => {
  const plan = sync.planModels({ settings: row([p('openai'), p('anthropic'), p('gemini', false), p('kimi', false)]), keysPresent: KEYS });
  assert.equal(sync.needsChange(openclawConfig('openai/gpt-5.5', ['anthropic/claude-sonnet-5-5']), plan), false);
});

test('an allowlist that could block a fallback counts as a change, and the rewrite drops it', () => {
  const plan = sync.planModels({ settings: row([p('openai'), p('anthropic')]), keysPresent: KEYS });
  const cfg = openclawConfig('openai/gpt-5.5', ['anthropic/claude-sonnet-5-5']);
  cfg.agents.defaults.modelPolicy = { allow: ['openai/gpt-5.5'] };
  assert.equal(sync.needsChange(cfg, plan), true);
  assert.equal(sync.withModels(cfg, plan).agents.defaults.modelPolicy.allow, undefined);
});

test('the rewrite changes the models and nothing else in OpenClaw\'s file', () => {
  const plan = sync.planModels({ settings: row([p('anthropic'), p('openai')]), keysPresent: KEYS });
  const cfg = openclawConfig('openai/gpt-5.5', ['anthropic/claude-sonnet-5-5']);
  const next = sync.withModels(cfg, plan);
  assert.deepEqual(next.agents.defaults.model, { primary: 'anthropic/claude-sonnet-5-5', fallbacks: ['openai/gpt-5.5'] });
  assert.deepEqual(next.meta, cfg.meta);
  assert.deepEqual(next.gateway, cfg.gateway);
  assert.deepEqual(next.agents.defaults.models, cfg.agents.defaults.models);
  assert.equal(cfg.agents.defaults.model.primary, 'openai/gpt-5.5', 'the original is not mutated');
});

test('a switched-on provider with no key on the Mini is left out AND named, and OpenClaw keeps a working order', () => {
  const plan = sync.planModels({ settings: row([p('gemini'), p('openai'), p('anthropic')]), keysPresent: KEYS, labels: { gemini: 'Google Gemini' } });
  assert.equal(plan.verdict, 'ORDER');
  assert.equal(plan.primary, 'openai/gpt-5.5', 'the order skips the keyless provider rather than breaking');
  assert.equal(plan.problems.length, 1);
  assert.equal(plan.problems[0].id, 'no-key:gemini');
  assert.match(plan.problems[0].text, /Google Gemini.*GEMINI_API_KEY/);
  assert.equal(sync.exitCode(plan), 1);

  const alarms = sync.planAlarms({ plan, state: {}, now: Date.parse('2026-11-19T10:00:00Z') });
  assert.equal(alarms.post.length, 1);
  assert.match(sync.renderMessage({ ...alarms, node: 'mac-mini' }), /Google Gemini/);
});

test('a provider OpenClaw has no model for (Kimi, an added service) is named, not silently skipped', () => {
  const settings = store.normaliseRow({
    id: 'platform',
    providers: [p('kimi'), p('custom-groq'), p('openai')],
    custom_providers: [{ id: 'custom-groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'AI_SERVICE_GROQ_API_KEY' }],
  });
  const plan = sync.planModels({ settings, keysPresent: KEYS, labels: { kimi: 'Kimi' } });
  assert.equal(plan.primary, 'openai/gpt-5.5');
  assert.deepEqual(plan.problems.map((x) => x.id), ['no-model:kimi', 'no-model:custom-groq']);
  assert.match(plan.problems[0].text, /Kimi.*Moonshot plugin/);
  assert.match(plan.problems[1].text, /Groq/);
});

test('nothing usable leaves OpenClaw as it is, and says so', () => {
  const plan = sync.planModels({ settings: row([p('gemini'), p('openai', false)]), keysPresent: KEYS });
  assert.equal(plan.verdict, 'NO_USABLE');
  assert.equal(sync.needsChange(openclawConfig('openai/gpt-5.5', []), plan), false);
  assert.equal(sync.exitCode(plan), 1);
  const alarms = sync.planAlarms({ plan, state: {} });
  assert.ok(alarms.post.some((t) => /cannot follow the AI switch/.test(t)));
});

test('an unreadable switch is CANNOT TELL, changes nothing, and reaches the bus only after an hour', () => {
  const plan = sync.planModels({ readError: 'production answered HTTP 503', keysPresent: KEYS });
  assert.equal(plan.verdict, 'CANNOT_TELL');
  assert.equal(sync.exitCode(plan), 2);
  assert.equal(sync.needsChange(openclawConfig('openai/gpt-5.5', []), plan), false);

  const t0 = Date.parse('2026-11-19T10:00:00Z');
  let a = sync.planAlarms({ plan, state: {}, now: t0 });
  assert.deepEqual(a.post, [], 'a passing blip is not an alarm');
  a = sync.planAlarms({ plan, state: a.next, now: t0 + 61 * 60 * 1000 });
  assert.equal(a.post.length, 1);
  assert.match(a.post[0], /CANNOT TELL.*HTTP 503/);
  // While blind, an open key finding is not cleared: blindness says nothing about it.
  const withKey = { ...a.next, open: { ...a.next.open, 'no-key:gemini': { text: 'x', postedAt: new Date(t0).toISOString() } } };
  a = sync.planAlarms({ plan, state: withKey, now: t0 + 62 * 60 * 1000 });
  assert.deepEqual(a.cleared, []);
  assert.ok(a.next.open['no-key:gemini']);
});

test('a finding posts once, repeats every six hours, and clears once', () => {
  const bad = sync.planModels({ settings: row([p('gemini'), p('openai')]), keysPresent: KEYS });
  const t0 = Date.parse('2026-11-19T10:00:00Z');
  let a = sync.planAlarms({ plan: bad, state: {}, now: t0 });
  assert.equal(a.post.length, 1);
  a = sync.planAlarms({ plan: bad, state: a.next, now: t0 + 10 * 60 * 1000 });
  assert.equal(a.post.length, 0, 'not every ten minutes');
  a = sync.planAlarms({ plan: bad, state: a.next, now: t0 + 6 * 60 * 60 * 1000 });
  assert.equal(a.post.length, 1, 'again after six hours');
  const good = sync.planModels({ settings: row([p('gemini'), p('openai')]), keysPresent: new Set([...KEYS, 'GEMINI_API_KEY']) });
  a = sync.planAlarms({ plan: good, state: a.next, now: t0 + 7 * 60 * 60 * 1000 });
  assert.equal(a.cleared.length, 1);
  assert.match(a.cleared[0], /^Cleared:/);
  a = sync.planAlarms({ plan: good, state: a.next, now: t0 + 8 * 60 * 60 * 1000 });
  assert.deepEqual([a.post, a.cleared], [[], []], 'and stays quiet');
});

test('a change put off because OpenClaw is busy is normal for a while, and an alarm after an hour', () => {
  const plan = sync.planModels({ settings: row([p('anthropic'), p('openai')]), keysPresent: KEYS });
  const t0 = Date.parse('2026-11-19T10:00:00Z');
  let a = sync.planAlarms({ plan, state: {}, now: t0, waiting: 'something is talking to OpenClaw' });
  assert.deepEqual(a.post, []);
  a = sync.planAlarms({ plan, state: a.next, now: t0 + 61 * 60 * 1000, waiting: 'something is talking to OpenClaw' });
  assert.equal(a.post.length, 1);
  assert.match(a.post[0], /has not followed the AI switch since/);
  a = sync.planAlarms({ plan, state: a.next, now: t0 + 70 * 60 * 1000 });
  assert.equal(a.cleared.length, 1, 'clears once the change has gone through');
  assert.equal(a.next.waitingSince, null);
});

test('Outreach\'s own order wins once SC-872 gives it one; otherwise the main order', () => {
  const main = [p('openai'), p('anthropic')];
  const settings = { ...row(main), groupOrders: { outreach: [p('anthropic'), p('openai')] }, groupErrors: {} };
  let plan = sync.planModels({ settings, keysPresent: KEYS });
  assert.equal(plan.primary, 'anthropic/claude-sonnet-5-5');
  assert.equal(plan.source, "Outreach's own order");

  plan = sync.planModels({ settings: { ...row(main), groupOrders: {}, groupErrors: { outreach: 'not a list' } }, keysPresent: KEYS });
  assert.equal(plan.primary, 'openai/gpt-5.5');
  assert.equal(plan.source, 'the main order');
  assert.match(plan.note, /could not be read/);

  plan = sync.planModels({ settings: { ...row(main), groupOrders: { outreach: [p('anthropic', false)] } }, keysPresent: KEYS });
  assert.equal(plan.source, 'the main order');
});

test('nothing saved on Settings › APIs yet means nothing to follow: OpenClaw keeps its order', () => {
  const plan = sync.planModels({ settings: store.normaliseRow(null), keysPresent: KEYS });
  assert.equal(plan.verdict, 'NOT_SAVED');
  assert.equal(sync.exitCode(plan), 0);
});

test('key names are read from the env file, never values, and an empty key is not a key', () => {
  const names = sync.keyNamesIn('OPENAI_API_KEY=sk-x\nexport ANTHROPIC_API_KEY="y"\nGEMINI_API_KEY=\n# COMMENT=1\n');
  assert.deepEqual([...names].sort(), ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
});

test('the installer follows what the sync last applied, and falls back to the committed list when it cannot', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'starcaster-model-order.json');

  assert.equal(models.loadEffective({ overrideFile: file }).source, 'committed');

  fs.writeFileSync(file, JSON.stringify({
    primary: 'anthropic/claude-sonnet-5-5', fallbacks: ['openai/gpt-5.5'],
    keys: { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY' },
  }));
  const m = models.loadEffective({ overrideFile: file });
  assert.equal(m.source, 'switch');
  assert.equal(m.primary, 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(m.keysNeeded, ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);

  fs.writeFileSync(file, '{"primary": "not-a-model"');
  const broken = models.loadEffective({ overrideFile: file });
  assert.equal(broken.source, 'committed');
  assert.equal(broken.primary, models.load().primary);
  assert.match(broken.overrideNote, /could not be used/);
});

test('the sync runs on the relay\'s wake, never fails it, and is gated on the openclaw role', () => {
  const root = path.join(__dirname, '..', '..');
  const relay = fs.readFileSync(path.join(root, 'scripts', 'run_bus_relay.sh'), 'utf8');
  assert.match(relay, /^npm run --silent openclaw:sync -- --check \|\| true$/m);
  const src = fs.readFileSync(path.join(root, 'scripts', 'openclaw_switch_sync.mjs'), 'utf8');
  assert.match(src, /checkRole\('openclaw'\)/);
  // A change waits while anything is talking to the gateway.
  assert.match(src, /busy !== false/);
});

test('a machine that cannot tell which node it is says CANNOT TELL out loud, never "another machine\'s job"', () => {
  const nodeRoles = require('../../lib/nodeRoles');
  // The Mini having lost its ~/.alphire-node file: owner is still mac-mini.
  const lost = nodeRoles.checkRole('openclaw', { node: { name: 'stranger', source: 'file', file: '/x/.alphire-node' } });
  assert.equal(lost.verdict, 'unidentified');
  const gate = sync.roleGate(lost);
  assert.equal(gate.run, false);
  assert.equal(gate.exitCode, 2);
  assert.match(gate.lines[0], /CANNOT TELL/);
  assert.ok(!gate.lines.some((l) => /not this machine's job/.test(l)));
  assert.ok(gate.lines.some((l) => /not been told which node it is/.test(l)));

  const unknown = sync.roleGate(nodeRoles.checkRole('no-such-role', { node: { name: 'mac-mini', source: 'file', file: '/x' } }));
  assert.deepEqual([unknown.run, unknown.exitCode], [false, 2]);

  // Only a real other owner is a quiet skip.
  const other = sync.roleGate({ owned: false, verdict: 'other-node', owner: 'mac-mini', message: 'm' });
  assert.deepEqual([other.run, other.exitCode], [false, 0]);
  assert.match(other.lines[0], /not this machine's job/);
  assert.equal(sync.roleGate({ owned: true, verdict: 'owned' }).run, true);
});

test('the pass itself, on a machine with an unrecognised name, exits 2 and changes nothing', () => {
  const { spawnSync } = require('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sync-unidentified-'));
  try {
    fs.writeFileSync(path.join(home, '.alphire-node'), 'stranger\n');
    const script = path.join(__dirname, '..', 'openclaw_switch_sync.mjs');
    const res = spawnSync(process.execPath, [script, '--check'], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 30000 });
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stdout, /CANNOT TELL/);
    assert.doesNotMatch(res.stdout, /not this machine's job/);
    assert.ok(!fs.existsSync(path.join(home, '.openclaw')), 'nothing written for OpenClaw');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
