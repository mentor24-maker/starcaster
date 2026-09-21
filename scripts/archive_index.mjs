#!/usr/bin/env node
/**
 * scripts/archive_index.mjs — which copies of the archive are the same file.
 *
 *   npm run archive:index                   index all four places, write the report
 *   npm run archive:index -- --out <dir>    where the report goes (default ~/archive-index)
 *   npm run archive:index -- --root <label>=<folder>    index only these folders (repeatable)
 *   npm run archive:index -- --remote <label>=<rclone remote:>    and these Drives (repeatable)
 *
 * Giving any --root or --remote replaces the default four places entirely; that
 * is how the test plants a duplicate in a scratch folder without touching a
 * real drive.
 *
 * READ-ONLY. It lists, reads zip tables of contents, and fingerprints bytes. It
 * moves nothing, deletes nothing, and unzips nothing to disk — zip members are
 * hashed as a stream. Slice 1 of 86bbvqh4z (ticket 86bbvr0wh); the rules live
 * in lib/archiveIndex.js.
 *
 * RERUNS ARE CHEAP. Every fingerprint is cached in <out>/hash-cache.json keyed
 * by path + size + modified time, so a second run only reads what changed and
 * gives the same answer.
 *
 * EXIT CODES, the harness convention (docs/DOCTRINE.md §5.33):
 *   0  the report was written and every entry was settled
 *   1  the report was written, but some entries could not be read (listed in it)
 *   2  no report — a location could not be listed at all
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
const idx = require(path.join(ROOT, 'lib', 'archiveIndex.js'));

const HOME = os.homedir();
const argv = process.argv.slice(2);
const argValues = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const OUT = path.resolve(argValues('--out')[0] || path.join(HOME, 'archive-index'));

function splitPair(s) {
  const eq = s.indexOf('=');
  if (eq < 1) { console.error(`expected <label>=<value>, got "${s}"`); process.exit(2); }
  return [s.slice(0, eq), s.slice(eq + 1)];
}

function defaultRoots() {
  // The MacBook's own copies: the folders the 2026-09-06 audit found content
  // in. "Desktop - Dane's MacBook Pro (2)" is matched by prefix because its
  // apostrophe is a curly one, and a typed straight one would silently miss it.
  const mac = ['Desktop', 'Documents', 'Downloads']
    .concat(fs.readdirSync(HOME).filter((n) => n.startsWith('Desktop - ')))
    .map((n) => path.join(HOME, n));
  return [['maxone', '/Volumes/maxone'], ...mac.map((p) => ['mac', p])];
}

const explicit = argValues('--root').length || argValues('--remote').length;
const ROOTS = explicit ? argValues('--root').map(splitPair) : defaultRoots();
const REMOTES = explicit ? argValues('--remote').map(splitPair) : [['mentor24', 'm24:'], ['mentorofaio', 'gdrive:']];

const log = (s) => process.stderr.write(`${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Denver' })}  ${s}\n`);

// ---------------------------------------------------------------------------
// Zips are read by Python's zipfile: it handles ZIP64 (these archives hold
// multi-gigabyte video), checks every member's CRC as it streams, and has been
// right for twenty years. Nothing is written to disk.
const PY_ZIP = String.raw`
import sys, zipfile, json, hashlib
mode, zp = sys.argv[1], sys.argv[2]
try:
    z = zipfile.ZipFile(zp)
except Exception as e:
    print(json.dumps({"error": "cannot open zip: %s" % e})); sys.exit(0)
if mode == "list":
    for i in z.infolist():
        if i.is_dir(): continue
        print(json.dumps({"name": i.filename, "size": i.file_size, "encrypted": bool(i.flag_bits & 1)}))
else:
    for n in json.load(sys.stdin):
        h = hashlib.md5()
        try:
            with z.open(n) as f:
                for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
            print(json.dumps({"name": n, "md5": h.hexdigest()}))
        except Exception as e:
            print(json.dumps({"name": n, "error": str(e)}))
        sys.stdout.flush()
`;

function python(args, input) {
  const r = spawnSync('python3', ['-c', PY_ZIP, ...args], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) return { error: `python3 could not run: ${r.error.message}` };
  if (r.status !== 0) return { error: `python3 exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop()}` };
  return { lines: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

// ---------------------------------------------------------------------------
// Local folders.
function walk(location, root, entries, source) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let items;
    try {
      items = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      if (rel === '') throw err;
      entries.push({ location, path: rel, size: 0, error: `folder could not be listed: ${idx.readErrorReason(err)}` });
      continue;
    }
    for (const d of items) {
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      const why = idx.skipReason(childRel);
      if (why) { source.skipped[why] = (source.skipped[why] || 0) + 1; continue; }
      if (d.isSymbolicLink()) { source.skipped['symlinks (not followed)'] = (source.skipped['symlinks (not followed)'] || 0) + 1; continue; }
      if (d.isDirectory()) { stack.push(childRel); continue; }
      if (!d.isFile()) continue;
      let st;
      try { st = fs.statSync(path.join(root, childRel)); } catch (err) {
        entries.push({ location, path: childRel, size: 0, error: idx.readErrorReason(err) });
        continue;
      }
      const e = { location, path: childRel, size: st.size, mtime: Math.floor(st.mtimeMs), abs: path.join(root, childRel) };
      entries.push(e);
      source.files += 1;
      if (childRel.toLowerCase().endsWith('.zip')) {
        e.zipFile = true;
        const r = python(['list', e.abs]);
        const first = r.lines && r.lines[0];
        if (r.error || (first && first.error)) { e.listError = r.error || first.error; continue; }
        for (const m of r.lines) {
          const mwhy = idx.skipReason(m.name);
          if (mwhy) { source.skipped[`${mwhy} (in zips)`] = (source.skipped[`${mwhy} (in zips)`] || 0) + 1; continue; }
          const me = { location, container: childRel, path: m.name, size: m.size, zipAbs: e.abs, zipMtime: e.mtime };
          if (m.encrypted) me.error = 'encrypted zip member';
          entries.push(me);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Google Drives, through rclone. Drive computes MD5 itself, so nothing is
// downloaded; a file with no checksum is either a native Google Doc (no bytes
// exist) or a genuine could-not-read, and those are told apart by MIME type.
function listRemote(location, remote, entries, source) {
  const r = spawnSync('rclone', ['lsjson', '-R', '--files-only', '--hash', '--hash-type', 'md5', remote], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) {
    throw new Error(`rclone lsjson ${remote} failed: ${r.error ? r.error.message : (r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  }
  for (const f of JSON.parse(r.stdout)) {
    const why = idx.skipReason(f.Path);
    if (why) { source.skipped[why] = (source.skipped[why] || 0) + 1; continue; }
    source.files += 1;
    entries.push({ location, path: f.Path, ...idx.classifyDriveRow(f) });
    if (f.Path.toLowerCase().endsWith('.zip')) {
      source.skipped['zips on Drive (contents not opened — would mean downloading them)'] = (source.skipped['zips on Drive (contents not opened — would mean downloading them)'] || 0) + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Fingerprinting, with a cache so a rerun only reads what changed.
const CACHE_FILE = path.join(OUT, 'hash-cache.json');
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
const cacheKey = (e) => (e.container ? `${e.zipAbs}|${e.zipMtime}::${e.path}|${e.size}` : `${e.abs}|${e.size}|${e.mtime}`);

function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file, { highWaterMark: 1 << 20 })
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

async function hashEverything(entries) {
  const needs = idx.sizesNeedingHash(entries);
  const todo = entries.filter((e) => !e.hash && !e.error && !e.native && needs.has(e.size) && (e.abs || e.zipAbs));
  let fromCache = 0;
  const loose = [];
  const byZip = new Map();
  for (const e of todo) {
    const hit = cache[cacheKey(e)];
    if (hit) { e.hash = hit; fromCache += 1; continue; }
    if (e.container) {
      if (!byZip.has(e.zipAbs)) byZip.set(e.zipAbs, []);
      byZip.get(e.zipAbs).push(e);
    } else loose.push(e);
  }
  const looseBytes = loose.reduce((s, e) => s + e.size, 0);
  log(`fingerprinting: ${todo.length} entries share a size with something else; ${fromCache} already cached, ${loose.length} loose files (${idx.humanBytes(looseBytes)}) and members of ${byZip.size} zips to read`);

  let done = 0;
  let lastSave = Date.now();
  for (const e of loose) {
    try { e.hash = await md5File(e.abs); cache[cacheKey(e)] = e.hash; } catch (err) { e.error = idx.readErrorReason(err); }
    done += 1;
    if (Date.now() - lastSave > 60000) { saveCache(); lastSave = Date.now(); log(`  loose files: ${done}/${loose.length}`); }
  }
  saveCache();

  let z = 0;
  for (const [zipAbs, members] of byZip) {
    z += 1;
    log(`  zip ${z}/${byZip.size}: ${path.basename(zipAbs)} (${members.length} members)`);
    const r = python(['hash', zipAbs], JSON.stringify(members.map((m) => m.path)));
    if (r.error) { for (const m of members) m.error = r.error; continue; }
    const got = new Map(r.lines.map((l) => [l.name, l]));
    for (const m of members) {
      const l = got.get(m.path);
      if (!l) m.error = 'zip reader returned nothing for this member';
      else if (l.error) m.error = `could not read from zip: ${l.error}`;
      else { m.hash = l.md5; cache[cacheKey(m)] = m.hash; }
    }
    saveCache();
  }
}

// ---------------------------------------------------------------------------
function tsv(rows) {
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n';
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const entries = [];
  const sources = [];

  for (const [location, root] of ROOTS) {
    const source = { location, root, files: 0, skipped: {} };
    sources.push(source);
    log(`listing ${location}: ${root}`);
    if (!fs.existsSync(root)) {
      console.error(`CANNOT TELL — ${location} is not there: ${root}. No report written.`);
      process.exit(2);
    }
    // Never index the report's own folder (a rerun would find its last output).
    const before = entries.length;
    walk(location, root, entries, source);
    const outRel = path.relative(root, OUT);
    if (!outRel.startsWith('..') && !path.isAbsolute(outRel)) {
      const kept = entries.slice(before).filter((e) => !(e.path === outRel || e.path.startsWith(`${outRel}/`) || (e.container && e.container.startsWith(`${outRel}/`))));
      entries.length = before;
      entries.push(...kept);
    }
  }
  for (const [location, remote] of REMOTES) {
    const source = { location, root: remote, files: 0, skipped: {} };
    sources.push(source);
    log(`listing ${location}: ${remote} (Drive's own checksums, nothing downloaded)`);
    try {
      listRemote(location, remote, entries, source);
    } catch (err) {
      console.error(`CANNOT TELL — ${err.message}. No report written.`);
      process.exit(2);
    }
  }
  log(`listed ${entries.length} entries`);

  await hashEverything(entries);

  const { markdown, analysis, zips, removals } = idx.renderReport(entries, {
    ranAt: new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }) + ' Mountain',
    sources,
  });

  fs.writeFileSync(path.join(OUT, 'report.md'), markdown);
  const dupRows = [['set', 'hash', 'bytes', 'kind', 'role', 'location', 'zip', 'path']];
  analysis.sets.forEach((s, i) => {
    dupRows.push([i + 1, s.hash, s.size, s.kind, 'KEEP', s.keeper.location, s.keeper.container || '', s.keeper.path]);
    for (const c of s.others) dupRows.push([i + 1, s.hash, s.size, s.kind, 'extra', c.location, c.container || '', c.path]);
  });
  fs.writeFileSync(path.join(OUT, 'duplicates.tsv'), tsv(dupRows));
  const remRows = [['location', 'path', 'bytes', 'hash', 'keeper']];
  for (const [loc, b] of Object.entries(removals)) for (const it of b.items) remRows.push([loc, it.copy.path, it.copy.size, it.hash, idx.describe(it.keeper)]);
  fs.writeFileSync(path.join(OUT, 'proposed-removals.tsv'), tsv(remRows));
  const zipRows = [['verdict', 'location', 'zip', 'bytes', 'members', 'members found nowhere else', 'their bytes', 'problems']];
  for (const zr of zips) zipRows.push([zr.verdict, zr.location, zr.path, zr.size, zr.members, zr.missing.length, zr.missing.reduce((s, m) => s + m.size, 0), zr.unreadable.join('; ')]);
  fs.writeFileSync(path.join(OUT, 'zips.tsv'), tsv(zipRows));
  fs.writeFileSync(path.join(OUT, 'unreadable.tsv'), tsv([['location', 'zip', 'path', 'reason'], ...analysis.unreadable.map((e) => [e.location, e.container || '', e.path, e.error])]));
  fs.writeFileSync(path.join(OUT, 'index.jsonl'), entries.map((e) => JSON.stringify({ location: e.location, container: e.container, path: e.path, size: e.size, hash: e.hash, native: e.native, error: e.error || e.listError })).join('\n') + '\n');

  console.log(`Report: ${path.join(OUT, 'report.md')}`);
  console.log(`${analysis.uniqueCount} distinct files (${idx.humanBytes(analysis.uniqueBytes)}); ${analysis.sets.length} duplicate sets; ${zips.length} zips; ${analysis.unreadable.length} could not be read.`);
  const blindZips = zips.filter((zr) => zr.verdict === 'CANNOT TELL').length;
  process.exit(analysis.unreadable.length || blindZips ? 1 : 0);
}

main().catch((err) => { console.error(`CANNOT TELL — ${err.stack || err.message}`); process.exit(2); });
