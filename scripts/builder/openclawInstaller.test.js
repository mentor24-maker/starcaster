'use strict';

/**
 * OpenClaw's models and keys on the Mini (SC-871).
 *
 * On 2026-11-18 the Anthropic key ran out of credit and outreach posting
 * stopped, because scripts/install_openclaw.sh set OpenClaw up with one
 * Anthropic model and copied one key, once. The fix was made by hand on the
 * Mini. These hold the repository to it: the installer writes the committed
 * model list (OpenAI first, Anthropic as the backup), and refreshes every key
 * that list needs from Doppler on every run.
 *
 * The key tests source the real script and run its write_secrets against a
 * FAKE doppler in a throwaway HOME, so nothing here can touch the real
 * ~/.openclaw or reach a real secret.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'install_openclaw.sh');
const models = require('../../lib/openclawModels');

test('the committed list puts OpenAI first and Anthropic as the backup, each with its key', () => {
  const m = models.load();
  assert.equal(m.primary, 'openai/gpt-5.5');
  assert.deepEqual(m.fallbacks, ['anthropic/claude-sonnet-5-5']);
  assert.deepEqual(m.keysNeeded, ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
});

test('a list naming a provider with no key, or a malformed model, is refused', () => {
  assert.throws(() => models.validate({ primary: 'kimi/k2', fallbacks: [], keys: {} }), /needs a key.*kimi/);
  assert.throws(() => models.validate({ primary: 'gpt-5.5', fallbacks: [], keys: { openai: 'OPENAI_API_KEY' } }), /not provider\/model/);
  assert.throws(() => models.validate({ primary: 'openai/a', keys: { openai: 'OPENAI_API_KEY' } }), /fallbacks/);
  assert.throws(() => models.validate({ primary: 'openai/a', fallbacks: ['openai/a'], keys: { openai: 'OPENAI_API_KEY' } }), /twice/);
});

// A throwaway HOME, so a Mini where the sync has recorded an order (SC-874)
// does not make these read that order instead of the committed one.
function printConfig(home) {
  return JSON.parse(execFileSync('bash', [SCRIPT, '--print-config'], { encoding: 'utf8', env: { ...process.env, HOME: home } }));
}

test('the config the installer writes carries the list, and no allowlist that could block a fallback', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const config = printConfig(home);
  const m = models.load();
  assert.deepEqual(config.agents.defaults.model, { primary: m.primary, fallbacks: m.fallbacks });
  assert.equal(config.agents.defaults.modelPolicy, undefined);
  assert.equal(config.agents.defaults.models, undefined);
  // The token stays a reference, never a value.
  assert.equal(config.gateway.auth.token, '${OPENCLAW_GATEWAY_TOKEN}');
});

test('the installer no longer names a model of its own', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(src, /^MODEL=/m);
  assert.doesNotMatch(src, /(openai|anthropic)\/(gpt|claude)-/);
});

/** A throwaway HOME and a bin holding a fake doppler that serves `secrets`. */
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-installer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(bin, 'doppler'), `#!/usr/bin/env node
const args = process.argv.slice(2);
const secrets = JSON.parse(process.env.FAKE_DOPPLER_SECRETS || '{}');
if (args[0] !== 'secrets' || args[1] !== 'get' || !args.includes('prd')) process.exit(9);
const v = secrets[args[2]];
if (!v) { console.error('Doppler Error: Could not find requested secret: ' + args[2]); process.exit(1); }
process.stdout.write(v);
`, { mode: 0o755 });
  return { dir, bin, home, env: path.join(home, '.openclaw', '.env') };
}

function writeSecrets(box, secrets) {
  const r = spawnSync('bash', ['-c', `source ${JSON.stringify(SCRIPT)} && write_secrets`], {
    encoding: 'utf8',
    env: {
      PATH: `${box.bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: box.home,
      FAKE_DOPPLER_SECRETS: JSON.stringify(secrets),
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const backups = (box) => fs.readdirSync(path.dirname(box.env)).filter((f) => f.startsWith('.env.before-install.'));

test('every key is copied in, a rotated key replaces the old one, and a second run changes nothing', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(path.dirname(box.env), { recursive: true });
  fs.writeFileSync(box.env, 'OPENCLAW_GATEWAY_TOKEN=tok-planted\nANTHROPIC_API_KEY=old-anthropic\nREDDIT_THING=keep-me\n');

  let r = writeSecrets(box, { OPENAI_API_KEY: 'new-openai', ANTHROPIC_API_KEY: 'rotated-anthropic' });
  assert.equal(r.code, 0, r.out);
  const env = fs.readFileSync(box.env, 'utf8');
  assert.match(env, /^OPENAI_API_KEY=new-openai$/m);
  assert.match(env, /^ANTHROPIC_API_KEY=rotated-anthropic$/m);
  assert.doesNotMatch(env, /old-anthropic/);
  assert.match(env, /^OPENCLAW_GATEWAY_TOKEN=tok-planted$/m, 'the gateway token is kept, not regenerated');
  assert.match(env, /^REDDIT_THING=keep-me$/m, 'lines it does not manage are kept');
  assert.equal(fs.statSync(box.env).mode & 0o777, 0o600);
  assert.equal(backups(box).length, 1, 'the old file is kept before it is replaced');
  assert.doesNotMatch(r.out, /new-openai|rotated-anthropic|tok-planted/, 'no value is ever printed');

  r = writeSecrets(box, { OPENAI_API_KEY: 'new-openai', ANTHROPIC_API_KEY: 'rotated-anthropic' });
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(box.env, 'utf8'), env, 'a second run changes nothing');
  assert.equal(backups(box).length, 1, 'and makes no second backup');
  assert.match(r.out, /unchanged/);
});

test('a key Doppler cannot supply stops the run with its name, and nothing is half-written', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(path.dirname(box.env), { recursive: true });
  const before = 'OPENCLAW_GATEWAY_TOKEN=tok-planted\nANTHROPIC_API_KEY=old-anthropic\n';
  fs.writeFileSync(box.env, before);

  const r = writeSecrets(box, { OPENAI_API_KEY: 'new-openai' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Cannot fetch ANTHROPIC_API_KEY/);
  assert.equal(fs.readFileSync(box.env, 'utf8'), before, 'the file is exactly as it was');
  assert.deepEqual(backups(box), []);
  assert.deepEqual(fs.readdirSync(path.dirname(box.env)).filter((f) => f.startsWith('.env.next.')), [], 'no temporary file left behind');
});

test('a first install generates the gateway token and copies both keys', (t) => {
  const box = sandbox(t);
  const r = writeSecrets(box, { OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2' });
  assert.equal(r.code, 0, r.out);
  const env = fs.readFileSync(box.env, 'utf8');
  assert.match(env, /^OPENAI_API_KEY=k1$/m);
  assert.match(env, /^ANTHROPIC_API_KEY=k2$/m);
  assert.match(env, /^OPENCLAW_GATEWAY_TOKEN=[0-9a-f]{64}$/m);
});

test('the installer writes the order the AI switch sync last applied, so installing again does not undo it (SC-874)', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.openclaw'));
  fs.writeFileSync(path.join(home, '.openclaw', 'starcaster-model-order.json'), JSON.stringify({
    primary: 'anthropic/claude-sonnet-5-5', fallbacks: ['openai/gpt-5.5'],
    keys: { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' },
  }));
  assert.deepEqual(printConfig(home).agents.defaults.model, { primary: 'anthropic/claude-sonnet-5-5', fallbacks: ['openai/gpt-5.5'] });
});

test('keys for the other providers OpenClaw can use are copied when Doppler has them, and skipped when not (SC-874)', (t) => {
  const box = sandbox(t);
  let r = writeSecrets(box, { OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2', GEMINI_API_KEY: 'k3' });
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(box.env, 'utf8'), /^GEMINI_API_KEY=k3$/m);
  assert.equal(fs.statSync(box.env).mode & 0o777, 0o600);
  assert.doesNotMatch(r.out, /k3/);

  const box2 = sandbox(t);
  r = writeSecrets(box2, { OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(fs.readFileSync(box2.env, 'utf8'), /GEMINI_API_KEY/);
  assert.match(r.out, /GEMINI_API_KEY not in Doppler prd/);
});
