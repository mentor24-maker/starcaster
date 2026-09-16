#!/usr/bin/env node
/**
 * scripts/restore_node.mjs — put a backed-up machine's state onto this one.
 *
 *   npm run restore:node                      what it WOULD do (dry run — the default)
 *   npm run restore:node -- --apply           do it
 *   npm run restore:node -- --node mac-mini   restore a DIFFERENT machine's backup onto this one
 *   npm run restore:node -- --from <folder>   read a local folder instead of fetching from GitHub
 *
 * DRY BY DEFAULT, AND THAT IS NOT CAUTION FOR ITS OWN SAKE.
 * This runs on the worst day, on a half-built machine, probably by somebody who
 * is not at home. The first thing they need is an inventory of what is about to
 * happen to the folder they are standing in — not a surprise.
 *
 * IT NEVER OVERWRITES.
 * Every destination that already has something in it is left exactly as it is
 * and the incoming copy is written beside it with a `.from-backup` suffix, and
 * SAID. A restore that clobbers a working file is how "let me just restore the
 * backup" turns a bad morning into a worse one, and the case is not rare: the
 * most likely reason somebody runs this is that they are half way through
 * standing a machine up by hand and want the rest.
 *
 * THE FOLDER NAME THAT CANNOT BE COPIED.
 * Claude Code keeps its memory under a folder named after the checkout's
 * ABSOLUTE PATH. Copying that folder between Macs by hand puts it where nothing
 * will ever read it, and an empty memory folder looks exactly like a working
 * one, so nothing errors — the old provisioning document got this wrong. This
 * script re-derives the name from THIS machine's checkout instead of trusting
 * the one in the archive.
 *
 * Exit codes (docs/DOCTRINE.md §5.33):
 *   0  the restore ran (or the dry run completed)
 *   1  something could not be restored
 *   2  no reading could be taken — no backup found, or this machine has no name
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nodeBackup = require(path.join(ROOT, 'lib', 'nodeBackup.js'));
const nodeRoles = require(path.join(ROOT, 'lib', 'nodeRoles.js'));
const nodeProvision = require(path.join(ROOT, 'lib', 'nodeProvision.js'));

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
// A restore of a real machine touches several hundred files, and on the bad day
// the six lines that need a decision must not be buried under four hundred that
// do not. So the routine outcomes are COUNTED and the exceptional ones are
// PRINTED, with --verbose to see everything.
const VERBOSE = argv.includes('--verbose');
const HOME = os.homedir();
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const out = [];
const say = (s = '') => out.push(s);
const flush = () => { console.log(out.join('\n')); out.length = 0; };

let problems = 0;

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeoutMs || 120000, cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
  } catch (_) { return null; }
}
const exists = (p) => { try { fs.accessSync(p); return true; } catch (_) { return false; } };

// --- which backup ----------------------------------------------------------

const me = nodeRoles.thisNode();
const wanted = flag('--node') || me.name;

if (!nodeRoles.isKnownNode(wanted)) {
  say(`CANNOT TAKE A READING — "${wanted}" is not a node this system knows.`);
  say(`Known machines: ${nodeRoles.KNOWN_NODES.join(', ')}.`);
  say('');
  say('If this is a replacement Mac that has not been named yet, name it first — every');
  say('ownership guard reads that one line, and a machine without it runs no jobs at all:');
  say(`  echo ${nodeRoles.KNOWN_NODES.join('|')} > ${me.file}`);
  flush();
  process.exit(2);
}

let source = flag('--from');
if (!source) {
  const cache = path.join(HOME, 'Library', 'Application Support', 'starcaster', 'backup', 'restore-source');
  const remote = `https://github.com/${nodeBackup.BACKUP_REPO}.git`;
  say(`Fetching the backup repo (${nodeBackup.BACKUP_REPO})…`);
  if (exists(path.join(cache, '.git'))) {
    run('git', ['-C', cache, 'fetch', '--quiet', 'origin'], { timeoutMs: 300000 });
    run('git', ['-C', cache, 'reset', '--hard', '--quiet', 'origin/HEAD'], { timeoutMs: 120000 });
  } else {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    if (run('git', ['clone', '--quiet', remote, cache], { timeoutMs: 600000 }) === null) {
      say('');
      say('COULD NOT FETCH THE BACKUP. This is the one step that needs GitHub, and it is the');
      say('first thing to do on a replacement machine:');
      say('  gh auth login && gh auth setup-git');
      say('');
      say('If that is already done and this still fails, the archive can be downloaded from');
      say(`  https://github.com/${nodeBackup.BACKUP_REPO}`);
      say('and pointed at with:  npm run restore:node -- --from <the unpacked folder>');
      flush();
      process.exit(2);
    }
  }
  source = path.join(cache, nodeBackup.nodeFolder(wanted));
}

// Accept either the node folder or the `files/` folder inside it, because on
// the bad day somebody will paste whichever path their eye landed on.
if (!exists(path.join(source, 'files')) && exists(path.join(source, '..', 'MANIFEST.md'))) {
  source = path.resolve(source, '..');
}
const files = path.join(source, 'files');
if (!exists(files)) {
  say('');
  say(`NO BACKUP FOUND for "${wanted}".`);
  say(`Looked in: ${source}`);
  say('');
  say('That is not the same as "the backup is empty" — nothing was read at all. If this');
  say('machine has never been backed up, there is nothing here to restore and the rebuild');
  say('is the provisioning route instead:  npm run provision:node');
  flush();
  process.exit(2);
}

const manifestPath = path.join(source, 'MANIFEST.md');
const takenLine = exists(manifestPath)
  ? (fs.readFileSync(manifestPath, 'utf8').split('\n').find((l) => l.startsWith('Taken ')) || '').trim()
  : '';

say('');
say(`Restoring "${wanted}" onto ${me.name === wanted ? 'this machine' : `this machine (${me.name})`}.`);
if (takenLine) say(`  ${takenLine}`);
say(APPLY ? '  APPLYING — files will be written.' : '  DRY RUN — nothing will be written. Add --apply to do it.');
say('');

// --- the copier ------------------------------------------------------------

/**
 * Place one file, refusing to overwrite.
 *
 * The three outcomes are all reported, including the boring one. A restore that
 * printed only what it changed would leave a reader unable to tell "already
 * correct" from "skipped by mistake", and those want opposite responses.
 */
const tally = { placed: 0, same: 0, beside: 0, failed: 0 };

function place(from, to, label) {
  const shown = to.replace(HOME, '~');
  if (exists(to)) {
    let same = false;
    try { same = fs.readFileSync(from).equals(fs.readFileSync(to)); } catch (_) { same = false; }
    if (same) { tally.same += 1; if (VERBOSE) say(`  already there   ${shown}`); return 'same'; }
    const beside = `${to}.from-backup`;
    if (APPLY) {
      try {
        fs.mkdirSync(path.dirname(beside), { recursive: true });
        fs.copyFileSync(from, beside);
      } catch (err) { say(`  COULD NOT WRITE ${shown}.from-backup (${err.code || err.message})`); problems += 1; tally.failed += 1; return 'failed'; }
    }
    // Always printed, never counted away: this is a file where the machine and
    // the backup disagree, and only a person can say which one is right.
    say(`  KEPT YOURS      ${shown} differs — the backup's copy is ${APPLY ? 'beside it' : 'would go beside it'} as ${path.basename(beside)}`);
    tally.beside += 1;
    return 'beside';
  }
  if (APPLY) {
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    } catch (err) { say(`  COULD NOT WRITE ${shown} (${err.code || err.message})`); problems += 1; tally.failed += 1; return 'failed'; }
  }
  tally.placed += 1;
  if (VERBOSE) say(`  ${APPLY ? 'restored' : 'would put'}        ${shown}`);
  return 'placed';
}

function listFiles(dir) {
  const acc = [];
  const visit = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = rel ? path.posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) visit(full, r);
      else if (e.isFile()) acc.push({ from: full, rel: r });
    }
  };
  visit(dir, '');
  return acc;
}

function section(title, body) {
  say(title);
  const before = out.length;
  const start = { ...tally };
  body();
  const moved = {
    placed: tally.placed - start.placed,
    same: tally.same - start.same,
    beside: tally.beside - start.beside,
    failed: tally.failed - start.failed,
  };
  const bits = [];
  if (moved.placed) bits.push(`${moved.placed} ${APPLY ? 'restored' : 'to restore'}`);
  if (moved.same) bits.push(`${moved.same} already identical`);
  if (moved.beside) bits.push(`${moved.beside} left alone because yours differs`);
  if (moved.failed) bits.push(`${moved.failed} FAILED`);
  // The summary goes FIRST among the quiet lines and after any loud ones, so a
  // section that printed a REFUSED still leads with the thing needing a person.
  if (bits.length) say(`  ${bits.join(', ')}.`);
  else if (out.length === before) say('  (nothing in the backup for this)');
  say('');
}

// --- identity --------------------------------------------------------------

section('The machine identity', () => {
  const f = path.join(files, 'identity', '.alphire-node');
  if (!exists(f)) return;
  // Restoring an identity ONTO A MACHINE THAT ALREADY HAS A DIFFERENT ONE is
  // the one case here that could do real damage — two machines both believing
  // they are the Mini would both claim tickets, which is the exact race
  // lib/nodeRoles.js exists to prevent. `place` refuses to overwrite, which is
  // the right behaviour, but this case deserves to be said in words.
  const current = nodeRoles.readIdentityFile(me.file);
  if (current && current.trim() !== wanted) {
    say(`  REFUSED         this machine already calls itself "${current.trim()}".`);
    say(`                  Restoring "${wanted}" over it would give the system two machines with`);
    say('                  one name, and both would claim tickets. Decide which this is first.');
    problems += 1;
    return;
  }
  place(f, me.file, 'identity');
});

// --- scheduled jobs --------------------------------------------------------

section('The scheduled jobs', () => {
  const d = path.join(files, 'launch-agents');
  if (!exists(d)) return;
  const placed = [];
  for (const f of listFiles(d)) {
    const res = place(f.from, path.join(HOME, 'Library', 'LaunchAgents', f.rel));
    if (res === 'placed') placed.push(f.rel);
  }
  if (placed.length) {
    say('');
    say('  These are COPIED, NOT STARTED. A plist on disk does nothing until it is loaded,');
    say('  and loading a job is a decision — a half-built machine that starts relaying and');
    say('  claiming tickets is worse than one that does nothing. Start them when the rest of');
    say('  the rebuild is verified:');
    for (const p of placed) say(`    launchctl load -w ~/Library/LaunchAgents/${p}`);
  }
});

// --- heartbeat and loop history -------------------------------------------

section('The job history (heartbeat records and loop logs)', () => {
  const hb = path.join(files, 'heartbeat');
  if (exists(hb)) {
    const dest = path.join(HOME, 'Library', 'Application Support', 'starcaster', 'heartbeat');
    for (const f of listFiles(hb)) place(f.from, path.join(dest, f.rel));
  }
  const logs = path.join(files, 'loop-logs');
  if (exists(logs)) {
    let n = 0;
    for (const f of listFiles(logs)) { place(f.from, path.join(HOME, 'loop-logs', f.rel)); n += 1; }
    if (!n) say('  (no loop logs in the backup)');
  }
});

// --- the memory folders, with the name re-derived --------------------------

section('The agent memory folders', () => {
  const d = path.join(files, 'claude-memory');
  if (!exists(d)) return;
  // The archive stores each memory folder under the slug it had on the OLD
  // machine. That slug encodes an absolute path, so it is only correct there.
  // Re-derive it from the checkouts THIS machine actually has.
  const slugs = new Map();
  for (const repo of nodeProvision.requiredRepos()) {
    const home = exists(path.join(repo.home, '.git'))
      ? repo.home
      : nodeProvision.findRepoElsewhere(repo.name, repo.home, HOME);
    if (!home) continue;
    slugs.set(repo.name, nodeProvision.claudeMemoryDir(home, HOME));
  }
  let oldDirs = [];
  try { oldDirs = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (_) { oldDirs = []; }
  for (const oldSlug of oldDirs) {
    // The slug is the absolute path with separators replaced, so the repo name
    // is recoverable from it without trusting the path itself.
    const repo = [...slugs.keys()].find((name) => oldSlug.endsWith(`-${name}`) || oldSlug.includes(`-${name}-`));
    if (!repo) {
      // Not one of the four repos a node is defined by — a scratch checkout, a
      // sibling project, or the home folder itself. The memory is still worth
      // having, and the slug already encodes the absolute path it belongs to,
      // so it is restored AT THAT SLUG. What is said out loud is the condition
      // under which that is wrong: the slug carries the old machine's username,
      // so on a Mac with a different one the folder will sit there unread —
      // and an unread memory folder looks exactly like an empty one, which is
      // the specific mistake this whole item exists to avoid repeating.
      const dest = path.join(HOME, '.claude', 'projects', oldSlug, 'memory');
      say(`  kept as-is      ${oldSlug} — not one of the four node repos, so its folder name is`);
      say('                  carried across unchanged. If this Mac uses a different account name');
      say('                  than the old one, rename that folder or nothing will read it.');
      for (const f of listFiles(path.join(d, oldSlug))) place(f.from, path.join(dest, f.rel));
      continue;
    }
    const dest = slugs.get(repo);
    if (VERBOSE || oldSlug !== path.basename(path.dirname(dest))) {
      say(`  ${repo}: ${oldSlug}  ->  ${dest.replace(HOME, '~')}`);
    }
    for (const f of listFiles(path.join(d, oldSlug))) place(f.from, path.join(dest, f.rel));
  }
});

// --- shell config, hand-written scripts, loose files ------------------------

section('Shell configuration and hand-written scripts', () => {
  for (const [dir, dest] of [['shell-config', HOME], ['local-bin', path.join(HOME, 'bin')], ['loose-backups', HOME]]) {
    const d = path.join(files, dir);
    if (!exists(d)) continue;
    for (const f of listFiles(d)) place(f.from, path.join(dest, f.rel));
  }
});

// --- the commits that existed on one disk ----------------------------------

section('Commits that existed only on the old machine', () => {
  const d = path.join(files, 'git-bundles');
  if (!exists(d)) return;
  for (const f of listFiles(d)) {
    const [repoName, rest] = f.rel.replace(/\.bundle$/, '').split('__');
    const repo = nodeProvision.requiredRepos().find((r) => path.basename(r.home) === repoName || r.name === repoName);
    const home = repo
      ? (exists(path.join(repo.home, '.git')) ? repo.home : nodeProvision.findRepoElsewhere(repo.name, repo.home, HOME))
      : null;
    if (!home) {
      say(`  WAITING         ${f.rel} — the "${repoName}" checkout is not on this machine yet.`);
      say('                  Clone it first (npm run provision:node does), then re-run this.');
      continue;
    }
    const branch = rest;
    const already = run('git', ['-C', home, 'rev-parse', '--verify', '--quiet', branch]);
    if (already) { say(`  already there   ${repoName}/${branch}`); continue; }
    if (!APPLY) { say(`  would restore   ${repoName}/${branch}  (from ${f.rel})`); continue; }
    // A bundle is fetched, never merged. The commits land as a branch and
    // nothing moves — what to do with the work is a decision, and a restore
    // script that started merging other people's branches would be making it.
    const res = run('git', ['-C', home, 'fetch', f.from, `${branch}:${branch}`], { timeoutMs: 180000 });
    if (res === null) {
      say(`  FAILED          ${repoName}/${branch} could not be fetched from ${f.rel}.`);
      say('                  Its prerequisite commits may not be in this checkout yet — fetch');
      say('                  origin first, then re-run.');
      problems += 1;
    } else {
      say(`  restored        ${repoName}/${branch}  (as a branch; nothing merged)`);
    }
  }
});

// --- what is deliberately not here -----------------------------------------

say('Still to do by hand — these are credentials and were never in the backup:');
say('');
for (const e of nodeBackup.EXCLUDED) {
  say(`  ${e.what}`);
  say(`      ${e.instead}`);
}
say('');
say('Then confirm the rebuild against what the old machine said on its last good day:');
say('');
say('  npm run doctor:node');
say(`  diff <(npm run --silent doctor:node) ${path.join(source, 'files', 'machine-report', 'machine-report.md').replace(HOME, '~')}`);
say('');

say(`In total: ${tally.placed} ${APPLY ? 'restored' : 'to restore'}, ${tally.same} already identical, `
  + `${tally.beside} left alone because this machine's copy differs, ${tally.failed} failed.`);
if (!VERBOSE) say('Add --verbose to list every file rather than counting them.');
say('');
if (!APPLY) {
  say('Nothing was written. Re-run with --apply to perform the restore.');
}

flush();
process.exit(problems ? 1 : 0);
