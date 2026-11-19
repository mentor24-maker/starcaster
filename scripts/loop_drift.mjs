#!/usr/bin/env node
/**
 * `npm run loop:drift` — is StarCaster's copy of the loop (`loop/`) the same
 * as Spirality's `main`? (SC-868)
 *
 *   npm run loop:drift                       read and print, write nothing
 *   npm run loop:drift -- --check            the same, and post to the bus (once a day per verdict)
 *   npm run loop:drift -- --check --dry-run  say what it WOULD post, send nothing, stamp nothing
 *
 * Read-only: two GitHub reads (Spirality's main commit, then its file list at
 * that commit) through `gh`, compared by git blob id against every file under
 * loop/ except README.md. The why and the verdicts are in lib/loopDrift.js.
 *
 * Posts only from the machine owning `bus-relay`, so "once a day" is true with
 * one poster. Not stamped on a failed post, so the next wake tries again.
 *
 * For the tests (scripts/builder/loopDrift.test.js), three overrides:
 *   LOOP_DRIFT_DIR    the folder to compare instead of loop/
 *   LOOP_DRIFT_GH     the gh program to run instead of `gh`
 *   LOOP_DRIFT_STAMP  where the once-a-day stamp lives
 *
 * Exit: 0 IN STEP, 1 BEHIND, 2 CANNOT TELL. run_bus_relay.sh guards the call
 * with `|| true` — a reading is not this script's failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const drift = require('../lib/loopDrift.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOOP_DIR = process.env.LOOP_DRIFT_DIR || path.join(ROOT, 'loop');
const GH = process.env.LOOP_DRIFT_GH || 'gh';
const ROLE = 'bus-relay';
// The relay wakes every ten minutes; Spirality's main does not move that often,
// so --check takes a fresh reading at most once an hour and repeats the last
// verdict in between. A failed read costs the same hour (a rate limit must not
// keep itself going by retrying every wake). --dry-run and plain runs always read.
const READ_EVERY_MS = 60 * 60 * 1000;

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run');

function stampPath() {
  if (process.env.LOOP_DRIFT_STAMP) return process.env.LOOP_DRIFT_STAMP;
  return path.join(require('../lib/nodeHeartbeat.js').heartbeatDir(), 'loop-drift.json');
}

function readState() {
  try { return JSON.parse(fs.readFileSync(stampPath(), 'utf8')); } catch { return {}; }
}

/** Every file under dir, path relative to it with forward slashes. Dotfiles skipped. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(full, rel));
    else if (entry.isFile()) out.push({ path: rel, sha: drift.blobSha(fs.readFileSync(full)) });
  }
  return out;
}

function gh(args) {
  return execFileSync(GH, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 32,
  });
}

function readSpirality() {
  try {
    const commit = JSON.parse(gh(['api', `repos/${drift.SPIRALITY_REPO}/commits/main`])).sha;
    if (!commit) return { remote: null, error: 'GitHub named no commit for main' };
    const tree = JSON.parse(gh(['api', `repos/${drift.SPIRALITY_REPO}/git/trees/${commit}?recursive=1`]));
    return { remote: { commit, tree: tree.tree, truncated: Boolean(tree.truncated) } };
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).split('\n').find((l) => l.trim()) || 'unknown error';
    return { remote: null, error: `gh failed: ${detail.slice(0, 200)}` };
  }
}

function writeState(next) {
  const file = stampPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

if (CHECK && !DRY) {
  const state = readState();
  const then = Date.parse(state.readAt || '');
  if (Number.isFinite(then) && Date.now() - then < READ_EVERY_MS && drift.EXIT[state.lastVerdict] !== undefined) {
    console.log(`loop:drift: ${state.lastVerdict} at the last reading (${state.readAt}); next reading after ${new Date(then + READ_EVERY_MS).toISOString()}.`);
    process.exit(drift.EXIT[state.lastVerdict]);
  }
}

let local = [];
let localError = '';
try { local = listFiles(LOOP_DIR); } catch (err) { localError = `could not read ${LOOP_DIR}: ${err.message}`; }
const reading = localError ? { remote: null, error: localError } : readSpirality();
const judged = drift.judge({ local, ...reading });

console.log(`loop:drift: ${judged.verdict} — ${judged.reason}`);
if (judged.commit) console.log(`  Spirality's main: ${judged.commit}`);
for (const p of judged.changed) console.log(`  DIFFERS  loop/${p}`);
for (const p of judged.deleted) console.log(`  DELETED IN SPIRALITY  loop/${p}`);

if (CHECK) {
  const roles = require('../lib/nodeRoles.js');
  const verdict = roles.checkRole(ROLE);
  const state = readState();
  const reading = { readAt: new Date().toISOString(), lastVerdict: judged.verdict };
  if (!verdict.owned) {
    console.log(`loop:drift: not posting — ${verdict.message.split('\n')[0]}`);
    if (!DRY) writeState({ ...state, ...reading });
  } else {
    const node = verdict.node.name;
    const at = new Date().toISOString();
    const decided = drift.plan({ judged, state });
    const posts = [];
    if (decided.behind) posts.push(drift.renderBehind({ judged, node, at }));
    if (decided.cannotTell) posts.push(drift.renderCannotTell({ judged, node, at }));
    if (decided.cleared) posts.push(drift.renderClear({ judged, node, at }));
    if (!posts.length) console.log('loop:drift: nothing new to say on the bus.');

    if (DRY) {
      for (const text of posts) console.log(`--- would post to the bus ---\n${text}`);
      if (posts.length) console.log('--- (dry run: nothing sent, nothing stamped) ---');
    } else {
      let sent = true;
      if (posts.length) {
        const clickup = require('./lib/clickup.cjs');
        for (const text of posts) {
          try {
            clickup.postBusMessage(text);
          } catch (err) {
            sent = false;
            console.error(`loop:drift: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
          }
        }
      }
      // Not stamped on a failed post (not even the reading), so the next wake tries again.
      if (sent) {
        writeState({ ...decided.next, ...reading });
        if (posts.length) console.log('loop:drift: posted to the bus.');
      }
    }
  }
}

process.exit(drift.EXIT[judged.verdict]);
