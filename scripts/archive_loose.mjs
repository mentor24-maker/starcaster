#!/usr/bin/env node
/**
 * scripts/archive_loose.mjs — copy every loose file on MaxOne (the ones never
 * inside a zip) that no Drive holds, read each one back, and COUNT what is
 * still not backed up. Ticket 86bc75y9r, blocking slice 4 of 86bbvqh4z; the
 * rules live in lib/archiveLoose.js.
 *
 *   npm run archive:loose -- plan            fingerprint the loose files the index did not, write the plan (moves nothing)
 *   npm run archive:loose -- run             upload + verify every pending file (resumable)
 *   npm run archive:loose -- status          THE COUNT: a fresh Drive listing against every loose file on MaxOne
 *
 * Options (tests use these to point everything at scratch folders):
 *   --index <file>        slice 1's index.jsonl       (default ~/archive-index/index.jsonl)
 *   --state <dir>         plan, ledger, logs, cache   (default ~/archive-index/loose)
 *   --maxone <dir>        where MaxOne is mounted     (default /Volumes/maxone)
 *   --remote m24=<target> --remote gdrive=<target>    use another rclone target for a Drive
 *
 * `status` is the number slice 4 waits on, and it is taken the honest way: it
 * lists both Drives at that moment and asks, for each loose file the index saw
 * on MaxOne, whether a file with the same MD5 and size is there now. Not the
 * ledger, not the upload's exit code. It prints 0 missing, or names every
 * missing file with a reason. Exit 0 only on 0 missing.
 *
 * RESUMABLE. Every verified file is appended to <state>/ledger.jsonl the moment
 * its MD5 is read back from Drive, and `run` skips anything already verified.
 *
 * NOTHING IS DELETED, by any command here. Deleting from MaxOne is slice 4's
 * job and it is gated on Dane.
 *
 * EXIT CODES (docs/DOCTRINE.md §5.33):
 *   0  plan: every file settled / run: every file verified / status: 0 missing
 *   1  finished, but something is held, failed, or still missing — listed
 *   2  could not take a reading at all (no index, MaxOne not mounted, rclone failed)
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
const loose = require(path.join(ROOT, 'lib', 'archiveLoose.js'));
const route = require(path.join(ROOT, 'lib', 'archiveRoute.js'));
const idx = require(path.join(ROOT, 'lib', 'archiveIndex.js'));

const HOME = os.homedir();
const argv = process.argv.slice(2);
const cmd = argv[0];
const argValues = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const INDEX = path.resolve(argValues('--index')[0] || path.join(HOME, 'archive-index', 'index.jsonl'));
const STATE = path.resolve(argValues('--state')[0] || path.join(HOME, 'archive-index', 'loose'));
const MAXONE = path.resolve(argValues('--maxone')[0] || '/Volumes/maxone');
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

// A Drive (or the scratch folder standing in for it) plus a path under it.
function target(remote, sub) {
  if (OVERRIDES[remote]) return path.join(OVERRIDES[remote], sub);
  return `${remote}${sub}`;
}

function rclone(args) {
  const r = spawnSync('rclone', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) return { ok: false, err: r.error.message };
  if (r.status !== 0) return { ok: false, err: (r.stderr || '').trim().split('\n').slice(-3).join(' | ') || `exit ${r.status}` };
  return { ok: true, out: r.stdout };
}

// ---------------------------------------------------------------------------
function readIndex() {
  if (!fs.existsSync(INDEX)) cannotTell(`no index at ${INDEX} — run slice 1 first (npm run archive:index)`);
  return fs.readFileSync(INDEX, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function indexAge() {
  const at = fs.statSync(INDEX).mtime;
  const hours = (Date.now() - at.getTime()) / 36e5;
  return `${at.toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'short' })} Mountain (${hours < 1 ? 'under an hour' : `${hours.toFixed(1)} hours`} ago)`;
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

function loadCache() {
  try { return JSON.parse(fs.readFileSync(HASH_CACHE, 'utf8')); } catch { return {}; }
}
function saveCache(cache) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(HASH_CACHE, JSON.stringify(cache));
}

const tsvCell = (c) => String(c ?? '').replace(/[\t\n]/g, ' ');
const tsv = (rows) => rows.map((r) => r.map(tsvCell).join('\t')).join('\n') + '\n';

// ---------------------------------------------------------------------------
// Fingerprinting straight off MaxOne. MaxOne is ExFAT, and macOS may list a
// name there in one Unicode form and open it only by the other (ticket
// 86bc4x5wh); so a name that will not open is tried in its other form before
// it is called unreadable.
function openable(abs) {
  const forms = [abs, abs.normalize('NFC'), abs.normalize('NFD')];
  for (const f of forms) if (fs.existsSync(f)) return f;
  return null;
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

// The MD5 of one loose file as it is on MaxOne now. Returns { hash } or
// { error }; a file whose size no longer matches the index is an error, because
// the plan would then describe a file that is not there any more.
function fingerprint(entry, cache) {
  const abs = openable(path.join(MAXONE, entry.path));
  if (!abs) return { error: 'not found on MaxOne by its indexed name' };
  let st;
  try { st = fs.statSync(abs); } catch (e) { return { error: e.code || e.message }; }
  if (st.size !== entry.size) return { error: `size changed since the index was taken (${entry.size} → ${st.size}) — run npm run archive:index again` };
  const k = `${abs}|${st.size}|${Math.floor(st.mtimeMs)}`;
  if (cache[k]) return { hash: cache[k] };
  try {
    const hash = md5File(abs);
    cache[k] = hash;
    return { hash };
  } catch (e) {
    return { error: e.code || e.message };
  }
}

// Every file on both Drives by Drive's own MD5 — nothing is downloaded. The
// same three listings slice 2's delete step takes (root of each Drive, plus
// mentor24's original Personal folder by id, in case it is not under the root).
function driveFingerprints() {
  const present = new Set();
  const listings = [['m24:', '', 'mentor24'], ['m24:', route.M24_PERSONAL_ID, 'mentor24 (the original Personal folder)'], ['gdrive:', '', 'mentorofaio']];
  for (const [remote, rootId, name] of listings) {
    const spec = OVERRIDES[remote] ? (rootId ? path.join(OVERRIDES[remote], rootId) : OVERRIDES[remote]) : remote;
    const flags = !OVERRIDES[remote] && rootId ? ['--drive-root-folder-id', rootId] : [];
    if (OVERRIDES[remote] && rootId && !fs.existsSync(spec)) continue;
    log(`listing ${name} with Drive's own fingerprints…`);
    const r = rclone(['lsjson', spec, ...flags, '-R', '--files-only', '--hash', '--hash-type', 'md5']);
    if (!r.ok) cannotTell(`could not list ${name}: ${r.err}`);
    for (const f of JSON.parse(r.out)) if (f.Hashes && f.Hashes.md5 && f.Size > 0) present.add(`${f.Hashes.md5}:${f.Size}`);
  }
  return present;
}

function freeSpace() {
  const out = {};
  for (const remote of ['m24:', 'gdrive:']) {
    const r = rclone(['about', target(remote, ''), '--json']);
    out[remote] = r.ok ? JSON.parse(r.out).free ?? null : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
function cmdPlan() {
  if (!fs.existsSync(MAXONE)) cannotTell(`MaxOne is not mounted at ${MAXONE}`);
  fs.mkdirSync(STATE, { recursive: true });
  const entries = readIndex();
  log(`plan: index taken ${indexAge()}`);
  const cache = loadCache();
  const all = loose.looseEntries(entries);
  const toHash = all.filter((e) => !e.hash && !e.error && e.size > 0 && !idx.skipReason(e.path));
  const total = toHash.reduce((s, e) => s + e.size, 0);
  log(`plan: ${all.length} loose file(s) on MaxOne; ${toHash.length} carry no fingerprint yet (${idx.humanBytes(total)}) — reading them off MaxOne now (cached ones are not re-read)`);
  let done = 0;
  let next = 5 * 1024 ** 3;
  for (const e of toHash) {
    const fp = fingerprint(e, cache);
    if (fp.error) e.error = fp.error; else e.hash = fp.hash;
    done += e.size;
    if (done >= next) { log(`  ${idx.humanBytes(done)} of ${idx.humanBytes(total)}`); saveCache(cache); next += 5 * 1024 ** 3; }
  }
  saveCache(cache);

  const rows = loose.plan(entries, loose.takenPaths(entries));
  fs.writeFileSync(PLAN_JSON, JSON.stringify(rows));
  fs.writeFileSync(path.join(STATE, 'plan.tsv'), tsv([
    ['action', 'file', 'bytes', 'goes to / reason'],
    ...rows.map((r) => [r.action, r.path, r.size, r.action === 'UPLOAD' ? `${loose.describeDest(r.dest)} (${r.dest.reason})` : r.reason]),
  ]));
  const s = loose.summarize(rows);
  console.log(`Plan: ${path.join(STATE, 'plan.tsv')}`);
  console.log(`${s.files} loose files on MaxOne (not inside any zip):`);
  console.log(`  ${s.upload} to upload, ${idx.humanBytes(s.uploadBytes)} (${s.video} video, ${idx.humanBytes(s.videoBytes)}, to mentorofaio; the rest to mentor24)`);
  console.log(`  ${s.onDrive} already on a Drive (or a duplicate of one being uploaded), ${idx.humanBytes(s.onDriveBytes)}`);
  console.log(`  ${s.skip - s.onDrive} left alone (empty or system files), ${s.hold} on hold (${idx.humanBytes(s.holdBytes)} — could not be read; listed in plan.tsv)`);
  const fit = loose.fits(rows, freeSpace());
  for (const l of fit.lines) console.log(`  ${l}`);
  for (const r of rows) if (r.action === 'HOLD') console.log(`  HOLD  ${r.path}: ${r.reason}`);
  return s.hold || !fit.ok ? 1 : 0;
}

function cmdRun() {
  if (!fs.existsSync(MAXONE)) cannotTell(`MaxOne is not mounted at ${MAXONE}`);
  fs.mkdirSync(STATE, { recursive: true });
  const rows = loadPlan();
  const ledger = loadLedger();
  const fit = loose.fits(rows, freeSpace(), ledger);
  for (const l of fit.lines) log(l);
  if (!fit.ok) { log('run: not starting — a Drive that fills mid-run refuses uploads one by one'); return 1; }
  const pending = rows.filter((r) => r.action === 'UPLOAD' && !(ledger.get(loose.rowId(r)) || {}).verified);
  const groups = loose.batches(pending);
  log(`run: ${pending.length} file(s) still to upload in ${groups.length} batch(es), ${idx.humanBytes(pending.reduce((s, r) => s + r.size, 0))}`);

  let failed = 0;
  let b = 0;
  for (const g of groups) {
    b += 1;
    const base = g.remote === 'gdrive:' ? loose.GDRIVE_PREFIX : loose.M24_PREFIX;
    const dest = target(g.remote, base);
    const rel = (r) => r.dest.path.slice(base.length + 1);
    log(`batch ${b}/${groups.length}: ${g.rows.length} file(s), ${idx.humanBytes(g.bytes)} → ${g.remote === 'gdrive:' ? 'mentorofaio' : 'mentor24'}: ${base}/`);
    const settled = new Set();
    const record = (r, fields) => {
      const e = { id: loose.rowId(r), dest: loose.describeDest(r.dest), at: new Date().toISOString(), ...fields };
      fs.appendFileSync(LEDGER, JSON.stringify(e) + '\n');
      ledger.set(e.id, e);
      settled.add(e.id);
      if (!e.verified) { failed += 1; log(`  FAILED ${e.id}: ${e.error}`); }
    };
    // Most files keep their MaxOne path under the Drive folder, so one rclone
    // copy with a list moves them all; a file renamed to dodge a different
    // file already at its path is copied to its new name on its own.
    const plain = g.rows.filter((r) => rel(r) === r.path);
    const renamed = g.rows.filter((r) => rel(r) !== r.path);
    const common = ['--ignore-existing', '--transfers', '4', '--retries', '5', '--low-level-retries', '20', '--log-file', path.join(STATE, 'rclone.log'), '--log-level', 'INFO'];
    if (plain.length) {
      const list = path.join(STATE, 'files-from.txt');
      fs.writeFileSync(list, plain.map((r) => r.path).join('\n') + '\n');
      const up = rclone(['copy', MAXONE, dest, '--files-from-raw', list, ...common]);
      if (!up.ok) log(`  upload reported a problem (${up.err}); verifying what arrived anyway`);
    }
    for (const r of renamed) {
      const src = openable(path.join(MAXONE, r.path));
      if (!src) { record(r, { verified: false, error: 'not found on MaxOne by its indexed name' }); continue; }
      const up = rclone(['copyto', src, OVERRIDES[g.remote] ? path.join(dest, rel(r)) : `${dest}/${rel(r)}`, ...common]);
      if (!up.ok) log(`  upload of ${r.path} reported a problem (${up.err}); verifying what arrived anyway`);
    }
    // Verification is a separate read, never the upload's exit code: ask Drive
    // for the MD5 and size of what it now holds at those paths, and compare it
    // with the fingerprint the plan took of the bytes on MaxOne.
    const toCheck = g.rows.filter((r) => !settled.has(loose.rowId(r)));
    const list = path.join(STATE, 'files-from.txt');
    fs.writeFileSync(list, toCheck.map(rel).join('\n') + '\n');
    const seen = rclone(['lsjson', dest, '-R', '--files-only', '--hash', '--hash-type', 'md5', '--files-from-raw', list]);
    if (!seen.ok) { for (const r of toCheck) record(r, { verified: false, error: `could not read back from Drive: ${seen.err}` }); continue; }
    const there = new Map(JSON.parse(seen.out).map((f) => [route.nameKey(f.Path), f]));
    for (const r of toCheck) {
      const f = there.get(route.nameKey(rel(r)));
      if (!f) record(r, { verified: false, md5: r.hash, error: 'not on Drive after the upload' });
      else if (f.Size !== r.size) record(r, { verified: false, md5: r.hash, error: `Drive holds ${f.Size} bytes, expected ${r.size} — a different file sits at that path` });
      else if (!f.Hashes || f.Hashes.md5 !== r.hash) record(r, { verified: false, md5: r.hash, error: `Drive's fingerprint ${(f.Hashes && f.Hashes.md5) || '(none)'} does not match ${r.hash}` });
      else record(r, { verified: true, md5: r.hash });
    }
    const s = loose.summarize(rows, ledger);
    log(`  progress: ${s.verified}/${s.upload} verified (${idx.humanBytes(s.verifiedBytes)} of ${idx.humanBytes(s.uploadBytes)}), ${s.failed} failed`);
  }
  const s = loose.summarize(rows, ledger);
  log(`run finished: ${s.verified}/${s.upload} verified, ${s.failed} failed${failed ? ' — see FAILED lines above' : ''}`);
  return s.verified === s.upload ? 0 : 1;
}

// THE COUNT. Reads the index for what is on MaxOne and asks both Drives, right
// now, what they hold. The plan's fingerprints (and the cache) stand in for
// the hashes the index never took.
function cmdStatus() {
  const entries = readIndex();
  console.log(`Index taken ${indexAge()} — run npm run archive:index for a fresh one if MaxOne has changed since.`);
  const all = loose.looseEntries(entries);
  const known = new Map();
  if (fs.existsSync(PLAN_JSON)) {
    const rows = loadPlan();
    for (const r of rows) if (r.hash) known.set(r.path, r.hash);
    const ledger = loadLedger();
    const s = loose.summarize(rows, ledger);
    console.log(`Run so far: ${s.verified} of ${s.upload} uploads verified on Drive (${idx.humanBytes(s.verifiedBytes)} of ${idx.humanBytes(s.uploadBytes)}); ${s.failed} failed; ${s.upload - s.verified - s.failed} not attempted yet.`);
    for (const r of rows) {
      const l = ledger.get(loose.rowId(r));
      if (r.action === 'UPLOAD' && l && !l.verified) console.log(`  FAILED  ${r.path}: ${l.error}`);
    }
  } else console.log('No plan yet (npm run archive:loose -- plan) — counting from the index alone.');
  const cache = loadCache();
  const hashOf = (e) => {
    if (known.has(e.path)) return known.get(e.path);
    const abs = fs.existsSync(MAXONE) ? openable(path.join(MAXONE, e.path)) : null;
    if (!abs) return '';
    try { const st = fs.statSync(abs); return cache[`${abs}|${st.size}|${Math.floor(st.mtimeMs)}`] || ''; } catch { return ''; }
  };
  const present = driveFingerprints();
  const v = loose.verdict(all, hashOf, (h, size) => present.has(`${h}:${size}`));
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, 'missing.tsv'), tsv([['file', 'bytes', 'reason'], ...v.missing.map((m) => [m.path, m.size, m.reason])]));
  console.log(`${v.total} loose files on MaxOne: ${v.backedUp} have a byte-identical copy on a Drive right now, ${v.noCopyNeeded} need none (empty or system files), ${v.missing.length} NOT on a Drive${v.missing.length ? ` (${idx.humanBytes(v.missing.reduce((s, m) => s + m.size, 0))})` : ''}.`);
  for (const m of v.missing) console.log(`  MISSING  ${m.path} (${idx.humanBytes(m.size)}): ${m.reason}`);
  if (v.missing.length) console.log(`Listed in ${path.join(STATE, 'missing.tsv')}. Slice 4 stays blocked until this reads 0.`);
  else console.log('Every loose file on MaxOne has a verified copy on a Drive. Slice 4\'s guard is met for the loose files.');
  return v.ok ? 0 : 1;
}

const commands = { plan: cmdPlan, run: cmdRun, status: cmdStatus };
if (!commands[cmd]) {
  console.error('usage: npm run archive:loose -- plan | run | status');
  process.exit(2);
}
process.exit(commands[cmd]());
