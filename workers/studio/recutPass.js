'use strict';

/**
 * The re-cut PASS — a rough cut Dane sent back, cut again from his note.
 *
 * Reel Spinner 4d (SC-836). The website cannot reach the Mini's queue, so a
 * send-back is a status on the edit's row (`sent_back`, with his note in
 * `dane_note`). Two halves:
 *
 *   watchSentBack   a WATCHER (clock-driven, like the rescore watch): once a
 *                   minute it asks the catalog for `sent_back` edits and puts
 *                   one `recut` job on the queue for each.
 *   recutJob        one job: the AI door turns the note into new keep ranges
 *                   (workers/studio/recut.js, which checks them against the
 *                   edit-list rules), the edit is rendered and uploaded the
 *                   way every rough cut is (the 4b path, roughCutPass.js), and
 *                   it goes back to `review`. `recut_count` goes up by one —
 *                   the store does that on `sent_back → rendering`.
 *
 * THREE WAYS IT GOES BACK TO HIM, never silently:
 *   re-cut          new rough cut, back in review; the card reads "Re-cut
 *                   from your note: …"
 *   handed back     the note could not become a valid edit (the AI said it
 *                   cannot, or its answer broke a rule): back in review
 *                   UNCHANGED — the same rough cut, the same ranges — with the
 *                   reason on the card. Not counted as a re-cut.
 *   stopped         re-cut MAX_RECUTS (3) times already: handed back with
 *                   "re-cut 3 times; tell an agent session what is still
 *                   wrong", and no AI call. Every later send-back gets the
 *                   same answer, so nothing loops.
 *
 * WHAT IS CHARGED TO THE EDIT, AND WHAT IS NOT (the line every Studio pass
 * draws). No AI provider able to pay, no network, ffmpeg missing, the catalog
 * unreachable, the disk too full: facts about the MACHINE. The job is put
 * back with no attempt spent, the edit stays `sent_back` exactly as he left
 * it, and — for the AI — the bus hears once per six hours (2d's rule,
 * workers/studio/momentsPass.js). All of these are checked BEFORE the AI is
 * paid, so a machine fault never wastes an answer.
 *
 * A render or upload that fails AFTER the edit moved is the edit's: it goes
 * to `failed` with the reason and a `rough_cut` job is queued for its
 * recording, whose retry renders the edit from its row — the NEW ranges — so
 * the decision the AI made is kept and never paid for twice.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rough = require('./roughCutPass.js');
const { recutFromNote, recutConfig, MAX_RECUTS } = require('./recut.js');
const { runFfmpeg, resolveDerivedDir, FAILURES } = require('./proxy.js');
const videoEditsStore = require('../../lib/videoEditsStore.js');

const STAGE_RECUT = 'recut';
const STAGE_RECUT_WATCH = 'recut.watch';
const SUBJECT_VIDEO_EDIT = 'video_edit';
/** How often the watcher asks the catalog for send-backs. */
const RECUT_WATCH_EVERY_MS = 60 * 1000;
/** How many send-backs one watch reads. More wait for the next minute. */
const WATCH_LIMIT = 50;

/** No provider can pay, or no network: wait an hour (2d's rule). */
const MACHINE_HOLD_MS = 60 * 60 * 1000;
/** The name the bus alarm goes out under, and its six-hour stamp's name. */
const ALARM_JOB = 'reel-spinner-recut';
/** The lease covers the AI call's whole timeout, before the render's is sized. */
const LEASE_MARGIN_MS = 5 * 60 * 1000;

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

function realCatalog() {
  return {
    ...rough.realCatalog(),
    listEditsByStatus: videoEditsStore.listEditsByStatus,
  };
}

/** The sentence on the card when the cap is reached. Kept here so the tests and the card agree. */
function capReason(count) {
  return `re-cut ${count} times; tell an agent session what is still wrong`;
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

/** The alarm sentence, naming each provider the door could not use. */
function machineReason(result) {
  if (result.code !== 'no_provider') {
    return `Reel Spinner re-cuts are stopped: this machine could not reach any AI provider (${text(result.reason)}).`;
  }
  const said = (result.skipped || []).map((s) => {
    const label = text(s.label) || text(s.provider) || 'a provider';
    if (s.verdict === 'NOT SET') return `${label}: no key`;
    if (s.verdict === 'INVALID') return `${label}: key refused`;
    if (s.verdict === 'OUT OF CREDIT' || s.verdict === 'OUT_OF_CREDIT') return `${label}: out of credit`;
    return `${label}: ${text(s.reason) || 'cannot serve'}`;
  });
  return `Reel Spinner re-cuts are stopped: no AI provider can pay. ${said.length ? `${said.join('. ')}.` : text(result.reason)}`;
}

/** One `recut` job per sent-back edit. Keyed by the edit id: the queue's unique index is the dedupe. */
function enqueueRecut(queue, { editId, why = '' }) {
  const id = text(editId);
  if (!id) throw new Error('enqueueRecut needs an edit id');
  return queue.enqueue({
    stage: STAGE_RECUT,
    subjectKind: SUBJECT_VIDEO_EDIT,
    subjectId: id,
    payload: { editId: id, ...(text(why) ? { why: text(why) } : {}) },
  });
}

/**
 * The watcher. A `recut` job that was BLOCKED after this send-back was made
 * is not queued again — its reason is the answer, and queueing it every
 * minute would hide it (the rescore watch's rule).
 */
async function watchSentBack({ queue, env = process.env, options = {}, catalog = realCatalog() } = {}) {
  const scope = scopeFor(options, env);
  if (!scope) return { ok: true, processed: [], skipped: [], failed: [], notConfigured: 'STUDIO_PROJECT_ID is not set' };
  const sent = await catalog.listEditsByStatus(WATCH_LIMIT, ['sent_back'], scope);
  if (!sent.ok) return { ok: false, processed: [], skipped: [], failed: [], error: `sent-back edits could not be read: ${sent.error}` };
  const jobs = queue.listJobs({ stage: STAGE_RECUT });
  const processed = [];
  const skipped = [];
  for (const edit of sent.data) {
    const id = text(edit.id);
    const sentAt = Date.parse(edit.updatedAt) || 0;
    const blocked = jobs.find((j) => j.state === 'blocked' && text(j.subjectId).toLowerCase() === id.toLowerCase()
      && Number(j.updatedAt) >= sentAt);
    if (blocked) {
      skipped.push({ editId: id, why: `its re-cut job ${blocked.id} is blocked: ${blocked.lastError}` });
      continue;
    }
    const { job, created } = enqueueRecut(queue, { editId: id, why: `sent back at ${edit.updatedAt}` });
    if (created) processed.push({ editId: id, jobId: job.id });
    else skipped.push({ editId: id, why: `job ${job.id} is already waiting` });
  }
  return { ok: true, processed, skipped, failed: [], truncated: sent.data.length >= WATCH_LIMIT };
}

/**
 * Re-cut one sent-back edit. The caller owns the claim. Every return says
 * what happened (`outcome`: recut | handed_back | stopped | moved_on |
 * failed | blocked | outage | lost) and what the queue was told.
 */
async function recutJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  drive = rough.realDrive(),
  options = {},
  env = process.env,
  ffmpeg = runFfmpeg,
  probeDuration = rough.realProbeDuration,
  exists = fs.existsSync,
  freeBytes = (dir) => require('./ingest.js').freeBytesFor(dir),
  io = fs,
  query,
  config = recutConfig(env),
  alarm = realAlarm,
  clearAlarm = realClearAlarm,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const editId = text(payload.editId) || text(job && job.subjectId);
  const base = { jobId: job.id, editId };
  const scope = scopeFor(options, env);
  const derivedDir = resolveDerivedDir(options, env);

  const blockIt = (reason) => {
    queue.block({ stage: STAGE_RECUT, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: editId || text(job.subjectId), reason, payload: job.payload || null, jobId: job.id });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const releaseIt = (reason, holdMs = rough.RELEASE_HOLD_MS) => {
    const released = typeof queue.release === 'function' ? queue.release(job.id, owner, { reason, runAfterMs: holdMs }) : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };
  const completeIt = (outcome, reason, extra = {}) => {
    const completed = queue.complete(job.id, owner);
    return { ...base, ...extra, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };

  if (!editId) return blockIt('this re-cut job names no edit. Fix: this should not be reachable from the watcher — report it, then delete the job.');
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the edit cannot be read in its project (CLAUDE.md landmine 12). '
      + 'Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const read = await catalog.getEditById(editId, scope);
  if (!read.ok) return releaseIt(`edit ${editId} could not be read: ${read.error}`);
  if (!read.data) return completeIt('moved_on', `edit ${editId} is not in the catalog any more, so there is nothing to re-cut`);
  const edit = read.data;
  if (edit.status !== 'sent_back') return completeIt('moved_on', `edit ${editId} is ${edit.status} now, not sent back, so it was left alone`);
  const sourceId = text(edit.sourceId);
  Object.assign(base, { sourceId, kind: edit.kind, note: edit.daneNote, recutCount: edit.recutCount });
  const beforeS = round(rough.keptSeconds(edit.keepRanges || []));
  base.beforeS = beforeS;

  /** Back to review, unchanged, with the reason on the card. */
  const handBack = async (outcome, why) => {
    const moved = await catalog.moveEdit(edit.id, 'review', { error: why }, scope);
    if (!moved.ok) {
      if (moved.status === 409) return completeIt('moved_on', `edit ${edit.id} moved while this ran: ${moved.error}`);
      return releaseIt(`edit ${edit.id} could not be handed back to review (${why}): ${moved.error}`);
    }
    const back = await catalog.getEditById(edit.id, scope);
    if (!back.ok || !back.data || back.data.status !== 'review' || text(back.data.error) !== text(why)) {
      return releaseIt(`edit ${edit.id} was handed back but read back as "${text(back.data && back.data.status) || 'nothing'}": ${back.ok ? 'its reason did not stick' : back.error}`);
    }
    return completeIt(outcome, why);
  };

  if (Number(edit.recutCount) >= MAX_RECUTS) return handBack('stopped', capReason(edit.recutCount));

  // Everything the render needs, read and checked BEFORE the AI is paid.
  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok && row.status !== 404) return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  if (!row.ok || !row.data) return handBack('handed_back', `could not re-cut from your note: its recording is not in the catalog any more`);
  const source = row.data;
  const picturePath = text(source.proxyPath);
  if (!picturePath || !exists(picturePath)) {
    return blockIt(`source ${sourceId} has no working copy on this disk (${picturePath || 'no proxy path in the catalog'}), `
      + `so edit ${edit.id} cannot be re-cut. Fix: re-run its proxy step, then delete this blocked job; the watcher queues it again.`);
  }
  const transcript = await catalog.getTranscriptBySource(sourceId, scope);
  if (!transcript.ok) return releaseIt(`the transcript of source ${sourceId} could not be read: ${transcript.error}`);
  const cuts = await catalog.getCutMarksBySource(sourceId, scope);
  if (!cuts.ok) return releaseIt(`the cut marks of source ${sourceId} could not be read: ${cuts.error}`);
  if (!transcript.data || text(transcript.data.state) !== 'done' || !cuts.data || text(cuts.data.state) !== 'done') {
    return handBack('handed_back', 'could not re-cut from your note: the recording has no finished transcript or cut marks to cut by');
  }
  const pairsRes = await catalog.listAudioPairsForSource(sourceId, scope);
  if (!pairsRes.ok) return releaseIt(`the line-ups of source ${sourceId} could not be read: ${pairsRes.error}`);
  const pairs = pairsRes.data;
  const ownSound = !text(edit.audioSourceId) || text(edit.audioSourceId).toLowerCase() === sourceId.toLowerCase();
  let pair = null;
  let otherDurationS;
  let soundPath = picturePath;
  if (!ownSound) {
    const other = await catalog.getSourceById(edit.audioSourceId, scope);
    if (!other.ok) return releaseIt(`the sound's recording ${edit.audioSourceId} could not be read: ${other.error}`);
    otherDurationS = other.data ? other.data.durationS : undefined;
    soundPath = text(other.data && other.data.proxyPath);
    if (!soundPath || !exists(soundPath)) {
      return blockIt(`edit ${edit.id} uses the sound of recording ${edit.audioSourceId}, whose working copy is not on this disk `
        + `(${soundPath || 'no proxy path'}). Fix: re-run that recording's proxy step, then delete this blocked job.`);
    }
    const aud = text(edit.audioSourceId).toLowerCase();
    pair = pairs.find((p) => [text(p.sourceAId).toLowerCase(), text(p.sourceBId).toLowerCase()].includes(aud)) || null;
  }

  const ffmpegCheck = ffmpeg(['-hide_banner', '-version'], { timeoutMs: 30 * 1000 });
  if (!ffmpegCheck.ok && ffmpegCheck.reason === FAILURES.FFMPEG_MISSING) {
    return releaseIt('ffmpeg is not installed or not on PATH on this machine — nothing was re-cut, and the edit was left sent back. Fix: brew install ffmpeg.');
  }

  if (!queue.heartbeat(job.id, owner, { leaseMs: config.timeoutMs + LEASE_MARGIN_MS })) {
    return { ...base, outcome: 'lost', jobAction: 'none', reason: `the lease on job ${job.id} was no longer this worker's` };
  }

  const durationS = Number(cuts.data.durationS) > 0 ? Number(cuts.data.durationS) : Number(source.durationS);
  const answer = await recutFromNote({
    kind: edit.kind,
    note: edit.daneNote,
    keepRanges: edit.keepRanges,
    words: Array.isArray(transcript.data.words) ? transcript.data.words : [],
    marks: Array.isArray(cuts.data.marks) ? cuts.data.marks : [],
    durationS,
    fps: source.fps,
    sourceId,
    audioSourceId: edit.audioSourceId,
    pair,
    otherDurationS,
  }, { query, config, scope });
  Object.assign(base, { model: answer.model || '', usage: answer.usage || null });

  if (answer.state === 'failed') {
    if (answer.machine) {
      const reason = machineReason(answer);
      const posted = alarm(reason, { env });
      const released = releaseIt(`${reason} Edit ${edit.id} was left sent back and will be tried again in an hour.`, MACHINE_HOLD_MS);
      return { ...released, alarm: posted && posted.said ? posted.said : '' };
    }
    clearAlarm();
    return handBack('handed_back', `could not re-cut from your note: ${answer.reason}. Send it back again to try once more.`);
  }
  clearAlarm();
  if (answer.state === 'refused') return handBack('handed_back', `could not re-cut from your note: ${answer.reason}`);

  // A valid new edit. Room on the disk first: a full disk is the machine's.
  const ranges = answer.ranges;
  const keptS = rough.keptSeconds(ranges);
  const newAudio = answer.audioSourceId;
  if (newAudio && newAudio.toLowerCase() !== text(edit.audioSourceId).toLowerCase()) soundPath = picturePath; // fell back to its own sound
  const shift = rough.soundShift(sourceId, newAudio, pairs);
  if (!shift.ok) return handBack('handed_back', `could not re-cut from your note: ${shift.why}`);
  const paths = rough.localPathsFor(derivedDir, edit.id);
  if (!rough.keptRender(paths, rough.renderFingerprint({ ranges, shiftS: shift.shiftS, picturePath, soundPath }), io)) {
    const free = freeBytes(derivedDir);
    if (!free || !free.ok) return releaseIt(`the free space where rough cuts are rendered (${derivedDir}) could not be read: ${free && free.error}`);
    const need = rough.estimateBytes(keptS) + rough.DISK_MARGIN_BYTES;
    if (free.value < need) {
      const gb = (b) => `${(b / (1024 ** 3)).toFixed(1)} GB`;
      return releaseIt(`the disk is too full to render a re-cut: ${gb(free.value)} free in ${derivedDir}, and this one needs about `
        + `${gb(rough.estimateBytes(keptS))} plus the ${gb(rough.DISK_MARGIN_BYTES)} always left free. The edit was left sent back. Fix: free some space on the Mini.`);
    }
  }
  if (!queue.heartbeat(job.id, owner, { leaseMs: rough.leaseForRender(keptS) })) {
    return { ...base, outcome: 'lost', jobAction: 'none', reason: `the lease on job ${job.id} was no longer this worker's` };
  }

  const patch = { keepRanges: ranges };
  if (newAudio !== (edit.audioSourceId || null)) patch.audioSourceId = newAudio;
  const moving = await catalog.moveEdit(edit.id, 'rendering', patch, scope);
  if (!moving.ok) {
    if (moving.status === 409) return completeIt('moved_on', `edit ${edit.id} moved while this ran: ${moving.error}`);
    return releaseIt(`edit ${edit.id} could not be moved to rendering with its new ranges: ${moving.error}`);
  }
  const recut = moving.data;
  Object.assign(base, { afterS: round(keptS), recutCount: recut.recutCount, changed: answer.changed, notes: answer.notes });

  const failAndRetry = async (why) => {
    const failed = await catalog.moveEdit(edit.id, 'failed', { error: why }, scope);
    const queued = rough.enqueueRoughCut(queue, { sourceId, why: `re-render the re-cut of edit ${edit.id}` });
    const note = failed.ok ? '' : ` (and the failure could not be written on the edit: ${failed.error})`;
    return completeIt('failed', `${why}${note}. Its new ranges are saved; rough-cut job ${queued.job.id} renders it again.`);
  };

  const rendered = rough.renderToDisk({ paths, ranges, shiftS: shift.shiftS, picturePath, soundPath, ffmpeg, probeDuration, io, keptS });
  if (!rendered.ok) {
    if (rendered.machine) return failAndRetry('ffmpeg went missing mid-run; it will be rendered again');
    return failAndRetry(`ffmpeg could not render the re-cut: ${rendered.why}`);
  }
  const name = rough.driveFileName(source, recut, null);
  const uploaded = await rough.uploadRender({ drive, queue, env, file: paths.video, bytes: rendered.bytes, name });
  if (!uploaded.ok) return failAndRetry(`re-cut rendered, but not uploaded: ${uploaded.error}. The render is kept at ${paths.video}`);

  const moved = await catalog.moveEdit(edit.id, 'review', { roughCutDriveFileId: uploaded.id }, scope);
  const back = moved.ok ? await catalog.getEditById(edit.id, scope) : moved;
  if (!back.ok || !back.data || back.data.status !== 'review' || text(back.data.roughCutDriveFileId) !== uploaded.id) {
    const why = !moved.ok ? moved.error : `it read back as "${text(back.data && back.data.status) || 'nothing'}"`;
    return failAndRetry(`re-cut uploaded to Drive as ${uploaded.id}, but the edit could not be marked for review: ${why}`);
  }
  // Confirmed on Drive and on the row: only now does the local copy go.
  rough.removeQuietly(paths.video, io);
  rough.removeQuietly(paths.sidecar, io);
  return completeIt('recut', `re-cut from the note: ${beforeS} s → ${round(keptS)} s${answer.changed ? ` (${answer.changed})` : ''}`,
    { driveFileId: uploaded.id, driveName: name, bytes: rendered.bytes, renderMs: rendered.renderMs, uploadMs: uploaded.ms });
}

/** Claim and re-cut up to `max` jobs. The daemon calls it with `max: 1`. An outage stops the run. */
async function runRecut(options = {}) {
  const { queue, owner = `recut-${process.pid}`, max = 1 } = options;
  if (!queue) throw new Error('runRecut needs a queue (workers/studio/queue.js)');
  const report = { owner, recut: [], handedBack: [], failed: [], blocked: [], released: [], lost: [], movedOn: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_RECUT] });
    if (!job) break;
    let result;
    try {
      result = await recutJob({ ...options, queue, job, owner, options });
    } catch (err) {
      const reason = `re-cutting this edit threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, editId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      recut: report.recut, handed_back: report.handedBack, stopped: report.handedBack, moved_on: report.movedOn,
      failed: report.failed, blocked: report.blocked, outage: report.released, lost: report.lost,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runRecut,
  recutJob,
  enqueueRecut,
  watchSentBack,
  capReason,
  machineReason,
  STAGE_RECUT,
  STAGE_RECUT_WATCH,
  SUBJECT_VIDEO_EDIT,
  RECUT_WATCH_EVERY_MS,
  MACHINE_HOLD_MS,
  ALARM_JOB,
};
