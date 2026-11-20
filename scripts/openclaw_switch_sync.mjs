#!/usr/bin/env node
/**
 * `npm run openclaw:sync` — make OpenClaw on the Mini follow the AI provider
 * switch on Settings › APIs (SC-874, OpenClaw keys 3).
 *
 *   npm run openclaw:sync                       say what it would change, change nothing
 *   npm run openclaw:sync -- --check            change it if the switch moved, and post to the bus
 *                                               (the relay's ten-minute wake runs this)
 *   npm run openclaw:sync -- --check --dry-run  say what it WOULD change and post, do neither
 *
 * WHAT IT DOES. Reads the switch's row from production (Outreach's own order
 * once SC-872's feature groups give it one, the main order otherwise), turns
 * each switched-on provider into an OpenClaw model through
 * lib/openclawProviderMap.json, keeps only those whose key is in
 * ~/.openclaw/.env, and, when that differs from OpenClaw's primary model and
 * fallbacks, rewrites them in ~/.openclaw/openclaw.json and restarts the
 * gateway. The deciding rules are lib/openclawSwitchSync.js; this file only
 * reads, writes, restarts and posts.
 *
 * NO CHANGE, NO RESTART. A restart interrupts whatever OpenClaw is doing. So
 * it restarts only when the order really changed, and never while something
 * is talking to it: a live connection to the gateway's port means an outreach
 * pass is mid-task, and the change waits for the next wake (ten minutes).
 *
 * WHERE THE SWITCH COMES FROM. Production's database, read with Doppler prd's
 * address and key through the Mini's prd-scoped Doppler key ($HOME/Studio, the
 * same one scripts/install_openclaw.sh and scripts/ai_keys_check.mjs use),
 * held in memory only. No key VALUE is ever printed or written by this script:
 * it reads only which key NAMES ~/.openclaw/.env holds.
 *
 * WHO RUNS IT. Only the machine that owns the `openclaw` role in
 * lib/nodeRoles.js, because that is the only machine with an OpenClaw to set.
 *
 * Exit: 0 in step (or brought into step), 1 a switched-on provider had to be
 * left out (or none could be used), 2 CANNOT TELL (the switch or OpenClaw's
 * config could not be read). run_bus_relay.sh guards it with `|| true`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sync = require('../lib/openclawSwitchSync.js');
const providerStore = require('../lib/aiProviderSettingsStore.js');
const nodeRoles = require('../lib/nodeRoles.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const { AI_PROVIDERS } = require('../lib/aiClient.js');

const STATE_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG = path.join(STATE_DIR, 'openclaw.json');
const ENV_FILE = path.join(STATE_DIR, '.env');
const ORDER_FILE = path.join(STATE_DIR, 'starcaster-model-order.json');
const ALARM_FILE = path.join(heartbeat.heartbeatDir(), 'openclaw-switch-sync.json');
const LABEL = 'com.starcaster.openclaw';
const PORT = 18789;
const PRD_SCOPE = process.env.OPENCLAW_SYNC_DOPPLER_SCOPE || path.join(os.homedir(), 'Studio');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run') || !CHECK;

const say = (line) => console.log(`openclaw-sync: ${line}`);

function readPrd(name) {
  try {
    const value = execFileSync('doppler', [
      'secrets', 'get', name, '--plain', '--scope', PRD_SCOPE,
      '--project', 'starcaster', '--config', 'prd', '--no-check-version',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    return { value: String(value || '').trim() };
  } catch (err) {
    if (err?.code === 'ENOENT') return { unreadable: 'the doppler command is not on this machine' };
    return { unreadable: `Doppler prd could not be read from this machine (scope ${PRD_SCOPE})` };
  }
}

/** `{ settings }` or `{ readError }`. Never a fallback: an unreadable switch is CANNOT TELL. */
async function readSwitch() {
  const url = readPrd('SUPABASE_URL');
  const key = readPrd('SUPABASE_SERVICE_KEY');
  if (url.unreadable || key.unreadable) return { readError: url.unreadable || key.unreadable };
  if (!url.value || !key.value) return { readError: 'Doppler prd has no database address or key to read it with' };
  try {
    const table = process.env.SUPABASE_AI_PROVIDER_SETTINGS_TABLE || 'ai_provider_settings';
    const res = await fetch(`${url.value.replace(/\/+$/, '')}/rest/v1/${table}?select=*&id=eq.platform&limit=1`, {
      headers: { apikey: key.value, Authorization: `Bearer ${key.value}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { readError: `production answered HTTP ${res.status}` };
    const rows = await res.json();
    return { settings: providerStore.normaliseRow(Array.isArray(rows) ? rows[0] : null) };
  } catch (err) {
    return { readError: String(err?.message || err).slice(0, 160) };
  }
}

/** Is anything talking to the gateway right now? true / false / null (cannot tell). */
function gatewayBusy() {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:ESTABLISHED'], { encoding: 'utf8', timeout: 10000 });
  if (r.error) return null;
  // lsof exits 1 with no output when nothing matches.
  const rows = String(r.stdout || '').split('\n').slice(1).filter(Boolean);
  return rows.length > 0;
}

function restartGateway() {
  const uid = process.getuid();
  const r = spawnSync('launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return { ok: false, why: String(r.stderr || r.stdout || `launchctl exited ${r.status}`).trim().slice(0, 200) };
  for (let i = 0; i < 30; i += 1) {
    const l = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (String(l.stdout || '').trim()) return { ok: true };
    spawnSync('sleep', ['1']);
  }
  return { ok: false, why: `the gateway was restarted but nothing was listening on ${PORT} 30 seconds later` };
}

/** The record install_openclaw.sh reads, so installing again keeps the switch's order. */
function orderRecord(plan, map, at) {
  const keys = {};
  for (const p of Object.values(map.providers)) keys[p.model.split('/')[0]] = p.key;
  return { _about: 'Written by scripts/openclaw_switch_sync.mjs (SC-874): the order OpenClaw follows from the AI switch on Settings › APIs. scripts/install_openclaw.sh writes this order too.', primary: plan.primary, fallbacks: plan.fallbacks, keys, source: plan.source, at };
}

function writePrivate(file, text) {
  const tmp = `${file}.next.${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ── who runs it ──────────────────────────────────────────────────────────────
const role = nodeRoles.checkRole('openclaw');
const gate = sync.roleGate(role);
if (!gate.run) {
  for (const line of gate.lines) say(line);
  process.exit(gate.exitCode);
}

// ── read ─────────────────────────────────────────────────────────────────────
const map = sync.loadMap();
const labels = Object.fromEntries(Object.values(AI_PROVIDERS).map((p) => [p.id, p.label]));
let envText = '';
let config = null;
let localError = '';
try { envText = fs.readFileSync(ENV_FILE, 'utf8'); } catch { localError = `${ENV_FILE} could not be read`; }
try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (err) { localError = localError || `${CONFIG} could not be read (${String(err?.message || err).slice(0, 120)})`; }

const read = localError ? { readError: '' } : await readSwitch();
let plan = localError
  ? { verdict: 'CANNOT_TELL', why: `OpenClaw's own setup could not be read: ${localError}` }
  : sync.planModels({ readError: read.readError, settings: read.settings, keysPresent: sync.keyNamesIn(envText), map, labels });

const have = config ? sync.currentModels(config) : { primary: '', fallbacks: [] };
say(`OpenClaw is on ${sync.describeModels(have)}.`);
let change = '';
let changeFailed = false;
let waiting = '';

if (plan.verdict === 'CANNOT_TELL') {
  say(`CANNOT TELL: ${plan.why}. OpenClaw is left as it is.`);
} else if (plan.verdict === 'NOT_SAVED' || plan.verdict === 'NO_USABLE') {
  say(`${plan.why}. OpenClaw is left as it is.`);
} else {
  if (plan.note) say(plan.note);
  if (!sync.needsChange(config, plan)) {
    say(`in step with ${plan.source} on Settings › APIs; nothing to change, no restart.`);
  } else {
    const want = sync.describeModels(plan);
    const busy = gatewayBusy();
    if (DRY) {
      say(`WOULD change OpenClaw to ${want}, following ${plan.source} on Settings › APIs, and restart it${busy ? ' (once nothing is talking to it: something is right now)' : ''}. Dry run: nothing changed.`);
    } else if (busy !== false) {
      waiting = `the switch says ${want}, but ${busy === null ? 'whether anything is talking to OpenClaw cannot be told' : 'something is talking to OpenClaw right now (an outreach pass mid-task)'}, so the change waits for the next wake`;
      say(`${waiting}.`);
    } else {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
      fs.copyFileSync(CONFIG, `${CONFIG}.before-sync.${stamp}`);
      writePrivate(CONFIG, `${JSON.stringify(sync.withModels(config, plan), null, 2)}\n`);
      writePrivate(ORDER_FILE, `${JSON.stringify(orderRecord(plan, map, new Date().toISOString()), null, 2)}\n`);
      const restarted = restartGateway();
      if (restarted.ok) {
        change = `OpenClaw changed from ${sync.describeModels(have)} to ${want}, following ${plan.source} on Settings › APIs, and was restarted.`;
        say(change);
      } else {
        changeFailed = true;
        change = `OpenClaw's config was changed to ${want}, following ${plan.source} on Settings › APIs, but the restart did not take: ${restarted.why}. Check with scripts/install_openclaw.sh --status on the Mini.`;
        say(change);
      }
    }
  }
}
for (const p of plan.problems || []) say(`LEFT OUT: ${p.text}`);

// ── tell the bus ─────────────────────────────────────────────────────────────
if (CHECK) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(ALARM_FILE, 'utf8')) || {}; } catch { state = {}; }
  const decided = sync.planAlarms({ plan, state, waiting });
  if (!decided.post.length && !decided.cleared.length && !change) {
    if (!DRY && JSON.stringify(decided.next) !== JSON.stringify(state)) {
      fs.mkdirSync(path.dirname(ALARM_FILE), { recursive: true });
      fs.writeFileSync(ALARM_FILE, `${JSON.stringify(decided.next, null, 2)}\n`);
    }
  } else {
    const text = sync.renderMessage({ ...decided, change, node: role.node?.name });
    if (DRY) {
      console.log(`--- would post to the bus ---\n${text}\n--- (dry run: nothing sent) ---`);
    } else {
      try {
        require('./lib/clickup.cjs').postBusMessage(text);
        fs.mkdirSync(path.dirname(ALARM_FILE), { recursive: true });
        fs.writeFileSync(ALARM_FILE, `${JSON.stringify(decided.next, null, 2)}\n`);
        say('posted to the bus.');
      } catch (err) {
        // Not stamped, so the next wake says it again rather than going quiet.
        console.error(`openclaw-sync: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
      }
    }
  }
}

process.exit(changeFailed ? 1 : sync.exitCode(plan));
