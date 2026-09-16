#!/usr/bin/env node
/**
 * scripts/backup_node.mjs — capture what would die with this machine.
 *
 *   npm run backup:node -- --dry-run     say exactly what it would take, write nothing
 *   npm run backup:node                  take it and push it
 *   npm run backup:node -- --scheduled   the throttled shape, for the relay's wake
 *   npm run backup:node -- --local-only  stage it and stop, without pushing
 *
 * WHAT IT IS, IN ONE SENTENCE
 * It copies the short list in lib/nodeBackup.js — the things that exist on one
 * disk and nowhere else — into a private GitHub repo, one folder per machine,
 * with a manifest saying what it got and what it did not.
 *
 * WHAT IT IS NOT
 * A disk image. Almost everything on a node is derived (repos from GitHub,
 * secrets from Doppler, data from Supabase, toolchain from `provision:node`),
 * and backing up derived state is how a backup becomes too big to check. The
 * argument for each item is in the inventory, next to the item.
 *
 * THE RULE THIS FILE IS BUILT AROUND
 * A backup that silently omits something is worse than one that fails, because
 * it looks complete. So every item ends up in exactly one of two lists —
 * captured, or skipped-with-a-reason — and both are printed and both go in the
 * manifest. There is no third path where an item quietly does not appear.
 *
 * EXIT CODES, the harness convention (docs/DOCTRINE.md §5.33):
 *   0  a backup was taken (or, with --scheduled, was correctly not due)
 *   1  something the inventory requires could not be captured
 *   2  no reading could be taken at all — unidentified machine, no gh, no repo
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
const DRY = argv.includes('--dry-run');
const SCHEDULED = argv.includes('--scheduled');
const LOCAL_ONLY = argv.includes('--local-only');
const HOME = os.homedir();

const out = [];
const say = (s = '') => out.push(s);
const flush = () => { console.log(out.join('\n')); out.length = 0; };

// ---------------------------------------------------------------------------
// Small shell helpers. Every one of them answers `null` rather than throwing:
// this script's whole job is to report what it could and could not do, so a
// command that is missing has to become a line in the manifest, not a stack
// trace that takes the other twelve items down with it.
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeoutMs || 120000,
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
  } catch (err) {
    // A NON-ZERO EXIT IS NOT AN EMPTY ANSWER for a command whose job is to
    // report. `doctor:node` exits 1 whenever it finds a FAIL, which is the
    // reading most worth keeping — and the first version of this helper threw
    // it away and wrote "(could not be read on this machine)" into the
    // machine report, on a machine where it had in fact run perfectly and
    // found something. A backup that records "no answer" where the answer was
    // "this is broken" is the failure this whole file is written against.
    if (opts.keepOutputOnFailure && err && typeof err.stdout === 'string' && err.stdout.trim()) {
      return err.stdout;
    }
    return null;
  }
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

function walkFiles(dir, { maxAgeDays = null, skipEntries = [], now = Date.now() } = {}) {
  const files = [];
  const cutoff = maxAgeDays ? now - maxAgeDays * 86400000 : null;
  const visit = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (skipEntries.includes(e.name)) continue;
      // node_modules and .git inside a captured folder would multiply the
      // archive by a thousand and add nothing: both are fully derived.
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.DS_Store') continue;
      const full = path.join(d, e.name);
      const r = rel ? path.posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) { visit(full, r); continue; }
      if (!e.isFile()) continue;           // sockets and symlinks are not state
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (cutoff && st.mtimeMs < cutoff) continue;
      files.push({ from: full, rel: r, bytes: st.size });
    }
  };
  visit(dir, '');
  return files;
}

/**
 * Copy a file into the staging area, scanning it first when the inventory says
 * to. A file that trips the scan is NOT copied and IS named — the whole value
 * of the scan is in the naming; silently dropping it would leave somebody
 * restoring a machine without a shell config and no idea why.
 */
function stageFile({ from, to, scan, tailBytes }) {
  fs.mkdirSync(path.dirname(to), { recursive: true });

  // A file that is going to be TAILED has to be read anyway, so the tail and
  // the scan share the one read rather than each doing their own.
  const needsText = Boolean(scan) || (Number.isFinite(tailBytes) && tailBytes > 0);
  let text = null;
  if (needsText) {
    try { text = fs.readFileSync(from, 'utf8'); } catch (_) { text = null; }
  }

  if (scan && text !== null) {
    const hits = nodeBackup.scanForSecrets(text);
    if (hits.length) {
      return { ok: false, why: `held back — it looks like it contains ${hits.map((h) => h.name).join(' and ')}` };
    }
  }

  if (Number.isFinite(tailBytes) && tailBytes > 0 && text !== null) {
    const tail = nodeBackup.tailWithNotice(text, tailBytes, { name: path.basename(from) });
    try {
      fs.writeFileSync(to, tail.text);
      return { ok: true, bytes: fs.statSync(to).size, truncated: tail.truncated, originalBytes: tail.originalBytes };
    } catch (err) {
      return { ok: false, why: `could not be written (${err.code || err.message})` };
    }
  }

  try {
    fs.copyFileSync(from, to);
    return { ok: true, bytes: fs.statSync(to).size };
  } catch (err) {
    return { ok: false, why: `could not be copied (${err.code || err.message})` };
  }
}

// ---------------------------------------------------------------------------
// Identity. An unidentified machine gets no backup and no pass — the same
// refusal lib/nodeRoles.js gives an unknown machine asking to run a job, and
// for the same reason: whatever this folder is, it is not this machine's.
// ---------------------------------------------------------------------------

const node = nodeRoles.thisNode();
if (!nodeRoles.isKnownNode(node.name)) {
  say(`CANNOT TAKE A READING — this machine calls itself "${node.name}" (from its ${node.source}),`);
  say('which is not a node this system knows. A backup filed under a name nothing recognises');
  say('would be a backup nobody could find on the day it is needed.');
  say('');
  say(`  Fix:  echo ${nodeRoles.KNOWN_NODES.join('|')} > ${node.file}`);
  flush();
  process.exit(2);
}
if (node.source === 'hostname') {
  say(`NOTE: this machine has no ~/.alphire-node file, so "${node.name}" is a GUESS from its`);
  say('hostname. Renaming the Mac would change it, and the backup would start filing itself');
  say('under a different name with nothing saying so. Writing the file is one line.');
  say('');
}

// ---------------------------------------------------------------------------
// The throttle. --scheduled means "a clock fired", which is not the same claim
// as "a backup is due"; the relay wakes every ten minutes and a backup is a
// daily thing. The stamp is what decides, not the clock.
// ---------------------------------------------------------------------------

const stampFile = nodeBackup.backupStampFile(HOME);
let lastStamp = null;
try { lastStamp = JSON.parse(fs.readFileSync(stampFile, 'utf8')); } catch (_) { lastStamp = null; }

if (SCHEDULED) {
  const due = nodeBackup.backupDue({ lastAt: lastStamp && lastStamp.at });
  if (!due.due) {
    say(`backup:node — not due: ${due.why}.`);
    flush();
    process.exit(0);
  }
  say(`backup:node — due: ${due.why}.`);
}

say(`Backing up "${node.name}"${DRY ? ' — DRY RUN, nothing will be written or pushed' : ''}.`);
say('');

// ---------------------------------------------------------------------------
// Staging.
// ---------------------------------------------------------------------------

const stage = DRY
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), 'alphire-node-backup-'));

const captured = [];
const skipped = [];
const notes = [];
let totalBytes = 0;
let hardFailure = false;

function record(item, files, bytes) {
  captured.push({ id: item.id, title: item.title, files, bytes });
  if (Number.isFinite(bytes)) totalBytes += bytes;
  say(`  captured  ${item.title} — ${files} file${files === 1 ? '' : 's'}, ${nodeBackup.humanBytes(bytes)}`);
}

function skip(item, why, { fatal = false } = {}) {
  skipped.push({ id: item.id, title: item.title, why });
  say(`  SKIPPED   ${item.title} — ${why}`);
  if (fatal) hardFailure = true;
}

// --- the file-shaped items --------------------------------------------------

for (const item of nodeBackup.CAPTURE) {
  if (item.kind === 'derived') continue;         // handled below, they need work

  const dest = stage ? path.join(stage, 'files', item.id) : null;
  let sources = [];

  if (item.kind === 'file') {
    const p = item.at(HOME);
    if (!exists(p)) { skip(item, `not present at ${p.replace(HOME, '~')}`, { fatal: !item.optional }); continue; }
    sources = [{ from: p, rel: path.basename(p), bytes: fs.statSync(p).size }];
  } else if (item.kind === 'files') {
    for (const p of item.at(HOME)) {
      if (exists(p)) sources.push({ from: p, rel: path.basename(p), bytes: fs.statSync(p).size });
    }
    if (!sources.length) { skip(item, 'none of these files are present on this machine', { fatal: !item.optional }); continue; }
  } else if (item.kind === 'dir') {
    const d = item.at(HOME);
    if (!exists(d)) { skip(item, `not present at ${d.replace(HOME, '~')}`, { fatal: !item.optional }); continue; }
    sources = walkFiles(d, { maxAgeDays: item.maxAgeDays, skipEntries: item.skipEntries || [] });
    if (!sources.length) {
      skip(item, item.maxAgeDays
        ? `nothing in ${d.replace(HOME, '~')} has changed in the last ${item.maxAgeDays} days`
        : `${d.replace(HOME, '~')} is empty`);
      continue;
    }
  } else if (item.kind === 'glob') {
    const d = item.at(HOME);
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { entries = []; }
    for (const e of entries) {
      if (!e.isFile() || !item.match.test(e.name)) continue;
      const full = path.join(d, e.name);
      sources.push({ from: full, rel: e.name, bytes: fs.statSync(full).size });
    }
    if (!sources.length) { skip(item, `nothing in ${d.replace(HOME, '~')} is ${item.matchText}`, { fatal: !item.optional }); continue; }
  } else if (item.kind === 'claude-memory') {
    // The folder NAME is derived from a checkout's absolute path, so it differs
    // on every machine and cannot be copied across by hand — the mistake the
    // old provisioning document made. Each memory folder is therefore stored
    // under the CHECKOUT PATH it belongs to, and the restore side re-derives
    // the name from the new machine's own path.
    const projects = item.at(HOME);
    let dirs = [];
    try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch (_) { dirs = []; }
    for (const d of dirs) {
      const mem = path.join(projects, d.name, 'memory');
      if (!exists(mem)) continue;
      for (const f of walkFiles(mem)) {
        sources.push({ from: f.from, rel: path.posix.join(d.name, f.rel), bytes: f.bytes });
      }
    }
    if (!sources.length) { skip(item, 'no agent memory folders on this machine have any content yet'); continue; }
  }

  if (DRY) {
    // Predict the tail rather than the file, or the dry run advertises a size
    // the real run will never write — and the whole point of a dry run is that
    // it is a faithful description of what is about to happen.
    const cap = Number.isFinite(item.tailBytes) && item.tailBytes > 0 ? item.tailBytes : Infinity;
    const bytes = sources.reduce((n, s) => n + Math.min(s.bytes, cap), 0);
    record(item, sources.length, bytes);
    continue;
  }

  let files = 0;
  let bytes = 0;
  const heldBack = [];
  let truncatedCount = 0;
  for (const s of sources) {
    const res = stageFile({ from: s.from, to: path.join(dest, s.rel), scan: item.scanForSecrets, tailBytes: item.tailBytes });
    if (res.ok) {
      files += 1;
      bytes += res.bytes;
      if (res.truncated) {
        truncatedCount += 1;
        notes.push(`${item.title}: ${s.rel} was ${nodeBackup.humanBytes(res.originalBytes)} and only its last `
          + `${nodeBackup.humanBytes(item.tailBytes)} was kept. The file says so at the top.`);
      }
    } else heldBack.push(`${s.rel} ${res.why}`);
  }
  if (truncatedCount) {
    say(`  note      ${truncatedCount} large log file(s) captured as their recent tail — see the manifest.`);
  }
  for (const h of heldBack) notes.push(`${item.title}: ${h}`);
  if (!files) skip(item, heldBack.length ? heldBack.join('; ') : 'every file in it could not be read', { fatal: !item.optional });
  else record(item, files, bytes);
}

// --- the commits that exist on one disk -------------------------------------
//
// The item this whole feature was really written for. A branch whose commits
// are all reachable from some origin ref is safe on GitHub and is skipped, and
// SAID to be skipped — otherwise "no bundles" is ambiguous between "nothing at
// risk" and "the sweep did not run".

const gitBundles = [];
{
  const item = nodeBackup.CAPTURE.find((c) => c.id === 'git-bundles');
  const homes = new Set();
  for (const repo of nodeProvision.requiredRepos()) {
    if (exists(path.join(repo.home, '.git'))) homes.add(repo.home);
    const elsewhere = nodeProvision.findRepoElsewhere(repo.name, repo.home, HOME);
    if (elsewhere) homes.add(elsewhere);
  }
  if (!homes.size) {
    skip(item, 'no checkouts were found on this machine, so nothing could be swept');
  } else {
    let files = 0;
    let bytes = 0;
    let safe = 0;
    for (const home of homes) {
      const repoName = path.basename(home);
      // Fetch first, so "not on origin" is measured against what GitHub has NOW
      // rather than against whatever this machine last heard. A stale answer
      // here bundles work that is already safe, which is only waste — but it
      // also MISSES nothing, so a failed fetch is a note, not a failure.
      if (run('git', ['-C', home, 'fetch', '--quiet', 'origin'], { timeoutMs: 60000 }) === null) {
        notes.push(`${repoName}: could not reach GitHub to check which branches are already pushed, so this sweep measured against the last known state of origin.`);
      }
      const branches = (run('git', ['-C', home, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/']) || '')
        .split('\n').map((s) => s.trim()).filter(Boolean);
      for (const branch of branches) {
        const countRaw = run('git', ['-C', home, 'rev-list', '--count', branch, '--not', '--remotes=origin']);
        const commits = countRaw === null ? null : Number(countRaw.trim());
        if (commits === null) { notes.push(`${repoName}/${branch}: could not be measured, so it is not known whether its commits are on GitHub.`); continue; }
        if (commits === 0) { safe += 1; continue; }
        if (DRY) {
          gitBundles.push({ repo: repoName, branch, commits });
          files += 1;
          bytes = null;          // a dry run writes no bundle, so it has no size to report
          continue;
        }
        const safeName = `${repoName}__${branch.replace(/[^A-Za-z0-9._-]/g, '_')}.bundle`;
        const dest = path.join(stage, 'files', 'git-bundles', safeName);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        // A THIN bundle: it carries only the commits origin does not have, and
        // names the rest as prerequisites. A full one would be hundreds of
        // megabytes of history GitHub already holds.
        const made = run('git', ['-C', home, 'bundle', 'create', dest, branch, '--not', '--remotes=origin'], { timeoutMs: 180000 });
        if (made === null || !exists(dest)) {
          notes.push(`${repoName}/${branch}: has ${commits} commit(s) not on GitHub and the bundle could NOT be written. This work is still on one disk only.`);
          hardFailure = true;
          continue;
        }
        const sz = fs.statSync(dest).size;
        gitBundles.push({ repo: repoName, branch, commits });
        files += 1;
        bytes += sz;
      }
    }
    notes.push(`Branch sweep: ${safe} branch(es) were already fully on GitHub and needed no bundle.`);
    if (files) record(item, files, bytes);
    else skip(item, `every branch across ${homes.size} checkout(s) is already fully pushed to GitHub — there is nothing at risk on this disk`);
  }
}

// --- the description of the machine itself ----------------------------------

{
  const item = nodeBackup.CAPTURE.find((c) => c.id === 'machine-report');
  const parts = [];
  const section = (title, value) => {
    parts.push(`## ${title}\n`);
    parts.push(value && value.trim() ? value.trim() : '(could not be read on this machine)');
    parts.push('');
  };
  section('macOS', run('sw_vers', []));
  section('Node', `${run('node', ['-v']) || ''}\nnpm ${run('npm', ['-v']) || ''}`);
  section('Homebrew packages installed by hand', run('brew', ['leaves'], { timeoutMs: 60000 }));
  section('launchd jobs loaded', (run('launchctl', ['list']) || '')
    .split('\n').filter((l) => /starcaster|danechristensen|alphire/i.test(l)).join('\n'));
  section('Checkouts', nodeProvision.requiredRepos()
    .map((r) => `${r.name}: ${exists(path.join(r.home, '.git')) ? r.home.replace(HOME, '~') : (nodeProvision.findRepoElsewhere(r.name, r.home, HOME) || 'NOT ON THIS MACHINE').replace(HOME, '~')}`)
    .join('\n'));
  // keepOutputOnFailure: doctor:node exits 1 on any FAIL, and a FAIL is
  // precisely what the replacement machine needs to be compared against.
  section('doctor:node, in full', run('npm', ['run', '--silent', 'doctor:node'], { cwd: ROOT, timeoutMs: 180000, keepOutputOnFailure: true }));

  const text = `# What was on \`${node.name}\`\n\nRecorded ${new Date().toISOString()}.\n\n`
    + 'This is the comparison sheet. Stand the replacement machine up, run `npm run doctor:node`\n'
    + 'on it, and diff it against the section below: anything that differs is something the\n'
    + 'rebuild has not finished doing.\n\n'
    + parts.join('\n');

  const hits = nodeBackup.scanForSecrets(text);
  if (hits.length) {
    // The report is generated, so a hit here means a command printed something
    // it should not have. Holding it back is right, and so is being loud: this
    // is a finding about the commands, not about the backup.
    skip(item, `held back — the generated report matched ${hits.map((h) => h.name).join(' and ')}, which means one of the commands it runs is printing a credential. That is worth fixing.`);
    hardFailure = true;
  } else if (DRY) {
    record(item, 1, Buffer.byteLength(text));
  } else {
    const dest = path.join(stage, 'files', 'machine-report', 'machine-report.md');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    record(item, 1, Buffer.byteLength(text));
  }
}

// ---------------------------------------------------------------------------
// The manifest.
// ---------------------------------------------------------------------------

const takenAt = new Date().toISOString();
const manifest = nodeBackup.renderManifest({
  node: node.name,
  takenAt,
  captured,
  skipped,
  totalBytes,
  gitBundles,
  notes,
});

say('');
say(`${captured.length} captured, ${skipped.length} skipped, ${nodeBackup.humanBytes(totalBytes)} total.`);

if (DRY) {
  say('');
  say('DRY RUN — nothing was written and nothing was pushed. The manifest it would write:');
  say('');
  say(manifest.split('\n').map((l) => `  │ ${l}`).join('\n'));
  flush();
  process.exit(hardFailure ? 1 : 0);
}

fs.writeFileSync(path.join(stage, 'MANIFEST.md'), manifest);

if (LOCAL_ONLY) {
  say('');
  say(`--local-only — staged and not pushed. It is at:\n  ${stage}`);
  flush();
  process.exit(hardFailure ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The push.
//
// A cached clone rather than a fresh one each night: a fresh clone re-downloads
// the whole history every time, and the history is the point of using a repo.
// Each machine writes only into its OWN folder, so two machines backing up in
// the same minute touch disjoint paths and the rebase resolves without a
// conflict ever being possible.
// ---------------------------------------------------------------------------

const cache = path.join(HOME, 'Library', 'Application Support', 'starcaster', 'backup', 'repo');
const remote = `https://github.com/${nodeBackup.BACKUP_REPO}.git`;

if (!exists(path.join(cache, '.git'))) {
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  say('');
  say(`Cloning the backup repo (first run on this machine)…`);
  if (run('git', ['clone', '--quiet', remote, cache], { timeoutMs: 300000 }) === null) {
    say('');
    say(`COULD NOT REACH THE BACKUP REPO — ${nodeBackup.BACKUP_REPO}.`);
    say('The backup was taken and is staged locally, but it has not left this machine:');
    say(`  ${stage}`);
    say('');
    say('Either the repo does not exist yet or this machine cannot authenticate to GitHub.');
    say(`  Create it:       gh repo create ${nodeBackup.BACKUP_REPO} --private`);
    say('  Authenticate:    gh auth login && gh auth setup-git');
    flush();
    process.exit(2);
  }
}

run('git', ['-C', cache, 'fetch', '--quiet', 'origin'], { timeoutMs: 120000 });
run('git', ['-C', cache, 'reset', '--hard', '--quiet', 'origin/HEAD'], { timeoutMs: 60000 });

const folder = path.join(cache, nodeBackup.nodeFolder(node.name));
fs.rmSync(folder, { recursive: true, force: true });
fs.mkdirSync(folder, { recursive: true });
fs.cpSync(stage, folder, { recursive: true });

run('git', ['-C', cache, 'add', '--all', nodeBackup.nodeFolder(node.name)]);
const staged = run('git', ['-C', cache, 'diff', '--cached', '--name-only']) || '';

if (!staged.trim()) {
  say('');
  say('Nothing on this machine has changed since the last backup — no new copy was pushed.');
} else {
  const msg = `${node.name}: backup ${takenAt}\n\n${captured.length} items, ${nodeBackup.humanBytes(totalBytes)}.`
    + `${skipped.length ? ` ${skipped.length} skipped (see MANIFEST.md).` : ''}`;
  if (run('git', ['-C', cache, 'commit', '--quiet', '-m', msg]) === null) {
    say('');
    say('The backup was staged into the repo clone but the commit failed. It is at:');
    say(`  ${folder}`);
    flush();
    process.exit(1);
  }
  if (run('git', ['-C', cache, 'push', '--quiet', 'origin', 'HEAD'], { timeoutMs: 300000 }) === null) {
    say('');
    say('COULD NOT PUSH — the backup is committed in the local clone but has not left this machine:');
    say(`  ${folder}`);
    say('  Retry with: git -C "$HOME/Library/Application Support/starcaster/backup/repo" push origin HEAD');
    flush();
    process.exit(1);
  }
  say('');
  say(`Pushed to ${nodeBackup.BACKUP_REPO} under ${nodeBackup.nodeFolder(node.name)}/.`);
}

// ---------------------------------------------------------------------------
// The stamp. Written LAST and only on a real success, for the same reason
// lib/nodeHeartbeat.js writes a beat last: a stamp written by reaching the end
// of the function is a stamp that records the code path running, not the
// backup working — and `doctor:node` reads this to tell somebody they are safe.
// ---------------------------------------------------------------------------

if (!hardFailure) {
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({
    node: node.name,
    at: takenAt,
    items: captured.length,
    skipped: skipped.length,
    bytes: totalBytes,
    repo: nodeBackup.BACKUP_REPO,
  }, null, 2));
} else {
  say('');
  say('NO STAMP WRITTEN — something the inventory requires could not be captured, so this');
  say('does not count as a backup and `doctor:node` will keep saying one is due.');
}

fs.rmSync(stage, { recursive: true, force: true });
flush();
process.exit(hardFailure ? 1 : 0);
