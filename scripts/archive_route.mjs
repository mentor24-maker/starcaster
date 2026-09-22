#!/usr/bin/env node
/**
 * scripts/archive_route.mjs — unzip what Drive is missing, upload it, verify it,
 * and only then clear the zips off MaxOne. Slice 2 of 86bbvqh4z (ticket
 * 86bbvr0xv); the rules live in lib/archiveRoute.js.
 *
 *   npm run archive:route -- plan            write the plan from slice 1's index (moves nothing)
 *   npm run archive:route -- run             unzip + upload + verify every pending file (resumable)
 *   npm run archive:route -- status          how far the run has got
 *   npm run archive:route -- clear           DRY RUN: which zips could be deleted right now, and why not
 *   npm run archive:route -- clear --apply   delete exactly those zips from MaxOne
 *
 * Options (tests use these to point everything at scratch folders):
 *   --index <file>        slice 1's index.jsonl       (default ~/archive-index/index.jsonl)
 *   --state <dir>         plan, ledger, logs, record  (default ~/archive-index/route)
 *   --maxone <dir>        where MaxOne is mounted     (default /Volumes/maxone)
 *   --staging <dir>       where each zip is unpacked  (default <state>/staging, on the Mac)
 *   --remote m24=<target> --remote gdrive=<target>    use another rclone target for a Drive
 *
 * RESUMABLE. Every verified file is appended to <state>/ledger.jsonl the moment
 * its MD5 is read back from Drive, and `run` skips anything already verified.
 * Kill it, unplug it, let the laptop sleep: run it again and it carries on.
 *
 * NOTHING IS DELETED BY `run`. Only `clear --apply` deletes, and it decides from
 * a FRESH listing of both Drives taken at that moment — a zip goes only when
 * every file in it has a byte-identical copy (MD5 + size) on a Drive right then.
 *
 * EXIT CODES (docs/DOCTRINE.md §5.33):
 *   0  done: every file verified / every zip cleared (or, dry run, clearable)
 *   1  finished, but some files failed or some zips are blocked — listed
 *   2  could not take a reading at all (no index, MaxOne not mounted, rclone failed)
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = require(path.join(ROOT, 'lib', 'archiveRoute.js'));
const idx = require(path.join(ROOT, 'lib', 'archiveIndex.js'));

const HOME = os.homedir();
const argv = process.argv.slice(2);
const cmd = argv[0];
const argValues = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const has = (flag) => argv.includes(flag);
const INDEX = path.resolve(argValues('--index')[0] || path.join(HOME, 'archive-index', 'index.jsonl'));
const STATE = path.resolve(argValues('--state')[0] || path.join(HOME, 'archive-index', 'route'));
const MAXONE = path.resolve(argValues('--maxone')[0] || '/Volumes/maxone');
// Unpacked on the Mac, never on MaxOne. MaxOne is ExFAT, and macOS lists names
// there in a different Unicode form from the one it will open them by: a file
// written as "…ΓÇ»PM.png" is listed decomposed, and opening or deleting it by
// the listed name fails. rclone reads by the listed name, so it uploaded none
// of 284 screenshots, and even `rm -rf` could not clear the folder, which
// crashed the run one zip from the end (ticket 86bc4x5wh, 2026-09-22).
const STAGING = path.resolve(argValues('--staging')[0] || path.join(STATE, 'staging'));
const LEGACY_STAGING = path.join(MAXONE, '.archive-route-staging');
// Headroom kept free on the Mac beyond the zip being unpacked.
const STAGING_SPARE_BYTES = 5 * 1024 ** 3;
const OVERRIDES = Object.fromEntries(argValues('--remote').map((s) => [s.slice(0, s.indexOf('=')) + ':', s.slice(s.indexOf('=') + 1)]));

const PLAN_JSON = path.join(STATE, 'plan.json');
const LEDGER = path.join(STATE, 'ledger.jsonl');
const LOG = path.join(STATE, 'run.log');

const stamp = () => new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'short', timeStyle: 'medium' });
function log(s) {
  const line = `${stamp()}  ${s}`;
  process.stderr.write(`${line}\n`);
  try { fs.appendFileSync(LOG, `${line}\n`); } catch { /* state dir not made yet */ }
}
// Clearing scratch space is never worth ending the run over: a folder that will
// not go is logged, and the next zip unpacks into a fresh one beside it.
function clearStaging(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (e) {
    log(`  could not clear the unpack folder ${dir} (${e.code || e.message}); carrying on without it`);
    return false;
  }
}

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

function cannotTell(msg) {
  console.error(`CANNOT TELL — ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Where an upload group physically goes. A real Drive folder id becomes
// --drive-root-folder-id; an override (a scratch folder in the test) gets the
// id as a sub-folder, so the two roots stay distinct there too.
function target(remote, rootId) {
  if (OVERRIDES[remote]) {
    return { spec: rootId ? path.join(OVERRIDES[remote], rootId) : OVERRIDES[remote], flags: [] };
  }
  return { spec: remote, flags: rootId ? ['--drive-root-folder-id', rootId] : [] };
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
  const rows = route.resolveClashes(route.plan(readIndex()));
  fs.writeFileSync(PLAN_JSON, JSON.stringify(rows));
  fs.writeFileSync(path.join(STATE, 'plan.tsv'), tsv([
    ['action', 'zip', 'file', 'bytes', 'goes to / reason'],
    ...rows.map((r) => [r.action, r.zip, r.member, r.size, r.action === 'UPLOAD' ? `${route.describeDest(r.dest)} (${r.dest.reason})` : r.reason]),
  ]));
  const s = route.summarize(rows);
  console.log(`Plan: ${path.join(STATE, 'plan.tsv')}`);
  console.log(`${s.members} files in ${new Set(rows.map((r) => r.zip)).size} MaxOne zips: ${s.upload} to upload (${idx.humanBytes(s.uploadBytes)}; ${s.video} video, ${idx.humanBytes(s.videoBytes)}, to mentorofaio), ${s.skip} skipped with a reason, ${s.hold} on hold (could not be read).`);
  return 0;
}

// Extract the named members of one zip into place under `outDir`, hashing as
// it writes. Python's zipfile checks each member's CRC while it streams.
const PY_EXTRACT = String.raw`
import sys, zipfile, json, hashlib, os
zp, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(zp)
for job in json.load(sys.stdin):
    h = hashlib.md5()
    dest = os.path.join(out, job["to"])
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with z.open(job["member"]) as f, open(dest, "wb") as w:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk); w.write(chunk)
        print(json.dumps({"id": job["id"], "md5": h.hexdigest()}))
    except Exception as e:
        print(json.dumps({"id": job["id"], "error": str(e)}))
    sys.stdout.flush()
`;

function groupKey(d) {
  return `${d.remote}|${d.rootId}`;
}

function cmdRun() {
  if (!fs.existsSync(MAXONE)) cannotTell(`MaxOne is not mounted at ${MAXONE}`);
  fs.mkdirSync(STATE, { recursive: true });
  const rows = loadPlan();
  const ledger = loadLedger();
  const pending = rows.filter((r) => r.action === 'UPLOAD' && !(ledger.get(route.rowId(r)) || {}).verified);
  const byZip = new Map();
  for (const r of pending) {
    if (!byZip.has(r.zip)) byZip.set(r.zip, []);
    byZip.get(r.zip).push(r);
  }
  log(`run: ${pending.length} file(s) still to upload from ${byZip.size} zip(s), ${idx.humanBytes(pending.reduce((s, r) => s + r.size, 0))}`);

  fs.mkdirSync(STAGING, { recursive: true });
  // A run from before the fix may have left its unpack folder on MaxOne.
  if (fs.existsSync(LEGACY_STAGING)) clearStaging(LEGACY_STAGING);

  let failed = 0;
  let z = 0;
  for (const [zipPath, zipRows] of byZip) {
    z += 1;
    const zipAbs = path.join(MAXONE, zipPath);
    log(`zip ${z}/${byZip.size}: ${zipPath} — ${zipRows.length} file(s), ${idx.humanBytes(zipRows.reduce((s, r) => s + r.size, 0))}`);
    const record = (r, fields) => {
      const e = { id: route.rowId(r), dest: route.describeDest(r.dest), at: new Date().toISOString(), ...fields };
      fs.appendFileSync(LEDGER, JSON.stringify(e) + '\n');
      ledger.set(e.id, e);
      if (!e.verified) { failed += 1; log(`  FAILED ${r.member}: ${e.error}`); }
    };
    if (!fs.existsSync(zipAbs)) { for (const r of zipRows) record(r, { verified: false, error: 'the zip is no longer on MaxOne' }); continue; }

    const zipBytes = zipRows.reduce((s, r) => s + r.size, 0);
    const room = freeBytes(STAGING);
    if (room !== null && room < zipBytes + STAGING_SPARE_BYTES) {
      for (const r of zipRows) record(r, { verified: false, error: `not enough free space on this Mac to unpack it (needs ${idx.humanBytes(zipBytes)} plus ${idx.humanBytes(STAGING_SPARE_BYTES)} spare, has ${idx.humanBytes(room)})` });
      continue;
    }
    const zipStage = fs.mkdtempSync(path.join(STAGING, 'zip-'));
    const groups = new Map();
    for (const r of zipRows) {
      const k = groupKey(r.dest);
      if (!groups.has(k)) groups.set(k, { dest: r.dest, rows: [], dir: path.join(zipStage, String(groups.size)) });
      groups.get(k).rows.push(r);
    }
    const byId = new Map(zipRows.map((r) => [route.rowId(r), r]));
    const md5 = new Map();
    for (const g of groups.values()) {
      const jobs = g.rows.map((r) => ({ id: route.rowId(r), member: r.member, to: r.dest.path }));
      const x = spawnSync('python3', ['-c', PY_EXTRACT, zipAbs, g.dir], { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 1 << 28 });
      if (x.status !== 0) { for (const r of g.rows) record(r, { verified: false, error: `could not unzip: ${(x.stderr || '').trim().split('\n').pop()}` }); g.rows = []; continue; }
      for (const l of x.stdout.split('\n').filter(Boolean)) {
        const o = JSON.parse(l);
        const r = byId.get(o.id);
        if (o.error) { record(r, { verified: false, error: `could not unzip: ${o.error}` }); continue; }
        if (r.hash && r.hash !== o.md5) { record(r, { verified: false, error: `unzipped bytes do not match slice 1's fingerprint (${o.md5} vs ${r.hash})` }); continue; }
        md5.set(o.id, o.md5);
      }
      g.rows = g.rows.filter((r) => md5.has(route.rowId(r)));
    }

    for (const g of groups.values()) {
      if (!g.rows.length) continue;
      const t = target(g.dest.remote, g.dest.rootId);
      const list = path.join(STATE, 'files-from.txt');
      fs.writeFileSync(list, g.rows.map((r) => r.dest.path).join('\n') + '\n');
      const up = rclone(['copy', g.dir, t.spec, ...t.flags, '--files-from-raw', list, '--ignore-existing', '--transfers', '4', '--retries', '5', '--low-level-retries', '20', '--log-file', path.join(STATE, 'rclone.log'), '--log-level', 'INFO']);
      if (!up.ok) log(`  upload reported a problem (${up.err}); verifying what arrived anyway`);
      // Verification is a separate read, never the upload's exit code: ask Drive
      // for the MD5 and size of every file it now holds at those paths.
      const seen = rclone(['lsjson', t.spec, ...t.flags, '-R', '--files-only', '--hash', '--hash-type', 'md5', '--files-from-raw', list]);
      if (!seen.ok) { for (const r of g.rows) record(r, { verified: false, error: `could not read back from Drive: ${seen.err}` }); continue; }
      const there = new Map(JSON.parse(seen.out).map((f) => [route.nameKey(f.Path), f]));
      for (const r of g.rows) {
        const f = there.get(route.nameKey(r.dest.path));
        const want = md5.get(route.rowId(r));
        if (!f) record(r, { verified: false, md5: want, error: 'not on Drive after the upload' });
        else if (f.Size !== r.size) record(r, { verified: false, md5: want, error: `Drive holds ${f.Size} bytes, expected ${r.size} — a different file may already sit at that path` });
        else if (!f.Hashes || f.Hashes.md5 !== want) record(r, { verified: false, md5: want, error: `Drive's fingerprint ${(f.Hashes && f.Hashes.md5) || '(none)'} does not match ${want}` });
        else record(r, { verified: true, md5: want });
      }
    }
    clearStaging(zipStage);
    const s = route.summarize(rows, ledger);
    log(`  progress: ${s.verified}/${s.upload} verified (${idx.humanBytes(s.verifiedBytes)} of ${idx.humanBytes(s.uploadBytes)}), ${s.failed} failed`);
  }
  const s = route.summarize(rows, ledger);
  log(`run finished: ${s.verified}/${s.upload} verified, ${s.failed} failed${failed ? ' — see FAILED lines above' : ''}`);
  return s.verified === s.upload ? 0 : 1;
}

function cmdStatus() {
  const rows = loadPlan();
  const ledger = loadLedger();
  const s = route.summarize(rows, ledger);
  console.log(`${s.verified} of ${s.upload} uploads verified on Drive (${idx.humanBytes(s.verifiedBytes)} of ${idx.humanBytes(s.uploadBytes)}); ${s.failed} failed; ${s.upload - s.verified - s.failed} not attempted yet. ${s.skip} skipped with a reason, ${s.hold} on hold.`);
  for (const r of rows) {
    const l = ledger.get(route.rowId(r));
    if (l && !l.verified) console.log(`  FAILED  ${r.zip} → ${r.member}: ${l.error}`);
  }
  return s.verified === s.upload && !s.failed ? 0 : 1;
}

// ---------------------------------------------------------------------------
function driveFingerprints() {
  const present = new Set();
  const listings = [['m24:', ''], ['m24:', route.M24_PERSONAL_ID], ['gdrive:', '']];
  for (const [remote, rootId] of listings) {
    const t = target(remote, rootId);
    if (OVERRIDES[remote] && rootId && !fs.existsSync(t.spec)) continue;
    log(`listing ${remote}${rootId ? ` (folder ${rootId})` : ''} with Drive's own fingerprints…`);
    const r = rclone(['lsjson', t.spec, ...t.flags, '-R', '--files-only', '--hash', '--hash-type', 'md5']);
    if (!r.ok) cannotTell(`could not list ${remote}: ${r.err}. Nothing deleted.`);
    for (const f of JSON.parse(r.out)) if (f.Hashes && f.Hashes.md5) present.add(`${f.Hashes.md5}:${f.Size}`);
  }
  return present;
}

function cmdClear() {
  const apply = has('--apply');
  if (!fs.existsSync(MAXONE)) cannotTell(`MaxOne is not mounted at ${MAXONE}`);
  const rows = loadPlan();
  const ledger = loadLedger();
  const entries = readIndex();
  const zipEntries = new Map(entries.filter((e) => e.location === 'maxone' && !e.container).map((e) => [e.path, e]));
  const present = driveFingerprints();
  const presentOnDrive = (h, size) => present.has(`${h}:${size}`);
  const hashOf = (r) => (ledger.get(route.rowId(r)) || {}).md5;

  const byZip = new Map();
  for (const r of rows) {
    if (!byZip.has(r.zip)) byZip.set(r.zip, []);
    byZip.get(r.zip).push(r);
  }
  const record = [['zip', 'file', 'bytes', 'action', 'where it is now', 'zip deleted?']];
  let cleared = 0;
  let blocked = 0;
  let freed = 0;
  for (const [zipPath, zipRows] of [...byZip].sort()) {
    const zipAbs = path.join(MAXONE, zipPath);
    const ze = zipEntries.get(zipPath);
    let verdict;
    if (!fs.existsSync(zipAbs)) verdict = { ok: false, gone: true, blockers: [] };
    else {
      verdict = route.clearable(zipRows, ze, presentOnDrive, hashOf);
      const st = fs.statSync(zipAbs);
      if (ze && st.size !== ze.size) verdict = { ok: false, blockers: [`the zip changed size since slice 1 indexed it (${ze.size} → ${st.size})`] };
    }
    let outcome;
    if (verdict.gone) outcome = 'already gone';
    else if (!verdict.ok) {
      blocked += 1;
      outcome = 'KEPT';
      console.log(`KEEP   ${zipPath} — ${verdict.blockers.length} file(s) not safely on Drive, e.g. ${verdict.blockers.slice(0, 2).join('; ')}`);
    } else {
      const size = fs.statSync(zipAbs).size;
      if (apply) { fs.rmSync(zipAbs); log(`deleted ${zipPath} (${idx.humanBytes(size)})`); outcome = 'deleted'; } else { console.log(`WOULD DELETE  ${zipPath} (${idx.humanBytes(size)})`); outcome = 'would delete'; }
      cleared += 1;
      freed += size;
    }
    for (const r of zipRows) {
      const l = ledger.get(route.rowId(r));
      const where = r.action === 'UPLOAD' ? `${route.describeDest(r.dest)}${l && l.verified ? ' (verified)' : ' (NOT verified)'}` : r.reason;
      record.push([zipPath, r.member, r.size, r.action, where, outcome]);
    }
  }
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, 'record.tsv'), tsv(record));
  if (apply) { clearStaging(STAGING); if (fs.existsSync(LEGACY_STAGING)) clearStaging(LEGACY_STAGING); }
  console.log(`${apply ? 'Deleted' : 'Would delete'} ${cleared} zip(s), ${idx.humanBytes(freed)}; ${blocked} kept because something in them is not on a Drive. Record: ${path.join(STATE, 'record.tsv')}`);
  if (!apply) console.log('Dry run — nothing deleted. Add --apply to delete exactly the zips marked WOULD DELETE.');
  return blocked ? 1 : 0;
}

const commands = { plan: cmdPlan, run: cmdRun, status: cmdStatus, clear: cmdClear };
if (!commands[cmd]) {
  console.error('usage: npm run archive:route -- plan | run | status | clear [--apply]');
  process.exit(2);
}
process.exit(commands[cmd]());
