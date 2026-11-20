'use strict';

/**
 * The YouTube-text PASS — each rough cut's title, description and tags,
 * written on the Mini (Reel Spinner 6a, SC-839). The rules are
 * workers/studio/youtubeCopy.js; nothing is decided here.
 *
 *   watchYoutubeCopy  a WATCHER (clock-driven, like the re-cut watch): every
 *                     few minutes it asks the catalog for edits in review,
 *                     approved or finished whose title, description or tags
 *                     are EMPTY, and puts one `youtube_copy` job on the queue
 *                     for each. It covers a first cut, a re-cut and the edits
 *                     made before this pass existed alike, because all it
 *                     reads is the row.
 *   youtubeCopyJob    one job: read the kept words, Dane's Reel Spinner notes,
 *                     the end card and the music, ask the AI door, and write
 *                     each field ONLY WHERE IT IS STILL EMPTY
 *                     (lib/videoEditsStore.js fillYoutubeCopy). A field he
 *                     typed in is never overwritten — not by this run, and not
 *                     by one whose answer lands after he typed. A box he
 *                     clears is filled again on the next watch.
 *
 * WHEN IT CANNOT BE WRITTEN, THE CARD SAYS WHY. The reason goes on the edit
 * (`error`, starting "YouTube text not written yet: ") unless the edit
 * already carries a re-cut's hand-back reason, which is kept. It is cleared
 * the moment the text is written.
 *
 * WHAT IS CHARGED TO THE EDIT, AND WHAT IS NOT (2d's line,
 * workers/studio/momentsPass.js). No AI provider able to pay, or no network:
 * the MACHINE's. The job is released for an hour with no attempt spent, the
 * card says so, and the bus hears once per six hours. The catalog unreadable:
 * released for 15 minutes. Everything the text needs (the end card, the
 * notes, the music credit) is read and checked BEFORE the AI is paid; one
 * that is missing blocks the job with the reason on the card, and the watcher
 * tries again six hours later, so filling in the end-cards note is enough —
 * nobody has to delete a job. An answer the rules refuse (clickbait, no
 * title) fails through the queue's retries.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const copy = require('./youtubeCopy.js');
const cards = require('./cards.js');
const videoEditsStore = require('../../lib/videoEditsStore.js');
const videoTranscriptsStore = require('../../lib/videoTranscriptsStore.js');
const videoMomentsStore = require('../../lib/videoMomentsStore.js');

const STAGE_YOUTUBE_COPY = 'youtube_copy';
const STAGE_YOUTUBE_COPY_WATCH = 'youtube_copy.watch';
const SUBJECT_VIDEO_EDIT = 'video_edit';
const YOUTUBE_COPY_WATCH_EVERY_MS = 5 * 60 * 1000;
/** listEditsByStatus's own ceiling. Waiting cuts are read on their own (routes/studioRoughCuts.js's reason). */
const WATCH_LIMIT = 500;
/** A blocked job (no end card, no notes) is queued again after this, so fixing the note is enough. */
const RETRY_BLOCKED_AFTER_MS = 6 * 60 * 60 * 1000;
const MACHINE_HOLD_MS = 60 * 60 * 1000;
const CATALOG_HOLD_MS = 15 * 60 * 1000;
const LEASE_MARGIN_MS = 5 * 60 * 1000;
const ALARM_JOB = 'reel-spinner-youtube-copy';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

function realCatalog() {
  return {
    getEditById: videoEditsStore.getEditById,
    listEditsByStatus: videoEditsStore.listEditsByStatus,
    fillYoutubeCopy: videoEditsStore.fillYoutubeCopy,
    noteYoutubeCopyProblem: videoEditsStore.noteYoutubeCopyProblem,
    clearYoutubeCopyProblem: videoEditsStore.clearYoutubeCopyProblem,
    getTranscriptBySource: videoTranscriptsStore.getTranscriptBySource,
    getMomentsBySource: videoMomentsStore.getMomentsBySource,
  };
}

function realReadBrief(args) {
  return require('../../lib/contextFor.js').readContextFor(args);
}

function realReadEndCards(args) {
  return cards.readEndCards(args);
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

/** The alarm sentence, naming each provider the door could not use. */
function machineReason(result) {
  if (result.code !== 'no_provider') {
    return `Reel Spinner's YouTube titles are stopped: this machine could not reach any AI provider (${text(result.reason)}).`;
  }
  const said = (result.skipped || []).map((s) => {
    const label = text(s.label) || text(s.provider) || 'a provider';
    if (s.verdict === 'NOT SET') return `${label}: no key`;
    if (s.verdict === 'INVALID') return `${label}: key refused`;
    if (s.verdict === 'OUT OF CREDIT' || s.verdict === 'OUT_OF_CREDIT') return `${label}: out of credit`;
    return `${label}: ${text(s.reason) || 'cannot serve'}`;
  });
  return `Reel Spinner's YouTube titles are stopped: no AI provider can pay. ${said.length ? `${said.join('. ')}.` : text(result.reason)}`;
}

/** Which fields of an edit are still empty. */
function emptyFields(edit) {
  const out = [];
  if (!text(edit.youtubeTitle)) out.push('youtubeTitle');
  if (!text(edit.youtubeDescription)) out.push('youtubeDescription');
  if (!Array.isArray(edit.youtubeTags) || !edit.youtubeTags.length) out.push('youtubeTags');
  return out;
}

function enqueueYoutubeCopy(queue, { editId, why = '' }) {
  const id = text(editId);
  if (!id) throw new Error('enqueueYoutubeCopy needs an edit id');
  return queue.enqueue({
    stage: STAGE_YOUTUBE_COPY,
    subjectKind: SUBJECT_VIDEO_EDIT,
    subjectId: id,
    payload: { editId: id, ...(text(why) ? { why: text(why) } : {}) },
  });
}

/**
 * The watcher. An edit whose job was BLOCKED in the last six hours is left
 * alone: its reason is on the card, and queueing it every five minutes would
 * read the same notes for the same answer.
 */
async function watchYoutubeCopy({ queue, env = process.env, options = {}, catalog = realCatalog(), now = Date.now } = {}) {
  const scope = scopeFor(options, env);
  if (!scope) return { ok: true, processed: [], skipped: [], failed: [], notConfigured: 'STUDIO_PROJECT_ID is not set' };
  const waiting = await catalog.listEditsByStatus(WATCH_LIMIT, ['review'], scope);
  if (!waiting.ok) return { ok: false, processed: [], skipped: [], failed: [], error: `edits in review could not be read: ${waiting.error}` };
  const later = await catalog.listEditsByStatus(WATCH_LIMIT, ['approved', 'finished'], scope);
  if (!later.ok) return { ok: false, processed: [], skipped: [], failed: [], error: `approved edits could not be read: ${later.error}` };
  const blocked = queue.listJobs({ stage: STAGE_YOUTUBE_COPY, state: 'blocked' });
  const processed = [];
  const skipped = [];
  for (const edit of [...waiting.data, ...later.data]) {
    const missing = emptyFields(edit);
    if (!missing.length) continue;
    const id = text(edit.id);
    const held = blocked.find((j) => text(j.subjectId).toLowerCase() === id.toLowerCase()
      && now() - Number(j.updatedAt) < RETRY_BLOCKED_AFTER_MS);
    if (held) {
      skipped.push({ editId: id, why: `its job ${held.id} is blocked: ${held.lastError}` });
      continue;
    }
    const { job, created } = enqueueYoutubeCopy(queue, { editId: id, why: `missing ${missing.join(', ')}` });
    if (created) processed.push({ editId: id, jobId: job.id });
    else skipped.push({ editId: id, why: `job ${job.id} is already waiting` });
  }
  return {
    ok: true, processed, skipped, failed: [],
    truncated: waiting.data.length >= WATCH_LIMIT || later.data.length >= WATCH_LIMIT,
  };
}

/**
 * Write one edit's YouTube text. The caller owns the claim. Every return says
 * what happened (`outcome`: written | kept | moved_on | blocked | failed |
 * outage | lost) and what the queue was told (`jobAction`).
 */
async function youtubeCopyJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  options = {},
  env = process.env,
  readBrief = realReadBrief,
  readEndCards = realReadEndCards,
  shelf = null,
  door,
  config = copy.copyConfig(env),
  alarm = realAlarm,
  clearAlarm = realClearAlarm,
  // The preview (scripts/studio_youtube_copy_preview.cjs) writes nothing, so
  // it may ask for text an edit already has. The pass never sets this.
  force = false,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const editId = text(payload.editId) || text(job && job.subjectId);
  const base = { jobId: job.id, editId };
  const scope = scopeFor(options, env);

  const completeIt = (outcome, reason, extra = {}) => {
    const completed = queue.complete(job.id, owner);
    return { ...base, ...extra, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };
  const releaseIt = (reason, holdMs = CATALOG_HOLD_MS) => {
    const released = typeof queue.release === 'function' ? queue.release(job.id, owner, { reason, runAfterMs: holdMs }) : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };
  /** Say it on the card, then hold the job. The note failing is said too, never swallowed. */
  const onCard = async (reason) => {
    const noted = await catalog.noteYoutubeCopyProblem(editId, reason, scope);
    return noted && noted.ok ? '' : ` (and the reason could not be put on the card: ${noted && noted.error})`;
  };
  const blockIt = async (reason) => {
    const note = await onCard(reason);
    queue.block({ stage: STAGE_YOUTUBE_COPY, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: editId || text(job.subjectId), reason: `${reason}${note}`, payload: job.payload || null, jobId: job.id });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason: `${reason}${note}` };
  };

  if (!editId) {
    queue.block({ stage: STAGE_YOUTUBE_COPY, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: text(job.subjectId) || 'unknown', reason: 'this job names no edit', payload: job.payload || null, jobId: job.id });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason: 'this job names no edit' };
  }
  if (!scope) {
    queue.block({ stage: STAGE_YOUTUBE_COPY, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: editId, reason: 'STUDIO_PROJECT_ID is not set', payload: job.payload || null, jobId: job.id });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason: 'STUDIO_PROJECT_ID is not set, so the edit cannot be read in its project. Fix: set STUDIO_PROJECT_ID.' };
  }

  const read = await catalog.getEditById(editId, scope);
  if (!read.ok) return releaseIt(`edit ${editId} could not be read: ${read.error}`);
  if (!read.data) return completeIt('moved_on', `edit ${editId} is not in the catalog any more`);
  const edit = read.data;
  if (!videoEditsStore.COPY_WRITABLE_STATUSES.includes(edit.status)) {
    return completeIt('moved_on', `edit ${editId} is ${edit.status}, so its YouTube text is not written now`);
  }
  if (!force && !emptyFields(edit).length) return completeIt('kept', `edit ${editId} already has a title, description and tags`);
  const sourceId = text(edit.sourceId);
  Object.assign(base, { sourceId, kind: edit.kind });

  // Everything the text needs, read and checked BEFORE the AI is paid.
  const transcript = await catalog.getTranscriptBySource(sourceId, scope);
  if (!transcript.ok) return releaseIt(`the transcript of source ${sourceId} could not be read: ${transcript.error}`);
  if (!transcript.data || text(transcript.data.state) !== 'done') return blockIt('its recording has no finished transcript to write it from');
  const said = copy.keptWords(transcript.data.words, edit.keepRanges);
  if (!said.length) return blockIt('the edit keeps no transcribed words, so there is nothing to describe');

  const moments = await catalog.getMomentsBySource(sourceId, scope);
  if (!moments.ok) return releaseIt(`the moments of source ${sourceId} could not be read: ${moments.error}`);
  const momentList = moments.data && Array.isArray(moments.data.moments) ? moments.data.moments : [];
  const which = cards.endCardProjectFor(edit, momentList);
  if (!which.ok) return blockIt(`it has no end card to end the description with: ${which.reason}`);

  const endCards = await readEndCards({ projectId: scope.projectId });
  if (!endCards || !endCards.ok) {
    const why = text(endCards && endCards.reason);
    if (/could not read/i.test(why)) return releaseIt(`the end-cards note could not be read: ${why}`);
    return blockIt(`${why || 'the end-cards note could not be read'}, so the description has no invitation to end on`);
  }
  const card = cards.endCardFor(which.project, endCards.cards);
  if (!card.ok) return blockIt(`${card.reason}, so the description has no invitation to end on. Add a line for ${which.project} to that note`);

  let musicShelf = shelf;
  if (!musicShelf) {
    try { musicShelf = realShelf(); } catch (err) { return blockIt(`the music shelf could not be read (${err.message})`); }
  }
  const credit = copy.attributionFor(edit.musicTrack, musicShelf);
  if (!credit.ok) return blockIt(credit.reason);

  const brief = await readBrief({ projectId: scope.projectId, use: 'reel-spinner' });
  if (!brief || !brief.ok) return releaseIt(`the Reel Spinner notes could not be read: ${(brief && brief.error) || 'no answer'}`);
  const briefText = text(brief.data && brief.data.text);
  if (!briefText) return blockIt('no Reel Spinner notes are switched on in this project (Assets › Context), so there is nothing to write it for');

  if (!queue.heartbeat(job.id, owner, { leaseMs: config.timeoutMs + LEASE_MARGIN_MS })) {
    return { ...base, outcome: 'lost', jobAction: 'none', reason: `the lease on job ${job.id} was no longer this worker's` };
  }

  const quote = edit.kind === 'short' && momentList[edit.momentIndex] ? text(momentList[edit.momentIndex].quote) : '';
  const answer = await copy.writeYoutubeCopy({
    kind: edit.kind,
    said,
    brief: briefText,
    project: which.project,
    invitation: card.card.invitation,
    quote,
    card: card.card,
    attribution: credit.attribution,
  }, { door, config, scope });
  Object.assign(base, { model: answer.model || '', usage: answer.usage || null });

  if (answer.state === 'failed') {
    if (answer.machine) {
      const reason = machineReason(answer);
      const posted = alarm(reason, { env });
      const note = await onCard(answer.code === 'no_provider'
        ? 'no AI provider can pay right now (Settings › APIs says which); the Mac Mini tries again every hour'
        : 'the Mac Mini could not reach an AI provider; it tries again every hour');
      const released = releaseIt(`${reason} Edit ${editId} will be tried again in an hour.${note}`, MACHINE_HOLD_MS);
      return { ...released, alarm: posted && posted.said ? posted.said : '' };
    }
    clearAlarm();
    // This edit's: the queue's retries decide, and the card says why meanwhile.
    const note = await onCard(`the AI's answer was refused: ${answer.reason}. The Mac Mini tries again`);
    queue.fail(job.id, owner, `${answer.reason}${note}`);
    return { ...base, outcome: 'failed', jobAction: 'failed', reason: answer.reason };
  }
  clearAlarm();

  const wanted = { youtubeTitle: answer.title, youtubeDescription: answer.description, youtubeTags: answer.tags };
  const filled = await catalog.fillYoutubeCopy(editId, wanted, scope);
  if (!filled.ok) {
    if (filled.status === 400) {
      queue.block({ stage: STAGE_YOUTUBE_COPY, subjectKind: SUBJECT_VIDEO_EDIT, subjectId: editId, reason: `the catalog refused the text: ${filled.error}`, payload: job.payload || null, jobId: job.id });
      return { ...base, outcome: 'blocked', jobAction: 'blocked', reason: `the catalog refused the text: ${filled.error}` };
    }
    return releaseIt(`the YouTube text for edit ${editId} could not be written: ${filled.error}`);
  }
  // Read back: every field this run wrote must hold exactly what was sent.
  const back = filled.data;
  const wrong = filled.written.filter((k) => JSON.stringify(back[k]) !== JSON.stringify(wanted[k]));
  if (wrong.length) return releaseIt(`the YouTube text for edit ${editId} was written but ${wrong.join(', ')} read back differently`);
  const cleared = await catalog.clearYoutubeCopyProblem(editId, scope);
  const clearNote = cleared && cleared.ok ? '' : ` (the old reason could not be taken off the card: ${cleared && cleared.error})`;
  const kept = filled.kept.length ? `; left as Dane wrote them: ${filled.kept.join(', ')}` : '';
  return completeIt(filled.written.length ? 'written' : 'kept',
    `wrote ${filled.written.join(', ') || 'nothing'}${kept}${clearNote}`,
    { written: filled.written, kept: filled.kept, title: answer.title, project: which.project });
}

/** Claim and write up to `max` jobs. The daemon calls it with `max: 1`. An outage stops the run. */
async function runYoutubeCopy(options = {}) {
  const { queue, owner = `youtubecopy-${process.pid}`, max = 1 } = options;
  if (!queue) throw new Error('runYoutubeCopy needs a queue (workers/studio/queue.js)');
  const report = { owner, written: [], kept: [], movedOn: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_YOUTUBE_COPY] });
    if (!job) break;
    let result;
    try {
      result = await youtubeCopyJob({ ...options, queue, job, owner, options });
    } catch (err) {
      const reason = `writing this edit's YouTube text threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, editId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      written: report.written, kept: report.kept, moved_on: report.movedOn, failed: report.failed,
      blocked: report.blocked, outage: report.released, lost: report.lost,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runYoutubeCopy,
  youtubeCopyJob,
  realCatalog,
  watchYoutubeCopy,
  enqueueYoutubeCopy,
  emptyFields,
  machineReason,
  STAGE_YOUTUBE_COPY,
  STAGE_YOUTUBE_COPY_WATCH,
  SUBJECT_VIDEO_EDIT,
  YOUTUBE_COPY_WATCH_EVERY_MS,
  RETRY_BLOCKED_AFTER_MS,
  MACHINE_HOLD_MS,
  ALARM_JOB,
};
