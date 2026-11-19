'use strict';

/**
 * The moments PASS — what scores each recording's best moments on the Mini.
 *
 * Reel Spinner 2d (SC-829). The rules are 2c's (workers/studio/moments.js);
 * nothing is decided here. This pass claims a `moments` job and:
 *
 *   1. reads the recording's clean transcript and its cut marks back from the
 *      catalog (the cut-marks pass queued this job when it wrote a `done` row);
 *   2. reads the Context notes Dane switched on for Reel Spinner, through
 *      lib/contextFor.js `readContextFor` — the brief, and its fingerprint;
 *   3. hands all three to `scoreMoments`, which asks the AI door (lib/aiClient.js
 *      `generate`, SC-843) — never a provider by name;
 *   4. writes video_moments with lib/videoMomentsStore.js, READS IT BACK and
 *      compares before completing (CLAUDE.md landmines 12/13).
 *
 * A moment is a decision, never a clip: no video file is touched.
 *
 * WHAT IS CHARGED TO THE RECORDING, AND WHAT IS NOT — the line transcribePass
 * and cutMarksPass draw, applied to an AI call:
 *
 *   No AI provider in the order can serve (every one out of credit or without
 *   a key, as `generate()` reports with code `no_provider`), or no network at
 *   all: a fact about the MACHINE. The job is released for an hour with no
 *   attempt spent, NO row is written, and the bus hears once per six hours
 *   (scripts/report_job_failure.mjs, `reel-spinner-scoring`) in plain words:
 *   "Reel Spinner scoring is stopped: no AI provider can pay. Anthropic: out
 *   of credit. OpenAI: no key". The next successful score clears that stamp,
 *   so a fault that is fixed and comes back is announced again at once.
 *
 *   The catalog or the notes unreadable: also the machine's; released for 15
 *   minutes like every other Studio pass, no attempt spent, no row.
 *
 *   An answer the rules refuse (not the agreed shape, cut off, no moment that
 *   could be placed), or no notes switched on: a VERDICT about this recording.
 *   A `failed` row carries the reason (DOCTRINE 5.31) and the job completes,
 *   because the verdict was delivered — retrying it on the queue's backoff
 *   would spend credit five times to be refused five times. Dane asks for a
 *   rescore from the screen (2e) when the brief or the rules change.
 *
 *   Any other failed call (a timeout, a rate limit, a provider refusing the
 *   request) is this recording's, but not yet a verdict: the job fails through
 *   the queue's retry rules, and only when those run out is a `failed` row
 *   written, saying why — so the screen never shows "not scored" for a
 *   recording that was tried five times. A recording that already has `done`
 *   moments (a rescore meeting an outage) keeps them; only the blocked job
 *   says why the rescore did not happen.
 *
 * THE BRIEF IS FINGERPRINTED, NOT WATCHED. Every row stores the fingerprint of
 * the notes it was scored against. Editing the notes does NOT rescore anything
 * by itself — that spends money on every recording, which is Dane's call — the
 * row only shows it was scored against an older version.
 *
 * RESCORING. `video_moments.rescore_requested_at` is set from the screen; the
 * daemon's `moments.rescore` watcher (`watchRescores` below) reads it every
 * minute and queues one job per request. The queue's live-job index makes a
 * request seen twice one job, and `upsertMoments` clears the stamp only for a
 * request made before the run began (`runStartedAt`), so a request made while
 * a score was running survives it and is answered by the next one.
 *
 * A SAVE THAT FAILS AFTER THE MODEL ANSWERED is kept in the queue's local cache
 * for a day, so the retry writes the paid-for answer instead of buying it again.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { scoreMoments, momentsConfig, RULES_VERSION } = require('./moments.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoTranscriptsStore = require('../../lib/videoTranscriptsStore.js');
const videoCutMarksStore = require('../../lib/videoCutMarksStore.js');
const videoMomentsStore = require('../../lib/videoMomentsStore.js');

const STAGE_MOMENTS = 'moments';
const STAGE_RESCORE_WATCH = 'moments.rescore';
const SUBJECT_VIDEO_SOURCE = 'video_source';

const MOMENTS_DONE = 'done';
const MOMENTS_FAILED = 'failed';
const TRANSCRIPT_DONE = 'done';
const CUTS_DONE = 'done';

/** The name the bus alarm goes out under, and its six-hour stamp's name. */
const ALARM_JOB = 'reel-spinner-scoring';

/** No provider can pay, or no network: wait an hour (the 1c whisper rule). */
const MACHINE_HOLD_MS = 60 * 60 * 1000;
/** The catalog or the notes could not be read: the other Studio passes' hold. */
const CATALOG_HOLD_MS = 15 * 60 * 1000;
/** The lease covers the model call's whole timeout plus the reads and writes around it. */
const LEASE_MARGIN_MS = 5 * 60 * 1000;
/** How long a paid-for answer whose save failed is kept for the retry. */
const UNSAVED_TTL_MS = 24 * 60 * 60 * 1000;
/** How often the daemon asks the catalog for rescore requests. */
const RESCORE_WATCH_EVERY_MS = 60 * 1000;

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

function realCatalog() {
  return {
    getSourceById: videoSourcesStore.getSourceById,
    getTranscriptBySource: videoTranscriptsStore.getTranscriptBySource,
    getCutMarksBySource: videoCutMarksStore.getCutMarksBySource,
    upsertMoments: videoMomentsStore.upsertMoments,
    getMomentsBySource: videoMomentsStore.getMomentsBySource,
    listRescoreRequests: videoMomentsStore.listRescoreRequests,
  };
}

function realReadBrief(args) {
  return require('../../lib/contextFor.js').readContextFor(args);
}

/**
 * Is a failed call the MACHINE's fault? No provider able to pay, or no network
 * at all. A timeout is not: the network answered nothing in time for THIS
 * recording's prompt, which may be too long, so it spends an attempt.
 */
function isMachineFault(result) {
  if (!result || result.state !== MOMENTS_FAILED || !result.retryable) return false;
  if (result.callCode === 'no_provider') return true;
  if (result.callCode === 'no_answer') return !/no answer within/i.test(text(result.reason));
  return false;
}

/**
 * The alarm sentence. `skipped` is the door's list of providers it could not
 * use, each with the verdict `npm run ai-keys` would give.
 */
function machineFaultReason(result) {
  if (result.callCode !== 'no_provider') {
    return `Reel Spinner scoring is stopped: this machine could not reach any AI provider (${text(result.reason)}).`;
  }
  const said = (result.skipped || []).map((s) => {
    const label = text(s.label) || text(s.provider) || 'a provider';
    if (s.verdict === 'NOT SET') return `${label}: no key`;
    if (s.verdict === 'INVALID') return `${label}: key refused`;
    if (s.verdict === 'OUT OF CREDIT' || s.verdict === 'OUT_OF_CREDIT') return `${label}: out of credit`;
    return `${label}: ${text(s.reason) || 'cannot serve'}`;
  });
  return `Reel Spinner scoring is stopped: no AI provider can pay. ${said.length ? `${said.join('. ')}.` : text(result.reason)}`;
}

/**
 * Post the alarm through scripts/report_job_failure.mjs — the one committed
 * failure path, which holds the six-hour throttle in its own stamp file. It
 * always exits 0; its stderr says whether the bus got the post.
 */
function realAlarm(reason, { run = spawnSync, env = process.env } = {}) {
  const res = run(process.execPath, [
    path.join(REPO_ROOT, 'scripts', 'report_job_failure.mjs'),
    '--job', ALARM_JOB, '--status', 'stopped', '--reason', reason,
  ], { env, encoding: 'utf8', timeout: 60 * 1000 });
  return { said: text(res && (res.stderr || res.stdout)) || (res && res.error ? res.error.message : '') };
}

/** A score landed: clear the alarm's stamp, so the next stoppage is news at once. */
function realClearAlarm() {
  try {
    const { heartbeatDir } = require('../../lib/nodeHeartbeat.js');
    fs.rmSync(path.join(heartbeatDir(), `failed-${ALARM_JOB}.stamp`), { force: true });
  } catch {
    // Not clearing a throttle stamp costs one quiet window at most.
  }
}

/**
 * Put a moments job on the queue for one source. Keyed by the source id, so
 * the queue's unique index on live (stage, subject) jobs is the dedupe: the
 * cut-marks pass, the backfill and a rescore request all get the same job.
 */
function enqueueMoments(queue, { sourceId, why = '' }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueMoments needs a source id');
  return queue.enqueue({
    stage: STAGE_MOMENTS,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id, ...(text(why) ? { why: text(why) } : {}) },
  });
}

function leaseForMoments(config) {
  return config.timeoutMs + LEASE_MARGIN_MS;
}

/** Same moments, same order? Compared on what a person would act on. */
function sameMoments(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((m, i) => Math.abs(Number(m.start_s) - Number(b[i].start_s)) < 0.001
    && Math.abs(Number(m.end_s) - Number(b[i].end_s)) < 0.001
    && Number(m.score) === Number(b[i].score));
}

function unsavedKey(sourceId) {
  return `moments-unsaved:${text(sourceId).toLowerCase()}`;
}

/** The row's `summary`; a "nothing stands on its own" answer carries its reason there. */
function summaryOf(result) {
  const summary = text(result.summary);
  const none = text(result.noneReason);
  return none ? `${summary}\n\nNo moment stands on its own: ${none}` : summary;
}

/** "anthropic/claude-sonnet-5-5, 9,000 in / 1,200 out, $0.03" — for the log and the backfill. */
function describeSpend(result) {
  const { priceCall } = require('../../lib/aiPricing.js');
  const usage = result && result.usage;
  if (!usage || !result.model) return '';
  const promptTokens = Number(usage.promptTokens ?? usage.input_tokens ?? usage.prompt_tokens) || 0;
  const completionTokens = Number(usage.completionTokens ?? usage.output_tokens ?? usage.completion_tokens) || 0;
  const cachedTokens = Number(usage.cachedTokens) || 0;
  const provider = text(result.provider) || text(result.model).split('/')[0];
  const model = text(result.model).includes('/') ? text(result.model).split('/').slice(1).join('/') : text(result.model);
  const price = priceCall({ provider, model, promptTokens, completionTokens, cachedTokens });
  const cost = price.priced ? `$${price.costUsd.toFixed(4)}` : `cost not priced (${price.reason})`;
  return `${result.model}, ${promptTokens} in / ${completionTokens} out, ${cost}`;
}

/**
 * Score one claimed job. The caller owns the claim; this never claims. Every
 * return says what happened to the MOMENTS (`outcome`) and what the queue was
 * told (`jobAction`).
 */
async function momentsJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  options = {},
  env = process.env,
  readBrief = realReadBrief,
  score = scoreMoments,
  config = momentsConfig(env),
  alarm = realAlarm,
  clearAlarm = realClearAlarm,
  now = () => Date.now(),
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const sourceId = text(payload.sourceId) || text(job && job.subjectId);
  const base = { jobId: job.id, sourceId };
  const scope = scopeFor(options, env);
  // Taken before anything is read: a rescore asked for after this instant was
  // not answered by this run, and upsertMoments keeps it (videoMomentsStore).
  const runStartedAt = new Date(now()).toISOString();

  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_MOMENTS,
      subjectKind: SUBJECT_VIDEO_SOURCE,
      subjectId: sourceId || text(job.subjectId),
      reason,
      payload: job.payload || null,
      jobId: job.id,
    });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const releaseIt = (reason, holdMs = CATALOG_HOLD_MS) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: holdMs })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };

  /** Write a moments row, read it back, settle the job — or say why not. */
  const settle = async (data, { outcome, reason, jobAction = 'complete', result = null, startedAt = runStartedAt }) => {
    const row = { ...data, rulesVersion: RULES_VERSION, runStartedAt: startedAt };
    const saved = await catalog.upsertMoments(sourceId, row, scope);
    const keep = () => {
      if (result && typeof queue.cacheSet === 'function') {
        queue.cacheSet(unsavedKey(sourceId), JSON.stringify({ data, outcome, reason, jobAction, startedAt }), { ttlMs: UNSAVED_TTL_MS });
      }
    };
    if (!saved.ok) {
      if (saved.status === 400 || saved.status === 404) {
        return blockIt(`the ${data.status} moments for source ${sourceId} were refused by the catalog: ${saved.error}`);
      }
      keep();
      return releaseIt(`the ${data.status} moments for source ${sourceId} could not be written: ${saved.error}.`
        + (result ? ' The answer is kept on this machine for a day, so the next try saves it without paying for it again.' : ''));
    }
    // Read it back (landmines 12/13): the write answering 200 is not the evidence.
    const back = await catalog.getMomentsBySource(sourceId, scope);
    if (!back.ok) {
      keep();
      return releaseIt(`the moments for source ${sourceId} were written but could not be read back: ${back.error}`);
    }
    const got = back.data;
    const moments = Array.isArray(data.moments) ? data.moments : [];
    if (!got || text(got.status) !== data.status || text(got.rulesVersion) !== RULES_VERSION
      || text(got.briefFingerprint) !== text(data.briefFingerprint) || !sameMoments(got.moments, moments)) {
      return blockIt(`the moments for source ${sourceId} were written as "${data.status}" with ${moments.length} moment(s) `
        + `but read back as "${text(got && got.status) || 'nothing'}" with ${got && Array.isArray(got.moments) ? got.moments.length : 0}, `
        + 'so the catalog did not keep them. '
        + `Fix: inspect video_moments for source ${sourceId} by hand, then delete this blocked job.`);
    }
    if (typeof queue.cacheSet === 'function') queue.cacheSet(unsavedKey(sourceId), '', { ttlMs: 1 });
    // Done moments are what the rough cut (Reel Spinner 4b) waits on. Queued
    // only after the row read back as kept, so a rough cut never starts from
    // moments the catalog does not hold. A second scoring queues the same live
    // job, and the rough-cut pass creates no second set of edit rows.
    let roughCut = null;
    if (data.status === MOMENTS_DONE) {
      try {
        const { job: queued, created } = require('./roughCutPass.js').enqueueRoughCut(queue, { sourceId, why: 'its moments are scored' });
        roughCut = { jobId: queued.id, created };
      } catch (err) {
        roughCut = { error: `the rough cut could not be queued: ${err.message} (npm run studio:backfill-roughcuts catches it up)` };
      }
    }
    if (jobAction === 'fail') {
      queue.fail(job.id, owner, reason);
      return { ...base, outcome, jobAction: 'failed', reason };
    }
    const completed = queue.complete(job.id, owner);
    return { ...base, outcome, jobAction: completed ? 'completed' : 'none', reason, ...(roughCut ? { roughCut } : {}) };
  };

  if (!sourceId) {
    return blockIt('this moments job names no source, so there is nothing to score. '
      + 'Fix: this should not be reachable from the cut-marks pass — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the moments cannot be written in their project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  // An earlier try paid for an answer and only the save failed: save that.
  const keptRaw = typeof queue.cacheGet === 'function' ? queue.cacheGet(unsavedKey(sourceId)) : null;
  if (keptRaw) {
    let kept = null;
    try { kept = JSON.parse(keptRaw); } catch { kept = null; }
    if (kept && kept.data) {
      const result = await settle(kept.data, { outcome: kept.outcome, reason: kept.reason, jobAction: kept.jobAction, result: kept, startedAt: kept.startedAt });
      if (result.outcome === 'done') clearAlarm();
      return { ...result, savedFromEarlierTry: true };
    }
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so its moments have nothing to belong to. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }

  const transcript = await catalog.getTranscriptBySource(sourceId, scope);
  if (!transcript.ok) return releaseIt(`the transcript of source ${sourceId} could not be read: ${transcript.error}`);
  if (!transcript.data || text(transcript.data.state) !== TRANSCRIPT_DONE) {
    return blockIt(`source ${sourceId} has no finished transcript (it reads "${text(transcript.data && transcript.data.state) || 'none'}"), `
      + 'so there are no words to score. Fix: re-run its transcription, then delete this blocked job.');
  }
  const cuts = await catalog.getCutMarksBySource(sourceId, scope);
  if (!cuts.ok) return releaseIt(`the cut marks of source ${sourceId} could not be read: ${cuts.error}`);
  if (!cuts.data || text(cuts.data.state) !== CUTS_DONE) {
    // Only a done cut-marks row queues this job: a moment must not start or
    // end inside a cut, and with no cuts that cannot be checked.
    return blockIt(`source ${sourceId} has no finished cut marks (they read "${text(cuts.data && cuts.data.state) || 'none'}"), `
      + 'so a moment could start inside an "um". Fix: re-run its cut marks (npm run studio:backfill-cuts), then delete this blocked job.');
  }

  const brief = await readBrief({ projectId: scope.projectId, use: 'reel-spinner' });
  if (!brief || !brief.ok) {
    return releaseIt(`the Reel Spinner notes for project ${scope.projectId} could not be read, so nothing was scored: `
      + `${(brief && brief.error) || 'no answer'}`);
  }

  if (!queue.heartbeat(job.id, owner, { leaseMs: leaseForMoments(config) })) {
    return { ...base, outcome: 'lost', jobAction: 'none',
      reason: `the lease on job ${job.id} was no longer this worker's, so the scoring was left to whoever holds it` };
  }

  const durationS = Number(cuts.data.durationS) > 0 ? Number(cuts.data.durationS) : Number(row.data.durationS);
  const briefText = text(brief.data && brief.data.text);
  const result = await score({
    words: Array.isArray(transcript.data.words) ? transcript.data.words : [],
    marks: Array.isArray(cuts.data.marks) ? cuts.data.marks : [],
    durationS,
    brief: { text: briefText, fingerprint: text(brief.data && brief.data.fingerprint) },
  }, { config, scope });

  if (result.state === MOMENTS_DONE) {
    const spend = describeSpend(result);
    const settled = await settle({
      status: MOMENTS_DONE,
      moments: result.moments,
      summary: summaryOf(result),
      briefFingerprint: result.briefFingerprint,
      model: result.model,
    }, {
      outcome: 'done',
      reason: `${result.moments.length} moment(s)${spend ? ` — ${spend}` : ''}`,
      result,
    });
    if (settled.outcome === 'done') clearAlarm();
    return { ...settled, provider: result.provider || '', spend };
  }

  if (isMachineFault(result)) {
    const reason = machineFaultReason(result);
    const posted = alarm(reason, { env });
    const released = releaseIt(`${reason} Source ${sourceId} was left as it was and will be tried again in an hour.`, MACHINE_HOLD_MS);
    return { ...released, alarm: posted && posted.said ? posted.said : '' };
  }

  // The rules' notes-missing refusal reads better with the notes reader's own sentence beside it.
  const why = !briefText && text(brief.data && brief.data.reason)
    ? `${result.reason} (${text(brief.data.reason)})`
    : text(result.reason);
  const failedRow = {
    status: MOMENTS_FAILED,
    moments: [],
    summary: '',
    briefFingerprint: result.briefFingerprint || text(brief.data && brief.data.fingerprint) || null,
    model: result.model || '',
    error: why,
  };

  if (!result.retryable) {
    // A verdict: written, and the job is done with it.
    return settle(failedRow, { outcome: 'failed', reason: why, result });
  }

  // A failed call that is this recording's but not yet a verdict: the queue's
  // retries decide. Only when they run out is the reason written on the row.
  queue.fail(job.id, owner, why);
  const after = typeof queue.getJob === 'function' ? queue.getJob(job.id) : null;
  if (after && after.state === 'blocked') {
    return recordRetriesRanOut({ catalog, sourceId, scope, failedRow, runStartedAt, base, why });
  }
  return { ...base, outcome: 'failed', jobAction: 'failed', reason: why };
}

/**
 * The queue's retries ran out on a failure that was never a verdict (a rate
 * limit, a timeout, a provider refusing the request). The blocked job carries
 * the reason either way; the question is what the ROW says.
 *
 * A recording that already has `done` moments KEEPS them. This is a rescore
 * that met a temporary outage, and five rate limits must not replace paid-for,
 * good moments with an empty `failed` row (SC-829 review). Its rescore stamp is
 * left standing, and the watcher reports the blocked job's reason against it.
 *
 * Otherwise the `failed` row is written, so the screen never shows "not
 * scored" for a recording tried five times — and READ BACK like every other
 * write here (landmines 12/13). When the existing row cannot be read, nothing
 * is written: overwriting what might be good moments is the expensive mistake.
 */
async function recordRetriesRanOut({ catalog, sourceId, scope, failedRow, runStartedAt, base, why }) {
  const blocked = { ...base, outcome: 'failed', jobAction: 'blocked', reason: why };
  const before = await catalog.getMomentsBySource(sourceId, scope);
  if (!before.ok) {
    return { ...blocked, rowNotWritten: `the existing moments could not be read (${before.error}), `
      + 'so nothing was written over them; the blocked job carries the reason' };
  }
  if (before.data && text(before.data.status) === MOMENTS_DONE) {
    const count = Array.isArray(before.data.moments) ? before.data.moments.length : 0;
    return { ...blocked, keptEarlierMoments: count,
      rowNotWritten: `the ${count} moment(s) already scored were kept; the blocked job carries the reason` };
  }
  const saved = await catalog.upsertMoments(sourceId, { ...failedRow, rulesVersion: RULES_VERSION, runStartedAt }, scope);
  if (!saved.ok) return { ...blocked, rowNotWritten: saved.error };
  const back = await catalog.getMomentsBySource(sourceId, scope);
  if (!back.ok) return { ...blocked, rowNotWritten: `the failed row was written but could not be read back: ${back.error}` };
  if (!back.data || text(back.data.status) !== MOMENTS_FAILED || text(back.data.error) !== text(failedRow.error)) {
    return { ...blocked, rowNotWritten: `the failed row was written but read back as "${text(back.data && back.data.status) || 'nothing'}", `
      + `so the catalog did not keep it. Fix: inspect video_moments for source ${sourceId} by hand.` };
  }
  return blocked;
}

/**
 * Claim and score up to `max` jobs. The daemon calls it with `max: 1`: one
 * scoring is a few minutes of waiting on a model, and the daemon must get back
 * to the other stages. An outage stops the run, so the same fault is not met
 * on every job behind it.
 */
async function runMoments(options = {}) {
  const {
    queue,
    owner = `moments-${process.pid}`,
    catalog = realCatalog(),
    env = process.env,
    max = 1,
    readBrief = realReadBrief,
    score = scoreMoments,
    alarm = realAlarm,
    clearAlarm = realClearAlarm,
    now = () => Date.now(),
  } = options;
  if (!queue) throw new Error('runMoments needs a queue (workers/studio/queue.js)');

  const report = { owner, done: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_MOMENTS] });
    if (!job) break;
    let result;
    try {
      result = await momentsJob({ queue, job, owner, catalog, options, env, readBrief, score, alarm, clearAlarm, now });
    } catch (err) {
      const reason = `scoring this source threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      done: report.done,
      failed: report.failed,
      blocked: report.blocked,
      outage: report.released,
      lost: report.lost,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

/**
 * The daemon's clock-driven half: queue one scoring job for every recording
 * Dane asked to have scored again. Runs twice, it queues nothing new — a live
 * job for the source is the same job — and a request whose job is BLOCKED
 * since the request was made is left alone, so a recording that cannot be
 * scored is not re-queued every minute.
 *
 * Returns the watcher shape formatWatch reads: `processed` (queued), `skipped`
 * (already waiting, or blocked) and `failed`, with `ok`.
 */
async function watchRescores({ queue, env = process.env, options = {}, catalog = realCatalog() } = {}) {
  const scope = scopeFor(options, env);
  if (!scope) {
    return { ok: true, processed: [], skipped: [], failed: [], notConfigured: 'STUDIO_PROJECT_ID is not set' };
  }
  const asked = await catalog.listRescoreRequests(scope);
  if (!asked.ok) {
    return { ok: false, processed: [], skipped: [], failed: [], error: `rescore requests could not be read: ${asked.error}` };
  }
  const jobs = queue.listJobs({ stage: STAGE_MOMENTS });
  const processed = [];
  const skipped = [];
  for (const request of asked.data) {
    const id = text(request.sourceId);
    const askedAt = Date.parse(request.rescoreRequestedAt) || 0;
    const blocked = jobs.find((j) => j.state === 'blocked' && text(j.subjectId).toLowerCase() === id.toLowerCase()
      && Number(j.updatedAt) >= askedAt);
    if (blocked) {
      skipped.push({ sourceId: id, why: `its scoring job ${blocked.id} is blocked: ${blocked.lastError}` });
      continue;
    }
    const { job, created } = enqueueMoments(queue, { sourceId: id, why: `rescore asked for at ${request.rescoreRequestedAt}` });
    if (created) processed.push({ sourceId: id, jobId: job.id });
    else skipped.push({ sourceId: id, why: `job ${job.id} is already waiting` });
  }
  return { ok: true, processed, skipped, failed: [], truncated: Boolean(asked.truncated) };
}

module.exports = {
  runMoments,
  momentsJob,
  enqueueMoments,
  watchRescores,
  isMachineFault,
  machineFaultReason,
  describeSpend,
  leaseForMoments,
  STAGE_MOMENTS,
  STAGE_RESCORE_WATCH,
  RESCORE_WATCH_EVERY_MS,
  MACHINE_HOLD_MS,
  ALARM_JOB,
};
