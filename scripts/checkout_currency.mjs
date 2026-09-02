/**
 * Is this machine running the code on `main`, and if not, can it fix itself?
 *
 * The reasoning, the incident and the rules live in lib/checkoutCurrency.js.
 * This file is the IO: the git readings, the suppression stamp, the bus post
 * and the one repair that is safe to perform without a person.
 *
 * It REPLACES the five `echo`-only branches that used to live inline in
 * scripts/run_bus_relay.sh. The refusals are deliberately the same refusals --
 * only main, only clean, only fast-forward -- because that timidity was never
 * the bug. What changed is that a refusal now reaches the bus, and names the
 * real reason (task 86bbrf2vf).
 *
 *   npm run checkout:current              report only
 *   npm run checkout:current -- --check   report, and post to the bus if stale
 *   npm run checkout:current -- --fix     displace safe blockers and retry
 *
 * It never exits non-zero for a stale checkout: the relay must not be failed
 * by its own watchdog. The `|| true` at the call site is belt and braces, not
 * the mechanism.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const currency = require('../lib/checkoutCurrency.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const clickup = require('./lib/clickup.cjs');

const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const CHECK = flag('check');
const FIX = flag('fix');
const DRY = flag('dry-run');
const NOW = Date.now();
const NODE = nodeRoles.thisNode();
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const ESC = String.fromCharCode(27);
const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? ESC + '[' + code + 'm' + text + ESC + '[0m' : text);
const red = (t) => paint('31', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);

// --- git, read-only unless asked otherwise ----------------------------------

function git(args, { cwd = REPO } = {}) {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: !out.error && out.status === 0,
    stdout: String(out.stdout || '').trim(),
    stderr: String(out.stderr || out.stdout || '').trim(),
  };
}

/** Commits each side of origin/main, or nulls when it cannot be counted. */
function distance() {
  const out = git(['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
  if (!out.ok) return { behind: null, ahead: null };
  const [b, a] = out.stdout.split(/\s+/).map((n) => Number(n));
  return { behind: Number.isFinite(b) ? b : null, ahead: Number.isFinite(a) ? a : null };
}

// --- the stamps -------------------------------------------------------------
//
// Both live beside the heartbeat's, and for the same reason: they are facts
// about THIS MACHINE, not about the code, so they must not vanish when a
// worktree is removed.

const alarmStamp = heartbeat.heartbeatDir() + '/stale-checkout.stamp';
const successStamp = heartbeat.heartbeatDir() + '/checkout-updated.stamp';

function readStamp(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
function writeStamp(file, at) {
  try {
    fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
    fs.writeFileSync(file, at + '\n');
    return null;
  } catch (err) { return String(err?.message || err); }
}
function clearStamp(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* nothing to clear */ }
}
function dueAgain(lastAt, everyMs) {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  return !Number.isFinite(t) || (NOW - t) >= everyMs;
}

// --- the pass ---------------------------------------------------------------

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '?';
// TRACKED changes only. `git status --porcelain` counts UNTRACKED files too,
// and that is what hid this whole bug: the three weekly-report files left in
// docs/reports/ made the tree read as "dirty", so the relay skipped with
// "uncommitted changes present" and never attempted the fast-forward that
// would have named them. Untracked files are not somebody's work in progress
// in the sense this guard means -- they are exactly the recoverable case, and
// treating them as sacred is what made the machine unrepairable for hours.
const dirty = git(['status', '--porcelain', '--untracked-files=no']).stdout !== '';
const fetched = git(['fetch', '--quiet', 'origin', 'main']).ok;

let { behind, ahead } = fetched ? distance() : { behind: null, ahead: null };
let mergeStderr = '';
let merged = false;

// Attempt the update, under exactly the old conditions.
if (fetched && branch === 'main' && !dirty && behind > 0 && ahead === 0) {
  const ff = git(['merge', '--ff-only', 'origin/main']);
  merged = ff.ok;
  mergeStderr = ff.ok ? '' : ff.stderr;
  if (ff.ok) ({ behind, ahead } = distance());
}

let state = currency.classify({
  branch, dirty, fetched, behind, ahead, mergeStderr, merged,
  lastSuccessAt: Date.parse(readStamp(successStamp)) || null,
  now: NOW,
});

// --- the one repair a background job may perform ----------------------------

if (FIX && state.state === currency.STATES.BLOCKED_UNTRACKED) {
  const tracked = git(['ls-tree', '-r', '--name-only', 'origin/main']);
  const safe = currency.autoRepairable(state.blocking, new Set(tracked.ok ? tracked.stdout.split('\n') : []));
  if (!safe.ok) {
    console.log(yellow('Not repairing: ' + safe.why));
  } else if (DRY) {
    console.log('--dry-run -- would displace ' + safe.paths.length + ' file(s) and retry:');
    for (const p of safe.paths) console.log('  ' + p);
  } else {
    // DISPLACE, NEVER DELETE. Reversible is the whole licence for doing this
    // without asking: the rule is that a background job may not rewrite
    // someone's work, and a move whose destination it prints is not a rewrite.
    const dest = path.join(heartbeat.heartbeatDir(), 'displaced', new Date(NOW).toISOString().replace(/[:.]/g, '-'));
    let moved = 0;
    for (const p of safe.paths) {
      try {
        const to = path.join(dest, p);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(REPO, p), to);
        moved += 1;
      } catch (err) {
        console.log(red('Could not displace ' + p + ': ' + String(err?.message || err)));
      }
    }
    if (moved) {
      console.log('Displaced ' + moved + ' file(s) to ' + dest + ' -- nothing was deleted.');
      const ff = git(['merge', '--ff-only', 'origin/main']);
      merged = ff.ok;
      ({ behind, ahead } = distance());
      state = currency.classify({
        branch, dirty: git(['status', '--porcelain', '--untracked-files=no']).stdout !== '', fetched,
        behind, ahead, mergeStderr: ff.ok ? '' : ff.stderr, merged,
        lastSuccessAt: Date.parse(readStamp(successStamp)) || null, now: NOW,
      });
    }
  }
}

// --- report -----------------------------------------------------------------

const text = currency.report(state, { node: NODE.name || 'an unnamed machine' });
console.log(state.alarm ? red(text) : state.cannotTell ? yellow(text) : green(text));

// A successful update, or already being level, is what "this machine is
// current" means -- both stamp, so the age quoted in the alarm is the age of
// the last time this machine was genuinely on main's code.
if (!state.alarm && !state.cannotTell) {
  writeStamp(successStamp, new Date(NOW).toISOString());
  clearStamp(alarmStamp);
  process.exit(0);
}

if (!CHECK || !state.alarm) process.exit(0);

// --- the alert --------------------------------------------------------------

const post = [
  '[' + (NODE.name || 'unnamed machine') + '] STALE CHECKOUT -- this machine is running old code and cannot update itself.',
  '',
  text,
  '',
  'Until this clears, every scheduled job here runs the tooling from the older commit, '
  + 'while loop worktrees are still cut from a fresh origin/main. Nothing errors; it just '
  + 'runs an older set of rules.',
].join('\n');

if (DRY) {
  console.log('');
  console.log('--dry-run -- this is what would go to the bus, and nothing was sent:');
  console.log('');
  console.log(post);
  process.exit(0);
}

if (!dueAgain(readStamp(alarmStamp), heartbeat.REPOST_EVERY_MS)) {
  console.log('Already reported within the last ' + Math.round(heartbeat.REPOST_EVERY_MS / 3600000) + 'h -- not posting again.');
  process.exit(0);
}

try {
  clickup.postBusMessage(BUS_CHANNEL, post);
  const why = writeStamp(alarmStamp, new Date(NOW).toISOString());
  if (why) console.log('Posted, but the suppression stamp could not be written (' + why + ').');
  console.log('Posted to the bus.');
} catch (err) {
  console.log(red('Could NOT post to the bus (' + String(err?.message || err).slice(0, 300) + ').'));
  console.log('Not stamping it as sent, so the next pass tries again.');
}

process.exit(0);
