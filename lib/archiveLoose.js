'use strict';

/**
 * The loose files on MaxOne — the ones that were never inside a zip — where
 * each one goes on Drive, and how to tell whether every one of them has a
 * verified copy there.
 *
 * WHY THIS EXISTS (ticket 86bc75y9r, found 2026-09-24 while checking slice 4's
 * guard). Slice 2 (lib/archiveRoute.js) unzipped, uploaded and verified every
 * zip on MaxOne, and its review was thorough and correct — for zips. MaxOne
 * also holds about 22,000 files that were never zipped, 107 GB of them, and
 * nothing ever copied those anywhere. Most happen to be on a Drive already
 * (uploaded years ago by other means); a few hundred are not, and among them
 * are the only copies of family videos. Slice 4 erases MaxOne. So: before that
 * erase, every loose file must have a byte-identical copy on a Drive, read back
 * and compared by MD5 and size.
 *
 * A PREMISE THE TICKET GOT WRONG, corrected here rather than built as written:
 * the index (lib/archiveIndex.js) fingerprints only files whose SIZE collides
 * with some other file, because a file no other file matches in size cannot be
 * anybody's duplicate. So a loose file "with no fingerprint recorded" is not
 * unjudgeable — it is a file whose size nothing on either Drive shares, which
 * means NO Drive copy exists. Every one of them needs uploading, and this slice
 * hashes it on the way (the MD5 is what the read-back is compared against).
 *
 * WHAT THIS FILE IS
 * Pure functions — no disk, no network, no clock — so every rule is testable
 * (scripts/builder/archiveLoose.test.js). Hashing, uploading and reading back
 * live in scripts/archive_loose.mjs.
 *
 * THE RULE: a loose file is BACKED UP only when a fresh Drive listing holds a
 * file with the same MD5 and size — not when an upload said 200, not when the
 * ledger remembers a verification. `verdict()` below is that rule, and it is
 * deliberately independent of how the copy got there.
 *
 * NOTHING HERE DELETES. Deleting from MaxOne is slice 4's job and gated on Dane.
 */

const idx = require('./archiveIndex.js');
const route = require('./archiveRoute.js');

// Where loose files land — the same two folders slice 2 uses for zip contents
// whose original location is unknown, mirroring the folder each file sat in on
// MaxOne. Measured, not assumed (2026-09-24): the loose folders under
// "Google Drive Download/Personal" (Photos, Finances, Pets, Family 2) exist on
// neither Drive, so there is no original home to send them back to, and a
// guess would scatter them where nobody will look.
const M24_PREFIX = 'Restored from MaxOne';
const GDRIVE_PREFIX = 'Archives-from-maxone';

/**
 * The destination for one loose file: { remote, rootId, path, reason }.
 *   remote  'm24:' (mentor24) or 'gdrive:' (mentorofaio) — the rclone names
 *   rootId  always '' here (the Drive root); kept so the shape matches slice 2
 *   path    the path on that Drive, mirroring where it sat on MaxOne
 */
function destination(filePath) {
  if (idx.mediaKind(filePath) === 'video') {
    return { remote: 'gdrive:', rootId: '', path: `${GDRIVE_PREFIX}/${filePath}`, reason: 'video → mentorofaio, mirroring its MaxOne folder' };
  }
  return { remote: 'm24:', rootId: '', path: `${M24_PREFIX}/${filePath}`, reason: 'everything but video → mentor24, mirroring its MaxOne folder' };
}

const key = (hash, size) => `${hash}:${size}`;

/** The loose MaxOne entries of an index: on MaxOne, not inside a zip, not a zip. */
function looseEntries(entries) {
  return entries.filter((e) => e.location === 'maxone' && !e.container && !String(e.path).toLowerCase().endsWith('.zip'));
}

/** "md5:size" → the first Drive entry carrying it, from an index. */
function driveCopies(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!e.container && (e.location === 'mentor24' || e.location === 'mentorofaio') && e.hash && e.size > 0) {
      const k = key(e.hash, e.size);
      if (!m.has(k)) m.set(k, e);
    }
  }
  return m;
}

/**
 * Drive paths already in use, as "remote|rootId|path" in lower case, from an
 * index. An upload must not land on a path that holds a DIFFERENT file: rclone
 * would skip it (--ignore-existing) and the read-back would then compare the
 * wrong bytes. Same bytes at the same path are a SKIP long before this matters.
 */
function takenPaths(entries) {
  const s = new Set();
  for (const e of entries) {
    if (e.container || !e.path) continue;
    if (e.location === 'mentor24') s.add(`m24:||${String(e.path).toLowerCase()}`);
    else if (e.location === 'mentorofaio') s.add(`gdrive:||${String(e.path).toLowerCase()}`);
  }
  return s;
}

/**
 * The plan: one row per loose file on MaxOne, in exactly one state.
 *   UPLOAD — no Drive has these bytes; send it to `dest`
 *   SKIP   — no upload needed, and `reason` says why: already on Drive (and
 *            where), the same bytes are uploaded from another row, empty, a
 *            system file
 *   HOLD   — it could not be read, so nothing is decided
 *
 * `entries` is the whole index (loose MaxOne rows are picked out here; the
 * Drive rows say what is already backed up). Every content-bearing row must
 * carry a hash by now — the script fingerprints the unhashed ones first — and
 * a row that still has none is HELD with that reason rather than uploaded
 * unverifiably. `taken` (optional) is takenPaths(); a destination already in
 * use by a different file is renamed "(from MaxOne 2)" like slice 2 does.
 */
function plan(entries, taken) {
  const drive = driveCopies(entries);
  const used = new Set(taken || []);
  const rows = [];
  const firstUpload = new Map();
  const loose = looseEntries(entries).slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const e of loose) {
    const row = { path: e.path, size: e.size, hash: e.hash || '', kind: idx.mediaKind(e.path) };
    const sys = idx.skipReason(e.path);
    if (sys) Object.assign(row, { action: 'SKIP', reason: sys });
    else if (!(e.size > 0)) Object.assign(row, { action: 'SKIP', reason: 'empty (0 bytes)' });
    else if (e.error) Object.assign(row, { action: 'HOLD', reason: `could not be read: ${e.error}` });
    else if (!e.hash) Object.assign(row, { action: 'HOLD', reason: 'no fingerprint could be taken' });
    else if (drive.has(key(e.hash, e.size))) {
      const c = drive.get(key(e.hash, e.size));
      Object.assign(row, { action: 'SKIP', reason: `already on Drive: ${idx.describe(c)}`, driveCopy: idx.describe(c) });
    } else if (firstUpload.has(key(e.hash, e.size))) {
      const first = firstUpload.get(key(e.hash, e.size));
      Object.assign(row, { action: 'SKIP', reason: `same file is uploaded from ${first.path}`, sameAs: rowId(first) });
    } else {
      const dest = destination(e.path);
      let p = dest.path;
      for (let n = 2; used.has(destKey(dest, p)); n += 1) p = route.renamed(dest.path, n);
      used.add(destKey(dest, p));
      Object.assign(row, { action: 'UPLOAD', dest: p === dest.path ? dest : { ...dest, path: p, reason: `${dest.reason}; renamed because a different file already sits at ${dest.path}` } });
      firstUpload.set(key(e.hash, e.size), row);
    }
    rows.push(row);
  }
  return rows;
}

function destKey(d, p) {
  return `${d.remote}|${d.rootId}|${String(p).toLowerCase()}`;
}

function rowId(r) {
  return r.path;
}

/** "mentor24: Restored from MaxOne/Personal/x.pdf" — a destination as Dane would read it. */
function describeDest(d) {
  return `${d.remote === 'm24:' ? 'mentor24' : 'mentorofaio'}: ${d.path}`;
}

/**
 * Split upload rows into batches of at most `maxFiles` files / `maxBytes`
 * bytes, one Drive per batch, so each batch is one rclone copy and the ledger
 * is written after each — an interrupted run loses one batch, not the run.
 */
function batches(rows, maxFiles = 500, maxBytes = 4 * 1024 ** 3) {
  const out = [];
  const open = new Map();
  for (const r of rows) {
    const k = r.dest.remote;
    let b = open.get(k);
    if (!b || b.rows.length >= maxFiles || (b.bytes + r.size > maxBytes && b.rows.length)) {
      b = { remote: r.dest.remote, rows: [], bytes: 0 };
      open.set(k, b);
      out.push(b);
    }
    b.rows.push(r);
    b.bytes += r.size;
  }
  return out;
}

/**
 * Does the plan fit? `free` is { 'm24:': bytes, 'gdrive:': bytes } from each
 * Drive's own quota report; a Drive whose free space cannot be read refuses.
 * The spare is kept back because a Drive that fills mid-run refuses uploads
 * one by one. Returns { ok, lines } — one line per Drive.
 */
const SPARE_BYTES = 5 * 1024 ** 3;
function fits(rows, free, ledger) {
  const need = { 'm24:': 0, 'gdrive:': 0 };
  for (const r of rows) {
    if (r.action !== 'UPLOAD') continue;
    const l = ledger && ledger.get(rowId(r));
    if (l && l.verified) continue;
    need[r.dest.remote] += r.size;
  }
  const lines = [];
  let ok = true;
  for (const [remote, name] of [['m24:', 'mentor24'], ['gdrive:', 'mentorofaio']]) {
    const have = free[remote];
    if (have === null || have === undefined) {
      ok = false;
      lines.push(`${name}: could not read its free space — not starting`);
      continue;
    }
    const room = need[remote] + SPARE_BYTES <= have;
    if (!room) ok = false;
    lines.push(`${name}: ${idx.humanBytes(need[remote])} still to upload, ${idx.humanBytes(have)} free — ${room ? 'fits' : `DOES NOT FIT (keeps ${idx.humanBytes(SPARE_BYTES)} spare)`}`);
  }
  return { ok, lines };
}

/** Counts for the status line. */
function summarize(rows, ledger) {
  const out = { files: rows.length, upload: 0, uploadBytes: 0, verified: 0, verifiedBytes: 0, failed: 0, skip: 0, onDrive: 0, onDriveBytes: 0, hold: 0, holdBytes: 0, video: 0, videoBytes: 0 };
  for (const r of rows) {
    if (r.action === 'SKIP') {
      out.skip += 1;
      if (r.driveCopy || r.sameAs) { out.onDrive += 1; out.onDriveBytes += r.size; }
    } else if (r.action === 'HOLD') { out.hold += 1; out.holdBytes += r.size; } else {
      out.upload += 1;
      out.uploadBytes += r.size;
      if (r.dest.remote === 'gdrive:') { out.video += 1; out.videoBytes += r.size; }
      const l = ledger && ledger.get(rowId(r));
      if (l && l.verified) { out.verified += 1; out.verifiedBytes += r.size; } else if (l && l.error) out.failed += 1;
    }
  }
  return out;
}

/**
 * THE COUNT slice 4 is gated on: of every loose file on MaxOne, how many have
 * a byte-identical copy on a Drive RIGHT NOW, and which do not, each with a
 * reason Dane can act on.
 *
 * `loose` are the loose MaxOne entries (from a fresh index); `hashOf(entry)`
 * supplies an MD5 for an entry the index did not hash (from the run's cache),
 * or nothing; `presentOnDrive(hash, size)` must answer from a FRESH listing of
 * both Drives. System files and empty files carry no content and need no copy;
 * they are counted separately so the total still adds up.
 *
 * Returns { total, backedUp, noCopyNeeded, missing: [{ path, size, reason }] }.
 * `ok` is true only when `missing` is empty.
 */
function verdict(loose, hashOf, presentOnDrive) {
  const out = { total: loose.length, backedUp: 0, noCopyNeeded: 0, missing: [] };
  for (const e of loose) {
    if (idx.skipReason(e.path) || !(e.size > 0)) { out.noCopyNeeded += 1; continue; }
    if (e.error) { out.missing.push({ path: e.path, size: e.size, reason: `could not be read on MaxOne: ${e.error}` }); continue; }
    const h = e.hash || (hashOf && hashOf(e)) || '';
    if (!h) { out.missing.push({ path: e.path, size: e.size, reason: 'no fingerprint yet — run "plan" to hash it, then "run" to upload it' }); continue; }
    if (presentOnDrive(h, e.size)) out.backedUp += 1;
    else out.missing.push({ path: e.path, size: e.size, reason: 'no copy with this fingerprint on either Drive' });
  }
  out.ok = out.missing.length === 0;
  return out;
}

module.exports = {
  M24_PREFIX,
  GDRIVE_PREFIX,
  destination,
  looseEntries,
  driveCopies,
  takenPaths,
  plan,
  rowId,
  describeDest,
  batches,
  fits,
  SPARE_BYTES,
  summarize,
  verdict,
};
