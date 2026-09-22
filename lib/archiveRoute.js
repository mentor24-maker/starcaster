'use strict';

/**
 * The archive route — where each file inside the MaxOne zips goes, and when a
 * zip may be deleted.
 *
 * WHY THIS EXISTS (ticket 86bbvr0xv, slice 2 of 86bbvqh4z)
 * Slice 1 (lib/archiveIndex.js) fingerprinted every file in four places and
 * reported which zips on MaxOne hold files that no Google Drive has. Dane read
 * that report and replied GO on 2026-09-21. This slice executes it: unzip only
 * what is missing from Drive, send video to mentorofaio and everything else to
 * mentor24 (Dane, 2026-09-06), verify each upload by MD5, and only then let a
 * zip be deleted.
 *
 * WHAT THIS FILE IS
 * Pure functions — no disk, no network, no clock — so every rule is testable
 * (scripts/builder/archiveRoute.test.js). The unzipping, uploading and deleting
 * live in scripts/archive_route.mjs.
 *
 * THE RULE THE WHOLE SLICE HANGS ON
 * A zip may be deleted only when every file in it has a byte-identical copy on
 * a Google Drive RIGHT NOW — checked against a fresh Drive listing at delete
 * time, by MD5 and size. Not "the upload exited 0", not "the ledger says it was
 * verified yesterday". That is `clearable()` below, and it is deliberately
 * independent of how the copy got there.
 */

const idx = require('./archiveIndex.js');

// mentor24's original "Personal" folder. There are TWO folders named Personal
// at the top of mentor24 (a 2016 one holding Family/, Finance/, Child Support/,
// and a 2026 one holding four loose documents), and Drive allows that, so a
// path like "m24:Personal/Family" is ambiguous to rclone. The folder id is not.
const M24_PERSONAL_ID = '0BxLM_-VfxgA5eldmX1cwT1F3d00';

/**
 * Where a zip's contents came from, decided by the zip's path on MaxOne.
 * The "Google Drive Download/Personal/<X>-<timestamp>.zip" files are Drive's
 * own split downloads of mentor24's Personal folder, taken 2026-01-12, and the
 * Personal-<timestamp> and Personal Social Circles-<timestamp> zips next to
 * them are the same download. Measured, not assumed: every one of those zips
 * that has ANY file still on a Drive has it under mentorofaio's
 * Mentor/Personal/ — the mirror of that folder. So those go back home.
 *
 * Everything else has no evidence of an original location, and a guess would
 * scatter files where nobody will look. Those land in one clearly named folder
 * per Drive, mirroring the folder they sat in on MaxOne — mentorofaio already
 * has "Archives-from-maxone" from the July migration, so video joins it.
 */
function origin(zipPath) {
  const p = String(zipPath);
  const base = p.split('/').pop();
  if (p.startsWith('Google Drive Download/Personal/')) return { kind: 'personal', stripPrefix: '' };
  if (p.startsWith('Personal/') && /^Personal-\d{8}T\d{6}Z/.test(base)) return { kind: 'personal', stripPrefix: 'Personal/' };
  if (p.startsWith('Personal/') && /^Personal Social Circles-\d{8}T\d{6}Z/.test(base)) return { kind: 'personal', stripPrefix: '' };
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  return { kind: 'unknown', dir };
}

/**
 * The destination for one member. Returns { remote, rootId, path, reason }:
 *   remote  'm24:' (mentor24) or 'gdrive:' (mentorofaio) — the rclone names
 *   rootId  a Drive folder id the path is relative to, or '' for the Drive root
 *   path    the path under that root
 */
function destination(zipPath, memberPath) {
  const video = idx.mediaKind(memberPath) === 'video';
  const o = origin(zipPath);
  if (o.kind === 'personal') {
    const rel = o.stripPrefix && memberPath.startsWith(o.stripPrefix) ? memberPath.slice(o.stripPrefix.length) : memberPath;
    if (video) return { remote: 'gdrive:', rootId: '', path: `Mentor/Personal/${rel}`, reason: 'video → mentorofaio, beside the rest of the Personal folder' };
    return { remote: 'm24:', rootId: M24_PERSONAL_ID, path: rel, reason: 'back to its original place in mentor24 Personal' };
  }
  const under = o.dir ? `${o.dir}/${memberPath}` : memberPath;
  if (video) return { remote: 'gdrive:', rootId: '', path: `Archives-from-maxone/${under}`, reason: 'video → mentorofaio; original location unknown' };
  return { remote: 'm24:', rootId: '', path: `Restored from MaxOne/${under}`, reason: 'original location unknown' };
}

const onDrive = (loc) => loc === 'mentor24' || loc === 'mentorofaio';

/**
 * The plan: one row per member of every zip on MaxOne, in exactly one state.
 *   UPLOAD — no Drive has it; unzip it and send it to `dest`
 *   SKIP   — no upload needed, and `reason` says why (already on Drive and
 *            where, the zip itself is on Drive, the same file is uploaded from
 *            another row, empty, a system file)
 *   HOLD   — it could not be read, so nothing is decided and its zip is never
 *            deleted
 *
 * `entries` are slice 1's index.jsonl rows. Only location "maxone" is planned:
 * the ticket's scope is MaxOne, whose reformat (slice 4) is the reason any of
 * this is urgent. The Mac's zips are left where they are for slice 3.
 */
function plan(entries) {
  const driveByKey = new Map();
  for (const e of entries) {
    if (!e.container && onDrive(e.location) && e.hash && e.size > 0) {
      const k = `${e.hash}:${e.size}`;
      if (!driveByKey.has(k)) driveByKey.set(k, e);
    }
  }
  const zips = new Map();
  for (const e of entries) {
    if (e.location !== 'maxone') continue;
    if (!e.container && e.path.toLowerCase().endsWith('.zip')) {
      if (!zips.has(e.path)) zips.set(e.path, { zip: e, members: [] });
      else zips.get(e.path).zip = e;
    }
  }
  for (const e of entries) {
    if (e.location !== 'maxone' || !e.container) continue;
    if (!zips.has(e.container)) zips.set(e.container, { zip: null, members: [] });
    zips.get(e.container).members.push(e);
  }

  const rows = [];
  const firstUpload = new Map();
  const names = [...zips.keys()].sort();
  for (const zipPath of names) {
    const { zip, members } = zips.get(zipPath);
    const zipCopy = zip && zip.hash && zip.size > 0 ? driveByKey.get(`${zip.hash}:${zip.size}`) : null;
    const sorted = members.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (zip && zip.error) {
      rows.push({ zip: zipPath, member: '', size: zip.size || 0, hash: '', action: 'HOLD', reason: `the zip could not be read: ${zip.error}` });
      continue;
    }
    for (const m of sorted) {
      const row = { zip: zipPath, member: m.path, size: m.size, hash: m.hash || '', kind: idx.mediaKind(m.path) };
      const sys = idx.skipReason(m.path);
      if (unsafePath(m.path)) Object.assign(row, { action: 'HOLD', reason: 'unsafe path inside the zip (absolute, or climbs out with "..") — not extracted' });
      else if (sys) Object.assign(row, { action: 'SKIP', reason: sys });
      else if (!(m.size > 0)) Object.assign(row, { action: 'SKIP', reason: 'empty (0 bytes)' });
      else if (m.error) Object.assign(row, { action: 'HOLD', reason: `could not be read: ${m.error}` });
      else if (zipCopy) Object.assign(row, { action: 'SKIP', reason: `the zip itself is on Drive: ${idx.describe(zipCopy)}`, driveCopy: idx.describe(zipCopy) });
      else if (m.hash && driveByKey.has(`${m.hash}:${m.size}`)) {
        const c = driveByKey.get(`${m.hash}:${m.size}`);
        Object.assign(row, { action: 'SKIP', reason: `already on Drive: ${idx.describe(c)}`, driveCopy: idx.describe(c) });
      } else if (m.hash && firstUpload.has(`${m.hash}:${m.size}`)) {
        const first = firstUpload.get(`${m.hash}:${m.size}`);
        Object.assign(row, { action: 'SKIP', reason: `same file is uploaded from ${first.zip} → ${first.member}`, sameAs: rowId(first) });
      } else {
        Object.assign(row, { action: 'UPLOAD', dest: destination(zipPath, m.path) });
        if (m.hash) firstUpload.set(`${m.hash}:${m.size}`, row);
      }
      rows.push(row);
    }
  }
  return rows;
}

/** A member name that would write outside the staging folder if extracted. */
function unsafePath(p) {
  const s = String(p);
  return s.startsWith('/') || s.split('/').some((seg) => seg === '..');
}

function rowId(r) {
  return `${r.zip}::${r.member}`;
}

/** "m24:[Personal]/Family/x.jpg" — a destination as Dane would read it. */
function describeDest(d) {
  const where = d.remote === 'm24:' ? 'mentor24' : 'mentorofaio';
  const root = d.rootId === M24_PERSONAL_ID ? 'Personal (the original, 2016 folder)/' : '';
  return `${where}: ${root}${d.path}`;
}

/**
 * Two uploads may not land on the same path — the second would either be
 * refused (--ignore-existing) or replace the first. Returns the rows whose
 * destination is taken by an earlier row, so the caller can rename them.
 */
function destinationClashes(rows) {
  const seen = new Map();
  const clashes = [];
  for (const r of rows) {
    if (r.action !== 'UPLOAD') continue;
    const k = `${r.dest.remote}|${r.dest.rootId}|${r.dest.path.toLowerCase()}`;
    if (seen.has(k)) clashes.push(r);
    else seen.set(k, r);
  }
  return clashes;
}

/** "a/b/IMG_1.MOV" + n → "a/b/IMG_1 (from MaxOne 2).MOV" */
function renamed(p, n) {
  const slash = p.lastIndexOf('/');
  const dir = p.slice(0, slash + 1);
  const base = p.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const tag = ` (from MaxOne ${n})`;
  return dot > 0 ? `${dir}${base.slice(0, dot)}${tag}${base.slice(dot)}` : `${dir}${base}${tag}`;
}

/** Give every clashing upload a distinct name. Mutates and returns rows. */
function resolveClashes(rows) {
  const key = (d, p) => `${d.remote}|${d.rootId}|${p.toLowerCase()}`;
  const taken = new Set();
  for (const r of rows) {
    if (r.action !== 'UPLOAD') continue;
    let p = r.dest.path;
    for (let n = 2; taken.has(key(r.dest, p)); n += 1) p = renamed(r.dest.path, n);
    taken.add(key(r.dest, p));
    if (p !== r.dest.path) r.dest = { ...r.dest, path: p };
  }
  return rows;
}

/**
 * May this zip be deleted? `presentOnDrive(hash, size)` must answer from a
 * FRESH Drive listing taken at delete time. `hashOf(row)` supplies the MD5 for
 * a member slice 1 never hashed (unique by size — nothing else was its size);
 * the run step records it while extracting.
 *
 * Returns { ok, blockers: [reason] }. Every member must be settled:
 *   system files and empty files carry no content and need no copy;
 *   everything else needs a Drive copy with the same MD5 and size, now.
 * A HOLD row blocks outright. "The zip itself is on Drive" counts only if that
 * zip copy is still there.
 */
function clearable(zipRows, zipEntry, presentOnDrive, hashOf) {
  const blockers = [];
  if (!zipRows.length) return { ok: false, blockers: ['no plan rows for this zip'] };
  const zipStillOnDrive = zipEntry && zipEntry.hash && zipEntry.size > 0 && presentOnDrive(zipEntry.hash, zipEntry.size);
  for (const r of zipRows) {
    if (r.action === 'HOLD') { blockers.push(`${r.member || '(zip)'}: ${r.reason}`); continue; }
    if (r.action === 'SKIP' && (r.reason === 'empty (0 bytes)' || idx.skipReason(r.member))) continue;
    if (zipStillOnDrive) continue;
    const h = r.hash || (hashOf && hashOf(r)) || '';
    if (!h) { blockers.push(`${r.member}: no fingerprint yet — it has not been extracted and uploaded`); continue; }
    if (!presentOnDrive(h, r.size)) blockers.push(`${r.member}: no copy with this fingerprint on either Drive`);
  }
  return { ok: blockers.length === 0, blockers };
}

/** Counts for the status line and the report. */
function summarize(rows, ledger) {
  const out = { members: rows.length, upload: 0, uploadBytes: 0, verified: 0, verifiedBytes: 0, failed: 0, skip: 0, hold: 0, video: 0, videoBytes: 0 };
  for (const r of rows) {
    if (r.action === 'SKIP') out.skip += 1;
    else if (r.action === 'HOLD') out.hold += 1;
    else {
      out.upload += 1;
      out.uploadBytes += r.size;
      if (r.dest.remote === 'gdrive:') { out.video += 1; out.videoBytes += r.size; }
      const l = ledger && ledger.get(rowId(r));
      if (l && l.verified) { out.verified += 1; out.verifiedBytes += r.size; } else if (l && l.error) out.failed += 1;
    }
  }
  return out;
}

module.exports = {
  M24_PERSONAL_ID,
  origin,
  destination,
  plan,
  rowId,
  unsafePath,
  describeDest,
  destinationClashes,
  renamed,
  resolveClashes,
  clearable,
  summarize,
};
