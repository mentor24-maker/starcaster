#!/usr/bin/env node
/**
 * scripts/archive_mac.mjs — copy what Drive is missing from the Mac's Desktop,
 * Downloads and old "Desktop - Dane's MacBook Pro (2)" folder, verify it, and
 * only then move the copies off the Mac. Slice 3 of 86bbvqh4z (ticket
 * 86bbvr0yr); the rules live in lib/archiveMac.js.
 *
 *   npm run archive:mac -- plan            walk + fingerprint the folders, list both Drives, write the plan (moves nothing)
 *   npm run archive:mac -- run             upload + verify every pending file (resumable; refuses if a Drive is too full)
 *   npm run archive:mac -- status          how far the run has got
 *   npm run archive:mac -- clear           DRY RUN: which files could leave the Mac right now, and why the rest stay
 *   npm run archive:mac -- clear --apply   move exactly those files into the Trash (only after Dane approves the dry run)
 *
 * Options (tests use these to point everything at scratch folders):
 *   --home <dir>          whose Desktop/Downloads      (default your home folder)
 *   --state <dir>         plan, ledger, logs, record   (default ~/archive-index/mac)
 *   --trash <dir>         where clear --apply moves to (default ~/.Trash/Archived-from-Mac-<time>)
 *   --remote m24=<target> --remote gdrive=<target>     use another rclone target for a Drive
 *
 * RESUMABLE. Uploads go in batches; every verified file is appended to
 * <state>/ledger.jsonl the moment its MD5 is read back from Drive, and `run`
 * skips anything already verified. Kill it, let the laptop sleep, run it again.
 *
 * NOTHING IS DELETED. `run` only copies. `clear --apply` MOVES files into the
 * Trash, deciding from a FRESH listing of both Drives and a fresh fingerprint
 * of each file on the Mac — a file goes only when a byte-identical copy (MD5 +
 * size) is on a Drive right then. Emptying the Trash is Dane's step.
 *
 * Cloud placeholders ("dataless" files — the name is on the Mac, the bytes are
 * not) are never read, uploaded or moved: reading one would start a download.
 *
 * EXIT CODES (docs/DOCTRINE.md §5.33):
 *   0  done: every file verified / every eligible file moved (or, dry run, movable)
 *   1  finished, but some files failed, are held, or would not fit — listed
 *   2  could not take a reading at all (no plan, a folder missing, rclone failed)
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mac = require(path.join(ROOT, 'lib', 'archiveMac.js'));
const idx = require(path.join(ROOT, 'lib', 'archiveIndex.js'));
const route = require(path.join(ROOT, 'lib', 'archiveRoute.js'));

const argv = process.argv.slice(2);
const cmd = argv[0];
const argValues = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const has = (flag) => argv.includes(flag);
const HOME = path.resolve(argValues('--home')[0] || os.homedir());
const STATE = path.resolve(argValues('--state')[0] || path.join(os.homedir(), 'archive-index', 'mac'));
const OVERRIDES = Object.fromEntries(argValues('--remote').map((s) => [s.slice(0, s.indexOf('=')) + ':', s.slice(s.indexOf('=') + 1)]));

const PLAN_JSON = path.join(STATE, 'plan.json');
const LEDGER = path.join(STATE, 'ledger.jsonl');
const LOG = path.join(STATE, 'run.log');
const HASH_CACHE = path.join(STATE, 'hash-cache.json');

const stamp = () => new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'medium' });
function log(s) {
  const line = `${stamp()}  ${s}`;
  process.stderr.write(`${line}\n`);
  try { fs.appendFileSync(LOG, `${line}\n`); } catch { /* state dir not made yet */ }
}

function cannotTell(msg) {
  console.error(`CANNOT TELL — ${msg}`);
  process.exit(2);
}

function rclone(args) {
  const r = spawnSync('rclone', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) return { ok: false, err: r.error.message };
  if (r.status !== 0) return { ok: false, err: (r.stderr || '').trim().split('\n').slice(-3).join(' | ') || `exit ${r.status}` };
  return { ok: true, out: r.stdout };
}

// A Drive, or the scratch folder standing in for it, plus a path under it.
function target(remote, sub) {
  if (OVERRIDES[remote]) return path.join(OVERRIDES[remote], sub);
  return `${remote}${sub}`;
}

// ---------------------------------------------------------------------------
// The three folders, found on disk. The old Desktop folder's name has a curly
// apostrophe, so it is found by prefix rather than typed.
function folders() {
  const names = mac.FOLDERS.concat(fs.readdirSync(HOME).filter((n) => n.startsWith(mac.OLD_DESKTOP_PREFIX)).sort());
  return names.map((name) => ({ folder: name, abs: path.join(HOME, name) }));
}

// Walk one folder. Symbolic links are not followed or archived; .git and
// node_modules folders are not walked into — both are COUNTED, so the report
// states what was left alone instead of silently not seeing it.
function walk(root, folder, out, left) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let items;
    try { items = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (e) {
      out.push({ folder, rel: rel || '.', size: 0, error: `could not list the folder (${e.code || e.message})` });
      continue;
    }
    for (const d of items) {
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) { left.symlinks += 1; continue; }
      if (d.isDirectory()) {
        if (idx.skipReason(childRel)) { left.skippedDirs.push(`${folder}/${childRel}`); continue; }
        stack.push(childRel);
        continue;
      }
      if (!d.isFile()) continue;
      try {
        const st = fs.statSync(path.join(root, childRel));
        out.push({ folder, rel: childRel, size: st.size, mtime: Math.floor(st.mtimeMs) });
      } catch (e) {
        out.push({ folder, rel: childRel, size: 0, error: e.code || e.message });
      }
    }
  }
}

// Files whose bytes live in the cloud, not on this disk. `find -flags` is the
// one way to read that flag without opening the file (opening it downloads it).
function datalessSet(root) {
  const r = spawnSync('find', [root, '-type', 'f', '-flags', '+dataless', '-print0'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 && !r.stdout) return null;
  return new Set(r.stdout.split('\0').filter(Boolean).map((p) => path.relative(root, p)));
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(HASH_CACHE, 'utf8')); } catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(HASH_CACHE, JSON.stringify(cache));
}

function md5File(abs) {
  const h = crypto.createHash('md5');
  const fd = fs.openSync(abs, 'r');
  const buf = Buffer.allocUnsafe(8 << 20);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// The MD5 of a file as it is now, from the cache when its size and time are
// unchanged. Returns { hash } or { error }.
function fingerprint(abs, size, mtime, cache) {
  const k = `${abs}|${size}|${mtime}`;
  if (cache[k]) return { hash: cache[k] };
  try {
    const hash = md5File(abs);
    cache[k] = hash;
    return { hash };
  } catch (e) {
    return { error: e.code || e.message };
  }
}

// Every file on both Drives, by Drive's own MD5 — nothing is downloaded.
function driveListing() {
  const where = new Map();
  for (const [remote, name] of [['m24:', 'mentor24'], ['gdrive:', 'mentorofaio']]) {
    const t = target(remote, '');
    if (OVERRIDES[remote] && !fs.existsSync(t)) continue;
    log(`listing ${name} with Drive's own fingerprints (this takes a few minutes)…`);
    const r = rclone(['lsjson', t, '-R', '--files-only', '--hash', '--hash-type', 'md5']);
    if (!r.ok) cannotTell(`could not list ${name}: ${r.err}. Nothing moved.`);
    for (const f of JSON.parse(r.out)) {
      if (f.Hashes && f.Hashes.md5 && f.Size > 0) {
        const k = `${f.Hashes.md5}:${f.Size}`;
        if (!where.has(k)) where.set(k, `${name}: ${f.Path}`);
      }
    }
  }
  return where;
}

function freeSpace() {
  const out = {};
  for (const remote of ['m24:', 'gdrive:']) {
    const r = rclone(['about', target(remote, ''), '--json']);
    out[remote] = r.ok ? JSON.parse(r.out).free ?? null : null;
  }
  return out;
}

function loadPlan() {
  if (!fs.existsSync(PLAN_JSON)) cannotTell(`no plan at ${PLAN_JSON} — run "plan" first`);
  return JSON.parse(fs.readFileSync(PLAN_JSON, 'utf8'));
}

function loadLedger() {
  const m = new Map();
  if (!fs.existsSync(LEDGER)) return m;
  for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(l);
    const prev = m.get(e.id);
    // A later success beats an earlier failure; a later failure never erases a success.
    if (!prev || e.verified || !prev.verified) m.set(e.id, e);
  }
  return m;
}

const tsvCell = (c) => String(c ?? '').replace(/[\t\n]/g, ' ');
const tsv = (rows) => rows.map((r) => r.map(tsvCell).join('\t')).join('\n') + '\n';

// ---------------------------------------------------------------------------
function cmdPlan() {
  fs.mkdirSync(STATE, { recursive: true });
  const roots = folders();
  for (const r of roots) if (!fs.existsSync(r.abs)) cannotTell(`${r.abs} is not there. No plan written.`);
  const files = [];
  const left = { symlinks: 0, skippedDirs: [] };
  for (const r of roots) {
    log(`walking ${r.abs}`);
    const before = files.length;
    walk(r.abs, r.folder, files, left);
    const dl = datalessSet(r.abs);
    if (!dl) cannotTell(`could not ask which files in ${r.abs} are cloud placeholders. No plan written.`);
    for (const f of files.slice(before)) if (dl.has(f.rel)) f.dataless = true;
  }
  const cache = loadCache();
  const toHash = files.filter((f) => !f.error && !f.dataless && f.size > 0 && !idx.skipReason(f.rel));
  const total = toHash.reduce((s, f) => s + f.size, 0);
  log(`fingerprinting ${toHash.length} file(s), ${idx.humanBytes(total)} (cached ones are not re-read)`);
  let done = 0;
  let next = 10 * 1024 ** 3;
  const abs = Object.fromEntries(roots.map((r) => [r.folder, r.abs]));
  for (const f of toHash) {
    const fp = fingerprint(path.join(abs[f.folder], f.rel), f.size, f.mtime, cache);
    if (fp.error) f.error = fp.error; else f.hash = fp.hash;
    done += f.size;
    if (done >= next) { log(`  ${idx.humanBytes(done)} of ${idx.humanBytes(total)}`); saveCache(cache); next += 10 * 1024 ** 3; }
  }
  saveCache(cache);

  const rows = mac.plan(files, driveListing());
  fs.writeFileSync(PLAN_JSON, JSON.stringify(rows));
  fs.writeFileSync(path.join(STATE, 'plan.tsv'), tsv([
    ['action', 'folder', 'file', 'bytes', 'goes to / reason'],
    ...rows.map((r) => [r.action, r.folder, r.rel, r.size, r.action === 'UPLOAD' ? `${mac.describeDest(r.dest)} (${r.dest.reason})` : r.reason]),
  ]));
  fs.writeFileSync(path.join(STATE, 'left-alone.txt'), `${left.skippedDirs.length} folder(s) not walked (.git, node_modules and similar):\n${left.skippedDirs.join('\n')}\n${left.symlinks} symbolic link(s) not followed.\n`);
  const s = mac.summarize(rows);
  console.log(`Plan: ${path.join(STATE, 'plan.tsv')}`);
  console.log(`${s.files} files in ${roots.map((r) => r.folder).join(', ')}:`);
  console.log(`  ${s.upload} to upload, ${idx.humanBytes(s.uploadBytes)} (${s.video} video, ${idx.humanBytes(s.videoBytes)}, to mentorofaio; the rest to mentor24)`);
  console.log(`  ${s.onDrive} already on a Drive (or a duplicate of one being uploaded), ${idx.humanBytes(s.onDriveBytes)}`);
  console.log(`  ${s.skip - s.onDrive} left alone (empty or system files), ${s.hold} on hold (${idx.humanBytes(s.holdBytes)} — placeholders or unreadable)`);
  console.log(`  ${left.skippedDirs.length} .git/node_modules-type folder(s) and ${left.symlinks} link(s) not walked — listed in left-alone.txt`);
  const fit = mac.fits(rows, freeSpace());
  for (const l of fit.lines) console.log(`  ${l}`);
  return fit.ok ? 0 : 1;
}

function cmdRun() {
  fs.mkdirSync(STATE, { recursive: true });
  const rows = loadPlan();
  const ledger = loadLedger();
  const fit = mac.fits(rows, freeSpace(), ledger);
  for (const l of fit.lines) log(l);
  if (!fit.ok) { log('run: not starting — a half-archived folder is worse than one never started'); return 1; }
  const abs = Object.fromEntries(folders().map((r) => [r.folder, r.abs]));
  const pending = rows.filter((r) => r.action === 'UPLOAD' && !(ledger.get(mac.rowId(r)) || {}).verified);
  const groups = mac.batches(pending);
  log(`run: ${pending.length} file(s) still to upload in ${groups.length} batch(es), ${idx.humanBytes(pending.reduce((s, r) => s + r.size, 0))}`);

  let failed = 0;
  let b = 0;
  for (const g of groups) {
    b += 1;
    const base = g.remote === 'gdrive:' ? `${mac.GDRIVE_PREFIX}/${g.folder}` : `${mac.M24_PREFIX}/${g.folder}`;
    const dest = target(g.remote, base);
    log(`batch ${b}/${groups.length}: ${g.rows.length} file(s), ${idx.humanBytes(g.bytes)} from ${g.folder} → ${g.remote === 'gdrive:' ? 'mentorofaio' : 'mentor24'}`);
    const record = (r, fields) => {
      const e = { id: mac.rowId(r), dest: mac.describeDest(r.dest), at: new Date().toISOString(), ...fields };
      fs.appendFileSync(LEDGER, JSON.stringify(e) + '\n');
      ledger.set(e.id, e);
      if (!e.verified) { failed += 1; log(`  FAILED ${e.id}: ${e.error}`); }
    };
    if (!abs[g.folder] || !fs.existsSync(abs[g.folder])) { for (const r of g.rows) record(r, { verified: false, error: `${g.folder} is no longer there` }); continue; }
    const list = path.join(STATE, 'files-from.txt');
    fs.writeFileSync(list, g.rows.map((r) => r.rel).join('\n') + '\n');
    const up = rclone(['copy', abs[g.folder], dest, '--files-from-raw', list, '--ignore-existing', '--transfers', '4', '--retries', '5', '--low-level-retries', '20', '--log-file', path.join(STATE, 'rclone.log'), '--log-level', 'INFO']);
    if (!up.ok) log(`  upload reported a problem (${up.err}); verifying what arrived anyway`);
    // Verification is a separate read, never the upload's exit code: ask Drive
    // for the MD5 and size of what it now holds at those paths, and compare it
    // with the fingerprint the plan took of the bytes on the Mac.
    const seen = rclone(['lsjson', dest, '-R', '--files-only', '--hash', '--hash-type', 'md5', '--files-from-raw', list]);
    if (!seen.ok) { for (const r of g.rows) record(r, { verified: false, error: `could not read back from Drive: ${seen.err}` }); continue; }
    const there = new Map(JSON.parse(seen.out).map((f) => [route.nameKey(f.Path), f]));
    for (const r of g.rows) {
      const f = there.get(route.nameKey(r.rel));
      if (!f) record(r, { verified: false, md5: r.hash, error: 'not on Drive after the upload' });
      else if (f.Size !== r.size) record(r, { verified: false, md5: r.hash, error: `Drive holds ${f.Size} bytes, expected ${r.size} — the file changed since the plan, or a different file sits at that path` });
      else if (!f.Hashes || f.Hashes.md5 !== r.hash) record(r, { verified: false, md5: r.hash, error: `Drive's fingerprint ${(f.Hashes && f.Hashes.md5) || '(none)'} does not match ${r.hash}` });
      else record(r, { verified: true, md5: r.hash });
    }
    const s = mac.summarize(rows, ledger);
    log(`  progress: ${s.verified}/${s.upload} verified (${idx.humanBytes(s.verifiedBytes)} of ${idx.humanBytes(s.uploadBytes)}), ${s.failed} failed`);
  }
  const s = mac.summarize(rows, ledger);
  log(`run finished: ${s.verified}/${s.upload} verified, ${s.failed} failed${failed ? ' — see FAILED lines above' : ''}`);
  return s.verified === s.upload ? 0 : 1;
}

function cmdStatus() {
  const rows = loadPlan();
  const ledger = loadLedger();
  const s = mac.summarize(rows, ledger);
  console.log(`${s.verified} of ${s.upload} uploads verified on Drive (${idx.humanBytes(s.verifiedBytes)} of ${idx.humanBytes(s.uploadBytes)}); ${s.failed} failed; ${s.upload - s.verified - s.failed} not attempted yet. ${s.onDrive} were already on a Drive, ${s.hold} on hold.`);
  for (const r of rows) {
    const l = ledger.get(mac.rowId(r));
    if (r.action === 'UPLOAD' && l && !l.verified) console.log(`  FAILED  ${mac.rowId(r)}: ${l.error}`);
  }
  return s.verified === s.upload && !s.failed ? 0 : 1;
}

// ---------------------------------------------------------------------------
function cmdClear() {
  const apply = has('--apply');
  const rows = loadPlan();
  const ledger = loadLedger();
  const abs = Object.fromEntries(folders().map((r) => [r.folder, r.abs]));
  const trash = path.resolve(argValues('--trash')[0] || path.join(HOME, '.Trash', `Archived-from-Mac-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}`));
  const drive = driveListing();
  const presentOnDrive = (h, size) => drive.has(`${h}:${size}`);
  const cache = loadCache();

  const record = [['folder', 'file', 'bytes', 'plan', 'where the Drive copy is', 'outcome']];
  let moved = 0;
  let movedBytes = 0;
  let kept = 0;
  let keptBytes = 0;
  const why = new Map();
  for (const r of rows) {
    const file = abs[r.folder] ? path.join(abs[r.folder], r.rel) : null;
    let now = null;
    if (file && r.action !== 'HOLD') {
      try {
        const st = fs.statSync(file);
        const fp = st.size > 0 ? fingerprint(file, st.size, Math.floor(st.mtimeMs), cache) : { hash: '' };
        now = { size: st.size, hash: fp.hash || '' };
      } catch { now = null; }
    }
    const v = mac.clearable(r, now, presentOnDrive);
    const copy = now && now.hash ? drive.get(`${now.hash}:${now.size}`) || '' : '';
    let outcome;
    if (v.gone) outcome = 'already gone';
    else if (!v.ok) {
      outcome = `KEPT — ${v.why}`;
      if (!v.why.startsWith('left in place')) {
        kept += 1;
        keptBytes += r.size;
        why.set(v.why, (why.get(v.why) || 0) + 1);
      }
    } else {
      if (apply) {
        const to = path.join(trash, r.folder, r.rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(file, to);
        outcome = 'moved to the Trash';
      } else outcome = 'would move to the Trash';
      moved += 1;
      movedBytes += r.size;
    }
    const l = ledger.get(mac.rowId(r));
    record.push([r.folder, r.rel, r.size, r.action === 'UPLOAD' ? `upload${l && l.verified ? ' (verified)' : ' (NOT verified)'}` : r.reason, copy, outcome]);
  }
  saveCache(cache);
  fs.mkdirSync(STATE, { recursive: true });
  const recordFile = path.join(STATE, apply ? 'record.tsv' : 'clear-dry-run.tsv');
  fs.writeFileSync(recordFile, tsv(record));
  if (apply) log(`clear --apply: moved ${moved} file(s), ${idx.humanBytes(movedBytes)}, into ${trash}`);
  console.log(`${apply ? 'Moved' : 'Would move'} ${moved} file(s), ${idx.humanBytes(movedBytes)}, ${apply ? 'into' : 'to'} the Trash${apply ? ` (${trash})` : ''}; ${kept} file(s), ${idx.humanBytes(keptBytes)}, stay on the Mac because they are not safely on a Drive.`);
  for (const [w, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${w}`);
  console.log(`Record: ${recordFile}`);
  if (!apply) console.log('Dry run — nothing moved. Add --apply to move exactly the files marked "would move".');
  return kept ? 1 : 0;
}

const commands = { plan: cmdPlan, run: cmdRun, status: cmdStatus, clear: cmdClear };
if (!commands[cmd]) {
  console.error('usage: npm run archive:mac -- plan | run | status | clear [--apply]');
  process.exit(2);
}
process.exit(commands[cmd]());
