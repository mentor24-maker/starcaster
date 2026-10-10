'use strict';

/**
 * Media intake — new Zoom recordings reach the Studio Inbox by themselves
 * (Media intake · 2 of 5, ticket 86bcfgyxp), and so do the videos in the Apple
 * Photos album "Studio" (3 of 5, ticket 86bcfgyy6 — its own section below).
 *
 * WHAT IT DOES
 * Zoom saves every local recording into iCloud Drive › Documents › Zoom, one
 * folder per meeting. Every fifteen minutes this looks there, picks the video
 * files that are finished and fully on the disk, and uploads each one ONCE to
 * the Studio Inbox on mentorofaio's Drive, where the Studio worker on the Mini
 * takes it from there. It reads iCloud Drive and uploads. It never deletes,
 * moves or renames anything on either side (Dane, 2026-10-08).
 *
 * WHY THE MACBOOK. That iCloud Drive belongs to the Apple ID only the MacBook
 * is signed in to; the Mini cannot see the folder at all. lib/nodeRoles.js
 * row `media-intake` carries the rest.
 *
 * FLAT INTO THE INBOX, NOT INTO A SUB-FOLDER. The ticket asked for
 * Inbox/Zoom/<meeting>/, and the Studio watcher ignores any file that is not
 * DIRECTLY inside the Inbox (workers/studio/drive.js, "a nested sub-folder is
 * not followed"). A recording filed there would sit on Drive and never reach
 * the Footage screen, so each one goes into the Inbox itself, named after its
 * meeting: "Zoom - <meeting folder> - <file>". Correction posted on the ticket
 * before building.
 *
 * THE FOUR WAYS A FILE IS NOT SENT, each named in the report:
 *   - it is history (recorded before this was installed) — that is the
 *     separate, explicit `--backfill` step, never the scheduled pass;
 *   - it is not on this disk yet (an iCloud placeholder, or half downloaded);
 *   - it is still being written (touched in the last two minutes);
 *   - it was already sent (its bytes are in the ledger — a rename or a copy
 *     changes the path, not the bytes).
 *
 * THE LEDGER is keyed by the file's MD5, which is also the checksum Google
 * Drive keeps for every upload — so "sent" is recorded only after Drive's own
 * checksum for the uploaded file has been read back and matched. An upload
 * that cannot be confirmed is a failure, and the next pass tries it again.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROLE = 'media-intake';

/** Where Zoom writes local recordings on the MacBook (measured 2026-10-08). */
function defaultZoomRoot(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents', 'Zoom');
}

/** The machine's own state folder for this job: ledger and lock live here. */
function defaultStateDir(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Application Support', 'starcaster-media-intake');
}

/**
 * The Studio Inbox, by id (docs/STUDIO.md). By id rather than by path because
 * the folder above it is still named "Studio-probe" and is due a rename — an
 * id does not change when a folder is renamed or moved.
 */
const DEFAULT_INBOX_FOLDER_ID = '1NBKTjYhQsrVr8seF2r2IXXqBt8-Go0GV';

/** A file must have been left alone this long before it counts as finished. */
const STABLE_AFTER_MS = 2 * 60 * 1000;

/** History is sent in bites: at most this many bytes per `--backfill --apply` run. */
const BACKFILL_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Only the video. Zoom also writes `audio*.m4a` (the same sound the `.mp4`
 * already carries), `playback.m3u`, `chat.txt`, `recording.conf` and the
 * `double_click_to_convert_*.zoom` files of an unfinished conversion — none of
 * which Studio wants.
 */
function isZoomVideo(name) {
  const n = String(name || '');
  return !n.startsWith('.') && /\.mp4$/i.test(n);
}

/**
 * Zoom names each meeting folder after the meeting's start, local time:
 * `2020-04-09 15.10.19 my meeting 612342203`. Null when the name does not
 * carry one — the caller then falls back to the file's own timestamp.
 */
function meetingFolderTime(folderName) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})/.exec(String(folderName || ''));
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Is the file's whole body on this disk?
 *
 * iCloud "optimise storage" leaves a file in place with its full size but none
 * of its bytes — a "dataless" file — and fetches them the moment something
 * reads it. A file it is part-way through fetching has SOME of them. Either
 * way the allocated blocks fall short of the size, and that is the test: it
 * needs no read (a read would start the download this is trying to avoid
 * racing) and no macOS-only flag the node runtime cannot see. The older
 * `.name.icloud` stand-in files are excluded by `isZoomVideo` already, because
 * they start with a dot.
 *
 * One block of slack, because the last block of a file is not always full.
 */
function isFullyLocal(stat) {
  const size = Number(stat && stat.size) || 0;
  if (size === 0) return false;
  const blocks = Number(stat && stat.blocks);
  if (!Number.isFinite(blocks)) return true; // a filesystem that does not report blocks cannot hold placeholders
  return blocks * 512 + 4096 >= size;
}

/** Finished = nothing has written to it for STABLE_AFTER_MS. */
function isStable(stat, now) {
  return now - Number(stat && stat.mtimeMs) >= STABLE_AFTER_MS;
}

/**
 * The name on Drive. `/` would be read by rclone as a folder, so it is
 * replaced; everything else about the meeting name is kept, because it is the
 * only thing on the Footage screen that says which call this was.
 */
function driveName(folder, file) {
  const clean = (s) => String(s || '').replace(/[/\\]/g, '-').trim();
  return `Zoom - ${clean(folder)} - ${clean(file)}`;
}

// --- the ledger -------------------------------------------------------------

function emptyLedger() {
  return { version: 1, cutoverAt: null, sent: {}, seen: {}, photos: {} };
}

/**
 * A missing ledger is a first run. An unreadable one is NOT — reading it as
 * empty would re-send every file it had ever recorded, so it throws, and the
 * pass fails loudly instead.
 */
function readLedger(file, io = fs) {
  let raw;
  try {
    raw = io.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ledger: emptyLedger(), firstRun: true };
    throw new Error(`the ledger at ${file} could not be read (${err && err.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`the ledger at ${file} is not JSON (${err && err.message}) — refusing to run, `
      + 'because treating it as empty would re-send every recording it lists');
  }
  return {
    ledger: {
      ...emptyLedger(), ...parsed, sent: parsed.sent || {}, seen: parsed.seen || {}, photos: parsed.photos || {},
    },
    firstRun: false,
  };
}

/** Write to a temporary file and rename, so a crash never leaves half a ledger. */
function writeLedger(file, ledger, io = fs) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  io.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  io.renameSync(tmp, file);
}

/**
 * One run at a time. launchd never starts a second copy of a scheduled job,
 * but a hand-run `--backfill --apply` can overlap a scheduled pass, and two
 * writers of one ledger lose each other's entries.
 *
 * THE LOCK MUST NOT OUTLIVE ITS RUN (round 1 of review, 86bcfgyxp). macOS stops
 * a launchd job with SIGTERM at shutdown, and a process killed that way never
 * reaches the code that removes the lock. After the restart the process number
 * written in it can belong to another program — often a system one, which
 * answers "not permitted" when asked whether it is alive — and a lock read as
 * held by it would turn every later pass away, forever. So a lock is honoured
 * only while all three hold:
 *   - its process is alive,
 *   - that process is a media_intake run (when `ps` can say what it is), and
 *   - it was taken less than LOCK_STALE_MS ago — no pass takes that long, so
 *     an older lock is a dead one whatever the process table says.
 * Anything else is taken over, and the takeover is named in the log.
 */
const LOCK_STALE_MS = 3 * 60 * 60 * 1000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && e.code === 'EPERM'); // alive, but not ours to signal
  }
}

/** The command line of a running process, or null when `ps` cannot say. */
function processCommand(pid) {
  const { spawnSync } = require('node:child_process');
  const res = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  if (res.status !== 0 || res.error) return null;
  return String(res.stdout || '').trim() || null;
}

function readLockFile(lock, io) {
  const raw = String(io.readFileSync(lock, 'utf8')).trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { pid: Number(parsed.pid) || 0, startedAtMs: Date.parse(parsed.startedAt) };
    }
  } catch (_) { /* the first version wrote the bare process number */ }
  let startedAtMs = NaN;
  try { startedAtMs = io.statSync(lock).mtimeMs; } catch (_) { /* gone meanwhile */ }
  return { pid: Number(raw) || 0, startedAtMs };
}

/** Why a lock is NOT honoured, or null when it is. */
function lockIsDead({ pid, startedAtMs }, { now, alive, commandOf }) {
  if (!(pid > 0)) return 'it names no process';
  if (!alive(pid)) return `process ${pid} is no longer running`;
  if (!Number.isFinite(startedAtMs) || now - startedAtMs >= LOCK_STALE_MS) {
    return `it was taken ${Number.isFinite(startedAtMs) ? `${Math.round((now - startedAtMs) / 60000)} minutes` : 'at an unknown time'} ago, `
      + `longer than any pass runs (${LOCK_STALE_MS / 3600000}h)`;
  }
  const command = commandOf(pid);
  if (command && !/media_intake/.test(command)) return `process ${pid} is not a media-intake run (${command.slice(0, 80)})`;
  return null;
}

function acquireLock(dir, {
  io = fs, now = Date.now(), pid = process.pid, alive = pidAlive, commandOf = processCommand,
} = {}) {
  const lock = path.join(dir, 'run.lock');
  const body = JSON.stringify({ pid, startedAt: new Date(now).toISOString() });
  io.mkdirSync(dir, { recursive: true });
  let tookOver = null;
  try {
    io.writeFileSync(lock, body, { flag: 'wx' });
  } catch (err) {
    if (!err || err.code !== 'EEXIST') throw err;
    const held = readLockFile(lock, io);
    const dead = lockIsDead(held, { now, alive, commandOf });
    if (!dead) return { ok: false, holder: held.pid, startedAtMs: held.startedAtMs };
    io.writeFileSync(lock, body);
    tookOver = { holder: held.pid, why: dead };
  }
  return {
    ok: true,
    tookOver,
    // Removes the lock only while it is still this run's: a run that was
    // itself taken over must not delete its successor's lock on the way out.
    release: () => {
      try {
        if (readLockFile(lock, io).pid === pid) io.unlinkSync(lock);
      } catch (_) { /* already gone */ }
    },
  };
}

function md5File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// --- finding recordings -----------------------------------------------------

/**
 * Every Zoom video under the root, one level of meeting folders deep, with
 * what is needed to decide about it. Reading the root is the one failure that
 * stops the pass: if this machine cannot list the folder, it cannot say that
 * nothing is new, and "nothing new" is what an empty list would say.
 */
function scanZoom(root, io = fs) {
  const found = [];
  let folders;
  try {
    folders = io.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    const why = err && err.code === 'EPERM'
      ? 'macOS refused access (EPERM). A scheduled job needs Full Disk Access for node to read iCloud Drive — '
        + 'System Settings › Privacy & Security › Full Disk Access'
      : String(err && err.message);
    throw new Error(`could not read the Zoom folder ${root}: ${why}`);
  }
  for (const dirent of folders) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const dir = path.join(root, dirent.name);
    let files;
    try {
      files = io.readdirSync(dir);
    } catch (_) {
      continue; // one unreadable meeting folder is not a reason to stop the rest
    }
    for (const name of files) {
      if (!isZoomVideo(name)) continue;
      const full = path.join(dir, name);
      let stat;
      try { stat = io.statSync(full); } catch (_) { continue; }
      if (!stat.isFile()) continue;
      found.push({
        path: full,
        folder: dirent.name,
        file: name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        stat,
        recordedAt: meetingFolderTime(dirent.name) ?? stat.mtimeMs,
      });
    }
  }
  return found.sort((a, b) => a.recordedAt - b.recordedAt || a.path.localeCompare(b.path));
}

/**
 * New, or history? A recording is new when its meeting started at or after
 * the cutover OR its file was last written at or after it — the second clause
 * catches a meeting that started a little before the install and finished
 * after it. iCloud keeps a file's modification time when it fetches the bytes,
 * so an old recording downloaded today is still history.
 */
function isAfterCutover(item, cutoverMs) {
  return item.recordedAt >= cutoverMs || item.mtimeMs >= cutoverMs;
}

// --- the pass ---------------------------------------------------------------

/**
 * The content hash, reusing the last one taken while the file's size and
 * modification time are unchanged — so a pass every fifteen minutes does not
 * re-read gigabytes it has already read.
 */
async function hashOf(item, ledger, hash) {
  const prior = ledger.seen[item.path];
  if (prior && prior.size === item.size && prior.mtimeMs === item.mtimeMs && prior.md5) return prior.md5;
  const md5 = await hash(item.path);
  ledger.seen[item.path] = { size: item.size, mtimeMs: item.mtimeMs, md5 };
  return md5;
}

/**
 * Send one file and confirm it. "Sent" means Drive reports the same MD5 for
 * the uploaded file as the local bytes have; anything else is a failure and
 * the ledger is not touched.
 */
async function sendOne(item, md5, { ledger, uploader, now, name = driveName(item.folder, item.file) }) {
  await uploader.upload(item.path, name);
  const remote = String(await uploader.remoteMd5(name) || '').trim().toLowerCase();
  if (remote !== md5) {
    throw new Error(remote
      ? `Drive reports checksum ${remote} for "${name}", the file on this disk is ${md5}`
      : `Drive did not report a checksum for "${name}" after uploading it`);
  }
  ledger.sent[md5] = {
    driveName: name,
    source: item.path,
    bytes: item.size,
    sentAt: new Date(now).toISOString(),
  };
  return name;
}

function emptyReport(mode) {
  return { mode, sent: [], alreadySent: [], waiting: [], history: [], failed: [], cutoverAt: null, firstRun: false };
}

/**
 * The scheduled pass: send every new, finished, fully-local recording once.
 *
 * Every dependency is passed in, so the tests drive it against a scratch
 * folder with a fake uploader and a fake clock.
 */
async function runPass({
  root, ledgerFile, uploader, now = Date.now(), io = fs, hash = md5File,
} = {}) {
  const report = emptyReport('new');
  const { ledger, firstRun } = readLedger(ledgerFile, io);
  report.firstRun = firstRun;
  if (!ledger.cutoverAt) ledger.cutoverAt = new Date(now).toISOString();
  report.cutoverAt = ledger.cutoverAt;
  const cutoverMs = Date.parse(ledger.cutoverAt);

  const items = scanZoom(root, io);
  for (const item of items) {
    if (!isAfterCutover(item, cutoverMs)) {
      report.history.push(item.path);
      continue;
    }
    if (!isFullyLocal(item.stat)) {
      report.waiting.push({ path: item.path, why: 'not fully downloaded from iCloud yet' });
      continue;
    }
    if (!isStable(item.stat, now)) {
      report.waiting.push({ path: item.path, why: 'still being written (changed in the last 2 minutes)' });
      continue;
    }
    let md5;
    try {
      md5 = await hashOf(item, ledger, hash);
    } catch (err) {
      report.failed.push({ path: item.path, why: `could not read it: ${err && err.message}` });
      continue;
    }
    if (ledger.sent[md5]) {
      report.alreadySent.push({ path: item.path, as: ledger.sent[md5].driveName });
      continue;
    }
    try {
      const name = await sendOne(item, md5, { ledger, uploader, now });
      report.sent.push({ path: item.path, as: name, bytes: item.size });
    } catch (err) {
      report.failed.push({ path: item.path, why: String(err && err.message) });
    }
    // Written after every file, so a pass that dies half way keeps what it did.
    writeLedger(ledgerFile, ledger, io);
  }
  writeLedger(ledgerFile, ledger, io);
  return report;
}

/**
 * The history step. Without `apply` it lists and sends nothing. With it, it
 * sends the oldest unsent recordings until the next one would take the run
 * past `limitBytes` — except that a single recording bigger than the whole
 * allowance is sent on its own, first, rather than blocking the queue forever.
 * A recording that is not on this disk is asked for (`requestDownload`) and
 * left for a later run; it is never read half-fetched.
 *
 * A recording written to in the last two minutes waits too, exactly as in the
 * scheduled pass (round 1 of review, 86bcfgyxp). Before the first scheduled
 * pass there is no cutover and everything counts as history — including a
 * meeting Zoom is converting right now — and a half-written file sent here
 * would have been recorded against its path, so the finished one was then
 * skipped as "already sent". Two guards: the stability check, and a path is
 * only "already sent" while it still has the size that was sent.
 */
async function runBackfill({
  root, ledgerFile, uploader, apply = false, limitBytes = BACKFILL_LIMIT_BYTES,
  now = Date.now(), io = fs, hash = md5File, requestDownload = null,
} = {}) {
  const { ledger, firstRun } = readLedger(ledgerFile, io);
  const plan = {
    mode: apply ? 'backfill-apply' : 'backfill-dry-run',
    cutoverAt: ledger.cutoverAt,
    firstRun,
    items: [],
    count: 0,
    bytes: 0,
    notLocal: 0,
    oldest: null,
    newest: null,
    sent: [],
    alreadySent: [],
    waiting: [],
    failed: [],
    deferred: 0,
    stillWriting: 0,
  };
  // Before the first scheduled pass there is no cutover, and EVERYTHING is
  // history; the dry run says so rather than guessing a date.
  const cutoverMs = ledger.cutoverAt ? Date.parse(ledger.cutoverAt) : Infinity;
  const sentBytes = new Map(Object.values(ledger.sent).map((s) => [s.source, s.bytes]));
  for (const item of scanZoom(root, io)) {
    if (isAfterCutover(item, cutoverMs)) continue;
    if (sentBytes.has(item.path) && sentBytes.get(item.path) === item.size) continue;
    const local = isFullyLocal(item.stat);
    const stable = isStable(item.stat, now);
    plan.items.push({
      path: item.path, folder: item.folder, bytes: item.size, local, stable, recordedAt: item.recordedAt,
    });
    plan.count += 1;
    plan.bytes += item.size;
    if (!local) plan.notLocal += 1;
    if (!stable) plan.stillWriting += 1;
  }
  if (plan.items.length) {
    plan.oldest = plan.items[0];
    plan.newest = plan.items[plan.items.length - 1];
  }
  if (!apply) return plan;

  let spent = 0;
  for (const entry of plan.items) {
    if (!entry.local) {
      if (requestDownload) {
        try { requestDownload(entry.path); } catch (_) { /* asked; a later run will see */ }
      }
      plan.waiting.push({ path: entry.path, why: 'not on this disk yet — asked iCloud to download it' });
      continue;
    }
    if (!entry.stable) {
      plan.waiting.push({ path: entry.path, why: 'still being written (changed in the last 2 minutes)' });
      continue;
    }
    if (spent > 0 && spent + entry.bytes > limitBytes) {
      plan.deferred += 1;
      continue;
    }
    const item = scanItem(entry, io);
    if (!item) {
      plan.failed.push({ path: entry.path, why: 'it disappeared between listing and sending' });
      continue;
    }
    if (item.size !== entry.bytes || !isStable(item.stat, now)) {
      plan.waiting.push({ path: entry.path, why: 'it changed after it was listed — still being written' });
      continue;
    }
    let md5;
    try {
      md5 = await hashOf(item, ledger, hash);
    } catch (err) {
      plan.failed.push({ path: entry.path, why: `could not read it: ${err && err.message}` });
      continue;
    }
    if (ledger.sent[md5]) {
      plan.alreadySent.push({ path: entry.path, as: ledger.sent[md5].driveName });
      continue;
    }
    try {
      const name = await sendOne(item, md5, { ledger, uploader, now });
      plan.sent.push({ path: entry.path, as: name, bytes: entry.bytes });
      spent += entry.bytes;
    } catch (err) {
      plan.failed.push({ path: entry.path, why: String(err && err.message) });
    }
    writeLedger(ledgerFile, ledger, io);
  }
  writeLedger(ledgerFile, ledger, io);
  return plan;
}

function scanItem(entry, io) {
  let stat;
  try { stat = io.statSync(entry.path); } catch (_) { return null; }
  return {
    path: entry.path,
    folder: entry.folder,
    file: path.basename(entry.path),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    stat,
    recordedAt: entry.recordedAt,
  };
}

// --- Apple Photos: the Studio album (Media intake · 3 of 5) ------------------

/**
 * THE SECOND SOURCE (ticket 86bcfgyy6). Dane puts a video into an album called
 * **Studio** in Apple Photos — on his iPhone or the Mac — and it reaches the
 * Inbox by itself. NOTHING OUTSIDE THAT ALBUM IS EVER SENT: that is how family
 * videos stay out of Studio (Dane, 2026-10-08). The album filter is applied
 * twice, once by osxphotos (`--album`) and once here (`inStudioAlbum`), so a
 * tool that one day reads `--album` loosely still cannot send a family video.
 *
 * ORIGINALS, from iCloud when they are not on the Mac. With iCloud Photos the
 * original of a video often lives only in iCloud; osxphotos `--download-missing`
 * asks Photos to fetch it. The export is a COPY in this job's own state folder,
 * deleted once it is uploaded. Nothing in Photos is ever deleted, moved or
 * changed: removing a video from Photos removes it from his iPhone too.
 *
 * NEVER TWICE, by two keys. The Photos item id (a video taken out of the album
 * and put back keeps its id — and is skipped without even being exported) and
 * the content hash (the same bytes imported twice, under a second id, or a
 * video already sent through the Zoom source).
 *
 * "COULD NOT READ" IS NOT "NOTHING NEW" (DOCTRINE §3.2). macOS keeps the
 * Photos library behind a privacy switch only Dane can turn on. A pass that
 * cannot read the library throws `PhotosUnreadable` and the run exits
 * non-zero, so the bus hears about it — it never reports "0 new videos".
 * Measured on the Mini, 2026-10-09: osxphotos without `--library` HANGS
 * silently when the library is blocked, so every call names the library and
 * carries a time limit, and the library is checked from here first.
 */
const PHOTOS_ALBUM = 'Studio';

/** The Photos library on the MacBook (measured 2026-10-08). */
function defaultPhotosLibrary(homedir = os.homedir()) {
  return path.join(homedir, 'Pictures', 'Photos Library.photoslibrary');
}

/** Exactly which switch Dane turns on, in the words System Settings uses. */
const PHOTOS_PERMISSION_FIX = 'On the MacBook: System Settings › Privacy & Security › Full Disk Access — '
  + 'turn ON the switch for "node" (press + and add it if it is not listed: '
  + 'press Cmd-Shift-G and type the path `which node` prints). If osxphotos is still refused afterwards, '
  + 'add its Python the same way (the path `head -1 "$(which osxphotos)"` prints, without the #!).';

class PhotosUnreadable extends Error {
  constructor(why, fix = PHOTOS_PERMISSION_FIX) {
    super(`CANNOT READ PHOTOS — ${why}`);
    this.name = 'PhotosUnreadable';
    this.fix = fix;
  }
}

function inStudioAlbum(item, album = PHOTOS_ALBUM) {
  return Boolean(item) && Array.isArray(item.albums) && item.albums.includes(album);
}

/**
 * The name on Drive: `Photos - 2026-10-09 18.04.11 - IMG_1234.MOV`. The date
 * is the wall-clock time Photos records for the item, written the way Zoom
 * writes its meeting folders; it keeps apart two iPhone files that are both
 * called IMG_1234.MOV, which a phone produces every ten thousand videos.
 */
function photosDriveName(item) {
  const clean = (s) => String(s || '').replace(/[/\\]/g, '-').trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(item && item.date || ''));
  const file = clean(item && (item.original_filename || item.filename)) || `${clean(item && item.uuid)}.mov`;
  return m ? `Photos - ${m[1]} ${m[2]}.${m[3]}.${m[4]} - ${file}` : `Photos - ${file}`;
}

function emptyPhotosReport(album) {
  return {
    mode: 'photos', album, albumCreated: false, sent: [], alreadySent: [], failed: [], photosSkipped: 0, outsideAlbum: 0,
  };
}

/**
 * One pass over the Studio album. `photos` is the adapter (osxphotosAdapter
 * below, or a fake in the tests):
 *   albums()                     → album names; throws PhotosUnreadable
 *   createAlbum(name)            → makes the album in Photos
 *   query(album)                 → osxphotos JSON items (uuid, albums, ismovie, date, original_filename)
 *   exportOriginal(item, dir)    → path of the exported original inside `dir`
 */
async function runPhotos({
  photos, ledgerFile, uploader, stagingDir, album = PHOTOS_ALBUM, now = Date.now(), io = fs, hash = md5File,
} = {}) {
  const report = emptyPhotosReport(album);
  const { ledger } = readLedger(ledgerFile, io);

  const names = await photos.albums();
  if (!names.includes(album)) {
    try {
      await photos.createAlbum(album);
      report.albumCreated = true;
    } catch (err) {
      report.failed.push({
        path: `album "${album}"`,
        why: `there is no album called "${album}" in Photos, and it could not be made: ${err && err.message}`,
      });
    }
    return report;
  }

  for (const item of await photos.query(album)) {
    if (!inStudioAlbum(item, album)) {
      report.outsideAlbum += 1;
      continue;
    }
    if (!item.ismovie) {
      report.photosSkipped += 1;
      continue;
    }
    const label = `Photos ${item.original_filename || item.filename || ''} (${item.uuid})`.replace(/\s+\(/, ' (');
    const known = ledger.photos[item.uuid];
    if (known) {
      report.alreadySent.push({ path: label, as: (ledger.sent[known.md5] || {}).driveName || known.driveName });
      continue;
    }
    const dir = path.join(stagingDir, String(item.uuid).replace(/[^A-Za-z0-9-]/g, '_'));
    try {
      io.rmSync(dir, { recursive: true, force: true });
      io.mkdirSync(dir, { recursive: true });
      const file = await photos.exportOriginal(item, dir);
      const stat = io.statSync(file);
      const md5 = await hash(file);
      if (ledger.sent[md5]) {
        ledger.photos[item.uuid] = { md5, driveName: ledger.sent[md5].driveName, at: new Date(now).toISOString() };
        report.alreadySent.push({ path: label, as: ledger.sent[md5].driveName });
      } else {
        const name = await sendOne({ path: file, size: stat.size }, md5, {
          ledger, uploader, now, name: photosDriveName(item),
        });
        ledger.sent[md5].photosUuid = item.uuid;
        ledger.photos[item.uuid] = { md5, driveName: name, at: new Date(now).toISOString() };
        report.sent.push({ path: label, as: name, bytes: stat.size });
      }
    } catch (err) {
      report.failed.push({ path: label, why: String(err && err.message) });
    } finally {
      // Only this job's own copy, inside its own state folder — never Photos.
      try { io.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
    writeLedger(ledgerFile, ledger, io);
  }
  writeLedger(ledgerFile, ledger, io);
  return report;
}

/**
 * The real adapter. `run(command, args, { timeoutMs })` resolves to
 * `{ status, stdout, stderr, timedOut }`; injected so the tests never need
 * osxphotos, Photos or a Mac.
 */
const PHOTOS_READ_TIMEOUT_MS = 5 * 60 * 1000;
const PHOTOS_EXPORT_TIMEOUT_MS = 30 * 60 * 1000; // a long video may have to come down from iCloud first

function osxphotosAdapter({
  run, library = defaultPhotosLibrary(), bin = 'osxphotos', io = fs,
} = {}) {
  const lib = ['--library', library];
  const said = (res) => String((res && (res.stderr || res.stdout)) || '').trim().split('\n').slice(-3).join(' | ');

  /** Can this process read the library at all? Asked by us, before osxphotos. */
  function checkAccess() {
    try {
      io.readdirSync(library);
    } catch (err) {
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        throw new PhotosUnreadable(`macOS refused access to ${library} (${err.code})`);
      }
      if (err && err.code === 'ENOENT') {
        throw new PhotosUnreadable(`there is no Photos library at ${library}`,
          'Set MEDIA_INTAKE_PHOTOS_LIBRARY to the library Photos uses (Photos › Settings › General shows it).');
      }
      throw new PhotosUnreadable(`${library} could not be read (${err && err.message})`);
    }
  }

  async function read(args, what) {
    const res = await run(bin, [...args, ...lib], { timeoutMs: PHOTOS_READ_TIMEOUT_MS });
    if (res && res.status === 0) return String(res.stdout || '');
    if (res && res.status === 127) {
      throw new PhotosUnreadable('osxphotos is not installed on this machine',
        'brew install pipx && pipx install osxphotos   (npm run doctor:node lists it under TOOLCHAIN)');
    }
    if (res && res.timedOut) {
      throw new PhotosUnreadable(`osxphotos ${what} did not answer within ${PHOTOS_READ_TIMEOUT_MS / 60000} minutes `
        + '(it hangs this way when macOS blocks the library)');
    }
    const text = said(res);
    if (/not readable|not permitted|PermissionError|EPERM/i.test(text)) {
      throw new PhotosUnreadable(`osxphotos was refused the library: ${text}`);
    }
    throw new PhotosUnreadable(`osxphotos ${what} failed (exit ${res ? res.status : '?'}): ${text || 'no output'}`,
      'Run the same command by hand on the MacBook to see the whole error.');
  }

  function parse(text, what) {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new PhotosUnreadable(`osxphotos ${what} did not print JSON (${err && err.message})`,
        'Run the same command by hand on the MacBook to see what it printed.');
    }
  }

  return {
    async albums() {
      checkAccess();
      const parsed = parse(await read(['albums', '--json'], 'albums'), 'albums');
      return Object.keys((parsed && parsed.albums) || {});
    },
    async createAlbum(name) {
      // osxphotos has no command that makes an album; Photos' own scripting does.
      const script = `tell application "Photos" to make new album named ${JSON.stringify(name)}`;
      const res = await run('osascript', ['-e', script], { timeoutMs: PHOTOS_READ_TIMEOUT_MS });
      if (!res || res.status !== 0) {
        throw new Error(`osascript failed (exit ${res ? res.status : '?'}): ${said(res) || 'no output'} — `
          + 'System Settings › Privacy & Security › Automation must allow it to control Photos');
      }
    },
    async query(album) {
      const parsed = parse(await read(['query', '--album', album, '--json'], 'query'), 'query');
      if (!Array.isArray(parsed)) throw new PhotosUnreadable('osxphotos query did not print a list');
      return parsed;
    },
    async exportOriginal(item, dir) {
      const res = await run(bin, [
        'export', dir, '--uuid', item.uuid, '--skip-edited', '--skip-live', '--download-missing', ...lib,
      ], { timeoutMs: PHOTOS_EXPORT_TIMEOUT_MS });
      if (!res || res.status !== 0) {
        throw new Error(res && res.timedOut
          ? `osxphotos export did not finish within ${PHOTOS_EXPORT_TIMEOUT_MS / 60000} minutes (an iCloud download that never came?)`
          : `osxphotos export failed (exit ${res ? res.status : '?'}): ${said(res) || 'no output'}`);
      }
      const files = io.readdirSync(dir).filter((n) => !n.startsWith('.'));
      const wanted = String(item.original_filename || '').toLowerCase();
      const pick = files.length === 1 ? files[0] : files.find((n) => n.toLowerCase() === wanted);
      if (!pick) {
        throw new Error(files.length
          ? `osxphotos exported ${files.length} files (${files.join(', ')}) and none is the original`
          : 'osxphotos exported nothing — the original may not have come down from iCloud');
      }
      return path.join(dir, pick);
    },
  };
}

function renderPhotos(report) {
  const lines = [];
  if (report.albumCreated) {
    lines.push(`Photos: there was no album called "${report.album}", so one was made. Add videos to it to send them.`);
  }
  lines.push(`Photos album "${report.album}": sent ${report.sent.length}, already sent ${report.alreadySent.length}, `
    + `failed ${report.failed.length}, photos skipped (only videos are sent) ${report.photosSkipped}`
    + (report.outsideAlbum ? `, ignored ${report.outsideAlbum} item(s) osxphotos returned from outside the album` : ''));
  for (const s of report.sent) lines.push(`  SENT     ${s.path} -> Inbox/"${s.as}" (${gb(s.bytes)})`);
  for (const f of report.failed) lines.push(`  FAILED   ${f.path} — ${f.why}`);
  return lines.join('\n');
}

// --- the uploader -----------------------------------------------------------

/**
 * Uploads through rclone, into the Inbox by folder id. rclone carries its own
 * Google sign-in in its own config, and the remote (`gdrive:` by default) is
 * mentorofaio's — which is what makes an upload count against mentorofaio's
 * storage, not mentor24's nearly-full one.
 *
 * `run(args)` returns `{ status, stdout, stderr }`; injected so the tests never
 * need rclone or a network.
 */
function rcloneUploader({ run, remote = 'gdrive:', folderId = DEFAULT_INBOX_FOLDER_ID }) {
  const base = ['--drive-root-folder-id', folderId];
  const must = (res, what) => {
    if (!res || res.status !== 0) {
      const said = String((res && (res.stderr || res.stdout)) || '').trim().split('\n').slice(-3).join(' | ');
      throw new Error(`rclone ${what} failed (exit ${res ? res.status : '?'}): ${said || 'no output'}`);
    }
    return String(res.stdout || '');
  };
  return {
    async upload(local, name) {
      must(await run(['copyto', local, `${remote}${name}`, ...base]), `upload of "${name}"`);
    },
    async remoteMd5(name) {
      const out = must(await run(['md5sum', `${remote}${name}`, ...base]), `checksum of "${name}"`);
      const first = out.split('\n').find((l) => l.trim());
      return first ? first.trim().split(/\s+/)[0] : '';
    },
  };
}

// --- words ------------------------------------------------------------------

function gb(bytes) {
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The pass report, plain enough to read in the launchd log. */
function renderPass(report) {
  const lines = [];
  if (report.firstRun) {
    lines.push(`First run: recordings from ${report.cutoverAt} on are "new". Everything older is history — `
      + 'see npm run media:intake -- --backfill zoom.');
  }
  lines.push(`sent ${report.sent.length}, already sent ${report.alreadySent.length}, `
    + `waiting ${report.waiting.length}, failed ${report.failed.length}, history (not this pass's job) ${report.history.length}`);
  for (const s of report.sent) lines.push(`  SENT     ${s.path} -> Inbox/"${s.as}" (${gb(s.bytes)})`);
  for (const w of report.waiting) lines.push(`  WAITING  ${w.path} — ${w.why}`);
  for (const f of report.failed) lines.push(`  FAILED   ${f.path} — ${f.why}`);
  return lines.join('\n');
}

function renderBackfill(plan) {
  const lines = [];
  if (!plan.cutoverAt) {
    lines.push('No cutover yet: the scheduled pass has never run on this machine, so EVERY recording counts as history.');
  } else {
    lines.push(`History = recordings from before ${plan.cutoverAt} (the first scheduled pass).`);
  }
  lines.push(`${plan.count} recording(s), ${gb(plan.bytes)} in total, not yet sent`
    + (plan.notLocal ? ` — ${plan.notLocal} of them not on this disk yet (iCloud would download them first)` : '')
    + (plan.stillWriting ? ` — ${plan.stillWriting} still being written, so not sent until they settle` : ''));
  if (plan.oldest) lines.push(`oldest: ${day(plan.oldest.recordedAt)}  ${plan.oldest.folder}`);
  if (plan.newest) lines.push(`newest: ${day(plan.newest.recordedAt)}  ${plan.newest.folder}`);
  if (plan.mode === 'backfill-dry-run') {
    lines.push(`DRY RUN — nothing sent. --apply sends the oldest first, at most ${gb(BACKFILL_LIMIT_BYTES)} per run.`);
    return lines.join('\n');
  }
  lines.push(`sent ${plan.sent.length}, already sent ${plan.alreadySent.length}, waiting ${plan.waiting.length}, `
    + `failed ${plan.failed.length}, left for the next run (over this run's allowance) ${plan.deferred}`);
  for (const s of plan.sent) lines.push(`  SENT     ${s.path} -> Inbox/"${s.as}" (${gb(s.bytes)})`);
  for (const w of plan.waiting) lines.push(`  WAITING  ${w.path} — ${w.why}`);
  for (const f of plan.failed) lines.push(`  FAILED   ${f.path} — ${f.why}`);
  return lines.join('\n');
}

module.exports = {
  BACKFILL_LIMIT_BYTES,
  DEFAULT_INBOX_FOLDER_ID,
  LOCK_STALE_MS,
  PHOTOS_ALBUM,
  PHOTOS_PERMISSION_FIX,
  PhotosUnreadable,
  ROLE,
  STABLE_AFTER_MS,
  acquireLock,
  defaultPhotosLibrary,
  defaultStateDir,
  defaultZoomRoot,
  driveName,
  inStudioAlbum,
  isAfterCutover,
  isFullyLocal,
  isStable,
  isZoomVideo,
  md5File,
  meetingFolderTime,
  osxphotosAdapter,
  photosDriveName,
  rcloneUploader,
  readLedger,
  renderBackfill,
  renderPass,
  renderPhotos,
  runBackfill,
  runPass,
  runPhotos,
  scanZoom,
  writeLedger,
};
