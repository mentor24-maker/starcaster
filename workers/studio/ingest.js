'use strict';

/**
 * The Studio's downloader (Studio Phase 1 · 4 of 8).
 *
 * The watcher (3/8) turns a new file in /Studio/Inbox/ or /Studio/Plates/ into
 * an `ingest` job carrying Drive's own metadata. This slice claims those jobs,
 * brings the bytes down to the Mini's local cache, proves they are the bytes
 * Drive said they were, and registers ONE row in `video_sources`. It probes
 * nothing and transcodes nothing — those are 5/8 and 6/8.
 *
 * RESUMABLE, BECAUSE OF THE MEASURED SIZE. The spike (86bbjkkdf) measured an
 * iPhone 15 Pro Max original at 66.3 MB/min: 3.57 GB for a 54-minute session.
 * A download that restarts from zero when the Mini naps is a download that
 * never finishes, so the bytes land in a `.part` file that is APPENDED to, and
 * a resumed attempt asks Drive for `Range: bytes=<what we already have>-`.
 * The part file surviving a crash is the feature, not litter.
 *
 * NOTHING IS BUFFERED INTO MEMORY. `lib/googleDrive.js`'s fetchDriveFileMedia
 * reads the whole response into a Buffer, which is fine for a logo and fatal
 * for 3.57 GB, so this module talks to Drive itself and pipes the response
 * body straight to disk. Memory stays at one chunk whatever the file size.
 *
 * VERIFY BEFORE REGISTERING, NEVER AFTER. Size and MD5 are checked against
 * Drive's metadata before a row is written, and a mismatch BLOCKS the job with
 * both numbers in the reason — it does not register a file we cannot vouch
 * for, and it does not retry, because asking again for bytes that already
 * arrived wrong is a retry storm against a wall (the same judgement the
 * watcher makes about an expired token).
 *
 * "COULD NOT VERIFY" IS NOT "VERIFIED". A Drive file with no md5Checksum is
 * blocked with that reason rather than ingested on trust (DOCTRINE 3.11).
 *
 * THE DISK FLOOR IS CHECKED BEFORE ANYTHING IS CLAIMED, AND AGAIN AGAINST THE
 * SIZE OF THE FILE IN HAND. Filling the Mini's boot disk takes down every job
 * on the machine, not just this one, so the pass refuses to start rather than
 * writing as far as it can and dying — "does not partially fill the disk" is
 * an acceptance criterion because a half-written 3.5 GB file is the worst of
 * both outcomes.
 *
 * NO `setInterval` AT MODULE SCOPE (DOCTRINE 5.2). This module never schedules
 * anything; the daemon that runs it on a timer is Studio 7/8's problem.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const googleDrive = require('../../lib/googleDrive.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoSessionsStore = require('../../lib/videoSessionsStore.js');
const { STAGE_INGEST, SUBJECT_DRIVE_FILE, LANES } = require('./drive.js');

/**
 * The ingest pass's own health flag, on the queue as a job like any other —
 * the same shape the watcher uses for `drive.watch`, so ONE place answers
 * "what is wrong with the pipeline?".
 *
 * It carries the conditions that stop the whole pass rather than one file: no
 * project to file the footage under, and not enough disk to hold any of it.
 * Per-file failures never come here; they stay on the file's own job.
 */
const STAGE_INGEST_HEALTH = 'ingest.health';
const SUBJECT_INGEST_HEALTH = 'ingest_health';

/**
 * What the standing alarm is ABOUT, carried in its own payload.
 *
 * The alarm has to survive passes that do not touch the condition at all, so
 * the row itself has to say what it is waiting on and which jobs are still
 * stuck behind it. Without that, a later pass has only "did anything happen to
 * me?" to go on, and the answer on a quiet pass is no — which is how a full
 * disk's alarm was deleted by a pass five minutes later that did nothing.
 */
const HEALTH_NO_ROOM = 'no_room';

/**
 * How much room the Mini must keep free, over and above whatever it is about
 * to download. 50 GB is not a guess at a nice margin — it is the observation
 * that 6/8 makes a proxy and a WAV out of every source, and that a boot disk
 * with no headroom takes the loops, the queue and the heartbeat down with it.
 * Override with STUDIO_DISK_FLOOR_BYTES.
 */
const DEFAULT_DISK_FLOOR_BYTES = 50 * 1024 * 1024 * 1024;

/** Tell the queue we are alive this often while bytes are moving. */
const DEFAULT_HEARTBEAT_MS = 30 * 1000;

/**
 * How long a Drive call may take before it is abandoned.
 *
 * NEITHER FETCH HAD A TIMEOUT, WHICH IS WORSE THAN IT SOUNDS ON THIS PATH.
 * `onProgress` — the only thing that renews the queue lease — fires on a
 * CHUNK, so a connection that goes quiet without closing delivers no chunks,
 * sends no heartbeat, and leaves the pass sitting there while its lease
 * silently expires and another worker claims the same 3.57 GB file. Node's
 * fetch waits for ever by default. Found by review on 2026-09-16.
 *
 * The metadata call gets a whole-call timeout, because it is one small
 * request. The media stream gets a STALL timeout instead of a total one: a
 * legitimate 3.57 GB download takes the best part of an hour on a home
 * connection, so "this call has run too long" is meaningless there, while
 * "no bytes have arrived for two minutes" is exactly the condition worth
 * acting on.
 *
 * Both are overridable with STUDIO_DRIVE_TIMEOUT_MS / STUDIO_DRIVE_STALL_MS,
 * and that sentence used to be a lie: neither name was read anywhere in the
 * repo, so a home connection that legitimately pauses for longer than two
 * minutes could not be given more room and an operator would have spent an
 * hour setting a variable that did nothing. `resolveDriveTimeouts` reads them
 * now, refusing a junk value rather than silently swapping the default back in
 * — the same judgement `resolveDiskFloorBytes` makes, because a budget nobody
 * can read is a budget that is not holding anything up. Found by review on
 * 2026-09-16.
 */
const DEFAULT_DRIVE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_DRIVE_STALL_MS = 2 * 60 * 1000;

/** The state a source is in the moment its bytes are on disk and verified. */
const STATE_DOWNLOADED = 'downloaded';

function text(value) {
  return String(value === 0 || value ? value : '').trim();
}

/** Bytes, for a person: "3.57 GB", not "3830794649". */
function humanBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'an unknown number of bytes';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(n);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 ? String(Math.round(size)) : size.toFixed(2);
  return `${n < 0 ? '-' : ''}${rendered} ${units[unit]}`;
}

/** A span, for a person: "10 minutes", not "600000". */
function humanDuration(ms) {
  const seconds = Math.round(Math.max(0, Number(ms) || 0) / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Where the bytes land. Never a path guessed at runtime — the same rule the
 * watcher applies to folder ids, for the same reason: a default that silently
 * points at the wrong disk is indistinguishable from one that works.
 */
function resolveCacheDir(options = {}, env = process.env) {
  const supplied = text(options.cacheDir || env.STUDIO_CACHE_DIR);
  if (supplied) return supplied;
  return path.join(os.homedir(), 'Studio', 'cache');
}

/**
 * The floor, in bytes. A junk value is NOT quietly swapped for the default:
 * `STUDIO_DISK_FLOOR_BYTES=fifty gigs` would otherwise read as 50 GB of
 * protection that was never configured. It returns an error the caller turns
 * into a blocked health job, because a floor nobody can read is a floor that
 * is not holding anything up.
 */
function resolveDiskFloorBytes(options = {}, env = process.env) {
  const raw = options.diskFloorBytes === undefined || options.diskFloorBytes === null
    ? text(env.STUDIO_DISK_FLOOR_BYTES)
    : options.diskFloorBytes;
  if (raw === '' || raw === undefined || raw === null) {
    return { ok: true, value: DEFAULT_DISK_FLOOR_BYTES };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      ok: false,
      error: `STUDIO_DISK_FLOOR_BYTES is set to "${raw}", which is not a number of bytes. `
        + 'Fix: set it to a plain byte count (50 GB is 53687091200), or unset it to use the default.',
    };
  }
  return { ok: true, value: parsed };
}

/**
 * The two Drive budgets, in milliseconds.
 *
 * Same contract as the disk floor: a junk value is REFUSED rather than quietly
 * swapped for the default, because `STUDIO_DRIVE_STALL_MS=5 minutes` would
 * otherwise read as five minutes of patience that was never configured. The
 * caller turns the refusal into a blocked health job.
 */
function resolveDriveTimeouts(options = {}, env = process.env) {
  const read = (label, supplied, fromEnv, fallback, example) => {
    const raw = supplied === undefined || supplied === null ? text(fromEnv) : supplied;
    if (raw === '' || raw === undefined || raw === null) return { ok: true, value: fallback };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        error: `${label} is set to "${raw}", which is not a number of milliseconds. `
          + `Fix: set it to a plain millisecond count (${example}), or unset it to use the default of `
          + `${Math.round(fallback / 1000)}s.`,
      };
    }
    return { ok: true, value: parsed };
  };

  const timeout = read(
    'STUDIO_DRIVE_TIMEOUT_MS', options.driveTimeoutMs, env.STUDIO_DRIVE_TIMEOUT_MS,
    DEFAULT_DRIVE_TIMEOUT_MS, '30 seconds is 30000'
  );
  if (!timeout.ok) return timeout;
  const stall = read(
    'STUDIO_DRIVE_STALL_MS', options.driveStallMs, env.STUDIO_DRIVE_STALL_MS,
    DEFAULT_DRIVE_STALL_MS, 'two minutes is 120000'
  );
  if (!stall.ok) return stall;
  return { ok: true, value: { timeoutMs: timeout.value, stallMs: stall.value } };
}

/**
 * Which project the footage belongs to.
 *
 * REQUIRED, and refused loudly when absent, because of landmine 12: an insert
 * with no project scope does not fail, it lands a row with no tenant, and a
 * row with no tenant is invisible to every screen that will ever look for it.
 * `project_id` is `not null` in this table, so it would surface as a confusing
 * database error rather than as the configuration problem it actually is.
 */
function resolveProjectId(options = {}, env = process.env) {
  return text(options.projectId || env.STUDIO_PROJECT_ID);
}

/** The scope object every store call in this module is handed. */
function scopeFor(options = {}, env = process.env) {
  const projectId = resolveProjectId(options, env);
  const userId = text(options.ownerUserId || env.STUDIO_OWNER_USER_ID);
  return projectId ? { projectId, userId } : null;
}

/**
 * Free bytes on the filesystem the cache lives on.
 *
 * Measured on the DIRECTORY, not on the machine: the cache may be an external
 * drive, and "the boot disk has room" is not an answer about the disk the
 * bytes are going to.
 *
 * IT WALKS UP EXACTLY ONE LEVEL, AND NO FURTHER. The first draft walked up to
 * the nearest parent that existed, which is a reasonable-sounding rule with a
 * hole straight through the thing this module is for: with
 * `STUDIO_CACHE_DIR=/Volumes/Studio/cache` and the drive NOT MOUNTED, the walk
 * reaches `/Volumes` and measures the BOOT DISK. The floor then passes on the
 * wrong disk's numbers, `mkdir -p` creates `/Volumes/Studio/cache` as an
 * ordinary folder on the boot disk, and 3.57 GB lands on the one disk the
 * floor exists to protect. Found by review on 2026-09-16.
 *
 * So "not created yet" and "not mounted" get different answers, which is the
 * distinction that was missing. One level covers the ordinary first run — the
 * cache folder itself has never been made, inside a parent that is plainly
 * there — and refuses everything beyond it, because a MISSING PARENT is what
 * an unmounted volume looks like from here. The refusal names both causes,
 * since from inside the process they are genuinely indistinguishable and the
 * operator can tell them apart in a second.
 *
 * `exists` says which of the two readings this is, so a caller can report
 * "measured the parent, the cache folder is not there yet" rather than
 * implying it looked at the folder itself.
 */
function freeBytesFor(dir, statfs = fs.statfsSync) {
  const target = path.resolve(dir);
  const parent = path.dirname(target);

  const measure = (probe, exists) => {
    let stats;
    try {
      stats = statfs(probe);
    } catch (err) {
      return { ok: false, error: err };
    }
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(free)) {
      return { ok: false, error: new Error(`the free space on ${probe} came back as something other than a number`) };
    }
    return { ok: true, value: free, measuredAt: probe, exists };
  };

  const onTarget = measure(target, true);
  if (onTarget.ok) return onTarget;

  if (parent === target) {
    return { ok: false, error: `the free space on ${dir} could not be read: ${onTarget.error.message}` };
  }

  const onParent = measure(parent, false);
  if (onParent.ok) return onParent;

  return {
    ok: false,
    error: `the free space on ${target} could not be read, and neither could the folder that should `
      + `contain it (${parent}): ${onParent.error.message}. `
      + 'Fix: this is either a cache folder whose parent has never been created, or a drive that is not '
      + 'mounted — check that the disk STUDIO_CACHE_DIR points at is plugged in and mounted, then create '
      + `${parent} if it is genuinely missing. Measuring further up the tree would report some OTHER disk's `
      + 'free space, which is how footage ends up on the boot disk.',
  };
}

/**
 * A file name that is safe to put on disk and still recognisable to a person.
 *
 * Drive names carry slashes, colons and newlines, and a name is not an
 * identity here — the Drive file id is, and it is the folder this sits in. So
 * this is allowed to be lossy. It is not allowed to escape the cache
 * directory, which is what `..` and a leading slash would do.
 */
function safeFileName(name, fallback) {
  const cleaned = text(name)
    .replace(/[/\\]+/g, '_')
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180)
    .trim();
  return cleaned || fallback;
}

/**
 * Where one Drive file's bytes live, and the half-written form of it.
 *
 * THE PART FILE IS NAMED FROM THE DRIVE FILE ID, NOT FROM THE DRIVE NAME.
 * It used to be `<the name>.part`, and a name in Drive is a value a person can
 * change at any moment: rename a clip between two attempts and the second
 * attempt looks for a part file that no longer exists, throws away 3 GB of
 * progress and starts from zero — the one thing this slice exists to prevent.
 * The containing directory is already the Drive file id, which is the only
 * identity here that cannot move, so the partial bytes are called
 * `download.part` inside it and survive any number of renames. Found by review
 * on 2026-09-16.
 *
 * The FINISHED file keeps the human name, because by then it is something a
 * person opens rather than something a retry has to find again.
 */
const PART_FILE_NAME = 'download.part';

function cachePathsFor({ cacheDir, lane, driveFileId, name }) {
  const dir = path.join(cacheDir, text(lane) || 'inbox', text(driveFileId));
  const fileName = safeFileName(name, `${text(driveFileId)}.media`);
  const finalPath = path.join(dir, fileName);
  return { dir, finalPath, partPath: path.join(dir, PART_FILE_NAME) };
}

/**
 * Every FINISHED file already sitting in one Drive file's cache folder.
 *
 * WHY THIS IS A DIRECTORY LISTING AND NOT A `stat` ON `finalPath`. The part
 * file was moved onto the Drive file id because a name in Drive is a value a
 * person can change at any moment — and the finished file was left keyed on
 * the name, which leaves the identical hole one step later. Rename a clip
 * between a finished download and a successful `createSource` (the `failIt`
 * retry path is exactly that gap) and the next attempt computes a different
 * `finalPath`, does not find the 3.57 GB already on disk, fetches the whole
 * thing again, and strands the first copy inside the folder with no catalog
 * row pointing at it — a cache leak the disk floor cannot see, because the
 * floor measures free space and never asks what is using it. Found by review
 * on 2026-09-16.
 *
 * The folder IS the Drive file id, so anything finished inside it is a copy of
 * this one file under whatever name it had at the time. Listing it is how the
 * caller finds its own bytes again after a rename, and how it knows which
 * strays to clear up. Sorted so two runs on the same folder pick the same
 * file rather than whatever the filesystem happened to say first.
 */
async function findCachedFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === PART_FILE_NAME) continue;
    const full = path.join(dir, entry.name);
    found.push({ path: full, size: await sizeOnDisk(full) });
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Size on disk, or 0 when it is not there. Anything else is a real failure. */
async function sizeOnDisk(file) {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile() ? stat.size : 0;
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }
}

async function removeQuietly(file) {
  try {
    await fsp.rm(file, { force: true });
  } catch {
    // Best effort. A part file that cannot be removed is already named in the
    // caller's own reason string; throwing here would replace a precise
    // failure with a vague one.
  }
}

/**
 * Drive's own account of the file, read FRESH at ingest time.
 *
 * The job payload already carries a size and an md5 from when the watcher saw
 * the file, and that is exactly why this asks again: a file re-uploaded in the
 * hours between watching and ingesting keeps its id and changes its bytes, so
 * verifying against the payload would prove the download matched a file that
 * no longer exists.
 */
async function getIngestMetadata(fileId, { timeoutMs = DEFAULT_DRIVE_TIMEOUT_MS } = {}) {
  const id = text(fileId);
  if (!id) return { ok: false, status: 400, error: 'fileId is required' };
  const tokenRes = await googleDrive.getAccessToken();
  if (!tokenRes.ok) return tokenRes;
  const query = new URLSearchParams({
    fields: 'id,name,mimeType,size,md5Checksum,trashed,createdTime,modifiedTime',
    supportsAllDrives: 'true',
  }).toString();
  const budget = Math.max(0, Number(timeoutMs) || 0);
  let res;
  try {
    res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${query}`,
      {
        headers: { Authorization: `Bearer ${tokenRes.data.accessToken}` },
        // A hung metadata read used to hold the whole pass open indefinitely.
        ...(budget > 0 ? { signal: AbortSignal.timeout(budget) } : {}),
      }
    );
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return {
        ok: false,
        status: 504,
        error: `Google Drive did not answer within ${Math.round(budget / 1000)}s when asked to describe `
          + `file ${id}, so the call was abandoned rather than left hanging`,
      };
    }
    return { ok: false, status: 502, error: `Google Drive could not be reached: ${err.message}` };
  }
  const body = await res.text().catch(() => '');
  let payload = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { message: body }; }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 500,
      error: payload?.error?.message || payload?.message || `Google Drive metadata read failed (${res.status})`,
    };
  }
  return { ok: true, status: 200, data: payload };
}

/**
 * Open the file's bytes as a stream, starting at `offset`.
 *
 * `rangeHonoured` is the field that matters, and the reason this is not
 * `fetchDriveFileMedia`. A server that ignores `Range` answers 200 with the
 * WHOLE file, and appending that to a part file already holding the first half
 * produces a file of exactly the right length made of the wrong bytes — which
 * the size check passes and only the hash catches. The caller truncates and
 * starts again when this comes back false.
 */
async function openDriveStream(fileId, { offset = 0, signal = null } = {}) {
  const id = text(fileId);
  if (!id) return { ok: false, status: 400, error: 'fileId is required' };
  const tokenRes = await googleDrive.getAccessToken();
  if (!tokenRes.ok) return tokenRes;
  const start = Number(offset) > 0 ? Math.floor(Number(offset)) : 0;
  let res;
  try {
    res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
      {
        headers: {
          Authorization: `Bearer ${tokenRes.data.accessToken}`,
          ...(start > 0 ? { Range: `bytes=${start}-` } : {}),
        },
        // The caller's stall watchdog owns this signal, and it is armed before
        // the call so a connection that never returns HEADERS is abandoned too
        // — not only one that stops mid-body.
        ...(signal ? { signal } : {}),
      }
    );
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { ok: false, status: 504, error: `Google Drive stopped responding while opening file ${id}` };
    }
    return { ok: false, status: 502, error: `Google Drive could not be reached: ${err.message}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { payload = { message: body }; }
    return {
      ok: false,
      status: res.status || 500,
      error: payload?.error?.message || payload?.message || `Google Drive media fetch failed (${res.status})`,
    };
  }
  return {
    ok: true,
    status: res.status,
    // 206 means the Range was honoured. Anything else means it was not, even
    // when the request carried one — see the note above.
    rangeHonoured: start === 0 || res.status === 206,
    stream: res.body ? Readable.fromWeb(res.body) : Readable.from([]),
  };
}

/** The real Drive, behind the same small interface a test hands a fake of. */
function realDriveClient() {
  return {
    getMetadata: (fileId, opts) => getIngestMetadata(fileId, opts),
    openStream: (fileId, opts) => openDriveStream(fileId, opts),
  };
}

/** The catalog, behind an interface a test can hand a fake of. */
function realCatalog() {
  return {
    findSourceByDriveFileId: videoSourcesStore.findSourceByDriveFileId,
    findSourceByContentHash: videoSourcesStore.findSourceByContentHash,
    createSource: videoSourcesStore.createSource,
    getSourceById: videoSourcesStore.getSourceById,
    findSessionByTitle: videoSessionsStore.findSessionByTitle,
    createSession: videoSessionsStore.createSession,
  };
}

/**
 * Which session a freshly-downloaded file joins.
 *
 * NOBODY HAS DECIDED THIS YET, AND THIS DOES NOT PRETEND OTHERWISE. Grouping
 * footage into a shoot — this wide shot and that person-on-camera are one
 * recording — needs the container metadata 5/8 reads and the sync pass 7/8
 * runs, and neither exists. But `video_sources.session_id` has to point
 * somewhere today, so ingest files everything into a HOLDING session named for
 * its lane and the day the file was recorded, and says so in the title:
 *
 *     Unsorted — inbox — 2026-09-15
 *
 * A holding pen with a name that reads as a holding pen is something a later
 * slice can regroup and a person can understand. A plausible-looking
 * "Session 4" invented by a downloader is the unmeasured value stated
 * confidently that `sync_offset_ms` was redesigned to avoid in 1/8.
 *
 * Override with the `resolveSessionId` option when a caller genuinely knows.
 */
function holdingSessionTitle(lane, recordedAt) {
  const when = recordedAt ? new Date(recordedAt) : null;
  const day = when && !Number.isNaN(when.getTime())
    ? when.toISOString().slice(0, 10)
    : 'undated';
  return `Unsorted — ${text(lane) || 'inbox'} — ${day}`;
}

/**
 * Find that holding session, or make it.
 *
 * IT ASKS FOR THE TITLE, IT DOES NOT SCAN A PAGE OF SESSIONS. The first draft
 * looked for the title inside `listSessions(200, scope)`, which orders by
 * `recorded_at desc` — so past about 200 sessions, any backfilled older day
 * falls off the end of that page, the lookup misses, and a duplicate holding
 * session is created on EVERY ingest from then on. A list read is not a
 * lookup. Found by review on 2026-09-16; the targeted finder is
 * `videoSessionsStore.findSessionByTitle`.
 *
 * Read-then-write, and the race is stated rather than hidden: two ingest jobs
 * for two different files recorded on the same day could both find nothing and
 * both create one. The cost is a duplicate holding session, which is cosmetic
 * and fixable by hand; the cost of a unique index on a title is a migration
 * and a rule about titles that nothing else in this schema has. Ingest runs
 * one job at a time on one machine today, so the window is currently shut.
 */
async function ensureHoldingSession({ catalog, lane, recordedAt, scope }) {
  const title = holdingSessionTitle(lane, recordedAt);
  const existing = await catalog.findSessionByTitle(title, scope);
  if (!existing.ok) {
    return {
      ok: false,
      status: existing.status,
      error: `the holding session "${title}" could not be looked up: ${existing.error}`,
    };
  }
  if (existing.data) return { ok: true, status: 200, data: existing.data, created: false };

  const created = await catalog.createSession({
    title,
    state: 'ingesting',
    recordedAt: recordedAt || null,
  }, scope);
  if (!created.ok) {
    return { ok: false, status: created.status, error: `the holding session could not be created: ${created.error}` };
  }
  return { ok: true, status: 201, data: created.data, created: true };
}

/**
 * Hash a file on disk, in one pass, with both digests at once.
 *
 * MD5 is what Drive can be compared against; SHA-256 is what the catalog
 * stores as `content_hash`, because MD5 is a checksum for transport and a
 * content identity two different files can share is not an identity. Reading a
 * 3.5 GB file twice for two digests would double the IO for no gain.
 */
async function hashFile(file) {
  const md5 = crypto.createHash('md5');
  const sha256 = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) {
    md5.update(chunk);
    sha256.update(chunk);
  }
  return { md5: md5.digest('hex'), sha256: sha256.digest('hex') };
}

/**
 * Bring the bytes down, resuming whatever is already there.
 *
 * Returns `{ ok, bytes, resumedFrom, restarted }`, or a refusal with a reason
 * in a person's language. It never deletes a part file on an ordinary failure:
 * the partial bytes ARE the progress, and throwing them away is what makes a
 * 3.57 GB download unfinishable on a machine that naps.
 */
async function downloadToPart({
  drive,
  driveFileId,
  partPath,
  expectedBytes,
  onProgress = null,
  stallMs = DEFAULT_DRIVE_STALL_MS,
}) {
  let have = await sizeOnDisk(partPath);

  // More bytes than Drive says the file has: the part file is left over from a
  // previous version of this Drive file, or from a bug. Either way it can
  // never become the right file by having more appended to it.
  if (expectedBytes > 0 && have > expectedBytes) {
    await removeQuietly(partPath);
    have = 0;
  }
  if (expectedBytes > 0 && have === expectedBytes) {
    return { ok: true, bytes: have, resumedFrom: have, restarted: false, transferred: 0 };
  }

  // ── The stall watchdog ───────────────────────────────────────────────────
  // Armed BEFORE the call, because a connection that never returns its headers
  // hangs just as completely as one that stops mid-body, and disarmed in the
  // `finally` below so nothing is left running after the function returns
  // (DOCTRINE 5.2 — this is a timer inside a function, never at module scope).
  //
  // It both aborts the controller, which is what tears a real socket down, and
  // destroys the stream, which is what guarantees the pipeline below actually
  // ends rather than trusting a transport to honour the signal.
  const budget = Math.max(0, Number(stallMs) || 0);
  const controller = new AbortController();
  let stallTimer = null;
  let stalled = false;
  let liveStream = null;
  const stallError = () => new Error(
    `no bytes arrived from Google Drive for ${Math.round(budget / 1000)}s, so the download was abandoned `
    + 'rather than left hanging with its queue lease quietly expiring'
  );
  const disarm = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const arm = () => {
    if (!budget) return;
    disarm();
    stallTimer = setTimeout(() => {
      stalled = true;
      try { controller.abort(stallError()); } catch { /* already aborted */ }
      if (liveStream && typeof liveStream.destroy === 'function') liveStream.destroy(stallError());
    }, budget);
    // Deliberately NOT unref'd. This timer is the only thing that will ever end
    // a hung download, so it has to hold the event loop open — an unref'd one
    // lets the process decide there is nothing left to do while a stream that
    // will never emit is still being awaited. It is cleared in the `finally`
    // below, so it cannot outlive the call.
  };

  try {
    return await withStallWatchdog();
  } finally {
    disarm();
  }

  async function withStallWatchdog() {
    arm();
    const opened = await drive.openStream(driveFileId, { offset: have, signal: controller.signal });
    if (!opened.ok) {
      disarm();
      return {
        ok: false,
        status: opened.status,
        error: stalled ? stallError().message : opened.error,
        bytes: have,
        resumedFrom: have,
      };
    }
    liveStream = opened.stream;
    arm();

    let restarted = false;
    let flags = 'a';
    if (have > 0 && opened.rangeHonoured === false) {
      // The server sent the whole file even though we asked for the tail.
      // Appending it would produce a file of the right length made of the wrong
      // bytes — see the note on openDriveStream.
      restarted = true;
      flags = 'w';
      have = 0;
    }

    const resumedFrom = have;
    let written = 0;
    let leaseLost = false;
    const out = fs.createWriteStream(partPath, { flags });
    try {
      await pipeline(
        opened.stream,
        async function* (source) {
          for await (const chunk of source) {
            arm(); // bytes are moving, so the clock starts again
            written += chunk.length;
            if (onProgress) {
              const verdict = await onProgress({ bytes: resumedFrom + written, expectedBytes });
              if (verdict === false) {
                leaseLost = true;
                return;
              }
            }
            yield chunk;
          }
        },
        out
      );
    } catch (err) {
      return {
        ok: false,
        status: stalled ? 504 : 502,
        error: `the download stopped after ${humanBytes(resumedFrom + written)}: `
          + `${stalled ? stallError().message : err.message}`,
        bytes: await sizeOnDisk(partPath),
        resumedFrom,
        restarted,
      };
    } finally {
      disarm();
    }
    if (leaseLost) {
      return {
        ok: false,
        status: 409,
        error: 'the lease on this job was lost, so the download was stopped',
        bytes: await sizeOnDisk(partPath),
        resumedFrom,
        restarted,
        leaseLost: true,
      };
    }

    return {
      ok: true,
      bytes: await sizeOnDisk(partPath),
      resumedFrom,
      restarted,
      transferred: written,
    };
  }
}

/**
 * What a payload from the watcher means to this slice.
 *
 * The lane and the role come from the watcher, because the FOLDER knows them;
 * everything about the bytes is read fresh from Drive (see getIngestMetadata).
 */
function readJobPayload(job) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const driveFileId = text(payload.driveFileId) || text(job && job.subjectId);
  const lane = text(payload.lane) || 'inbox';
  const known = LANES[lane] || null;
  return {
    driveFileId,
    name: text(payload.name),
    lane,
    folderPath: known ? known.path : '',
    // `null` for inbox footage on purpose — the watcher refuses to guess the
    // role and so does this. `createSource` defaults it to 'reference'.
    layerRole: payload.layerRole === null || payload.layerRole === undefined
      ? null
      : text(payload.layerRole),
    recordedAt: text(payload.createdTime) || text(payload.modifiedTime) || '',
    watchedSizeBytes: Number(payload.sizeBytes) || 0,
    watchedMd5: text(payload.md5Checksum),
  };
}

/**
 * Ingest ONE claimed job. The caller owns the claim; this never claims.
 *
 * Every return says what happened to the FILE and what happened to the JOB,
 * because they are not the same question and a reader has to be able to see
 * them disagree: `outcome` is for a person reading the report, `jobAction` is
 * what the queue was actually told.
 */
async function ingestJob({
  queue,
  job,
  owner,
  drive = realDriveClient(),
  catalog = realCatalog(),
  options = {},
  env = process.env,
  statfs = fs.statfsSync,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  clock = Date.now,
  resolveSessionId = null,
}) {
  const facts = readJobPayload(job);
  const scope = scopeFor(options, env);
  const cacheDir = resolveCacheDir(options, env);
  const base = { fileId: facts.driveFileId, name: facts.name, lane: facts.lane, jobId: job.id };

  // `jobId` is what stops this pass reporting a file as blocked while leaving
  // its own job `running` — see the long note on `queue.block`. The subject
  // lookup usually finds that same job, but "usually" is not a guarantee when
  // the payload's Drive file id and the job's subject can differ, and the
  // failure is silent and expensive (about 71 GB of re-download for one
  // corrupt clip). Name the job we are holding.
  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_INGEST,
      subjectKind: SUBJECT_DRIVE_FILE,
      subjectId: facts.driveFileId || text(job.subjectId),
      reason,
      payload: job.payload || null,
      jobId: job.id,
    });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const failIt = (reason) => {
    queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'failed', jobAction: 'failed', reason };
  };
  /**
   * "This work is fine, the conditions are not."
   *
   * An outage of Supabase or Drive is a fact about the MACHINE, exactly as a
   * full disk is, and the disk floor already treats it that way. Charging it
   * to the FILE was the third finding of review round 3, and taken in the same
   * round while the reasoning is fresh: with DEFAULT_MAX_ATTEMPTS = 5 and a
   * 30s-doubling backoff, roughly eight minutes of database trouble sent
   * perfectly good footage to terminal `blocked` carrying a reason about
   * somebody else's outage, needing a hand to clear it.
   *
   * `release` spends no attempt, so a passing outage costs a wait rather than
   * a file. The 15 minutes is the same hold-off the disk floor uses.
   *
   * It falls back to `fail` on a queue with no `release` for the same reason
   * the floor's call does: a job put back by nothing at all is a job lost.
   */
  const releaseIt = (reason) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: 15 * 60 * 1000 })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return {
      ...base,
      outcome: released ? 'outage' : 'failed',
      jobAction: released ? 'released' : 'failed',
      reason,
    };
  };

  if (!facts.driveFileId) {
    return blockIt(
      'this job carries no Drive file id, so there is nothing to download. '
      + 'Fix: this should not be reachable from the watcher — report it, then delete the job.'
    );
  }
  const timeouts = resolveDriveTimeouts(options, env);
  if (!timeouts.ok) return blockIt(timeouts.error);

  if (!scope) {
    return blockIt(
      'STUDIO_PROJECT_ID is not set, so there is no project to file this footage under. '
      + 'A row written without one belongs to nobody and is invisible to every screen that looks for it '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.'
    );
  }

  // ── What does Drive say the file is, right now? ──────────────────────────
  //
  // This runs BEFORE the catalog is asked, and the order is the fix for review
  // round 3. It used to be the other way round — a known Drive file id
  // completed the job as "already in the catalog" without a single byte of it
  // ever being compared to anything. Drive keeps the file id across a
  // re-upload, a "Manage versions" replacement and a Drive Desktop overwrite,
  // so that path kept the OLD content hash and the OLD local_path pointing at
  // the OLD bytes and reported a CLEAN pass. 5/8 then probed footage that is
  // not in Drive any more and 6/8 made a proxy of it, with no alarm anywhere.
  //
  // 3/8 re-enqueues on every Drive change on purpose and says so
  // (workers/studio/drive.js): "a file that has genuinely changed should be
  // re-ingested, and the watcher cannot tell a rename from a re-upload. Cheap
  // duplicate work is 4/8's to refuse, on the md5Checksum this payload already
  // carries." This is 4/8 doing that refusing.
  //
  // The cost of the swap is one metadata call — a header read, not a download
  // — on a file that turns out to be a duplicate. The cost of the old order
  // was a catalog that silently disagreed with Drive.
  const meta = await drive.getMetadata(facts.driveFileId, { timeoutMs: timeouts.value.timeoutMs });
  if (!meta.ok) {
    if (meta.status === 404) {
      return blockIt(
        `Drive says file ${facts.driveFileId}${facts.name ? ` ("${facts.name}")` : ''} does not exist, `
        + 'or this credential cannot see it. '
        + 'Fix: check the file is still in the watched folder, and that the Studio token\'s account can read it. '
        + `Drive said: ${meta.error}`
      );
    }
    return releaseIt(`Drive would not describe file ${facts.driveFileId}: ${meta.error}`);
  }
  const expectedBytes = Number(meta.data.size) || 0;
  const expectedMd5 = text(meta.data.md5Checksum);
  const driveName = text(meta.data.name) || facts.name;

  // Where this file's bytes live on disk. Computed HERE, above the trashed
  // check, rather than further down with the disk-room question — because the
  // trashed path needs it (review round 3).
  const paths = cachePathsFor({ cacheDir, lane: facts.lane, driveFileId: facts.driveFileId, name: driveName });

  if (meta.data.trashed) {
    // A previous attempt's partial download is kept on purpose — the partial
    // bytes ARE the progress, and resuming is the whole point of this slice.
    // But once the clip is trashed in Drive, nothing will ever resume them:
    // the job completes, no catalog row points at them, and 3/8 skips trashed
    // files so nothing re-enqueues. They are stranded, and at this slice's
    // real scale that is up to 3.57 GB per trashed clip sitting for ever on
    // the one disk the floor exists to protect — which the floor cannot see,
    // because it measures free space and never asks what is using it.
    //
    // Third instance of this cache-leak class on this branch (the 409 path and
    // the wrong-length strays were the first two), same treatment.
    await removeQuietly(paths.partPath);
    queue.complete(job.id, owner);
    return {
      ...base,
      outcome: 'skipped',
      jobAction: 'completed',
      reason: 'the file was moved to the Drive trash between being watched and being ingested, '
        + 'so it was not downloaded',
    };
  }
  if (!expectedBytes) {
    return blockIt(
      `Drive reports no size for file ${facts.driveFileId}${driveName ? ` ("${driveName}")` : ''}, `
      + 'so a download of it could not be checked against anything and nothing was registered. '
      + 'Fix: this is normal for a Google-native document and wrong for footage — check what the file actually is.'
    );
  }
  if (!expectedMd5) {
    // "Could not verify" is not "verified" (DOCTRINE 3.11). Registering it
    // anyway would put a file in the catalog that nothing ever proved arrived
    // intact, and every slice downstream treats the catalog as the truth.
    return blockIt(
      `Drive reports no md5Checksum for file ${facts.driveFileId}${driveName ? ` ("${driveName}")` : ''}, `
      + 'so the download could not be proved to have arrived intact and was not registered. '
      + 'Fix: Drive supplies an md5 for every uploaded binary file — one without it is usually a Google-native '
      + 'document or a shortcut, which is not footage. Check what the file is.'
    );
  }

  // ── Is it already in the catalog, and is it still the SAME file? ─────────
  //
  // Two questions, not one. The Drive file id answers "have we seen this id?";
  // only the md5 answers "are these the bytes we ingested?". Asking the first
  // alone is what review round 3 sent this back for.
  //
  // Three outcomes, never two (DOCTRINE 3.2):
  //
  //   same id, same md5      → dedupe. Nothing to do, nothing downloaded.
  //   same id, different md5 → the file was REPLACED in Drive. Re-ingest and
  //                            update the row in place, so one Drive file
  //                            stays one catalog row.
  //   same id, no stored md5 → cannot tell. The row predates the drive_md5
  //                            column. "Could not verify" is not "verified"
  //                            (DOCTRINE 3.11), so re-ingest and say why —
  //                            it costs one download, once, and it is the only
  //                            answer that cannot leave a wrong row standing.
  //
  // Note what is NOT compared: `content_hash` is a sha256 of the bytes on disk
  // and Drive's is an md5. They are different algorithms and comparing them
  // would be nonsense; `drive_md5` exists precisely so there is something on
  // the row that CAN be compared with what Drive says.
  const already = await catalog.findSourceByDriveFileId(facts.driveFileId, scope);
  if (!already.ok) {
    return releaseIt(
      `the catalog could not be asked whether this file is already in it: ${already.error}`
    );
  }
  let replacing = null;
  if (already.data) {
    const storedMd5 = text(already.data.driveMd5);
    if (storedMd5 && storedMd5 === expectedMd5) {
      queue.complete(job.id, owner);
      return {
        ...base,
        outcome: 'deduped',
        jobAction: 'completed',
        sourceId: already.data.id,
        reason: `this Drive file is already in the catalog as source ${already.data.id} `
          + 'and Drive reports the same md5, so it is the same file and nothing was downloaded',
      };
    }
    replacing = already.data;
    base.replacingSourceId = already.data.id;
  }

  // ── Is there room? ───────────────────────────────────────────────────────
  // The floor was already checked for the pass; this asks the narrower
  // question the pass could not: does THIS file fit and still leave the floor
  // standing? Refusing here is what "does not partially fill the disk" means.
  const floor = resolveDiskFloorBytes(options, env);
  if (!floor.ok) return blockIt(floor.error);
  const free = freeBytesFor(cacheDir, statfs);
  if (!free.ok) {
    return releaseIt(`${free.error} — so whether there is room for ${humanBytes(expectedBytes)} could not be decided`);
  }
  // `paths` is computed above, with the trashed check that needs it.
  // Whatever is finished in this Drive file's folder counts towards what is
  // already here, WHATEVER IT IS CALLED — see findCachedFiles. Asking only
  // about `finalPath` made a renamed clip look like a file nobody had started.
  // And a half-finished download of the OLD bytes cannot be resumed into the
  // new ones — resuming would splice two different files together and produce
  // a hash that matches nothing. Drop it before anything counts it.
  if (replacing) await removeQuietly(paths.partPath);
  const cached = await findCachedFiles(paths.dir);
  // A REPLACED file adopts nothing. Normally a finished file of the right
  // length in this folder is this file, and adopting it saves a 3.57 GB
  // download. But when the catalog says this Drive id used to hold different
  // bytes, anything already in the folder is the OLD version — and a
  // same-length re-upload (a re-export at the same settings; a one-frame trim
  // is not) would be adopted as if nothing had changed. Then the md5 check
  // would refuse it and the file would go to `blocked` with a checksum error
  // that reads like corruption rather than like a replacement.
  //
  // So on a replacement the folder is treated as empty: every stray is swept
  // below (nothing is in `usable`), and the new bytes are fetched.
  const usable = replacing ? null : (cached.find((file) => file.size === expectedBytes) || null);
  const alreadyOnDisk = (await sizeOnDisk(paths.partPath)) + (usable ? usable.size : 0);
  const stillNeeded = Math.max(0, expectedBytes - alreadyOnDisk);
  if (free.value - stillNeeded < floor.value) {
    // The job goes BACK on the queue rather than failing: a full disk is not
    // this file's fault, and spending its retry budget on the machine's
    // problem is how a perfectly good job ends up blocked (the same reasoning
    // that split `attempts` from `recoveries` in the queue).
    const reason = `there is not enough room to download ${humanBytes(stillNeeded)} `
      + `and still keep ${humanBytes(floor.value)} free — ${humanBytes(free.value)} is free on ${free.measuredAt}. `
      + 'Nothing was downloaded, so the disk was not partially filled. '
      + 'Fix: free space on that disk, or lower STUDIO_DISK_FLOOR_BYTES if the floor is set too high.';
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: 15 * 60 * 1000 })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return {
      ...base,
      outcome: 'no_room',
      jobAction: released ? 'released' : 'failed',
      reason,
      freeBytes: free.value,
      floorBytes: floor.value,
      neededBytes: stillNeeded,
    };
  }

  // ── Bring the bytes down ─────────────────────────────────────────────────
  await fsp.mkdir(paths.dir, { recursive: true });

  // A complete file from an earlier attempt that died before it registered:
  // verify that rather than fetching 3.57 GB again — and adopt it even if the
  // clip has been RENAMED in Drive since, which is the whole reason this asks
  // the folder rather than one path.
  let verifyPath = usable ? usable.path : paths.finalPath;
  let resumedFrom = 0;
  let restarted = false;

  // Anything finished in this folder that is NOT the right length is a copy of
  // a previous version of this Drive file (the folder is keyed by the id, so
  // it can be nothing else). That is the same judgement the old code made
  // about a wrong-length `finalPath`, widened to one whose name has moved —
  // without which the stray is a full-size file no catalog row points at and
  // no free-space check can account for.
  for (const stray of cached) {
    if (usable && stray.path === usable.path) continue;
    await removeQuietly(stray.path);
  }

  if (!usable) {
    let lastBeat = clock();
    const downloaded = await downloadToPart({
      drive,
      driveFileId: facts.driveFileId,
      partPath: paths.partPath,
      expectedBytes,
      stallMs: timeouts.value.stallMs,
      onProgress: async ({ bytes }) => {
        const at = clock();
        if (at - lastBeat < heartbeatMs) return true;
        lastBeat = at;
        const pct = expectedBytes ? Math.floor((bytes / expectedBytes) * 100) : 0;
        // A worker that ignores a lost lease is a worker about to finish a job
        // a second worker is also doing — the queue's own note on heartbeat.
        return queue.heartbeat(job.id, owner, { progressPct: pct }) !== false;
      },
    });
    resumedFrom = downloaded.resumedFrom || 0;
    restarted = Boolean(downloaded.restarted);
    if (!downloaded.ok) {
      if (downloaded.leaseLost) {
        // The job belongs to somebody else now. Touching it would be the
        // double-processing the single-statement `claim` exists to prevent.
        return {
          ...base,
          outcome: 'lease_lost',
          jobAction: 'none',
          reason: `${downloaded.error}. The ${humanBytes(downloaded.bytes)} already downloaded were kept, `
            + 'so the next attempt resumes from there.',
        };
      }
      // The part file is KEPT. Those bytes are the progress.
      return failIt(
        `${downloaded.error}. The ${humanBytes(downloaded.bytes)} already on disk were kept, `
        + 'so the next attempt resumes from there rather than starting again.'
      );
    }
    if (downloaded.bytes < expectedBytes) {
      return failIt(
        `the download ended early with ${humanBytes(downloaded.bytes)} of ${humanBytes(expectedBytes)}. `
        + 'Those bytes were kept, so the next attempt resumes from there.'
      );
    }
    if (downloaded.bytes > expectedBytes) {
      await removeQuietly(paths.partPath);
      return blockIt(
        `the download came to ${humanBytes(downloaded.bytes)} but Drive says the file is ${humanBytes(expectedBytes)}, `
        + 'so the bytes were discarded and nothing was registered. '
        + 'Fix: the file most likely changed in Drive mid-download — check it, then delete this blocked job '
        + 'to try again.'
      );
    }
    verifyPath = paths.partPath;
  }

  // ── Prove they are the right bytes, BEFORE anything is written ───────────
  let digests;
  try {
    digests = await hashFile(verifyPath);
  } catch (err) {
    return failIt(`the downloaded file could not be read back to check it: ${err.message}`);
  }
  if (digests.md5.toLowerCase() !== expectedMd5.toLowerCase()) {
    await removeQuietly(verifyPath);
    return blockIt(
      `the downloaded bytes do not match Drive's checksum for ${driveName || facts.driveFileId} `
      + `(Drive says ${expectedMd5}, what arrived hashes to ${digests.md5}), `
      + 'so the file was discarded and nothing was registered. '
      + 'Fix: a corrupt part file is the usual cause and has now been deleted — delete this blocked job '
      + 'to download it again.'
    );
  }

  // ── One row, or none ─────────────────────────────────────────────────────
  // The same bytes arriving as a different Drive file — AirDrop, then a Photos
  // sync, then a re-export — are one piece of footage and get one row. The
  // database holds that rule (idx_video_sources_project_content_hash); this
  // check is the cheap one that keeps the ordinary case off the error path.
  const sameBytes = await catalog.findSourceByContentHash(digests.sha256, scope);
  if (!sameBytes.ok) {
    return releaseIt(`the catalog could not be asked whether these bytes are already in it: ${sameBytes.error}`);
  }
  if (sameBytes.data && replacing && sameBytes.data.id === replacing.id) {
    // We came down this path because the row carried NO stored md5 and "could
    // not verify" is not "verified" — so we re-fetched to find out. The bytes
    // hash to exactly what the row already says. Nothing changed; the row was
    // simply written before `drive_md5` existed. Backfill it so this costs one
    // download once rather than one on every pass, and complete.
    const backfilled = await catalog.updateSource(replacing.id, { driveMd5: expectedMd5 }, scope);
    if (!backfilled.ok) {
      return releaseIt(`the source row's Drive md5 could not be recorded: ${backfilled.error}`);
    }
    await removeQuietly(verifyPath);
    queue.complete(job.id, owner);
    return {
      ...base,
      outcome: 'deduped',
      jobAction: 'completed',
      sourceId: replacing.id,
      contentHash: digests.sha256,
      reason: `source ${replacing.id} carried no Drive md5, so this file was fetched to find out whether it `
        + 'had been replaced. It had not — the bytes are unchanged — and the md5 is now on the row, '
        + 'so no later pass has to ask again',
    };
  }
  if (sameBytes.data && replacing) {
    // The Drive file was replaced, and its new bytes are bytes the catalog
    // ALREADY holds under a different source. Two rows would now describe the
    // same footage and one of them (the old row for this Drive id) points at
    // bytes that no longer exist anywhere. There is no guess to make here that
    // is not somebody's editing decision, so this stops and says exactly what
    // it found rather than quietly picking one.
    await removeQuietly(verifyPath);
    return blockIt(
      `Drive file ${facts.driveFileId}${driveName ? ` ("${driveName}")` : ''} was replaced, and its new bytes `
      + `are already in the catalog as source ${sameBytes.data.id}`
      + `${sameBytes.data.driveFileId ? ` (Drive file ${sameBytes.data.driveFileId})` : ''}. `
      + `Source ${replacing.id} still points at the bytes this file used to hold, which are now nowhere in Drive. `
      + 'Nothing was changed. '
      + `Fix: decide which row should survive — keep ${sameBytes.data.id} and delete ${replacing.id} if the old `
      + 'take is finished with, or restore the previous version in Drive if the replacement was a mistake.'
    );
  }
  if (sameBytes.data) {
    await removeQuietly(verifyPath);
    queue.complete(job.id, owner);
    return {
      ...base,
      outcome: 'deduped',
      jobAction: 'completed',
      sourceId: sameBytes.data.id,
      contentHash: digests.sha256,
      reason: `these are the same bytes as source ${sameBytes.data.id} `
        + `(${sameBytes.data.driveFileId || 'another Drive file'}), so the duplicate copy was deleted `
        + 'and no second row was made',
    };
  }

  if (verifyPath === paths.partPath) {
    await fsp.rename(paths.partPath, paths.finalPath);
  } else if (verifyPath !== paths.finalPath) {
    // Adopted under an older Drive name. Move it to the name the clip has now,
    // so the catalog's `localPath` and the disk agree; the bytes are the same
    // bytes and have just been hashed against Drive's own checksum.
    await fsp.rename(verifyPath, paths.finalPath);
  }

  // ── The replacement writes back to the row that is already there ─────────
  // One Drive file is one catalog row. A replaced file that made a SECOND row
  // would leave the first pointing at bytes that no longer exist, and every
  // screen showing both. The session, the layer role and anything 5/8 or 6/8
  // has already written are left alone — the file changed, not its place in
  // the edit — and `state` goes back to `downloaded` so the later slices know
  // to re-probe and re-proxy the new bytes.
  if (replacing) {
    const updated = await catalog.updateSource(replacing.id, {
      state: STATE_DOWNLOADED,
      contentHash: digests.sha256,
      driveMd5: expectedMd5,
      localPath: paths.finalPath,
    }, scope);
    if (!updated.ok) {
      return releaseIt(`the replaced file's source row could not be updated: ${updated.error}`);
    }
    // The same read-back the create path does, and for the same reason
    // (landmine 12): the write reporting 200 is not the evidence, the row is.
    const readBackUpdated = await catalog.getSourceById(replacing.id, scope);
    if (!readBackUpdated.ok) {
      return releaseIt(
        `source ${replacing.id} was updated but could not be read back to check it: ${readBackUpdated.error}`
      );
    }
    if (!text(readBackUpdated.data.projectId)) {
      return blockIt(
        `source ${replacing.id} has NO project id, so it belongs to nobody and no screen will ever show it `
        + '(CLAUDE.md landmine 12). Fix: check video_sources has both project_id and owner_user_id, '
        + `then repair row ${replacing.id} and delete this blocked job.`
      );
    }
    if (text(readBackUpdated.data.contentHash) !== digests.sha256) {
      return blockIt(
        `source ${replacing.id} still reads back with the OLD content hash after being updated, so the catalog `
        + 'and the file on disk disagree about what this footage is. Nothing downstream should trust it. '
        + `Fix: inspect row ${replacing.id} by hand, then delete this blocked job.`
      );
    }
    queue.complete(job.id, owner);
    return {
      ...base,
      outcome: 'ingested',
      jobAction: 'completed',
      sourceId: replacing.id,
      contentHash: digests.sha256,
      bytes: expectedBytes,
      resumedFrom,
      restarted,
      reason: `this Drive file had been REPLACED since it was last ingested — Drive reports a different md5 `
        + `from the one on source ${replacing.id}${replacing.driveMd5 ? '' : ' (the row carried none, so it '
        + 'could not be ruled out)'} — so the new bytes were downloaded and the existing row was updated `
        + 'in place rather than a second row being made',
    };
  }

  let sessionId = '';
  if (typeof resolveSessionId === 'function') {
    sessionId = text(await resolveSessionId({ facts, meta: meta.data, scope }));
    if (!sessionId) {
      return failIt('the caller\'s resolveSessionId returned no session id, so there was nowhere to file this source');
    }
  } else {
    const session = await ensureHoldingSession({
      catalog,
      lane: facts.lane,
      recordedAt: text(meta.data.createdTime) || facts.recordedAt,
      scope,
    });
    if (!session.ok) return failIt(session.error);
    sessionId = session.data.id;
  }

  const created = await catalog.createSource({
    sessionId,
    ...(facts.layerRole ? { layerRole: facts.layerRole } : {}),
    state: STATE_DOWNLOADED,
    driveFileId: facts.driveFileId,
    contentHash: digests.sha256,
    // What Drive said this file's md5 was at the moment we took these bytes.
    // Stored so a later pass can ask whether the file at this Drive id is
    // still the same file — the question that has no answer without it.
    driveMd5: expectedMd5,
    localPath: paths.finalPath,
    recordedAt: text(meta.data.createdTime) || facts.recordedAt || null,
  }, scope);
  if (!created.ok) {
    if (created.status === 409) {
      // The database refused on the content-hash index — another worker
      // registered these exact bytes between the check above and this write.
      // One row is the rule and one row is what there is, so this is a dedupe,
      // not a failure.
      //
      // AND THE COPY GOES, exactly as it does on the dedupe path thirty lines
      // above. By this point the bytes have been renamed to `finalPath`, so
      // leaving them there strands a full-size file with no catalog row
      // pointing at it — a cache leak the disk floor cannot see, because the
      // floor measures free space and never asks what is using it. The winning
      // row is a DIFFERENT Drive file (the same id was already caught by
      // findSourceByDriveFileId), and the cache path is keyed by Drive file
      // id, so this can never be the surviving row's own copy. Found by review
      // on 2026-09-16.
      await removeQuietly(paths.finalPath);
      queue.complete(job.id, owner);
      return {
        ...base,
        outcome: 'deduped',
        jobAction: 'completed',
        contentHash: digests.sha256,
        reason: 'another worker registered these exact bytes first, so the duplicate copy was deleted '
          + 'and no second row was made',
      };
    }
    return releaseIt(`the source row could not be written: ${created.error}`);
  }

  // ── Read the row back ────────────────────────────────────────────────────
  // Landmine 12: `scopedInsertRow` stops stamping the tenant columns when the
  // table fails its probe, and the insert still SUCCEEDS. The row lands with
  // no project and every screen that looks for it finds nothing. The insert
  // reporting 201 is not the evidence; the row is.
  const readBack = await catalog.getSourceById(created.data.id, scope);
  if (!readBack.ok) {
    return failIt(
      `the source row was written as ${created.data.id} but could not be read back to check it: ${readBack.error}`
    );
  }
  if (!text(readBack.data.projectId)) {
    return blockIt(
      `source ${created.data.id} was written with NO project id, so it belongs to nobody and no screen will ever `
      + 'show it (CLAUDE.md landmine 12 — a tenant-scoped table needs both project_id and owner_user_id, and '
      + 'scopedInsertRow silently stops stamping either when the probe fails). '
      + `Fix: check video_sources has both columns, then delete row ${created.data.id} and this blocked job.`
    );
  }

  queue.complete(job.id, owner);
  return {
    ...base,
    outcome: 'ingested',
    jobAction: 'completed',
    sourceId: readBack.data.id,
    sessionId,
    projectId: readBack.data.projectId,
    contentHash: digests.sha256,
    bytes: expectedBytes,
    localPath: paths.finalPath,
    resumed: resumedFrom > 0,
    resumedFrom,
    restarted,
    reason: resumedFrom > 0
      ? `resumed from ${humanBytes(resumedFrom)} and finished at ${humanBytes(expectedBytes)}`
      : `downloaded ${humanBytes(expectedBytes)}`,
  };
}

/**
 * The alarm that is currently raised for this cache, or null.
 *
 * Read back rather than remembered, because the pass that raised it was a
 * different process fifteen minutes ago. This is the "fact that outlives one
 * pass" the round-2 review asked for.
 */
function standingAlarm(queue, cacheDir) {
  if (typeof queue.listJobs !== 'function') return null;
  return queue
    .listJobs({ stage: STAGE_INGEST_HEALTH, state: 'blocked' })
    .find((job) => job.subjectKind === SUBJECT_INGEST_HEALTH && job.subjectId === cacheDir) || null;
}

/**
 * Which jobs are STILL stuck for want of disk room, at the end of this pass.
 *
 * The ids come from two places and both are needed: the files this pass put
 * back, and the ones a previous pass put back and recorded on the alarm. Each
 * is then looked up, because an id on the alarm proves only that it was stuck
 * once — a job that has since been ingested, failed, blocked or deleted is not
 * stuck any more, and an alarm that cannot stand down is an alarm that gets
 * ignored.
 */
function stillWaitingForRoom({ queue, released, alarm }) {
  const carried = alarm && alarm.payload && alarm.payload.kind === HEALTH_NO_ROOM
    ? (Array.isArray(alarm.payload.heldJobIds) ? alarm.payload.heldJobIds : [])
    : [];
  const ids = new Set();
  for (const id of [...carried, ...released.map((entry) => entry.jobId)]) {
    const n = Number(id);
    if (Number.isFinite(n)) ids.add(n);
  }
  if (typeof queue.getJob !== 'function') return [...ids].sort((a, b) => a - b);
  return [...ids]
    .filter((id) => {
      const job = queue.getJob(id);
      return Boolean(job) && (job.state === 'pending' || job.state === 'running');
    })
    .sort((a, b) => a - b);
}

/**
 * Claim ingest jobs and do them, up to `max`.
 *
 * Returns a REPORT, always, and never throws for an ordinary failure — the
 * same bargain `watchDrive` makes, for the same reason: a worker that dies on
 * a bad afternoon is a worker somebody has to restart at 3am.
 */
async function runIngest(options = {}) {
  const {
    queue,
    owner = `ingest-${process.pid}`,
    drive = realDriveClient(),
    catalog = realCatalog(),
    env = process.env,
    statfs = fs.statfsSync,
    max = 1,
    clock = Date.now,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    resolveSessionId = null,
  } = options;

  if (!queue) throw new Error('runIngest needs a queue (workers/studio/queue.js)');

  const cacheDir = resolveCacheDir(options, env);
  const report = {
    ok: false,
    owner,
    cacheDir,
    floorBytes: null,
    freeBytes: null,
    measuredAt: null,
    cacheDirExists: null,
    ingested: [],
    deduped: [],
    skipped: [],
    failed: [],
    blocked: [],
    released: [],
    // Work put back because a SERVICE was down, kept separate from `released`
    // on purpose. Both are "the work is fine, the conditions are not", but the
    // disk alarm reads `released` to decide whether files are stuck for want
    // of room — and a Supabase outage filed in there would raise an alarm
    // saying the disk is full when it is not, which is the class of lie this
    // ticket has been sent back for three times.
    outages: [],
    unchecked: [],
    health: null,
    healthCleared: false,
    // Raised at the END of the pass and true whenever the alarm is up — the
    // field a reader should believe, because `health` is only set by the pass
    // that wrote it and says nothing about one that did nothing.
    healthStanding: false,
    // What the QUEUE says is outstanding, which is not the same question as
    // what this pass touched. `null` only when the queue is too old to answer.
    waiting: null,
    // The jobs still stuck for want of disk room, by id.
    awaitingRoom: [],
  };

  const stopThePass = (reason) => {
    report.health = queue.block({
      stage: STAGE_INGEST_HEALTH,
      subjectKind: SUBJECT_INGEST_HEALTH,
      subjectId: cacheDir,
      reason,
    }).job;
    report.healthStanding = true;
    report.unchecked.push(reason);
    return report;
  };

  const projectId = resolveProjectId(options, env);
  if (!projectId) {
    return stopThePass(
      'STUDIO_PROJECT_ID is not set, so there is no project to file downloaded footage under and nothing was '
      + 'ingested. A row written without one belongs to nobody and is invisible to every screen that looks for it '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.'
    );
  }

  const floor = resolveDiskFloorBytes(options, env);
  if (!floor.ok) return stopThePass(floor.error);
  report.floorBytes = floor.value;

  // Read before any file is claimed, so a junk value stops the pass with one
  // alarm rather than blocking each file it reaches in turn.
  const timeouts = resolveDriveTimeouts(options, env);
  if (!timeouts.ok) return stopThePass(timeouts.error);

  const free = freeBytesFor(cacheDir, statfs);
  if (!free.ok) {
    // A reading that could not be taken is not a reading that passed
    // (DOCTRINE 3.11). Downloading 3.57 GB onto a disk whose free space is
    // unknown is exactly the partial fill the floor exists to prevent.
    return stopThePass(
      `${free.error}, so the disk floor could not be checked and nothing was downloaded. `
      + `Fix: check that ${cacheDir} is on a disk this machine can see (STUDIO_CACHE_DIR points at it).`
    );
  }
  report.freeBytes = free.value;
  report.measuredAt = free.measuredAt;
  // `false` means the cache folder itself is not there yet and the reading was
  // taken on its parent — worth saying out loud, because "0 files ingested"
  // and "the folder is empty because it has never existed" read identically.
  report.cacheDirExists = free.exists !== false;
  if (free.value < floor.value) {
    return stopThePass(
      `only ${humanBytes(free.value)} is free on ${free.measuredAt} and the floor is ${humanBytes(floor.value)}, `
      + 'so ingest refused to start and nothing was downloaded — the disk was not partially filled. '
      + 'Fix: free space on that disk, or lower STUDIO_DISK_FLOOR_BYTES if the floor is set too high.'
    );
  }

  for (let done = 0; done < Math.max(1, Number(max) || 1); done += 1) {
    const job = queue.claim(owner, { stages: [STAGE_INGEST] });
    if (!job) break;
    let result;
    try {
      result = await ingestJob({
        queue, job, owner, drive, catalog, options, env, statfs, clock, heartbeatMs, resolveSessionId,
      });
    } catch (err) {
      // An unexpected throw is still a job somebody has to account for. It
      // fails (and so retries) rather than being left running until its lease
      // expires, because a job nobody reports is a job nobody fixes.
      const reason = `the ingest of this file threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, fileId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      ingested: report.ingested,
      deduped: report.deduped,
      skipped: report.skipped,
      failed: report.failed,
      blocked: report.blocked,
      no_room: report.released,
      outage: report.outages,
      lease_lost: report.unchecked,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'no_room') break; // the disk will not have got bigger
    if (result.outcome === 'outage') break;  // nor will the service have come back
  }

  // ── The verdict, and the alarm ───────────────────────────────────────────
  // BOTH ARE COMPUTED FROM WHAT IS TRUE OF THE QUEUE AND THE DISK, NEVER FROM
  // WHAT THIS PASS HAPPENED TO TOUCH. That distinction is the whole of round 2
  // of this ticket, and round 1 got half of it: counting `released` fixed the
  // pass that HITS the condition, and every pass afterwards still contradicted
  // it. `release` holds a job off for fifteen minutes and `claim` honours
  // `run_after`, so the pass five minutes later claims nothing at all — every
  // bucket empty, `ok` flipping to true, "no ingest jobs were waiting on the
  // queue" printed while one was, and `clearBlock` DELETING the only durable
  // record of a disk that is exactly as full as it was. Found by review on
  // 2026-09-16.
  //
  // So the pass asks two things it cannot learn from its own buckets: what the
  // queue is still holding (`queue.waiting`, decided by the queue's own clock
  // — the same clock `claim` uses, or the two would disagree about one fact),
  // and which files the standing alarm says are still stuck. An alarm stands
  // down only on a pass that can show the condition is over; never on a pass
  // that simply did nothing.
  const waiting = typeof queue.waiting === 'function' ? queue.waiting({ stage: STAGE_INGEST }) : null;
  if (waiting) {
    report.waiting = {
      pending: waiting.pending,
      dueNow: waiting.dueNow,
      heldOff: waiting.heldOff,
      nextDueInMs: waiting.nextDueInMs,
    };
  }

  const alarm = standingAlarm(queue, cacheDir);
  const stuck = stillWaitingForRoom({ queue, released: report.released, alarm });
  report.awaitingRoom = stuck;

  if (stuck.length) {
    const nextDue = waiting && waiting.nextDueInMs > 0
      ? ` The next attempt is due in ${humanDuration(waiting.nextDueInMs)}.`
      : '';
    const first = report.released[0] || null;
    report.health = queue.block({
      stage: STAGE_INGEST_HEALTH,
      subjectKind: SUBJECT_INGEST_HEALTH,
      subjectId: cacheDir,
      reason: `${stuck.length} file(s) could not be downloaded for want of disk room, so ingest is `
        + 'making no progress and will keep refusing on every pass until space is freed.'
        + nextDue
        + (first
          ? ` The first of them: ${first.reason}`
          : ` ${humanBytes(report.freeBytes)} is free on ${report.measuredAt}, `
            + `and the floor is ${humanBytes(report.floorBytes)}.`),
      // The ids ARE the durable record. Without them a later pass has only its
      // own empty buckets to reason from, which is how this alarm got deleted.
      payload: { kind: HEALTH_NO_ROOM, heldJobIds: stuck },
    }).job;
    report.healthStanding = true;
  } else if (typeof queue.clearBlock === 'function') {
    // The floor is standing, a project is configured, and nothing is left
    // stuck for want of room, so any earlier alarm about any of that is over.
    // An alarm that cannot stand down is an alarm that gets ignored.
    report.healthCleared = queue.clearBlock({
      stage: STAGE_INGEST_HEALTH,
      subjectKind: SUBJECT_INGEST_HEALTH,
      subjectId: cacheDir,
    });
  } else if (alarm) {
    report.healthStanding = true;
  }

  // A pass is clean when nothing went wrong in it AND nothing is left waiting
  // that it could not do. `heldOff` is the half a pass cannot see from its own
  // buckets: a job put back for want of room, or backing off after a failure,
  // is work outstanding whether or not this particular pass ever saw it.
  report.ok = report.failed.length === 0
    && report.blocked.length === 0
    && report.unchecked.length === 0
    && report.released.length === 0
    && report.outages.length === 0
    && !report.healthStanding
    && (!waiting || waiting.heldOff === 0);

  return report;
}

/** The pass, in plain English, for whoever reads the log at 9am. */
function formatIngestReport(report) {
  const lines = [];
  lines.push(report.ok ? 'Studio ingest: finished cleanly.' : 'Studio ingest: FINISHED WITH THINGS TO LOOK AT.');
  lines.push(`Cache: ${report.cacheDir}`);
  if (report.freeBytes !== null && report.freeBytes !== undefined) {
    lines.push(
      `Disk: ${humanBytes(report.freeBytes)} free, floor ${humanBytes(report.floorBytes)}`
      + `${report.cacheDirExists === false ? ` (measured on ${report.measuredAt} — the cache folder does not exist yet)` : ''}.`
    );
  }
  // THE STANDING ALARM GETS ITS OWN LINE, HIGH UP, ON EVERY PASS IT IS UP FOR.
  // Whoever reads this at 9am is reading ONE pass's log, and the condition the
  // alarm is about outlives passes — a quiet pass that prints nothing about it
  // reads as a pipeline with nothing wrong, which is exactly what a full disk
  // looked like five minutes after it was found.
  //
  // It is suppressed only where this same pass is already saying the same
  // thing at the same volume a line or two below: as a `COULD NOT CHECK`
  // (`stopThePass` files the alarm with the identical sentence) or as the
  // `NO ROOM` lines for the files it has just put back. The line exists for
  // the pass that has nothing of its own to report.
  const alarmReason = report.healthStanding && report.health ? String(report.health.lastError || '') : '';
  const alreadySaid = report.released.length > 0 || report.unchecked
    .some((entry) => (typeof entry === 'string' ? entry : entry && entry.reason) === alarmReason);
  if (alarmReason && !alreadySaid) {
    lines.push(`  ALARM STANDING — ${alarmReason}`);
  }
  for (const entry of report.ingested) {
    lines.push(`  downloaded  ${entry.name || entry.fileId} — ${entry.reason}, registered as source ${entry.sourceId}`);
  }
  for (const entry of report.deduped) {
    lines.push(`  already had ${entry.name || entry.fileId} — ${entry.reason}`);
  }
  for (const entry of report.skipped) {
    lines.push(`  skipped     ${entry.name || entry.fileId} — ${entry.reason}`);
  }
  for (const entry of report.released) {
    // NOT "put back". Putting a file back is the right call and it is still a
    // pass that shipped nothing, so it reads at the same volume as a failure.
    lines.push(`  NO ROOM     ${entry.name || entry.fileId} — ${entry.reason}`);
  }
  for (const entry of report.failed) {
    lines.push(`  FAILED      ${entry.name || entry.fileId} — ${entry.reason}`);
  }
  for (const entry of report.blocked) {
    lines.push(`  BLOCKED     ${entry.name || entry.fileId} — ${entry.reason}`);
  }
  for (const reason of report.unchecked) {
    lines.push(`  COULD NOT CHECK — ${typeof reason === 'string' ? reason : reason.reason}`);
  }
  if (!report.ingested.length && !report.deduped.length && !report.skipped.length
      && !report.failed.length && !report.blocked.length && !report.released.length
      && !report.unchecked.length) {
    // Landmine 17: an empty report that does not say WHY reads as a broken
    // one — and one that says the WRONG why is worse. "no ingest jobs were
    // waiting on the queue" was printed on a pass where a file was waiting and
    // simply not due yet, which is the opposite of nothing to do.
    const waiting = report.waiting;
    if (waiting && waiting.heldOff) {
      lines.push(
        `  Nothing was claimed — ${waiting.heldOff} ingest job(s) are waiting and not due yet`
        + `${waiting.nextDueInMs > 0 ? `, the next in ${humanDuration(waiting.nextDueInMs)}` : ''}.`
      );
    } else if (waiting && waiting.dueNow) {
      lines.push(
        `  Nothing was claimed — ${waiting.dueNow} ingest job(s) are waiting on the queue `
        + 'and were not picked up, which should not happen.'
      );
    } else {
      lines.push('  Nothing to do — no ingest jobs were waiting on the queue.');
    }
  }
  return lines.join('\n');
}

module.exports = {
  runIngest,
  ingestJob,
  formatIngestReport,
  // Exported for their own tests. Each is a decision that can be wrong on its
  // own, and driving them through a whole download to check one boundary is
  // how a test ends up asserting nothing in particular.
  downloadToPart,
  hashFile,
  freeBytesFor,
  cachePathsFor,
  findCachedFiles,
  PART_FILE_NAME,
  safeFileName,
  humanBytes,
  humanDuration,
  resolveCacheDir,
  resolveDiskFloorBytes,
  resolveDriveTimeouts,
  resolveProjectId,
  readJobPayload,
  holdingSessionTitle,
  ensureHoldingSession,
  realDriveClient,
  realCatalog,
  openDriveStream,
  getIngestMetadata,
  STAGE_INGEST,
  SUBJECT_DRIVE_FILE,
  STAGE_INGEST_HEALTH,
  SUBJECT_INGEST_HEALTH,
  HEALTH_NO_ROOM,
  DEFAULT_DISK_FLOOR_BYTES,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_DRIVE_TIMEOUT_MS,
  DEFAULT_DRIVE_STALL_MS,
  STATE_DOWNLOADED,
};
