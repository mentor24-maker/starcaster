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

const path = require('node:path');
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

// ---------------------------------------------------------------------------
// Dedupe (ticket 86bcfgyza, media intake 5 of 5): free the MacBook of copies
// that are safely on a Drive. Dane's rule (2026-10-08): only MacBook copies are
// ever removed, only after he approves a dry run, and a file goes only when a
// byte-identical copy (MD5 + size) is on mentor24 or mentorofaio AT THAT
// MOMENT — re-read from Drive's own fingerprints, never taken from a report.

// What `clear --apply` moved on 2026-10-04 and nobody emptied: 173 GB, laid
// out as <folder>/<rel> beneath it, so a file's original home is HOME/<rel>.
const ARCHIVED_TRASH = '.Trash/Archived-from-Mac-20261004-0327';

/**
 * One file in the archived Trash folder. `now` is { size, hash?, dataless?,
 * error? } as read at this moment, or null when it is gone; `originalFree`
 * says whether its old place on the Mac is empty. Returns { action, why }:
 *   DELETE   its bytes are on a Drive right now — empty it from the Trash
 *   RESTORE  no Drive has its bytes — put it back where it came from
 *   HOLD     nothing is decided: unreadable, a placeholder, or its old place
 *            is taken by another file (putting it back would overwrite one)
 *   GONE     it is no longer there
 */
function trashVerdict(now, presentOnDrive, originalFree) {
  if (!now) return { action: 'GONE', why: 'no longer in the Trash' };
  if (now.dataless) return { action: 'HOLD', why: 'a cloud placeholder — its bytes are not on this Mac' };
  if (now.error) return { action: 'HOLD', why: `could not be read: ${now.error}` };
  if (now.size > 0 && !now.hash) return { action: 'HOLD', why: 'could not fingerprint it' };
  if (now.size > 0 && presentOnDrive(now.hash, now.size)) return { action: 'DELETE', why: '' };
  if (!originalFree) return { action: 'HOLD', why: 'no copy on either Drive, and another file now sits where it came from' };
  return { action: 'RESTORE', why: now.size > 0 ? 'no copy with this fingerprint on either Drive' : 'empty (0 bytes) — nothing on Drive to match' };
}

/**
 * The second look, at --apply time, for a file the dry run said may go. It
 * goes only if its bytes are what the dry run fingerprinted AND a Drive holds
 * them now. Anything else is held back — never deleted on the dry run's word.
 * Returns { ok, why }.
 */
function stillSafe(dry, now, presentOnDrive) {
  if (!now) return { ok: false, gone: true, why: 'no longer there' };
  if (now.dataless) return { ok: false, why: 'a cloud placeholder now' };
  if (!now.hash) return { ok: false, why: 'could not fingerprint it now' };
  if (now.hash !== dry.hash || now.size !== dry.size) return { ok: false, why: 'it changed since the dry run' };
  if (!presentOnDrive(now.hash, now.size)) return { ok: false, why: 'its Drive copy is gone (or no longer matches) since the dry run' };
  return { ok: true, why: '' };
}

/**
 * The MacBook rows of archive:index's proposed-removals.tsv (4 of 5's report):
 * [{ path, size, hash, keeper }]. `other` counts the rows for any other place,
 * which this never touches (mac-trash rows are the `trash` command's).
 */
function reportRows(tsvText) {
  const lines = String(tsvText).split('\n').filter(Boolean);
  const head = (lines.shift() || '').split('\t');
  const col = (n) => head.indexOf(n);
  const need = ['location', 'path', 'bytes', 'hash', 'keeper'];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) return { error: `not a proposed-removals.tsv — no ${missing.join(', ')} column` };
  const rows = [];
  const other = {};
  for (const l of lines) {
    const c = l.split('\t');
    const loc = c[col('location')];
    if (loc !== 'mac') { other[loc] = (other[loc] || 0) + 1; continue; }
    rows.push({ path: c[col('path')], size: Number(c[col('bytes')]), hash: c[col('hash')], keeper: c[col('keeper')] });
  }
  return { rows, other };
}

/**
 * One MacBook copy from the report. The report's "mac" place is four folders
 * (Desktop, Documents, Downloads, the old Desktop) and records only the path
 * beneath one of them, so `candidates` are the files at that path in each:
 * [{ folder, size, hash?, dataless?, error? }]. Returns one decision per
 * candidate: { folder, action: 'MOVE' | 'HOLD', why }, or [] when none exist.
 * A candidate whose bytes differ from the report's is simply another file
 * that happens to share the path — it is held only if NO candidate matched.
 */
function reportVerdicts(row, candidates, presentOnDrive) {
  const matching = candidates.filter((c) => c.hash === row.hash && c.size === row.size);
  if (!matching.length) {
    return candidates.map((c) => ({
      folder: c.folder,
      action: 'HOLD',
      why: c.dataless ? 'a cloud placeholder — its bytes are not on this Mac' : c.error ? `could not be read: ${c.error}` : 'it changed since the report',
    }));
  }
  return matching.map((c) => (presentOnDrive(c.hash, c.size)
    ? { folder: c.folder, action: 'MOVE', why: '' }
    : { folder: c.folder, action: 'HOLD', why: `no copy on either Drive right now (the report's keeper: ${row.keeper || 'unknown'})` }));
}

/** 'a b' → "'a b'" — safe to paste into a shell, whatever the name holds. */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** "mentor24: Photos/x.jpg" → the rclone path that copies it back. */
function driveRef(where) {
  const m = /^(mentor24|mentorofaio): (.*)$/.exec(String(where || ''));
  if (!m) return null;
  return `${m[1] === 'mentor24' ? 'm24:' : 'gdrive:'}${m[2]}`;
}

/**
 * The line written to the restore log for each change, the way `npm run tidy`
 * logs its deletions: one command that undoes it.
 *   deleted → copy the Drive copy back to where the file lived on the Mac
 *   moved   → move it back from the Trash
 */
function restoreLine(change) {
  if (change.kind === 'deleted') return `rclone copyto ${shellQuote(driveRef(change.driveCopy))} ${shellQuote(change.original)}`;
  return `mkdir -p ${shellQuote(path.dirname(change.from))} && mv -n ${shellQuote(change.to)} ${shellQuote(change.from)}`;
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
  ARCHIVED_TRASH,
  trashVerdict,
  stillSafe,
  reportRows,
  reportVerdicts,
  shellQuote,
  driveRef,
  restoreLine,
};
