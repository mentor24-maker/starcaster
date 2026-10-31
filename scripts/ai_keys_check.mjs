#!/usr/bin/env node
/**
 * `npm run ai-keys` — every AI key Starcaster and the Mini use, which account
 * each one bills, and whether it works right now (ticket 86bcvhfht).
 *
 * The why, the readings and the alarm rule are in lib/aiKeys.js; this file
 * only gathers the keys, keeps the alarm state and posts.
 *
 *   npm run ai-keys                        check and print, write nothing
 *   npm run ai-keys -- --check             the same, and post to the bus when a key is OUT OF CREDIT or INVALID,
 *                                          or has read CANNOT TELL for over an hour
 *   npm run ai-keys -- --check --dry-run   say what it WOULD post, send nothing, stamp nothing
 *
 * WHERE THE KEYS COME FROM. No value is ever printed — fingerprints only.
 *   The website's keys: Doppler `prd`, the config Vercel is built from, read
 *     with the Mini's prd-scoped Doppler key ($HOME/Studio, the same one
 *     scripts/install_openclaw.sh uses; AI_KEYS_DOPPLER_SCOPE overrides it).
 *     A machine with no prd access reports those rows CANNOT TELL — never a pass.
 *     A Settings › APIs override lives in the deployment, not here, so the
 *     panel under Settings › APIs is where that one is checked.
 *   The Mini's OpenClaw key: ~/.openclaw/.env, which OpenClaw reads itself.
 *
 * WHO POSTS. The keys are the same wherever this runs, so two machines posting
 * would say everything twice. Only the machine that owns `bus-relay` posts;
 * the other prints its reading and stops. That machine going dark is the
 * heartbeat's to report.
 *
 * Exit: 0 every key works, 1 a key is OUT OF CREDIT or INVALID, 2 a reading
 * could not be taken. run_bus_relay.sh guards the call with `|| true` — a
 * finding about a key is not this script's failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const aiKeys = require('../lib/aiKeys.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');

const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const STATE_FILE = path.join(heartbeat.heartbeatDir(), 'ai-keys-alarms.json');
const OPENCLAW_ENV = path.join(os.homedir(), '.openclaw', '.env');
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

/** ANTHROPIC_API_KEY out of ~/.openclaw/.env, never printed. */
function readOpenclawKey() {
  let text;
  try { text = fs.readFileSync(OPENCLAW_ENV, 'utf8'); } catch { return null; }
  const line = text.split('\n').find((l) => /^\s*(export\s+)?ANTHROPIC_API_KEY\s*=/.test(l));
  if (!line) return { key: '' };
  return { key: line.replace(/^\s*(export\s+)?ANTHROPIC_API_KEY\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2') };
}

const WEBSITE_JOBS = {
  anthropic: 'the website — Write with AI, outreach reply drafts, alt text, tagging and every other Claude feature',
  openai: 'the website — the features that call OpenAI',
  gemini: 'the website — the features that call Google Gemini',
};

// Each provider's variable names in the order lib/apiSettings.js reads them;
// the first one that is set is the one the website uses.
const WEBSITE_KEYS = [
  ['anthropic', ['ANTHROPIC_API_KEY']],
  ['openai', ['OPENAI_API_KEY']],
  ['gemini', ['GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY']],
];

const entries = [];
for (const [provider, names] of WEBSITE_KEYS) {
  let read = { key: '' };
  let used = names[0];
  for (const name of names) {
    read = readPrd(name);
    used = name;
    if (read.key || read.unreadable) break;
  }
  entries.push({
    id: `website-${provider}`,
    provider,
    place: 'the website (Doppler prd)',
    job: WEBSITE_JOBS[provider],
    source: `Doppler prd ${used}`,
    ...read,
  });
}

const openclawRole = nodeRoles.checkRole('openclaw');
const openclaw = readOpenclawKey();
if (openclaw) {
  entries.push({
    id: 'openclaw-anthropic',
    provider: 'anthropic',
    place: "the Mini's OpenClaw (~/.openclaw/.env)",
    job: 'the Mini — OpenClaw: outreach posting, sign-in checks, Reddit and Substack passes',
    source: '~/.openclaw/.env ANTHROPIC_API_KEY',
    ...openclaw,
  });
} else if (openclawRole.owned) {
  entries.push({
    id: 'openclaw-anthropic',
    provider: 'anthropic',
    place: "the Mini's OpenClaw (~/.openclaw/.env)",
    job: 'the Mini — OpenClaw',
    unreadable: `this machine owns OpenClaw but ${OPENCLAW_ENV} could not be read`,
  });
}

const rows = await aiKeys.checkKeys(entries);
const comparisons = aiKeys.compareKeys(rows);

console.log('ai-keys: every AI key in use, the account it bills, and whether it works (values never shown):');
for (const row of rows) console.log(`  ${aiKeys.rowLine(row)}`);
if (!openclaw && !openclawRole.owned) {
  console.log(`  (the Mini's OpenClaw key is not on this machine — ${openclawRole.owner || 'another machine'} runs OpenClaw; run this there to see it)`);
}
for (const c of comparisons) console.log(`  ${c.text}`);

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
    if (!decided.post.length && !decided.clear.length && !decided.blind.length && !decided.sighted.length) {
      console.log('ai-keys: nothing to post (no key newly down or recovered, none blind for over an hour, open alarms posted under 6h ago).');
      // Still save: a first CANNOT TELL records when the blindness started, and
      // without that record a blind check could never reach its one-hour mark.
      if (!DRY && JSON.stringify(decided.next) !== JSON.stringify(state)) saveState();
    } else {
      const node = relay.node?.name || 'an unnamed machine';
      const text = aiKeys.renderMessage({ ...decided, comparisons, node, at: new Date().toISOString() });
      if (DRY) {
        console.log(`--- would post to the bus (${BUS_CHANNEL}) ---\n${text}\n--- (dry run: nothing sent, nothing stamped) ---`);
      } else {
        try {
          require('./lib/clickup.cjs').postBusMessage(BUS_CHANNEL, text);
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

process.exit(aiKeys.exitCode(rows));
