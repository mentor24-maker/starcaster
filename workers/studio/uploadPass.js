'use strict';

/**
 * The YouTube upload PASS — a finished video goes up to Dane of Earth as
 * PRIVATE (Reel Spinner 6c, SC-842). Dane makes it public himself, with one
 * click in YouTube Studio (his choice, 2026-11-16). The calls are
 * youtubeUpload.js; this file decides when, with what text, and tidies.
 *
 *   watchFinished   a WATCHER, like the finished-video watch: every minute it
 *                   asks the catalog for `finished` edits (and `uploading`
 *                   ones, which a restart left mid-way) and queues one
 *                   `upload` job each.
 *   uploadJob       one job, for one edit:
 *                     1. the edit, its finished file (finalRenderPass.js
 *                        `finishedPathsFor`) and the text it goes up with are
 *                        read and checked first;
 *                     2. a fresh sign-in, and — before a NEW upload — a check
 *                        that it belongs to Dane of Earth;
 *                     3. the edit moves to `uploading` (its text is locked
 *                        from here, so what goes up is what he approved);
 *                     4. the file goes up through a RESUMABLE upload whose
 *                        address is saved beside the file first
 *                        (`<edit id>.upload.json`), so a dropped connection
 *                        or a restart resumes from the byte YouTube has;
 *                     5. the video is read back from YouTube until it is
 *                        there, Private, and not rejected;
 *                     6. the edit moves to `on_youtube` with the video's id,
 *                        and is read back;
 *                     7. ONLY THEN the finished file, its sidecar and the
 *                        session note are deleted.
 *
 * A FILE IS NEVER DELETED BEFORE YOUTUBE CONFIRMS IT. Every way out before
 * step 7 leaves the finished file where it is. A failed or unconfirmed upload
 * keeps it; a refused one keeps it too (the edit is `failed`, and Dane can
 * look at what was refused).
 *
 * A RETRY NEVER UPLOADS TWICE. The video id is written into the session note
 * the moment YouTube names it, so a try whose catalog write failed comes back,
 * finds the id, skips the upload and only does the writes. A saved session
 * that is still open is asked how far it got and carried on.
 *
 * WHAT IS CHARGED TO THE EDIT, AND WHAT IS NOT (the line every Studio pass
 * draws):
 *   - the day's upload allowance used up: put back until it resets (midnight
 *     Pacific, 1 AM Mountain) with NO attempt spent, and the log says so;
 *   - the sign-in refused, or it belongs to another channel: stopped, put back
 *     for an hour with no attempt spent, and the bus hears once per six hours
 *     with the fix (`reel-spinner-youtube-upload`, scripts/report_job_failure.mjs);
 *     the next good sign-in clears it;
 *   - no answer, a YouTube 5xx, the catalog unreachable: put back for 15
 *     minutes, no attempt spent; the upload resumes where it stopped;
 *   - YouTube refused THIS upload (a 4xx about the video, or a rejection on
 *     read-back): the edit moves to `failed` with YouTube's reason, starting
 *     `YouTube refused the upload: ` so the Rough cuts card keeps showing it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const yt = require('./youtubeUpload.js');
const copy = require('./youtubeCopy.js');
const cards = require('./cards.js');
const { finishedPathsFor, resolveFinishedDir } = require('./finalRenderPass.js');
const { EXPECTED_CHANNEL } = require('../../lib/youtubeUploadAccess.js');
const videoEditsStore = require('../../lib/videoEditsStore.js');
const videoMomentsStore = require('../../lib/videoMomentsStore.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STAGE_UPLOAD = 'upload';
const STAGE_UPLOAD_WATCH = 'upload.watch';
const SUBJECT_VIDEO_EDIT = 'video_edit';
const ALARM_JOB = 'reel-spinner-youtube-upload';
const UPLOAD_WATCH_EVERY_MS = 60 * 1000;
const WATCH_LIMIT = 200;
/** A blocked job is queued again after this. */
const RETRY_BLOCKED_AFTER_MS = 6 * 60 * 60 * 1000;
/** The machine's problem: tried again in 15 minutes, no attempt spent. */
const RELEASE_HOLD_MS = 15 * 60 * 1000;
/** A refused sign-in: tried again hourly (the bus hears once per six hours). */
const AUTH_HOLD_MS = 60 * 60 * 1000;
/** Each piece's beat keeps the lease this long: far more than one 8 MB piece takes. */
const PIECE_LEASE_MS = 15 * 60 * 1000;
/** YouTube's read can lag its own write (docs/STUDIO.md): read back for up to this long. */
const READ_BACK_TRIES = 7;
const READ_BACK_WAIT_MS = 5 * 1000;
/** People & Blogs, what the 6b test upload used. */
const CATEGORY_ID = '22';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

/** The session note beside the finished file: `<finished>/<edit id>.upload.json`. */
function uploadPathsFor(finishedDir, editId) {
  const paths = finishedPathsFor(finishedDir, editId);
  return { ...paths, session: path.join(finishedDir, `${text(editId)}.upload.json`) };
}

function readJson(file, io = fs) {
  try { return JSON.parse(io.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value, io = fs) {
  const part = `${file}.part`;
  io.writeFileSync(part, JSON.stringify(value, null, 2));
  io.renameSync(part, file);
}

function removeQuietly(file, io = fs) {
  try { io.rmSync(file, { force: true }); } catch { /* already gone */ }
}

function realCatalog() {
  return {
    getEditById: videoEditsStore.getEditById,
    listEditsByStatus: videoEditsStore.listEditsByStatus,
    moveEdit: videoEditsStore.moveEdit,
    getMomentsBySource: videoMomentsStore.getMomentsBySource,
  };
}

function realShelf() {
  return require('../../lib/studioMusicShelf.js').loadShelf();
}

/** The alarm, through scripts/report_job_failure.mjs (its own six-hour throttle). */
function realAlarm(reason, { run = spawnSync, env = process.env } = {}) {
  const res = run(process.execPath, [
    path.join(REPO_ROOT, 'scripts', 'report_job_failure.mjs'),
    '--job', ALARM_JOB, '--status', 'stopped', '--reason', reason,
  ], { env, encoding: 'utf8', timeout: 60 * 1000 });
  return { said: text(res && (res.stderr || res.stdout)) || (res && res.error ? res.error.message : '') };
}

function realClearAlarm() {
  try {
    const { heartbeatDir } = require('../../lib/nodeHeartbeat.js');
    fs.rmSync(path.join(heartbeatDir(), `failed-${ALARM_JOB}.stamp`), { force: true });
  } catch {
    // Not clearing a throttle stamp costs one quiet window at most.
  }
}

function enqueueUpload(queue, { editId, why = '' }) {
  const id = text(editId);
  if (!id) throw new Error('enqueueUpload needs an edit id');
  return queue.enqueue({
    stage: STAGE_UPLOAD,
    subjectKind: SUBJECT_VIDEO_EDIT,
    subjectId: id,
    payload: { editId: id, ...(text(why) ? { why: text(why) } : {}) },
  });
}

/** The watcher. An edit whose job was blocked in the last six hours is left alone. */
async function watchFinished({ queue, env = process.env, options = {}, catalog = realCatalog(), now = Date.now } = {}) {
  const scope = scopeFor(options, env);
  if (!scope) return { ok: true, processed: [], skipped: [], failed: [], notConfigured: 'STUDIO_PROJECT_ID is not set' };
  const listed = await catalog.listEditsByStatus(WATCH_LIMIT, ['finished', 'uploading'], scope);
  if (!listed.ok) return { ok: false, processed: [], skipped: [], failed: [], error: `finished edits could not be read: ${listed.error}` };
  const blocked = queue.listJobs({ stage: STAGE_UPLOAD, state: 'blocked' });
  const processed = [];
  const skipped = [];
  for (const edit of listed.data) {
    const id = text(edit.id);
    const held = blocked.find((j) => text(j.subjectId).toLowerCase() === id.toLowerCase()
      && now() - Number(j.updatedAt) < RETRY_BLOCKED_AFTER_MS);
    if (held) {
      skipped.push({ editId: id, why: `its job ${held.id} is blocked: ${held.lastError}` });
      continue;
    }
    const { job, created } = enqueueUpload(queue, { editId: id, why: edit.status });
    if (created) processed.push({ editId: id, jobId: job.id });
    else skipped.push({ editId: id, why: `job ${job.id} is already waiting` });
  }
  return { ok: true, processed, skipped, failed: [], truncated: listed.data.length >= WATCH_LIMIT };
}

/**
 * What the video goes up with: the title, the description with the end
 * card's ending and the music credit its track needs, and the tags.
 *
 * The description was written (6a) before any music was picked, so most
 * carry no credit. Its no-credit ending is taken off and the ending put back
 * WITH the credit (youtubeCopy.js `composeDescription`), so the invitation is
 * never there twice and a credit the licence needs is never missing.
 * `{ ok, metadata }`, or `{ ok: false, machine, why }`.
 */
async function uploadMetadata({ edit, sidecar, scope, catalog, readEndCards, shelf }) {
  // YouTube's limits, held by the same code 6a writes with: one line, no < or >, 100 characters.
  const title = copy.cutAtWord(edit.youtubeTitle, copy.TITLE_MAX);
  if (!text(title)) return { ok: false, why: 'it has no YouTube title, so there is nothing to put it up under' };

  const credit = copy.attributionFor(edit.musicTrack, shelf);
  if (!credit.ok) return { ok: false, why: credit.reason };

  let project = text(sidecar && sidecar.endCardProject);
  if (!project) {
    const moments = await catalog.getMomentsBySource(edit.sourceId, scope);
    if (!moments.ok) return { ok: false, machine: true, why: `the moments of source ${edit.sourceId} could not be read: ${moments.error}` };
    const which = cards.endCardProjectFor(edit, moments.data && Array.isArray(moments.data.moments) ? moments.data.moments : []);
    if (!which.ok) return { ok: false, why: `it has no end card to end the description with: ${which.reason}` };
    project = which.project;
  }
  const endCards = await readEndCards({ projectId: scope.projectId });
  if (!endCards || !endCards.ok) {
    const why = text(endCards && endCards.reason) || 'the end-cards note could not be read';
    return { ok: false, machine: /could not read/i.test(why), why };
  }
  const card = cards.endCardFor(project, endCards.cards);
  if (!card.ok) return { ok: false, why: `${card.reason}, so the description has no ending` };

  let body = text(edit.youtubeDescription);
  const bare = copy.descriptionEnding(card.card, '');
  if (body.endsWith(bare)) body = body.slice(0, -bare.length).trim();
  const description = copy.composeDescription(body, card.card, credit.attribution);
  const tags = copy.cleanTags(Array.isArray(edit.youtubeTags) ? edit.youtubeTags : []);
  return {
    ok: true,
    metadata: {
      snippet: { title, description, tags, categoryId: CATEGORY_ID },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    },
  };
}

/** Read the video back until it is there, or the tries run out. YouTube's read can lag its write. */
async function confirmVideo({ client, token, videoId, sleep, tries = READ_BACK_TRIES, waitMs = READ_BACK_WAIT_MS }) {
  let last = null;
  for (let n = 0; n < tries; n += 1) {
    if (n) await sleep(waitMs);
    last = await client.getVideo({ token, videoId });
    if (!last.ok) return last;
    if (last.video) break;
  }
  const video = last && last.video;
  if (!video) return { ok: false, kind: 'unconfirmed', why: `YouTube named video ${videoId} but does not show it yet` };
  const status = video.status || {};
  if (['rejected', 'failed', 'deleted'].includes(text(status.uploadStatus))) {
    const reason = text(status.rejectionReason) || text(status.failureReason) || text(status.uploadStatus);
    return { ok: false, kind: 'refused', why: `YouTube ${text(status.uploadStatus)} video ${videoId} after it arrived (${reason})` };
  }
  return { ok: true, video, privacy: text(status.privacyStatus), uploadStatus: text(status.uploadStatus) };
}

/**
 * Upload one finished edit. The caller owns the claim; this never claims.
 * Every return says what happened (`outcome`: uploaded | moved_on | failed |
 * blocked | outage | waiting | lost) and what the queue was told.
 */
async function uploadJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  client = null,
  options = {},
  env = process.env,
  readEndCards = (args) => cards.readEndCards(args),
  shelf = null,
  alarm = realAlarm,
  clearAlarm = realClearAlarm,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock = Date.now,
  io = fs,
  chunkBytes = yt.CHUNK_BYTES,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const editId = text(payload.editId) || text(job && job.subjectId);
  const base = { jobId: job.id, editId };
  const scope = scopeFor(options, env);
  const finishedDir = resolveFinishedDir(options, env);
  const youtube = client || yt.createYoutubeClient({ env });

  const completeIt = (outcome, reason, extra = {}) => {
    const completed = queue.complete(job.id, owner);
    return { ...base, ...extra, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };
  const releaseIt = (reason, { holdMs = RELEASE_HOLD_MS, outcome = 'outage', ...extra } = {}) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: holdMs })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, ...extra, outcome, jobAction: released ? 'released' : 'failed', reason };
  };
  const blockIt = (reason) => {
    queue.block({ stage: STAGE_UPLOAD, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: editId || text(job.subjectId) || 'unknown', reason, payload: job.payload || null, jobId: job.id });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const failJob = (reason) => {
    queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'failed', jobAction: 'failed', reason };
  };
  const signInStopped = (why) => {
    const reason = `Reel Spinner's YouTube uploads are stopped: ${why}`;
    const told = alarm(reason, { env });
    return releaseIt(`${reason}. The finished file is kept; tried again in an hour`, { holdMs: AUTH_HOLD_MS, alarm: told && told.said });
  };
  // YouTube said no to THIS upload. The file stays: nothing is deleted before YouTube confirms it.
  const refusedIt = async (why) => {
    const reason = `${videoEditsStore.UPLOAD_PROBLEM_PREFIX}${why}. The finished file is kept on the Mac Mini`;
    const moved = await catalog.moveEdit(editId, 'failed', { error: reason }, scope);
    if (!moved.ok) return releaseIt(`YouTube refused the upload (${why}), and edit ${editId} could not be marked failed: ${moved.error}`);
    return completeIt('failed', reason);
  };

  if (!editId) return blockIt('this upload job names no edit, so there is nothing to upload');
  if (!scope) return blockIt('STUDIO_PROJECT_ID is not set, so the edit cannot be read in its project. Fix: set STUDIO_PROJECT_ID.');

  // ── 1. The edit, its file and its text ─────────────────────────────────
  const read = await catalog.getEditById(editId, scope);
  if (!read.ok) return releaseIt(`edit ${editId} could not be read: ${read.error}`);
  if (!read.data || !text(read.data.id)) return completeIt('moved_on', `edit ${editId} is not in the catalog any more`);
  const edit = read.data;
  const paths = uploadPathsFor(finishedDir, editId);
  const saved = readJson(paths.session, io) || {};

  if (edit.status === 'on_youtube') {
    // Already up. A delete that did not happen last time happens now, but only
    // for the video this disk uploaded.
    if (text(saved.videoId) && text(saved.videoId) === text(edit.youtubeVideoId)) {
      removeQuietly(paths.video, io); removeQuietly(paths.sidecar, io); removeQuietly(paths.session, io);
    }
    return completeIt('moved_on', `edit ${editId} is already on YouTube (${text(edit.youtubeVideoId)})`);
  }
  if (edit.status !== 'finished' && edit.status !== 'uploading') {
    return completeIt('moved_on', `edit ${editId} is ${edit.status}, not finished, so there is nothing to upload`);
  }
  Object.assign(base, { kind: edit.kind, file: paths.video });

  let videoId = text(saved.videoId);
  let bytes = 0;
  if (!videoId) {
    if (!io.existsSync(finishedDir)) {
      return releaseIt(`the folder finished videos are kept in (${finishedDir}) is not on this disk, so this is not the machine that made them. Fix: check STUDIO_FINISHED_DIR`);
    }
    try { bytes = io.statSync(paths.video).size; } catch { bytes = 0; }
    if (!(bytes > 0)) {
      return refusedIt(`there is nothing to upload: the finished file is not at ${paths.video}. Fix: send the cut back and approve it again, which makes the finished video again`);
    }
  }
  base.bytes = bytes;

  let musicShelf = shelf;
  if (!musicShelf) {
    try { musicShelf = realShelf(); } catch (err) { return blockIt(`the music shelf could not be read (${err.message}), so the music credit cannot be written`); }
  }
  const meta = await uploadMetadata({ edit, sidecar: readJson(paths.sidecar, io), scope, catalog, readEndCards, shelf: musicShelf });
  if (!meta.ok) return meta.machine ? releaseIt(meta.why) : blockIt(`it cannot go up yet: ${meta.why}`);

  // ── 2. A fresh sign-in, for the right channel ──────────────────────────
  const signedIn = await youtube.accessToken();
  if (!signedIn.ok) return signedIn.kind === 'auth' ? signInStopped(signedIn.why) : releaseIt(signedIn.why);
  const token = signedIn.token;
  if (!videoId && !text(saved.sessionUrl)) {
    const mine = await youtube.channelTitles(token);
    if (!mine.ok) return mine.kind === 'auth' ? signInStopped(mine.why) : releaseIt(mine.why);
    if (!mine.titles.includes(EXPECTED_CHANNEL)) {
      return signInStopped(`the upload sign-in belongs to ${mine.titles.length ? `"${mine.titles.join('", "')}"` : 'an account with no channel'}, not "${EXPECTED_CHANNEL}", so nothing was uploaded. ${yt.FIX_SIGN_IN}`);
    }
  }
  clearAlarm();

  // ── 3. The edit moves to uploading; its text is locked from here ────────
  if (edit.status === 'finished') {
    const moved = await catalog.moveEdit(editId, 'uploading', {}, scope);
    if (!moved.ok) {
      if (moved.status === 409) return completeIt('moved_on', `edit ${editId} moved before it could start uploading (${moved.error})`);
      return releaseIt(`edit ${editId} could not be marked uploading: ${moved.error}`);
    }
  }

  // ── 4. The upload, resumable ───────────────────────────────────────────
  if (!videoId) {
    if (!queue.heartbeat(job.id, owner, { leaseMs: PIECE_LEASE_MS })) {
      return { ...base, outcome: 'lost', jobAction: 'none', reason: `the lease on job ${job.id} was no longer this worker's` };
    }
    const started = clock();
    const up = await yt.uploadResumable({
      client: youtube, token, file: paths.video, bytes, metadata: meta.metadata, io, chunkBytes,
      session: text(saved.sessionUrl) && Number(saved.bytes) === bytes ? saved : null,
      saveSession: ({ sessionUrl }) => writeJson(paths.session, { sessionUrl, bytes, startedAt: new Date(clock()).toISOString() }, io),
      onProgress: async () => queue.heartbeat(job.id, owner, { leaseMs: PIECE_LEASE_MS }) !== false,
    });
    Object.assign(base, { resumedFrom: up.resumedFrom, sentBytes: up.sentBytes, uploadMs: clock() - started });
    if (!up.ok) {
      if (up.leaseLost) return { ...base, outcome: 'lost', jobAction: 'none', reason: up.why };
      if (up.kind === 'quota') {
        return releaseIt(`YouTube's daily upload allowance is used up (${up.why}). It resets at midnight Pacific (1 AM Mountain); `
          + 'this upload waits until then, no attempt counted, and the finished file is kept', { holdMs: yt.msUntilQuotaReset(clock()), outcome: 'waiting' });
      }
      if (up.kind === 'auth') return signInStopped(up.why);
      if (up.kind === 'refused') return refusedIt(up.why);
      return releaseIt(`the upload stopped part-way (${up.why}); it carries on from where YouTube got to, and the finished file is kept`);
    }
    videoId = text(up.video && up.video.id);
    // The id goes on the disk FIRST, so no later failure can lead to a second upload.
    writeJson(paths.session, { ...(readJson(paths.session, io) || {}), videoId, uploadedAt: new Date(clock()).toISOString() }, io);
  } else {
    base.uploadReused = true;
  }
  base.videoId = videoId;

  // ── 5. Read back from YouTube ──────────────────────────────────────────
  const confirmed = await confirmVideo({ client: youtube, token, videoId, sleep });
  if (!confirmed.ok) {
    if (confirmed.kind === 'refused') return refusedIt(confirmed.why);
    if (confirmed.kind === 'auth') return signInStopped(confirmed.why);
    return releaseIt(`${confirmed.why}; the finished file is kept until YouTube shows it`);
  }
  base.privacy = confirmed.privacy;
  if (confirmed.privacy !== 'private') base.warning = `it was uploaded as Private, but YouTube reads it back as "${confirmed.privacy}"`;

  // ── 6. The edit moves to on_youtube, and is read back ───────────────────
  const onYoutube = await catalog.moveEdit(editId, 'on_youtube', { youtubeVideoId: videoId }, scope);
  if (!onYoutube.ok) {
    return releaseIt(`video ${videoId} is on YouTube, but edit ${editId} could not be marked on_youtube: ${onYoutube.error}. The file is kept; the next try only does this write`);
  }
  const back = await catalog.getEditById(editId, scope);
  if (!back.ok) return releaseIt(`edit ${editId} was marked on_youtube, but reading it back failed: ${back.error}. The file is kept`);
  if (!back.data || back.data.status !== 'on_youtube' || text(back.data.youtubeVideoId) !== videoId) {
    return failJob(`edit ${editId} was marked on_youtube with video ${videoId} but read back as "${text(back.data && back.data.status)}" with video "${text(back.data && back.data.youtubeVideoId)}". The file is kept`);
  }

  // ── 7. Confirmed on YouTube and in the catalog: now the file goes ───────
  removeQuietly(paths.video, io);
  removeQuietly(paths.sidecar, io);
  removeQuietly(paths.session, io);
  return completeIt('uploaded', `on YouTube as ${confirmed.privacy || 'private'}: video ${videoId}; the finished file was deleted`);
}

/** Claim and upload up to `max` jobs. The daemon calls it with `max: 1`. */
async function runUpload(options = {}) {
  const { queue, owner = `upload-${process.pid}`, max = 1 } = options;
  if (!queue) throw new Error('runUpload needs a queue (workers/studio/queue.js)');
  const report = { owner, uploaded: [], movedOn: [], failed: [], blocked: [], released: [], waiting: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_UPLOAD] });
    if (!job) break;
    let result;
    try {
      result = await uploadJob({ ...options, queue, job, owner, options });
    } catch (err) {
      const reason = `uploading this edit threw an error: ${err.message}. The finished file is kept`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, editId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      uploaded: report.uploaded, moved_on: report.movedOn, failed: report.failed, blocked: report.blocked,
      outage: report.released, waiting: report.waiting, lost: report.lost,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage' || result.outcome === 'waiting') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runUpload,
  uploadJob,
  watchFinished,
  enqueueUpload,
  uploadMetadata,
  confirmVideo,
  uploadPathsFor,
  realCatalog,
  STAGE_UPLOAD,
  STAGE_UPLOAD_WATCH,
  SUBJECT_VIDEO_EDIT,
  UPLOAD_WATCH_EVERY_MS,
  RETRY_BLOCKED_AFTER_MS,
  RELEASE_HOLD_MS,
  AUTH_HOLD_MS,
  ALARM_JOB,
};
