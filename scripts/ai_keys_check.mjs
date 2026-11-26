#!/usr/bin/env node
/**
 * `npm run ai-keys` — every AI key Starcaster and the Mini use, which account
 * each one bills, and whether it works right now (ticket 86bcvhfht). Since
 * SC-848 the website's keys are every provider on the AI switch, in the order
 * Settings › APIs saved, Kimi and any added service included. One provider
 * dry while another works is a notice; none able to answer is an `ALARM:`.
 *
 * The why, the readings and the alarm rule are in lib/aiKeys.js; this file
 * only gathers the keys, keeps the alarm state and posts.
 *
 *   npm run ai-keys                        check and print, write nothing
 *   npm run ai-keys -- --check             the same, and post to the bus when a key is OUT OF CREDIT or INVALID,
 *                                          or has read CANNOT TELL for over an hour; an ALARM (texted) when
 *                                          no switched-on provider can answer
 *   npm run ai-keys -- --check --dry-run   say what it WOULD post, send nothing, stamp nothing
 *
 * WHERE THE KEYS COME FROM. No value is ever printed — fingerprints only.
 *   The website's keys: Doppler `prd`, the config Vercel is built from, read
 *     with the Mini's prd-scoped Doppler key ($HOME/Studio, the same one
 *     scripts/install_openclaw.sh uses; AI_KEYS_DOPPLER_SCOPE overrides it).
 *     A machine with no prd access reports those rows CANNOT TELL — never a pass.
 *     A Settings › APIs override lives in the deployment, not here, so the
 *     panel under Settings › APIs is where that one is checked.
 *   The Mini's OpenClaw keys: every provider key in ~/.openclaw/.env, which
 *     OpenClaw reads itself, plus the model it is set to from
 *     ~/.openclaw/openclaw.json, compared with lib/openclawModels.json (SC-873).
 *
 * WHO POSTS. The keys are the same wherever this runs, so two machines posting
 * would say everything twice. Only the machine that owns `bus-relay` posts;
 * the other prints its reading and stops. That machine going dark is the
 * heartbeat's to report.
 *
 * Exit: 0 every key works, 1 a key is OUT OF CREDIT or INVALID, or the Mini's
 * OpenClaw has drifted from the repo or lacks a key its model list needs,
 * 2 a reading could not be taken. 1 outranks 2. run_bus_relay.sh guards the call with `|| true` — a
 * finding about a key is not this script's failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const aiKeys = require('../lib/aiKeys.js');
const providerStore = require('../lib/aiProviderSettingsStore.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const openclawModels = require('../lib/openclawModels.js');
const openclawKeys = require('../lib/openclawKeys.js');

const STATE_FILE = path.join(heartbeat.heartbeatDir(), 'ai-keys-alarms.json');
const OPENCLAW_DIR = process.env.AI_KEYS_OPENCLAW_DIR || path.join(os.homedir(), '.openclaw');
const OPENCLAW_ENV = path.join(OPENCLAW_DIR, '.env');
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
const PRD_SCOPE = process.env.AI_KEYS_DOPPLER_SCOPE || path.join(os.homedir(), 'Studio');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run');

/** One secret from Doppler prd, held in memory only. '' when it is simply not set. */
function readPrd(name) {
  try {
    const value = execFileSync('doppler', [
      'secrets', 'get', name, '--plain', '--scope', PRD_SCOPE,
      '--project', 'starcaster', '--config', 'prd', '--no-check-version',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    return { key: String(value || '').trim() };
  } catch (err) {
    const said = String(err?.stderr || err?.message || '');
    // Doppler's own wording for a secret that does not exist in the config.
    if (/could not find requested secret|not found/i.test(said)) return { key: '' };
    if (err?.code === 'ENOENT') return { unreadable: 'the doppler command is not on this machine, so Doppler prd could not be read' };
    return { unreadable: `could not read Doppler prd from this machine (scope ${PRD_SCOPE})` };
  }
}

/** A file's text, or { error } saying why it could not be read. Never printed. */
function readText(file) {
  try { return { text: fs.readFileSync(file, 'utf8') }; } catch (err) {
    return { error: `${file} could not be read (${err?.code || 'error'})`, missing: err?.code === 'ENOENT' };
  }
}

/** The committed model list (SC-871), or { unreadable }. */
function readCommittedModels() {
  try {
    const list = openclawModels.load();
    const raw = JSON.parse(fs.readFileSync(openclawModels.FILE, 'utf8'));
    return { list, keys: raw.keys || {} };
  } catch (err) {
    return { list: { unreadable: String(err?.message || err).slice(0, 160) }, keys: {} };
  }
}

/**
 * The switch's order as production has it (SC-848). The Settings › APIs row
 * lives in the production database, and this machine's own settings point at
 * its local copy, so the row is read from Doppler prd's database address with
 * prd's key, held in memory only. When that cannot be read, the order falls
 * back to prd's AI_PROVIDER_ORDER exactly as the door does, and says so.
 */
async function readProductionOrder() {
  const url = readPrd('SUPABASE_URL');
  const key = readPrd('SUPABASE_SERVICE_KEY');
  let settings = null;
  let fallbackReason = '';
  if (url.unreadable || key.unreadable) {
    fallbackReason = url.unreadable || key.unreadable;
  } else if (!url.key || !key.key) {
    fallbackReason = 'Doppler prd has no database address or key to read the saved order with';
  } else {
    try {
      const table = process.env.SUPABASE_AI_PROVIDER_SETTINGS_TABLE || 'ai_provider_settings';
      const res = await fetch(`${url.key.replace(/\/+$/, '')}/rest/v1/${table}?select=*&id=eq.platform&limit=1`, {
        headers: { apikey: key.key, Authorization: `Bearer ${key.key}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        fallbackReason = `the saved order could not be read from production (HTTP ${res.status})`;
      } else {
        const rows = await res.json();
        settings = providerStore.normaliseRow(Array.isArray(rows) ? rows[0] : null);
        if (!settings.exists) { settings = null; fallbackReason = 'nothing has been saved on Settings › APIs yet'; }
        else if (!aiKeys.mainOrderSaved(settings)) fallbackReason = 'the main order on Settings › APIs has not been saved yet (only feature groups have been)';
      }
    } catch (err) {
      fallbackReason = `the saved order could not be read from production (${String(err?.message || err).slice(0, 120)})`;
    }
  }
  const env = {};
  if (!aiKeys.mainOrderSaved(settings)) {
    const order = readPrd('AI_PROVIDER_ORDER');
    if (order.key) env.AI_PROVIDER_ORDER = order.key;
  }
  return aiKeys.switchProviders({ settings, env, fallbackReason });
}

// A provider's key in Doppler prd, by the setting the door reads. Gemini's
// second name is the alias lib/apiSettings.js also accepts.
const KEY_ALIASES = { GEMINI_API_KEY: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY'] };
const keySource = new Map();
function prdKeyFor(def) {
  const names = KEY_ALIASES[def.keyEnv] || [def.keyEnv];
  let read = { key: '' };
  let used = names[0];
  for (const name of names) {
    read = readPrd(name);
    used = name;
    if (read.key || read.unreadable) break;
  }
  keySource.set(def.id, `Doppler prd ${used}`);
  return read;
}

const order = await readProductionOrder();
const entries = aiKeys.switchEntries(order, {
  keyFor: prdKeyFor,
  sourceFor: (def) => keySource.get(def.id) || '',
  place: 'the website (Doppler prd)',
});

// The Mini's OpenClaw (SC-873): every provider key it holds, and the model it
// is set to. On a machine that does not run OpenClaw and has neither file, it
// is skipped with a note; on the machine that does, an unreadable file is
// CANNOT TELL, never a pass.
const openclawRole = nodeRoles.checkRole('openclaw');
const envFile = readText(OPENCLAW_ENV);
const configFile = readText(OPENCLAW_CONFIG);
const openclawHere = openclawRole.owned || !envFile.missing || !configFile.missing;
let openclaw = null;
if (openclawHere) {
  const committed = readCommittedModels();
  openclaw = openclawKeys.openclawReport({
    envText: envFile.text ?? null,
    envError: envFile.error,
    configText: configFile.text ?? null,
    configError: configFile.error,
    committed: committed.list,
    committedKeys: committed.keys,
  });
  entries.push(...openclaw.entries);
}

const rows = await aiKeys.checkKeys(entries);
const comparisons = aiKeys.compareKeys(rows, { pairs: openclaw ? openclawKeys.comparePairs(openclaw.entries) : [] });

console.log('ai-keys: every AI provider on the switch, the account each bills, and whether it works (values never shown).');
console.log(`  Order: ${aiKeys.orderSourceText(order)}.`);
for (const id of order.ignored) console.log(`  (left out: "${id}" is in the saved order but is not a provider this check knows)`);
for (const row of rows) console.log(`  ${aiKeys.rowLine(row)}`);
if (openclaw) {
  if (openclaw.model) console.log(`  ${openclaw.model}`);
  for (const line of openclaw.blind) console.log(`  ${line}`);
  for (const line of openclaw.findings) console.log(`  ${line}`);
} else {
  console.log(`  (the Mini's OpenClaw keys and model are not on this machine — ${openclawRole.owner || 'another machine'} runs OpenClaw; run this there to see them)`);
}
const labelOf = new Map(rows.map((r) => [r.id, r.label || r.provider]));
for (const c of comparisons) console.log(`  ${labelOf.get(c.b) || ''}: ${c.text}`);
const sw = aiKeys.switchState(rows);
if (sw.serving) console.log(`  AI calls are using: ${sw.serving.label}.`);
else if (sw.outage) console.log('  ALARM: no switched-on provider can answer, so every AI feature has stopped.');
else console.log('  No switched-on provider answered, and at least one could not be read, so whether AI features work cannot be told.');

if (CHECK) {
  const relay = nodeRoles.checkRole('bus-relay');
  if (!relay.owned) {
    console.log(`ai-keys: not posting — only the machine that owns bus-relay (${relay.owner}) posts, so nothing is said twice.`);
  } else {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { state = {}; }
    const decided = aiKeys.planAlarms({ rows, state });
    const saveState = () => {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, `${JSON.stringify(decided.next, null, 2)}\n`);
    };
    if (!decided.post.length && !decided.clear.length && !decided.blind.length && !decided.sighted.length && !decided.outage && !decided.restored) {
      console.log('ai-keys: nothing to post (no key newly down or recovered, none blind for over an hour, open alarms posted under 6h ago).');
      // Still save: a first CANNOT TELL records when the blindness started, and
      // without that record a blind check could never reach its one-hour mark.
      if (!DRY && JSON.stringify(decided.next) !== JSON.stringify(state)) saveState();
    } else {
      const node = relay.node?.name || 'an unnamed machine';
      const text = aiKeys.renderMessage({ ...decided, comparisons, node, at: new Date().toISOString() });
      if (DRY) {
        console.log(`--- would post to the bus (the tracker's) ---\n${text}\n--- (dry run: nothing sent, nothing stamped) ---`);
      } else {
        try {
          require('./lib/clickup.cjs').postBusMessage(text);
          saveState();
          console.log('ai-keys: posted to the bus.');
        } catch (err) {
          // Not stamped, so the next wake tries again rather than going quiet.
          console.error(`ai-keys: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
        }
      }
    }
  }
}

process.exit(openclawKeys.exitCode(aiKeys.exitCode(rows), openclaw));
