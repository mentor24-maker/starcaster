'use strict';

/**
 * The archive index — which copies of Dane's files are the same file.
 *
 * WHY THIS EXISTS (ticket 86bbvr0wh, slice 1 of 86bbvqh4z)
 * The same photos and video have been zipped, copied and renamed across four
 * places: the MaxOne USB drive, the mentor24 Google Drive, the mentorofaio
 * Google Drive and the MacBook itself. Half of MaxOne (106 GB) is zip files.
 * Before anything is moved or deleted, somebody has to know which copies are
 * redundant — and "redundant" has to mean the BYTES match, never the name.
 * Names here are actively misleading; this material has been renamed on every
 * trip between locations.
 *
 * THE ONE IDEA THAT MAKES IT AFFORDABLE
 * Two files can only be the same file if they are the same SIZE. Drive tells us
 * size and MD5 for free, a zip's table of contents tells us each member's size
 * for free, and the filesystem tells us every loose file's size for free. So
 * the only bytes that ever need reading are files whose size matches some other
 * file's size. A file with a size nothing else has is unique by construction,
 * and the report says so ("unique by size") rather than pretending it hashed it.
 *
 * MD5, not SHA-256, because MD5 is what Google Drive computes. The job is
 * matching copies of the same file, not resisting a forger, and one hash
 * everywhere is what lets a zip member on MaxOne be matched against a Drive
 * file without downloading 956 GB.
 *
 * WHAT THIS FILE IS
 * Pure functions over entries the caller already read — no disk, no network,
 * no clock — so every rule is testable (scripts/builder/archiveIndex.test.js).
 * The walking, listing and hashing live in scripts/archive_index.mjs.
 *
 * THE RULE THE REPORT IS BUILT AROUND
 * Every entry ends up in exactly one bucket: hashed, unique by size, a native
 * Google file (no checksum exists), or COULD NOT READ with the reason. There is
 * no path where an entry quietly does not appear — a sweep that silently skips
 * is a false all-clear (docs/DOCTRINE.md 3.11).
 *
 * NOTHING HERE DECIDES TO DELETE ANYTHING. It proposes a keeper and lists the
 * other copies; Dane approves the list, and that approval is what unblocks
 * slice 2.
 */

const LOCATIONS = ['mentor24', 'mentorofaio', 'mac', 'maxone'];

// Where each kind of file is meant to END UP (Dane, 2026-09-06): video to
// mentorofaio, everything else back to mentor24. The keeper for a duplicate set
// is the copy already at its destination, then the other Drive, then a loose
// copy, and a copy trapped inside a zip last.
const KEEPER_ORDER = {
  video: ['mentorofaio', 'mentor24', 'mac', 'maxone'],
  other: ['mentor24', 'mentorofaio', 'mac', 'maxone'],
};

const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'mts', 'm2ts', 'wmv', 'mpg', 'mpeg', '3gp', 'webm', 'flv', 'vob', 'mod', 'tod', 'dv']);
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'gif', 'tif', 'tiff', 'bmp', 'webp', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'psd', 'svg']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'aac', 'aif', 'aiff', 'flac', 'ogg', 'wma', 'caf']);

function extOf(name) {
  const base = String(name).split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function mediaKind(name) {
  const ext = extOf(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (PHOTO_EXT.has(ext)) return 'photo';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'other';
}

// Things that are not Dane's content: OS bookkeeping, and the two folder kinds
// that are regenerated from somewhere else (a repo's history, a package
// install). Every skip is COUNTED and the report prints the counts, so an
// exclusion is stated rather than silent.
const SKIP_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', 'Icon\r']);
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.Trashes', '.Spotlight-V100', '.fseventsd', '.TemporaryItems', 'System Volume Information', '__MACOSX']);

/** Why a path is skipped, or null to keep it. `rel` uses "/" separators. */
function skipReason(rel) {
  const parts = String(rel).split('/').filter(Boolean);
  const base = parts[parts.length - 1] || '';
  for (const dir of parts.slice(0, -1)) {
    if (SKIP_DIR_NAMES.has(dir)) return `inside ${dir}/`;
  }
  if (SKIP_DIR_NAMES.has(base)) return `inside ${base}/`;
  if (SKIP_FILE_NAMES.has(base)) return 'system file';
  if (base.startsWith('._')) return 'macOS resource fork (._ file)';
  return null;
}

/** Stable id for an entry, used for sorting and in the detail files. */
function entryId(e) {
  return e.container ? `${e.location}:${e.container}::${e.path}` : `${e.location}:${e.path}`;
}

/** Where a copy lives, readable: "maxone: Archives/x.zip → DCIM/IMG_1.MOV". */
function describe(e) {
  return e.container ? `${e.location}: ${e.container} → ${e.path}` : `${e.location}: ${e.path}`;
}

/**
 * Which sizes need hashing: every size shared by two or more entries, except
 * zero (every empty file "matches" every other and says nothing). Entries that
 * already carry a hash (Drive) still count toward a collision, so a loose file
 * the same size as a Drive file gets read.
 */
function sizesNeedingHash(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (!(e.size > 0)) continue;
    counts.set(e.size, (counts.get(e.size) || 0) + 1);
  }
  const out = new Set();
  for (const [size, n] of counts) if (n > 1) out.add(size);
  return out;
}

function keeperRank(e, order) {
  const loc = order.indexOf(e.location);
  return [e.container ? 1 : 0, loc < 0 ? 99 : loc, e.path.length, entryId(e)];
}

function compareRank(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * The copy to keep. A loose copy always beats one inside a zip (a zip member
 * cannot be opened without the whole zip), then the destination for this kind
 * of file, then the shortest path, then the id — so the answer never depends on
 * the order things were listed in, and a rerun names the same keeper.
 */
function pickKeeper(copies) {
  const kind = mediaKind(copies[0].path) === 'video' ? 'video' : 'other';
  const order = KEEPER_ORDER[kind];
  return copies.slice().sort((a, b) => compareRank(keeperRank(a, order), keeperRank(b, order)))[0];
}

/**
 * Put every entry in exactly one bucket and build the duplicate sets.
 * Input entries: { location, path, container?, size, hash?, native?, error? }.
 *   hash    — md5 hex, present when it was hashed or Drive supplied it
 *   native  — a Google Doc/Sheet/Slide: no bytes, so no checksum exists
 *   error   — it could not be read; the reason
 */
function analyze(entries) {
  const needs = sizesNeedingHash(entries);
  const unreadable = [];
  const native = [];
  const uniqueBySize = [];
  const byHash = new Map();
  let empty = 0;

  for (const e of entries) {
    if (e.error) { unreadable.push(e); continue; }
    if (e.native) { native.push(e); continue; }
    if (!(e.size > 0)) { empty += 1; continue; }
    if (e.hash) {
      const key = `${e.hash}:${e.size}`;
      if (!byHash.has(key)) byHash.set(key, []);
      byHash.get(key).push(e);
      continue;
    }
    if (needs.has(e.size)) {
      // A size something else shares, and no hash: we cannot say whether it is
      // a copy. That is a could-not-tell, never "unique".
      unreadable.push({ ...e, error: 'size matches another file but it was not hashed' });
      continue;
    }
    uniqueBySize.push(e);
  }

  const sets = [];
  let uniqueCount = uniqueBySize.length;
  let uniqueBytes = uniqueBySize.reduce((s, e) => s + e.size, 0);
  for (const [key, copies] of byHash) {
    uniqueCount += 1;
    uniqueBytes += copies[0].size;
    if (copies.length < 2) continue;
    const sorted = copies.slice().sort((a, b) => (entryId(a) < entryId(b) ? -1 : 1));
    const keeper = pickKeeper(sorted);
    sets.push({
      hash: key.split(':')[0],
      size: copies[0].size,
      kind: mediaKind(keeper.path),
      keeper,
      others: sorted.filter((c) => c !== keeper),
    });
  }
  sets.sort((a, b) => (b.size * b.others.length) - (a.size * a.others.length) || (a.hash < b.hash ? -1 : 1));

  return { sets, unreadable, native, uniqueBySize, empty, uniqueCount, uniqueBytes, byHash };
}

/**
 * Per zip on a local disk: is everything in it already somewhere else?
 *   ON DRIVE     — every member has a byte-identical copy on a Google Drive, or
 *                  the zip file itself does. Slice 2 need not unzip it.
 *   ELSEWHERE    — every member exists outside this zip, but not all on a
 *                  Drive (e.g. only as a loose file on the Mac).
 *   PARTLY       — some members have no copy anywhere else; slice 2 must unzip
 *                  and route those, and the report lists how many and how big.
 *   CANNOT TELL  — the zip or one of its members could not be read.
 */
function classifyZips(entries, analysis) {
  const onDrive = (loc) => loc === 'mentor24' || loc === 'mentorofaio';
  const zips = new Map();
  for (const e of entries) {
    if (e.zipFile) zips.set(`${e.location}:${e.path}`, { zip: e, members: [] });
  }
  for (const e of entries) {
    if (!e.container) continue;
    const z = zips.get(`${e.location}:${e.container}`);
    if (z) z.members.push(e);
  }

  const needs = sizesNeedingHash(entries);
  const copiesOf = (e) => (e.hash ? analysis.byHash.get(`${e.hash}:${e.size}`) || [] : []);
  const out = [];
  for (const { zip, members } of zips.values()) {
    const zipCopies = copiesOf(zip).filter((c) => c !== zip);
    const row = {
      location: zip.location,
      path: zip.path,
      size: zip.size,
      members: members.length,
      zipOnDrive: zipCopies.some((c) => onDrive(c.location)),
      verdict: '',
      missing: [],
      unreadable: [],
    };
    if (zip.error || zip.listError) {
      row.verdict = 'CANNOT TELL';
      row.unreadable.push(zip.error || zip.listError);
      out.push(row);
      continue;
    }
    let allDrive = true;
    let allElsewhere = true;
    for (const m of members) {
      if (!(m.size > 0)) continue;
      if (m.error) { row.unreadable.push(`${m.path}: ${m.error}`); continue; }
      if (!m.hash) {
        if (needs.has(m.size)) { row.unreadable.push(`${m.path}: size matches another file but it was not hashed`); continue; }
        // Unique by size: nothing else anywhere is this big, so no copy exists.
        allDrive = false; allElsewhere = false; row.missing.push(m); continue;
      }
      const others = copiesOf(m).filter((c) => c.container !== zip.path || c.location !== zip.location);
      if (!others.length) { allDrive = false; allElsewhere = false; row.missing.push(m); continue; }
      if (!others.some((c) => onDrive(c.location))) allDrive = false;
    }
    if (row.zipOnDrive) row.verdict = 'ON DRIVE';
    else if (row.unreadable.length) row.verdict = 'CANNOT TELL';
    else if (allDrive) row.verdict = 'ON DRIVE';
    else if (allElsewhere) row.verdict = 'ELSEWHERE';
    else row.verdict = 'PARTLY';
    out.push(row);
  }
  const order = { 'CANNOT TELL': 0, PARTLY: 1, ELSEWHERE: 2, 'ON DRIVE': 3 };
  out.sort((a, b) => order[a.verdict] - order[b.verdict] || b.size - a.size || (a.path < b.path ? -1 : 1));
  return out;
}

/**
 * What one `rclone lsjson --hash` row is. Google Docs, Sheets and Slides have no
 * file bytes, so Drive keeps no checksum for them — and rclone does NOT report
 * them under their Google MIME type: it presents them as the Office file it
 * would export (`Alphire Agency System.docx`, type docx) with Size -1. The
 * first real run counted 1,199 of those as could-not-read; Size -1 is the tell.
 */
function classifyDriveRow(f) {
  const md5 = f.Hashes && f.Hashes.md5;
  if (String(f.MimeType || '').startsWith('application/vnd.google-apps.') || f.Size < 0) {
    return { size: 0, native: true };
  }
  if (md5) return { size: f.Size, hash: md5 };
  return { size: f.Size, error: 'Drive supplied no checksum' };
}

/**
 * A read failure, in words Dane can act on. Error -11 (EDEADLK) is what macOS
 * returns for a file that iCloud has moved off this Mac: the name is here, the
 * bytes are not, and reading it would start a download. The first real run hit
 * 7,332 of those in Documents and printed "Unknown system error -11".
 */
function readErrorReason(err) {
  if (err && (err.errno === -11 || err.code === 'EDEADLK' || /system error -11\b/.test(String(err.message)))) {
    return 'in iCloud only — not downloaded to this Mac, so it was not read (reading it would download it)';
  }
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return `macOS refused access (${err.code})`;
  return `could not read: ${(err && (err.code || err.message)) || 'unknown error'}`;
}

function humanBytes(n) {
  if (!(n > 0)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * The removal proposals, per location: every non-keeper copy that is a LOOSE
 * file (zip members are handled by the zip verdicts — you cannot delete one
 * file out of a zip that is itself going away). Proposals only.
 */
function proposedRemovals(analysis) {
  const byLoc = {};
  for (const loc of LOCATIONS) byLoc[loc] = { count: 0, bytes: 0, items: [] };
  for (const set of analysis.sets) {
    for (const c of set.others) {
      if (c.container) continue;
      const bucket = byLoc[c.location] || (byLoc[c.location] = { count: 0, bytes: 0, items: [] });
      bucket.count += 1;
      bucket.bytes += c.size;
      bucket.items.push({ copy: c, keeper: set.keeper, hash: set.hash });
    }
  }
  for (const b of Object.values(byLoc)) b.items.sort((x, y) => (entryId(x.copy) < entryId(y.copy) ? -1 : 1));
  return byLoc;
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * The report Dane reads. Plain words first, numbers second, detail last; the
 * full lists go to the side files named at the bottom, so this stays readable.
 * `meta` = { ranAt, sources: [{location, root, files, skipped: {reason: n}, error?}], topN }
 */
function renderReport(entries, meta) {
  const analysis = analyze(entries);
  const zips = classifyZips(entries, analysis);
  const removals = proposedRemovals(analysis);
  const topN = meta.topN || 150;
  const L = [];
  const push = (s = '') => L.push(s);

  const wasted = analysis.sets.reduce((s, set) => s + set.size * set.others.length, 0);
  const hashedCount = entries.filter((e) => e.hash && !e.error).length;

  push('# Archive index — which copies are the same file');
  push('');
  push(`Run ${meta.ranAt}. Read-only: nothing was moved, unzipped to a permanent place, or deleted.`);
  push('Every "duplicate" below is a byte-for-byte match by MD5 fingerprint and size — never by name.');
  push('');
  push('## The short version');
  push('');
  push(`- **Unique content:** ${analysis.uniqueCount.toLocaleString('en-US')} distinct files, ${humanBytes(analysis.uniqueBytes)}.`);
  push(`- **Duplicate sets:** ${analysis.sets.length.toLocaleString('en-US')} files exist in more than one copy; the extra copies take ${humanBytes(wasted)}.`);
  const zc = (v) => zips.filter((z) => z.verdict === v);
  push(`- **Zips on MaxOne and the Mac:** ${zips.length} indexed. ${zc('ON DRIVE').length} are already fully on a Google Drive (${humanBytes(zc('ON DRIVE').reduce((s, z) => s + z.size, 0))}), ${zc('ELSEWHERE').length} are fully copied elsewhere but not all on Drive, ${zc('PARTLY').length} hold files found nowhere else, ${zc('CANNOT TELL').length} could not be read.`);
  push(`- **Could not read:** ${analysis.unreadable.length.toLocaleString('en-US')} entries — listed in full below. Zero would mean nothing was skipped.`);
  push('');
  push('## Where things are');
  push('');
  push('| Location | Where | Files listed | Skipped (and why) | Problem |');
  push('| --- | --- | --- | --- | --- |');
  for (const s of meta.sources) {
    const skipped = Object.entries(s.skipped || {}).map(([why, n]) => `${n} ${why}`).join('; ') || 'none';
    push(`| ${s.location} | ${mdEscape(s.root)} | ${(s.files || 0).toLocaleString('en-US')} | ${mdEscape(skipped)} | ${s.error ? mdEscape(s.error) : '—'} |`);
  }
  push('');
  push(`How each entry was settled: ${hashedCount.toLocaleString('en-US')} have an MD5 fingerprint (read here, or supplied by Google Drive); ${analysis.uniqueBySize.length.toLocaleString('en-US')} are unique by size — nothing else anywhere is that many bytes, so no copy can exist and they were not read; ${analysis.native.length.toLocaleString('en-US')} are Google Docs/Sheets/Slides, which have no file bytes and so no fingerprint (they cannot be a copy of anything in a zip); ${analysis.empty.toLocaleString('en-US')} are empty (0 bytes) and are ignored.`);
  push('');

  push('## What each later slice would do — proposals for your approval');
  push('');
  push('Nothing below happens until you approve it. This slice only proposes.');
  push('');
  push('**Zips that do not need unzipping** — every file inside already has an identical copy on a Google Drive (or the zip itself does). Slice 2 would skip them, and they become candidates for deletion once you approve:');
  push('');
  const zipTable = (rows) => {
    push('| Zip | Size | Files inside | Why |');
    push('| --- | --- | --- | --- |');
    for (const z of rows) {
      const why = z.zipOnDrive ? 'the zip file itself is on Drive'
        : z.verdict === 'PARTLY' ? `${z.missing.length} file(s), ${humanBytes(z.missing.reduce((s, m) => s + m.size, 0))}, found nowhere else`
          : z.verdict === 'CANNOT TELL' ? mdEscape(z.unreadable.slice(0, 2).join('; ') + (z.unreadable.length > 2 ? ` (+${z.unreadable.length - 2} more)` : ''))
            : z.verdict === 'ELSEWHERE' ? 'every file has a copy, but not all on Drive'
              : 'every file has a copy on Drive';
      push(`| ${mdEscape(`${z.location}: ${z.path}`)} | ${humanBytes(z.size)} | ${z.members} | ${why} |`);
    }
    if (!rows.length) push('| (none) | | | |');
    push('');
  };
  zipTable(zc('ON DRIVE'));
  push('**Zips that DO need unzipping** — they hold files with no copy on any Drive. Slice 2 would unzip these and send the unique files on (video to mentorofaio, everything else to mentor24):');
  push('');
  zipTable([...zc('PARTLY'), ...zc('ELSEWHERE')]);
  if (zc('CANNOT TELL').length) {
    push('**Zips that could not be read** — nothing is proposed for these:');
    push('');
    zipTable(zc('CANNOT TELL'));
  }

  push('**Loose extra copies** — files outside any zip that have an identical copy kept elsewhere:');
  push('');
  push('| Location | Extra copies | Space they take |');
  push('| --- | --- | --- |');
  for (const loc of Object.keys(removals)) {
    push(`| ${loc} | ${removals[loc].count.toLocaleString('en-US')} | ${humanBytes(removals[loc].bytes)} |`);
  }
  push('');
  push('The file-by-file list is in `proposed-removals.tsv`, each line naming the copy AND the keeper it duplicates, so any line can be checked by hand.');
  push('');

  push(`## The ${Math.min(topN, analysis.sets.length)} biggest duplicate sets`);
  push('');
  push('Ranked by space the extra copies take. The keeper is the copy already where that kind of file is meant to live (video: mentorofaio; everything else: mentor24), then the other Drive, then a loose file, and a copy inside a zip last.');
  push('');
  for (const set of analysis.sets.slice(0, topN)) {
    push(`- **${humanBytes(set.size)}** ${set.kind}, ${set.others.length + 1} copies — keep \`${mdEscape(describe(set.keeper))}\``);
    for (const c of set.others) push(`  - also \`${mdEscape(describe(c))}\``);
  }
  if (!analysis.sets.length) push('(no duplicates found)');
  push('');

  push('## Could not read');
  push('');
  if (!analysis.unreadable.length) {
    push('Nothing. Every entry listed was either fingerprinted or proven unique by size.');
  } else {
    push('These are neither "unique" nor "duplicate" — the report cannot say. Nothing is proposed for them.');
    push('');
    const why = new Map();
    for (const e of analysis.unreadable) {
      const reason = String(e.error).split(/: | — /)[0];
      const k = `${e.location}: ${reason}`;
      why.set(k, (why.get(k) || 0) + 1);
    }
    push('| Where and why | How many |');
    push('| --- | --- |');
    for (const [k, n] of [...why].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) push(`| ${mdEscape(k)} | ${n.toLocaleString('en-US')} |`);
    push('');
    const shown = analysis.unreadable.slice().sort((a, b) => (entryId(a) < entryId(b) ? -1 : 1));
    for (const e of shown.slice(0, 300)) push(`- \`${mdEscape(describe(e))}\` — ${mdEscape(e.error)}`);
    if (shown.length > 300) push(`- …and ${shown.length - 300} more, all in \`unreadable.tsv\`.`);
  }
  push('');
  push('## Side files');
  push('');
  push('- `duplicates.tsv` — every duplicate set, one copy per line, keeper marked');
  push('- `proposed-removals.tsv` — every loose extra copy with its keeper');
  push('- `zips.tsv` — every zip and its verdict');
  push('- `unreadable.tsv` — everything that could not be read, with the reason');
  push('- `index.jsonl` — every entry the index saw');
  push('');
  return { markdown: L.join('\n'), analysis, zips, removals };
}

module.exports = {
  LOCATIONS,
  KEEPER_ORDER,
  analyze,
  classifyDriveRow,
  classifyZips,
  describe,
  entryId,
  humanBytes,
  mediaKind,
  pickKeeper,
  proposedRemovals,
  readErrorReason,
  renderReport,
  sizesNeedingHash,
  skipReason,
};
