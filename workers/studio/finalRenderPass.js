'use strict';

/**
 * The finished-video PASS — an approved rough cut, made again at full quality
 * on the Mini (Reel Spinner 5c, SC-840). What the command says is
 * finalRender.js; this file fetches, checks, runs and tidies.
 *
 *   watchApproved     a WATCHER (clock-driven, like the re-cut watch): every
 *                     minute it asks the catalog for `approved` edits and puts
 *                     one `final_render` job on the queue for each. The
 *                     website, where Dane presses Approve, cannot reach this
 *                     queue, so the status on the row is the request.
 *   finalRenderJob    one job, for one edit:
 *                       1. everything the video needs is read and checked
 *                          first — the YouTube title (the title card shows
 *                          it), the end card, the music — so nothing is
 *                          downloaded for a video that cannot be made;
 *                       2. the free space is checked against the original's
 *                          size plus the finished file's estimate BEFORE
 *                          anything is downloaded, and the job stops with the
 *                          numbers if there is not room;
 *                       3. the original comes back from Drive (the cache
 *                          sweep deletes originals once a recording is ready,
 *                          workers/studio/evict.js) into a folder of this
 *                          job's own, checked against Drive's md5;
 *                       4. the cards are drawn (cards.js), the music track is
 *                          fetched once and kept, and ffmpeg renders the
 *                          edit's own kept stretches from the original;
 *                       5. the finished file goes to ~/Studio/finished/
 *                          <edit id>.mp4, its length is checked, the edit
 *                          moves to `finished` with its music track, and is
 *                          read back;
 *                       6. the downloaded original is deleted — after a
 *                          render, and after a failure.
 *
 * THE FINISHED FILE IS NOT UPLOADED TO DRIVE (mentor24's storage is short).
 * It waits on this disk for the YouTube upload (6c), which deletes it after a
 * confirmed upload. `finishedPathsFor` is where 6c finds it, and the sidecar
 * beside it (`<edit id>.json`) says what it was made from.
 *
 * ONE RENDER AT A TIME. The daemon runs one job per tick, and ffmpeg runs
 * under spawnSync, so nothing else runs on this process while it renders.
 * That also means this process cannot beat while ffmpeg works, so the lease
 * is stretched up front to cover the download, the render and the writes
 * around them (the rule proxyPass.js explains). The download's own progress
 * beats carry that same stretch (a bare beat would cut the lease back to the
 * queue's five minutes), and the lease is stretched again right before ffmpeg
 * starts, to the render's own allowance, because ffmpeg runs after the
 * download, the music and the cards have all spent some of it.
 *
 * WHAT IS CHARGED TO THE EDIT, AND WHAT IS NOT (the line every Studio pass
 * draws). ffmpeg or the card browser missing, the catalog or Drive
 * unreachable, the disk too full, no YouTube title yet: facts about the
 * MACHINE or about timing. The job is put back with no attempt spent, and the
 * edit is left `approved`. A render ffmpeg refuses, a download that arrives
 * wrong, a finished file of the wrong length: this edit's. The job fails
 * through the queue's retries (the edit still stays `approved`, because the
 * store's only way out of `failed` is back to a draft, which would throw away
 * Dane's Approve). No end card or no usable music: blocked with the reason,
 * and the watcher tries again six hours later, so fixing the note is enough.
 * A render that FAILED every attempt the queue allows is different: nothing
 * outside the edit will change the answer, and each retry downloads the whole
 * original again. It stays held until the edit itself changes (its row's
 * updated_at moves past the job's: Dane sends it back and approves it again,
 * a new title, a new track). When it does, the exhausted job is stood down
 * (moved to done) before the new one is queued, so a later block with a
 * reason starts its own row and the six-hour retry applies to it again.
 *
 * WHAT HAPPENS TO THE FINISHED FILE. It is kept for 6c only when the edit
 * reaches `finished`. If the edit moved on while it rendered (Dane sent it
 * back), the file and its sidecar are deleted: nothing would ever upload or
 * remove them, and they would count against every later disk check. A job
 * whose lease was lost leaves the working folder alone, because it is named
 * after the edit and now belongs to whoever holds the job.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const plan = require('./finalRender.js');
const cards = require('./cards.js');
const music = require('./music.js');
const rough = require('./roughCutPass.js');
const { runFfmpeg, encodeTimeoutMs, FAILURES } = require('./proxy.js');
const { DEFAULT_MAX_ATTEMPTS } = require('./queue.js');
const videoEditsStore = require('../../lib/videoEditsStore.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoMomentsStore = require('../../lib/videoMomentsStore.js');
const videoAudioPairsStore = require('../../lib/videoAudioPairsStore.js');

const STAGE_FINAL_RENDER = 'final_render';
const STAGE_FINAL_RENDER_WATCH = 'final_render.watch';
const SUBJECT_VIDEO_EDIT = 'video_edit';
/** How often the watcher asks the catalog for approved edits. */
const FINAL_RENDER_WATCH_EVERY_MS = 60 * 1000;
const WATCH_LIMIT = 200;
/** A blocked job (no end card, no music) is queued again after this, so fixing the note is enough. */
const RETRY_BLOCKED_AFTER_MS = 6 * 60 * 60 * 1000;
/** Not the edit's fault: hold the job for the 15 minutes every Studio pass uses. */
const RELEASE_HOLD_MS = 15 * 60 * 1000;
/** Never render into the last 5 GB of the disk: other stages are downloading into it too. */
const DISK_MARGIN_BYTES = rough.DISK_MARGIN_BYTES;
/** A music track is a few megabytes; this is room for the longest on the shelf with plenty over. */
const MUSIC_ESTIMATE_BYTES = 30 * 1024 * 1024;
/** A download is allowed at least half an hour, and as long as 1 MB/s would take. */
const DOWNLOAD_FLOOR_MS = 30 * 60 * 1000;
const DOWNLOAD_SLOWEST_BYTES_PER_MS = 1024;
/** Full quality at `medium` is slower than the proxy settings encodeTimeoutMs was measured on. */
const RENDER_TIMEOUT_FACTOR = 3;
const LEASE_MARGIN_MS = 10 * 60 * 1000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function gb(bytes) {
  return `${(Number(bytes) / (1024 ** 3)).toFixed(1)} GB`;
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

/** `~/Studio/finished`, or `STUDIO_FINISHED_DIR`. */
function resolveFinishedDir(options = {}, env = process.env, homedir = os.homedir()) {
  return text(options.finishedDir) || text(env.STUDIO_FINISHED_DIR) || path.join(homedir, 'Studio', 'finished');
}

/** `~/Studio/music`, or `STUDIO_MUSIC_DIR`: the shelf's tracks, fetched once and kept. */
function resolveMusicDir(options = {}, env = process.env, homedir = os.homedir()) {
  return text(options.musicDir) || text(env.STUDIO_MUSIC_DIR) || path.join(homedir, 'Studio', 'music');
}

/** Where one edit's finished file lives (6c reads this), and the folder its job works in. */
function finishedPathsFor(finishedDir, editId) {
  const id = text(editId);
  const work = path.join(finishedDir, '.work', id);
  return {
    dir: finishedDir,
    video: path.join(finishedDir, `${id}.mp4`),
    sidecar: path.join(finishedDir, `${id}.json`),
    work,
    part: path.join(work, 'render.part.mp4'),
    script: path.join(work, 'filter.txt'),
    titleCard: path.join(work, 'title-card.png'),
    endCard: path.join(work, 'end-card.png'),
  };
}

function realCatalog() {
  return {
    getEditById: videoEditsStore.getEditById,
    listEditsByStatus: videoEditsStore.listEditsByStatus,
    listEditsForSource: videoEditsStore.listEditsForSource,
    moveEdit: videoEditsStore.moveEdit,
    getSourceById: videoSourcesStore.getSourceById,
    getMomentsBySource: videoMomentsStore.getMomentsBySource,
    listAudioPairsForSource: videoAudioPairsStore.listAudioPairsForSource,
  };
}

/** Drive's file facts and bytes, the same calls ingest uses (workers/studio/ingest.js). */
function realDriveMedia() {
  return require('./ingest.js').realDriveClient();
}

function realShelf() {
  return require('../../lib/studioMusicShelf.js').loadShelf();
}

function realReadEndCards(args) {
  return cards.readEndCards(args);
}

/** ffprobe's JSON for a file. `{ ok, data }` or `{ ok: false, why }`. */
function realProbe(file, { run = spawnSync, bin = process.env.STUDIO_FFPROBE || 'ffprobe' } = {}) {
  const res = run(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8', timeout: 60 * 1000, maxBuffer: 32 * 1024 * 1024,
  });
  if (res && res.error && res.error.code === 'ENOENT') return { ok: false, machine: true, why: `${bin} is not installed or not on PATH` };
  if (!res || Number(res.status) !== 0) return { ok: false, why: text(res && res.stderr) || `${bin} exited ${res && res.status}` };
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch (err) {
    return { ok: false, why: `${bin} printed something that is not JSON: ${err.message}` };
  }
}

/** How long the PICTURE of a file runs (not the container, which the sound can stretch). */
function realPictureDuration(file, { run = spawnSync, bin = process.env.STUDIO_FFPROBE || 'ffprobe' } = {}) {
  const res = run(bin, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8', timeout: 60 * 1000,
  });
  const value = Number(text(res && res.stdout).split('\n')[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Draw both cards to PNGs with the Chromium the UI harness uses. A browser
 * that will not start is the machine's (`machine: true`); a card that spilled
 * is refused by cards.js and is this edit's.
 */
async function realDrawCards({ titleHtml, endHtml, titleCardPath, endCardPath }) {
  let browser;
  try {
    browser = await cards.openBrowser();
  } catch (err) {
    return { ok: false, machine: true, why: `the browser that draws the cards would not start (${err.message}). Fix: npx playwright install chromium in ~/Studio` };
  }
  try {
    const title = await cards.renderCard({ html: titleHtml, outFile: titleCardPath, browser });
    if (!title.ok) return { ok: false, why: `the title card: ${title.reason}` };
    const end = await cards.renderCard({ html: endHtml, outFile: endCardPath, browser });
    if (!end.ok) return { ok: false, why: `the end card: ${end.reason}` };
    return { ok: true };
  } finally {
    await browser.close().catch(() => {});
  }
}

function enqueueFinalRender(queue, { editId, why = '' }) {
  const id = text(editId);
  if (!id) throw new Error('enqueueFinalRender needs an edit id');
  return queue.enqueue({
    stage: STAGE_FINAL_RENDER,
    subjectKind: SUBJECT_VIDEO_EDIT,
    subjectId: id,
    payload: { editId: id, ...(text(why) ? { why: text(why) } : {}) },
  });
}

/**
 * Did this blocked job get there by FAILING every attempt the queue allows,
 * rather than by being blocked with a reason? Only failures spend attempts.
 */
function exhaustedFailure(job, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return Number(job && job.attempts) >= Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);
}

/** The edit's last change, in ms, or null when the row's updated_at does not read as a time. */
function editChangedAt(edit) {
  const at = Date.parse(text(edit && edit.updatedAt));
  return Number.isFinite(at) ? at : null;
}

/**
 * Should a watcher leave this edit alone because of a BLOCKED job for it on
 * `stage`? The reason (a string) when it should, null when it may be queued.
 * Shared by every watcher that queues one job per edit (final render, upload),
 * so "gave up after every attempt" means the same thing in each:
 *
 *   - a job that FAILED every attempt the queue allows holds the edit until
 *     the edit itself changes; retrying it every six hours would do the same
 *     work to fail the same way;
 *   - when the edit HAS changed since, that exhausted row is stood down
 *     (queue.clearBlock) before a new job is queued. queue.block() writes onto
 *     the subject's existing blocked row, so left in place, a later reasoned
 *     block would land on it, keep its attempts and stamp it newer than the
 *     edit, and the edit would never come back;
 *   - a job blocked WITH A REASON holds it for six hours (RETRY_BLOCKED_AFTER_MS).
 */
function blockedHold({ queue, stage, blocked, edit, now = Date.now, maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
  const id = text(edit && edit.id);
  const mine = blocked.filter((j) => text(j.subjectId).toLowerCase() === id.toLowerCase());
  const changedAt = editChangedAt(edit);
  const gaveUp = mine.find((j) => exhaustedFailure(j, maxAttempts)
    && (changedAt == null || changedAt <= Number(j.updatedAt)));
  if (gaveUp) {
    return `its job ${gaveUp.id} failed all ${gaveUp.attempts} attempts (${gaveUp.lastError}); it is not tried again until the edit changes`
      + (changedAt == null ? ' (and the edit\'s last change could not be read, so it stays held)' : '');
  }
  const outlived = changedAt != null
    && mine.some((j) => exhaustedFailure(j, maxAttempts) && changedAt > Number(j.updatedAt));
  if (outlived) {
    queue.clearBlock({ stage, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: text(mine[0].subjectId) || id });
    return null;
  }
  const held = mine.find((j) => !exhaustedFailure(j, maxAttempts) && now() - Number(j.updatedAt) < RETRY_BLOCKED_AFTER_MS);
  return held ? `its job ${held.id} is blocked: ${held.lastError}` : null;
}

/**
 * The watcher. An edit whose job was BLOCKED in the last six hours is left
 * alone: its reason is in the queue, and queueing it every minute would read
 * the same notes for the same answer. An edit whose render FAILED every
 * attempt is left alone until the edit itself changes: retrying it every six
 * hours re-downloads the whole original to fail the same way again.
 */
async function watchApproved({ queue, env = process.env, options = {}, catalog = realCatalog(), now = Date.now, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  const scope = scopeFor(options, env);
  if (!scope) return { ok: true, processed: [], skipped: [], failed: [], notConfigured: 'STUDIO_PROJECT_ID is not set' };
  const approved = await catalog.listEditsByStatus(WATCH_LIMIT, ['approved'], scope);
  if (!approved.ok) return { ok: false, processed: [], skipped: [], failed: [], error: `approved edits could not be read: ${approved.error}` };
  const blocked = queue.listJobs({ stage: STAGE_FINAL_RENDER, state: 'blocked' });
  const processed = [];
  const skipped = [];
  for (const edit of approved.data) {
    const id = text(edit.id);
    const hold = blockedHold({ queue, stage: STAGE_FINAL_RENDER, blocked, edit, now, maxAttempts });
    if (hold) {
      skipped.push({ editId: id, why: hold });
      continue;
    }
    const { job, created } = enqueueFinalRender(queue, { editId: id, why: 'approved' });
    if (created) processed.push({ editId: id, jobId: job.id });
    else skipped.push({ editId: id, why: `job ${job.id} is already waiting` });
  }
  return { ok: true, processed, skipped, failed: [], truncated: approved.data.length >= WATCH_LIMIT };
}

/** The track the previous edit of the same recording got, for music.js rule 2. */
function previousTrackOf(edits, editId) {
  const list = Array.isArray(edits) ? edits : [];
  const at = list.findIndex((e) => text(e.id) === text(editId));
  const before = (at < 0 ? list : list.slice(0, at)).filter((e) => text(e.musicTrack));
  return before.length ? text(before[before.length - 1].musicTrack) : '';
}

/** What a render is made from. Two renders with the same fingerprint are the same file. */
function renderFingerprint(facts) {
  return crypto.createHash('sha256').update(JSON.stringify({ v: plan.RENDER_VERSION, ...facts })).digest('hex').slice(0, 16);
}

/** A finished file from an earlier try, if it was made from exactly this. */
function keptFinished(paths, fingerprint, io = fs) {
  try {
    const side = JSON.parse(io.readFileSync(paths.sidecar, 'utf8'));
    const size = io.statSync(paths.video).size;
    if (side && side.fingerprint === fingerprint && size > 0 && side.bytes === size) return side;
  } catch {
    // No sidecar, no file, or a sidecar that does not parse: nothing to reuse.
  }
  return null;
}

/**
 * Bring one Drive file down to `dest`, checked against Drive's size and md5.
 * `{ ok, bytes }`, or `{ ok: false, machine, leaseLost, why }`.
 */
async function fetchFromDrive({ driveMedia, driveFileId, dest, onProgress, io = fs }) {
  const ingest = require('./ingest.js');
  const meta = await driveMedia.getMetadata(driveFileId);
  if (!meta.ok) {
    const gone = meta.status === 404;
    return { ok: false, machine: !gone, gone, why: `Drive could not describe file ${driveFileId}: ${meta.error}` };
  }
  if (meta.data && meta.data.trashed) return { ok: false, gone: true, why: `Drive file ${driveFileId} is in the trash` };
  const expected = Number(meta.data && meta.data.size);
  const md5 = text(meta.data && meta.data.md5Checksum).toLowerCase();
  if (!(expected > 0) || !md5) return { ok: false, gone: true, why: `Drive gives no size or md5 for file ${driveFileId}, so a download of it could not be checked` };
  const part = `${dest}.part`;
  io.mkdirSync(path.dirname(dest), { recursive: true });
  const got = await ingest.downloadToPart({ drive: driveMedia, driveFileId, partPath: part, expectedBytes: expected, onProgress });
  if (!got.ok) return { ok: false, machine: !got.leaseLost, leaseLost: Boolean(got.leaseLost), why: got.error };
  if (got.bytes !== expected) return { ok: false, why: `the download came to ${got.bytes} bytes, but Drive says the file is ${expected}` };
  const digests = await ingest.hashFile(part);
  if (digests.md5.toLowerCase() !== md5) {
    rough.removeQuietly(part, io);
    return { ok: false, why: `the download does not match Drive's md5 (Drive says ${md5}, what arrived hashes to ${digests.md5})` };
  }
  io.renameSync(part, dest);
  return { ok: true, bytes: expected };
}

/**
 * Make one approved edit's finished video. The caller owns the claim; this
 * never claims. Every return says what happened (`outcome`: finished |
 * moved_on | failed | blocked | outage | lost) and what the queue was told.
 */
async function finalRenderJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  driveMedia = realDriveMedia(),
  options = {},
  env = process.env,
  ffmpeg = runFfmpeg,
  probe = realProbe,
  pictureDuration = realPictureDuration,
  drawCards = realDrawCards,
  readEndCards = realReadEndCards,
  shelf = null,
  exists = fs.existsSync,
  freeBytes = (dir) => require('./ingest.js').freeBytesFor(dir),
  io = fs,
  clock = Date.now,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const editId = text(payload.editId) || text(job && job.subjectId);
  const base = { jobId: job.id, editId };
  const scope = scopeFor(options, env);
  const finishedDir = resolveFinishedDir(options, env);
  const musicDir = resolveMusicDir(options, env);

  let leaseLost = false;
  const lostIt = (reason) => {
    leaseLost = true;
    return { ...base, outcome: 'lost', jobAction: 'none', reason };
  };
  const completeIt = (outcome, reason, extra = {}) => {
    const completed = queue.complete(job.id, owner);
    return { ...base, ...extra, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };
  const releaseIt = (reason, extra = {}) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: RELEASE_HOLD_MS })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, ...extra, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };
  const blockIt = (reason) => {
    queue.block({ stage: STAGE_FINAL_RENDER, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: editId || text(job.subjectId) || 'unknown', reason, payload: job.payload || null, jobId: job.id });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const failIt = (reason, extra = {}) => {
    queue.fail(job.id, owner, reason);
    return { ...base, ...extra, outcome: 'failed', jobAction: 'failed', reason };
  };

  if (!editId) return blockIt('this finished-video job names no edit, so there is nothing to render');
  if (!scope) return blockIt('STUDIO_PROJECT_ID is not set, so the edit cannot be read in its project. Fix: set STUDIO_PROJECT_ID.');

  // ── 1. Everything the video needs, read and checked before any download ──
  const read = await catalog.getEditById(editId, scope);
  if (!read.ok) return releaseIt(`edit ${editId} could not be read: ${read.error}`);
  if (!read.data || !text(read.data.id)) return completeIt('moved_on', `edit ${editId} is not in the catalog any more`);
  const edit = read.data;
  if (edit.status !== 'approved') return completeIt('moved_on', `edit ${editId} is ${edit.status}, not approved, so there is nothing to finish`);
  const sourceId = text(edit.sourceId);
  Object.assign(base, { sourceId, kind: edit.kind });
  const ranges = Array.isArray(edit.keepRanges) ? edit.keepRanges : [];
  if (!ranges.length) return blockIt(`edit ${editId} keeps nothing, so there is nothing to render. Fix: send it back with a note`);

  const title = text(edit.youtubeTitle);
  if (!title) {
    return releaseIt(`edit ${editId} has no YouTube title yet, and the title card shows it. `
      + 'The YouTube-text pass writes one within minutes (or Dane types it on the card); this is tried again in 15 minutes');
  }

  const sourceRes = await catalog.getSourceById(sourceId, scope);
  if (!sourceRes.ok) {
    if (sourceRes.status === 404) return blockIt(`source ${sourceId} is not in the catalog any more, so there is no original to render from`);
    return releaseIt(`source ${sourceId} could not be read: ${sourceRes.error}`);
  }
  const source = sourceRes.data;

  const momentsRes = await catalog.getMomentsBySource(sourceId, scope);
  if (!momentsRes.ok) return releaseIt(`the moments of source ${sourceId} could not be read: ${momentsRes.error}`);
  const moments = momentsRes.data && Array.isArray(momentsRes.data.moments) ? momentsRes.data.moments : [];

  const which = cards.endCardProjectFor(edit, moments);
  if (!which.ok) return blockIt(`it has no end card: ${which.reason}`);
  const endCards = await readEndCards({ projectId: scope.projectId });
  if (!endCards || !endCards.ok) {
    const why = text(endCards && endCards.reason);
    if (/could not read/i.test(why)) return releaseIt(`the end-cards note could not be read: ${why}`);
    return blockIt(`${why || 'the end-cards note could not be read'}, so the video has no end card`);
  }
  const card = cards.endCardFor(which.project, endCards.cards);
  if (!card.ok) return blockIt(`${card.reason}, so the video has no end card. Add a line for ${which.project} to that note`);
  const titleLaid = cards.titleCard(title);
  if (!titleLaid.ok) return blockIt(`the title card could not be laid out: ${titleLaid.reason}`);
  const endLaid = cards.endCard(card.card);
  if (!endLaid.ok) return blockIt(`the end card could not be laid out: ${endLaid.reason}`);

  let musicShelf = shelf;
  if (!musicShelf) {
    try { musicShelf = realShelf(); } catch (err) { return blockIt(`the music shelf could not be read (${err.message})`); }
  }
  let trackId = text(edit.musicTrack);
  let musicNote = '';
  if (!trackId) {
    const siblings = await catalog.listEditsForSource(sourceId, scope);
    if (!siblings.ok) return releaseIt(`the other edits of source ${sourceId} could not be read: ${siblings.error}`);
    const mood = edit.kind === 'short'
      ? text(moments[edit.momentIndex] && moments[edit.momentIndex].mood)
      : music.moodForMoments(moments);
    const picked = music.pickTrack({
      shelf: musicShelf, mood, lengthS: plan.expectedLengthS(ranges),
      previousTrackId: previousTrackOf(siblings.data, editId), seed: editId,
    });
    if (!picked.ok) return blockIt(picked.reason);
    trackId = picked.trackId;
    musicNote = picked.note;
  }
  const track = (Array.isArray(musicShelf.tracks) ? musicShelf.tracks : []).find((t) => t && t.id === trackId);
  if (!track || !text(track.driveFileId) || !text(track.fileName)) {
    return blockIt(`the edit's music "${trackId}" is not on the music shelf with a Drive file, so it cannot be mixed in`);
  }
  Object.assign(base, { musicTrack: trackId, ...(musicNote ? { musicNote } : {}), endCardProject: which.project });

  // The sound the row names: the recording's own, or the lined-up partner's
  // working copy (the partner's original is not fetched; see docs/STUDIO.md).
  const pairsRes = await catalog.listAudioPairsForSource(sourceId, scope);
  if (!pairsRes.ok) return releaseIt(`the line-ups of source ${sourceId} could not be read: ${pairsRes.error}`);
  const shift = rough.soundShift(sourceId, edit.audioSourceId, pairsRes.data);
  if (!shift.ok) return blockIt(shift.why);
  let partnerSound = '';
  if (text(edit.audioSourceId) && text(edit.audioSourceId).toLowerCase() !== sourceId.toLowerCase()) {
    const other = await catalog.getSourceById(edit.audioSourceId, scope);
    if (!other.ok) return releaseIt(`the sound's recording ${edit.audioSourceId} could not be read: ${other.error}`);
    partnerSound = text(other.data && other.data.proxyPath);
    if (!partnerSound || !exists(partnerSound)) {
      return blockIt(`the edit uses the sound of recording ${edit.audioSourceId}, whose working copy is not on this disk (${partnerSound || 'no proxy path'})`);
    }
  }

  const paths = finishedPathsFor(finishedDir, editId);
  const musicPath = path.join(musicDir, path.basename(text(track.fileName)));
  const fingerprint = renderFingerprint({
    ranges, shiftS: shift.shiftS, sound: text(edit.audioSourceId) || sourceId, original: text(source.driveFileId) || text(source.localPath),
    title, endCard: card.card, music: trackId,
  });

  // A finished file from an earlier try whose catalog write failed: only the write is left.
  let rendered = keptFinished(paths, fingerprint, io);

  const ffmpegCheck = ffmpeg(['-hide_banner', '-version'], { timeoutMs: 30 * 1000 });
  if (!rendered && !ffmpegCheck.ok && ffmpegCheck.reason === FAILURES.FFMPEG_MISSING) {
    return releaseIt('ffmpeg is not installed or not on PATH on this machine, so nothing was downloaded or rendered. Fix: brew install ffmpeg.');
  }

  // ── 2. Room on the disk, before anything is downloaded ──────────────────
  const renderTimeoutMs = RENDER_TIMEOUT_FACTOR * encodeTimeoutMs(plan.expectedLengthS(ranges));
  const renderLeaseMs = renderTimeoutMs + LEASE_MARGIN_MS;
  let leaseMs = renderLeaseMs;
  const cached = text(source.localPath);
  const driveFileId = text(source.driveFileId);
  let originalPath = '';
  let originalIsOurs = false;
  if (!rendered) {
    if (cached && exists(cached)) {
      // Still in the cache (ingest only ever renames a COMPLETE, md5-checked
      // download into place): used where it is, and never deleted by this job.
      originalPath = cached;
    } else if (!driveFileId) {
      return blockIt(`source ${sourceId} has no Drive file id and its original is not on this disk, so there is nothing at full quality to render from`);
    }
    let originalBytes = 0;
    if (!originalPath) {
      const meta = await driveMedia.getMetadata(driveFileId);
      if (!meta.ok) {
        if (meta.status === 404) return blockIt(`the original of source ${sourceId} is not on Drive any more (file ${driveFileId})`);
        return releaseIt(`Drive could not describe the original of source ${sourceId}: ${meta.error}`);
      }
      originalBytes = Number(meta.data && meta.data.size) || 0;
    }
    const outputBytes = plan.estimateOutputBytes({ ranges, width: source.width, height: source.height, fps: source.fps });
    const musicBytes = exists(musicPath) ? 0 : MUSIC_ESTIMATE_BYTES;
    const need = originalBytes + outputBytes + musicBytes + DISK_MARGIN_BYTES;
    io.mkdirSync(finishedDir, { recursive: true });
    const free = freeBytes(finishedDir);
    if (!free || !free.ok) return releaseIt(`the free space where finished videos are made (${finishedDir}) could not be read: ${free && free.error}`);
    Object.assign(base, { disk: { freeBytes: free.value, originalBytes, outputBytes, marginBytes: DISK_MARGIN_BYTES } });
    if (free.value < need) {
      return releaseIt(`the disk is too full to make this finished video: ${gb(free.value)} free where finished videos are made `
        + `(${finishedDir}), and it needs ${gb(need)} — ${originalPath ? 'the original is already on this disk' : `the original is ${gb(originalBytes)}`}, `
        + `the finished file about ${gb(outputBytes)}, plus the ${gb(DISK_MARGIN_BYTES)} always left free. `
        + 'Nothing was downloaded and the edit was left approved. Fix: free some space on the Mini.');
    }

    // The lease covers the download, the render and the writes around them.
    leaseMs = (originalPath ? 0 : Math.max(DOWNLOAD_FLOOR_MS, Math.ceil(originalBytes / DOWNLOAD_SLOWEST_BYTES_PER_MS)))
      + renderLeaseMs;
    if (!queue.heartbeat(job.id, owner, { leaseMs })) {
      return lostIt(`the lease on job ${job.id} was no longer this worker's, so the render was left to whoever holds it`);
    }
  }

  try {
    if (!rendered) {
      // ── 3. The original, the music, the cards ────────────────────────────
      io.mkdirSync(paths.work, { recursive: true });
      if (!originalPath) {
        const ext = path.extname(cached).replace(/[^.A-Za-z0-9]/g, '') || '.mov';
        const dest = path.join(paths.work, `original${ext}`);
        originalIsOurs = true;
        const started = clock();
        const got = await fetchFromDrive({
          driveMedia, driveFileId, dest, io,
          // Each beat keeps the whole stretch: a bare beat resets the lease to the queue's default.
          onProgress: async () => queue.heartbeat(job.id, owner, { leaseMs }) !== false,
        });
        if (!got.ok) {
          if (got.leaseLost) return lostIt(`the lease on job ${job.id} was lost during the download`);
          if (got.gone) return blockIt(`the original of source ${sourceId} could not be fetched: ${got.why}`);
          if (got.machine) return releaseIt(`the original of source ${sourceId} could not be downloaded: ${got.why}. The partial download was deleted`);
          return failIt(`the original of source ${sourceId} arrived wrong: ${got.why}`);
        }
        originalPath = dest;
        Object.assign(base, { download: { bytes: got.bytes, ms: clock() - started } });
      }
      if (!exists(musicPath)) {
        const got = await fetchFromDrive({ driveMedia, driveFileId: text(track.driveFileId), dest: musicPath, io });
        if (!got.ok) {
          if (got.gone) return blockIt(`the music track "${trackId}" could not be fetched from Drive: ${got.why}`);
          if (got.machine) return releaseIt(`the music track "${trackId}" could not be downloaded: ${got.why}`);
          return failIt(`the music track "${trackId}" arrived wrong: ${got.why}`);
        }
      }
      const facts = probe(originalPath);
      if (!facts.ok) {
        if (facts.machine) return releaseIt(`the original could not be measured: ${facts.why}. Fix: brew install ffmpeg`);
        return failIt(`the original of source ${sourceId} could not be measured: ${facts.why}`);
      }
      const picture = plan.pictureFacts(facts.data);
      if (!picture.ok) return failIt(`the original of source ${sourceId}: ${picture.why}`);
      Object.assign(base, { width: picture.width, height: picture.height, rate: picture.rate, ...(picture.hdr ? { hdr: 'the original is HDR; it was made in ordinary colour without tone-mapping' } : {}) });

      const drawn = await drawCards({ titleHtml: titleLaid.html, endHtml: endLaid.html, titleCardPath: paths.titleCard, endCardPath: paths.endCard });
      if (!drawn.ok) return drawn.machine ? releaseIt(drawn.why) : failIt(`the cards could not be drawn: ${drawn.why}`);
      const notes = [...(titleLaid.notes || []), ...(endLaid.notes || [])];
      if (notes.length) base.cardNotes = notes;

      // ── 4. The render ────────────────────────────────────────────────────
      const soundPath = partnerSound || originalPath;
      const inputs = plan.inputsFor({ picturePath: originalPath, soundPath, titleCardPath: paths.titleCard, endCardPath: paths.endCard, musicPath, rate: picture.rate });
      io.writeFileSync(paths.script, plan.filterScript({ ranges, shiftS: shift.shiftS, width: picture.width, height: picture.height, rate: picture.rate, inputs }));
      rough.removeQuietly(paths.part, io);
      // ffmpeg runs under spawnSync and cannot beat, so the lease is sized to
      // the render NOW, after the download, the music and the cards.
      if (!queue.heartbeat(job.id, owner, { leaseMs: renderLeaseMs })) {
        return lostIt(`the lease on job ${job.id} was lost before the render started, so it was left to whoever holds it`);
      }
      const ran = ffmpeg(plan.renderArgs({
        picturePath: originalPath, soundPath, titleCardPath: paths.titleCard, endCardPath: paths.endCard, musicPath,
        scriptPath: paths.script, outPath: paths.part, rate: picture.rate, fps: picture.fps,
      }), { timeoutMs: renderTimeoutMs });
      if (!ran.ok) {
        if (ran.reason === FAILURES.FFMPEG_MISSING) return releaseIt('ffmpeg went missing mid-run. Fix: brew install ffmpeg.');
        const detail = text(ran.detail);
        return failIt(`ffmpeg could not render it: ${detail.length > 1500 ? `…${detail.slice(-1500)}` : detail}`);
      }
      const lengthS = pictureDuration(paths.part);
      const length = plan.lengthCheck({ ranges, fps: picture.fps, actualS: lengthS });
      if (!length.ok) return failIt(`the finished video is the wrong length: ${length.why}. It was deleted`, { length });
      io.renameSync(paths.part, paths.video);
      rendered = {
        fingerprint, editId, sourceId, kind: edit.kind, bytes: io.statSync(paths.video).size,
        lengthS: length.actualS, expectedLengthS: length.expectedS, offS: length.offS, renderMs: ran.ms,
        width: picture.width, height: picture.height, rate: picture.rate,
        musicTrack: trackId, endCardProject: which.project, title,
      };
      io.writeFileSync(paths.sidecar, JSON.stringify(rendered, null, 2));
    } else {
      base.renderReused = true;
    }
    Object.assign(base, { file: paths.video, bytes: rendered.bytes, lengthS: rendered.lengthS, expectedLengthS: rendered.expectedLengthS, renderMs: rendered.renderMs });

    // ── 5. The edit moves to finished, and is read back ────────────────────
    const moved = await catalog.moveEdit(editId, 'finished', { musicTrack: trackId }, scope);
    if (!moved.ok) {
      if (moved.status === 409) {
        // Nothing uploads or deletes a finished file whose edit is not
        // `finished`, so it goes now rather than filling the disk forever.
        rough.removeQuietly(paths.video, io);
        rough.removeQuietly(paths.sidecar, io);
        return completeIt('moved_on', `edit ${editId} moved while it was being finished (${moved.error}); the finished file was deleted, since nothing would ever upload it`);
      }
      return releaseIt(`the finished video is made (${paths.video}), but edit ${editId} could not be marked finished: ${moved.error}. The file is kept and reused`);
    }
    const back = await catalog.getEditById(editId, scope);
    if (!back.ok) {
      // The write went through; only the read-back did not answer. That is the
      // machine's, not the edit's: the retry finds the edit finished and stops.
      return releaseIt(`edit ${editId} was marked finished, but reading it back failed: ${back.error}. The file is kept at ${paths.video}`);
    }
    if (!back.data || back.data.status !== 'finished' || text(back.data.musicTrack) !== trackId) {
      const why = `it read back as "${text(back.data && back.data.status)}" with music "${text(back.data && back.data.musicTrack)}"`;
      return failIt(`edit ${editId} was marked finished but did not read back that way: ${why}. The file is kept at ${paths.video}`);
    }
    return completeIt('finished', `finished video ready for YouTube: ${paths.video}`);
  } finally {
    // ── 6. The downloaded original goes, after a render and after a failure ─
    if (leaseLost) {
      // The working folder is named after the edit, so it is the new holder's now.
    } else if (originalIsOurs) {
      io.rmSync(paths.work, { recursive: true, force: true });
      // And the `.work` folder itself once nothing else is in it.
      try { io.rmdirSync(path.dirname(paths.work)); } catch { /* another job's folder is in it, or it is gone */ }
    }
    else {
      rough.removeQuietly(paths.part, io);
      rough.removeQuietly(paths.script, io);
      rough.removeQuietly(paths.titleCard, io);
      rough.removeQuietly(paths.endCard, io);
    }
  }
}

/**
 * Claim and finish up to `max` jobs. The daemon calls it with `max: 1`: one
 * render at a time, and the daemon must get back to the other stages.
 */
async function runFinalRender(options = {}) {
  const { queue, owner = `finalrender-${process.pid}`, max = 1 } = options;
  if (!queue) throw new Error('runFinalRender needs a queue (workers/studio/queue.js)');
  const report = { owner, finished: [], movedOn: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_FINAL_RENDER] });
    if (!job) break;
    let result;
    try {
      result = await finalRenderJob({ ...options, queue, job, owner, options });
    } catch (err) {
      const reason = `making this edit's finished video threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, editId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      finished: report.finished, moved_on: report.movedOn, failed: report.failed,
      blocked: report.blocked, outage: report.released, lost: report.lost,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runFinalRender,
  finalRenderJob,
  watchApproved,
  enqueueFinalRender,
  finishedPathsFor,
  resolveFinishedDir,
  resolveMusicDir,
  previousTrackOf,
  exhaustedFailure,
  blockedHold,
  realCatalog,
  realProbe,
  realPictureDuration,
  realDrawCards,
  STAGE_FINAL_RENDER,
  STAGE_FINAL_RENDER_WATCH,
  SUBJECT_VIDEO_EDIT,
  FINAL_RENDER_WATCH_EVERY_MS,
  RETRY_BLOCKED_AFTER_MS,
  RELEASE_HOLD_MS,
  DISK_MARGIN_BYTES,
};
