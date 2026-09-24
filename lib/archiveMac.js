'use strict';

/**
 * The Mac archive — where each loose file in Desktop, Downloads and the old
 * "Desktop - Dane's MacBook Pro (2)" folder goes, and when it may leave the Mac.
 *
 * WHY THIS EXISTS (ticket 86bbvr0yr, slice 3 of 86bbvqh4z)
 * MaxOne holds 466 GiB and the MacBook was using 705 GiB, so MaxOne cannot be
 * the Mac's backup drive until the Mac comes down to ~400 GB. Clearing Filmora's
 * caches and old versions got part of the way; the rest is these three folders
 * (~190 GB). Slice 2 (lib/archiveRoute.js) did the same job for the zips on
 * MaxOne. This does it for loose files on the Mac, under the same rules:
 * video to mentorofaio, everything else to mentor24 (Dane, 2026-09-06), every
 * upload read back by MD5, and nothing leaves the Mac unless a byte-identical
 * copy is on a Drive at that moment.
 *
 * WHAT THIS FILE IS
 * Pure functions — no disk, no network, no clock — so every rule is testable
 * (scripts/builder/archiveMac.test.js). Walking, hashing, uploading and moving
 * live in scripts/archive_mac.mjs.
 *
 * NOTHING IS DELETED. `clear --apply` MOVES the verified files into the Trash,
 * and only after Dane has approved the dry run's list (the epic's rule: a
 * script never decides on its own what to delete). Emptying the Trash is his.
 */

const idx = require('./archiveIndex.js');

// The three folders this slice archives, by the label used on Drive. The old
// Desktop folder's name carries a curly apostrophe; it is found by prefix on
// disk (see scripts/archive_mac.mjs) and labelled by its real name.
const FOLDERS = ['Desktop', 'Downloads'];
const OLD_DESKTOP_PREFIX = 'Desktop - ';

// Where the uploads land. Named to sit beside slice 2's "Restored from MaxOne"
// (mentor24) and "Archives-from-maxone" (mentorofaio), so a person browsing
// either Drive finds both archives together.
const M24_PREFIX = 'Restored from Mac';
const GDRIVE_PREFIX = 'Archives-from-mac';

/**
 * The destination for one file: { remote, path, reason }.
 *   remote  'm24:' (mentor24) or 'gdrive:' (mentorofaio) — the rclone names
 *   path    the path on that Drive, mirroring where it sat on the Mac
 */
function destination(folder, rel) {
  if (idx.mediaKind(rel) === 'video') {
    return { remote: 'gdrive:', path: `${GDRIVE_PREFIX}/${folder}/${rel}`, reason: 'video → mentorofaio' };
  }
  return { remote: 'm24:', path: `${M24_PREFIX}/${folder}/${rel}`, reason: 'everything but video → mentor24' };
}

const key = (hash, size) => `${hash}:${size}`;

/**
 * The plan: one row per file found under the three folders, in exactly one state.
 *   UPLOAD — no Drive has these bytes; send it to `dest`
 *   SKIP   — no upload needed, and `reason` says why: already on Drive (and
 *            where), the same bytes are uploaded from another row, empty, a
 *            system file, inside a .git or node_modules folder
 *   HOLD   — it could not be read, or its bytes are not on this Mac at all (a
 *            cloud placeholder), so nothing is decided and it never moves
 *
 * `files` are { folder, rel, size, mtime, hash?, error?, dataless? } — `hash`
 * is the MD5 of the bytes on the Mac. `drive` maps "md5:size" to where a Drive
 * copy is ("mentor24: Photos/x.jpg"), from a listing taken at plan time.
 */
function plan(files, drive) {
  const rows = [];
  const firstUpload = new Map();
  const sorted = files.slice().sort((a, b) => {
    const x = `${a.folder}/${a.rel}`;
    const y = `${b.folder}/${b.rel}`;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const f of sorted) {
    const row = { folder: f.folder, rel: f.rel, size: f.size, mtime: f.mtime, hash: f.hash || '', kind: idx.mediaKind(f.rel) };
    const sys = idx.skipReason(f.rel);
    if (sys) Object.assign(row, { action: 'SKIP', reason: sys });
    else if (f.dataless) Object.assign(row, { action: 'HOLD', reason: 'a cloud placeholder — its bytes are not on this Mac, so it is left alone' });
    else if (f.error) Object.assign(row, { action: 'HOLD', reason: `could not be read: ${f.error}` });
    else if (!(f.size > 0)) Object.assign(row, { action: 'SKIP', reason: 'empty (0 bytes)' });
    else if (!f.hash) Object.assign(row, { action: 'HOLD', reason: 'no fingerprint was taken' });
    else if (drive.has(key(f.hash, f.size))) {
      const where = drive.get(key(f.hash, f.size));
      Object.assign(row, { action: 'SKIP', reason: `already on Drive: ${where}`, driveCopy: where });
    } else if (firstUpload.has(key(f.hash, f.size))) {
      const first = firstUpload.get(key(f.hash, f.size));
      Object.assign(row, { action: 'SKIP', reason: `same file is uploaded from ${first.folder}/${first.rel}`, sameAs: rowId(first) });
    } else {
      Object.assign(row, { action: 'UPLOAD', dest: destination(f.folder, f.rel) });
      firstUpload.set(key(f.hash, f.size), row);
    }
    rows.push(row);
  }
  return rows;
}

function rowId(r) {
  return `${r.folder}/${r.rel}`;
}

/** "mentor24: Restored from Mac/Desktop/x.pdf" — a destination as Dane would read it. */
function describeDest(d) {
  return `${d.remote === 'm24:' ? 'mentor24' : 'mentorofaio'}: ${d.path}`;
}

/**
 * Does the plan fit? `free` is { 'm24:': bytes, 'gdrive:': bytes } from each
 * Drive's own quota report. The spare is kept back because a Drive that fills
 * mid-run refuses uploads one by one, and a half-archived folder is worse than
 * one that was never started. Returns { ok, lines } — one line per Drive.
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

/**
 * May this file leave the Mac? `now` is the file as it is on disk at clear time
 * ({ size, mtime, hash } or null when it is gone); `presentOnDrive(hash, size)`
 * answers from a FRESH listing of both Drives. Returns { ok, why }.
 *
 * The bytes compared are the bytes on the Mac NOW, not the plan's: a file that
 * changed since the plan (a document edited on the Desktop) must match a Drive
 * copy in its current form or it stays. Empty and system files stay too — they
 * carry nothing worth a decision, and a .git folder is not ours to break up.
 */
function clearable(row, now, presentOnDrive) {
  if (row.action === 'HOLD') return { ok: false, why: row.reason };
  if (row.action === 'SKIP' && (row.reason === 'empty (0 bytes)' || idx.skipReason(row.rel))) return { ok: false, why: 'left in place: ' + row.reason };
  if (!now) return { ok: false, gone: true, why: 'no longer on the Mac' };
  if (!now.hash) return { ok: false, why: 'could not fingerprint it now' };
  if (!presentOnDrive(now.hash, now.size)) {
    const changed = now.hash !== row.hash || now.size !== row.size;
    return { ok: false, why: changed ? 'it changed since the plan, and its current bytes are on neither Drive' : 'no copy with this fingerprint on either Drive' };
  }
  return { ok: true, why: '' };
}

/** Counts for the status line and the report. */
function summarize(rows, ledger) {
  const out = { files: rows.length, upload: 0, uploadBytes: 0, verified: 0, verifiedBytes: 0, failed: 0, skip: 0, skipBytes: 0, onDrive: 0, onDriveBytes: 0, hold: 0, holdBytes: 0, video: 0, videoBytes: 0 };
  for (const r of rows) {
    if (r.action === 'SKIP') {
      out.skip += 1;
      out.skipBytes += r.size;
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
 * Split upload rows into batches of at most `maxFiles` files / `maxBytes`
 * bytes, grouped by (Drive, folder) so each batch is one rclone copy. Small
 * batches are what make the run resumable in useful steps: the ledger is
 * written after each one, so an interrupted 150 GB run loses one batch.
 */
function batches(rows, maxFiles = 500, maxBytes = 4 * 1024 ** 3) {
  const out = [];
  const open = new Map();
  for (const r of rows) {
    const k = `${r.dest.remote}|${r.folder}`;
    let b = open.get(k);
    if (!b || b.rows.length >= maxFiles || (b.bytes + r.size > maxBytes && b.rows.length)) {
      b = { remote: r.dest.remote, folder: r.folder, rows: [], bytes: 0 };
      open.set(k, b);
      out.push(b);
    }
    b.rows.push(r);
    b.bytes += r.size;
  }
  return out;
}

module.exports = {
  FOLDERS,
  OLD_DESKTOP_PREFIX,
  M24_PREFIX,
  GDRIVE_PREFIX,
  SPARE_BYTES,
  destination,
  plan,
  rowId,
  describeDest,
  fits,
  clearable,
  summarize,
  batches,
};
