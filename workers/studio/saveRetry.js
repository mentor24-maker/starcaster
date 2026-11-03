'use strict';

/**
 * When a catalog SAVE fails: is it the network, or is it this recording?
 *
 * Task 86bcwzu4b. transcribePass.js and cutMarksPass.js both release a job
 * for 15 minutes, without spending an attempt, when the catalog cannot be
 * written. That rule is right for an outage and wrong for a fault that only
 * ever hits ONE file: on 2026-11-01 a 106-minute recording's transcript failed
 * to save on every try for two days, `attempts` stayed 0, and every retry
 * re-ran a 14-minute whisper first — the worker spent most of its time on it
 * and the cut-marks backfill crawled behind it.
 *
 * Two things, then, and this file is both:
 *
 *   1. WHICH IT IS. An outage hits every source; a fault in one file hits
 *      only that one. So each failed save is counted against its own
 *      (stage, source), every successful save anywhere is stamped, and a
 *      source is charged with its failures only when BOTH are true:
 *        - its saves have failed SAVE_FAILURE_LIMIT times in a row, and
 *        - some other save succeeded after its first failure — proof the
 *          catalog was reachable the whole time.
 *      With no other save to compare against, it stays released free: "could
 *      not tell" is never charged to a recording. That is cheap now, because
 *      of the second thing.
 *
 *   2. KEEP THE WORK. What whisper produced is written beside the WAV before
 *      the job is released, and the next try saves THAT instead of running
 *      whisper again. A retry is a save, not a 14-minute transcription. The
 *      file is deleted once a save is read back.
 *
 * SAVE_FAILURE_LIMIT is 4: at the 15-minute hold every pass uses, that is an
 * hour of failing while other recordings saved fine. The longest outage on
 * record (2026-08-16, 2.5 h) failed every save, so it would not have charged
 * anything — the "someone else succeeded" half is what guards that, not the
 * count.
 *
 * Both records live in the queue's own cache table, so they survive a daemon
 * restart and need no new schema.
 */

const fs = require('node:fs');
const path = require('node:path');

const SAVE_FAILURE_LIMIT = 4;

const LAST_SAVE_OK_KEY = 'catalog-save:last-ok';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function failureKey(stage, sourceId) {
  return `catalog-save:failures:${text(stage)}:${text(sourceId)}`;
}

function readJson(queue, key) {
  if (!queue || typeof queue.cacheGet !== 'function') return null;
  try {
    const raw = queue.cacheGet(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJson(queue, key, value) {
  if (!queue || typeof queue.cacheSet !== 'function') return;
  queue.cacheSet(key, JSON.stringify(value));
}

/**
 * A save for (stage, source) was written and read back. Clears its run of
 * failures, and counts one more success. "Succeeded since?" is answered by
 * that count, not by comparing clocks: two events in the same millisecond
 * would otherwise read as neither before nor after.
 */
function noteSaveSucceeded(queue, { stage, sourceId, now = Date.now() }) {
  const prior = readJson(queue, LAST_SAVE_OK_KEY);
  const seq = (prior && Number(prior.seq) > 0 ? Number(prior.seq) : 0) + 1;
  writeJson(queue, LAST_SAVE_OK_KEY, { seq, at: now, stage: text(stage), sourceId: text(sourceId) });
  writeJson(queue, failureKey(stage, sourceId), null);
}

/**
 * A save for (stage, source) failed. Returns the verdict and the evidence for it:
 *
 *   { charge: false, count, ... }  release it free, as before
 *   { charge: true,  count, lastOk, ... }  this recording's fault; stop retrying
 *
 * A charge resets the count, so a job queued again by hand gets a full run of
 * tries before it is charged a second time.
 */
function noteSaveFailed(queue, { stage, sourceId, error, now = Date.now(), limit = SAVE_FAILURE_LIMIT }) {
  const key = failureKey(stage, sourceId);
  const prior = readJson(queue, key);
  const lastOk = readJson(queue, LAST_SAVE_OK_KEY);
  const okSeq = lastOk && Number(lastOk.seq) > 0 ? Number(lastOk.seq) : 0;
  const firstAt = prior && Number.isFinite(Number(prior.firstAt)) ? Number(prior.firstAt) : now;
  const okSeqAtFirst = prior && Number.isFinite(Number(prior.okSeqAtFirst)) ? Number(prior.okSeqAtFirst) : okSeq;
  const count = (prior && Number(prior.count) > 0 ? Number(prior.count) : 0) + 1;
  const othersSaved = okSeq > okSeqAtFirst;
  const charge = count >= limit && othersSaved;
  writeJson(queue, key, charge ? null : { count, firstAt, okSeqAtFirst, lastError: text(error) });
  return { charge, count, limit, firstAt, othersSaved, lastOk: othersSaved ? lastOk : null };
}

/** One plain sentence for the release reason: how many in a row, and why it is not charged yet. */
function describeRelease(verdict) {
  const { count, limit, othersSaved } = verdict;
  if (count < limit) {
    return `This is failed save ${count} of ${limit} in a row for this source; at ${limit}, if other recordings are saving `
      + 'fine, it is charged to this recording instead of retried.';
  }
  return `That is ${count} failed saves in a row, but no other save has succeeded since the first, so this looks like `
    + 'the catalog being unreachable rather than this recording — released without spending an attempt.';
}

/** The sentence for a charge: the count, and the other save that proves the catalog was reachable. */
function describeCharge(verdict) {
  const ok = verdict.lastOk || {};
  const when = Number.isFinite(Number(ok.at)) ? new Date(Number(ok.at)).toISOString() : 'recently';
  return `Its save has now failed ${verdict.count} times in a row while other saves succeeded `
    + `(the latest: ${text(ok.stage) || 'a save'} for source ${text(ok.sourceId) || '?'} at ${when}), `
    + 'so this is about this recording, not the network, and it is no longer retried.';
}

/** Where a stage keeps unsaved work for a source: beside the WAV it came from. */
function unsavedPath(wavPath, stage) {
  return path.join(path.dirname(wavPath), `${text(stage)}-unsaved.json`);
}

function wavBytes(wavPath, stat) {
  try {
    return stat(wavPath).size;
  } catch (_) {
    return null;
  }
}

/**
 * Keep what this run produced so the next try can save it without redoing it.
 * Best effort: a disk that refuses only costs the next try a whisper run, which
 * is how it was before. Returns the path written, or '' when it could not be.
 */
function keepUnsaved({ wavPath, stage, sourceId, data, outcome, reason, stat = fs.statSync, writeFile = fs.writeFileSync }) {
  if (!text(wavPath)) return '';
  const file = unsavedPath(wavPath, stage);
  try {
    writeFile(file, JSON.stringify({
      sourceId: text(sourceId),
      wavPath,
      wavBytes: wavBytes(wavPath, stat),
      outcome,
      reason,
      data,
    }));
    return file;
  } catch (_) {
    return '';
  }
}

/**
 * The work an earlier try kept, if it is for THIS source and THIS WAV. A WAV
 * that has been remade since (different size) means the kept work describes
 * a different recording, so it is thrown away rather than saved.
 */
function takeUnsaved({ wavPath, stage, sourceId, stat = fs.statSync, readFile = fs.readFileSync }) {
  if (!text(wavPath)) return null;
  const file = unsavedPath(wavPath, stage);
  let kept;
  try {
    kept = JSON.parse(readFile(file, 'utf8'));
  } catch (_) {
    return null;
  }
  const current = wavBytes(wavPath, stat);
  if (!kept || typeof kept !== 'object' || !kept.data
    || text(kept.sourceId) !== text(sourceId) || kept.wavPath !== wavPath
    || current == null || Number(kept.wavBytes) !== current) {
    dropUnsaved({ wavPath, stage });
    return null;
  }
  return { file, data: kept.data, outcome: kept.outcome, reason: kept.reason };
}

function dropUnsaved({ wavPath, stage }) {
  if (!text(wavPath)) return;
  try {
    fs.rmSync(unsavedPath(wavPath, stage), { force: true });
  } catch (_) { /* nothing kept, or nothing we can do about it */ }
}

module.exports = {
  noteSaveSucceeded,
  noteSaveFailed,
  describeRelease,
  describeCharge,
  keepUnsaved,
  takeUnsaved,
  dropUnsaved,
  unsavedPath,
  SAVE_FAILURE_LIMIT,
};
