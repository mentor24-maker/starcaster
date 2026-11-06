'use strict';

/**
 * "Preview Build" and "Build draft pages" on Builder › Site Import
 * (task 86bcz9wcx). Dane, 2026-11-05: "I'd rather have a button on the screen
 * so I can launch the build myself."
 *
 * The build itself (scripts/site_import_map.mjs) cannot run inside the website:
 * it backs every page it touches up to local files (Vercel's disk is read-only,
 * landmine 6) and outlives a request. So the screen only QUEUES a build request
 * on the job, and the Mac Mini import worker — which already polls every five
 * minutes and has a disk — runs the script and records the result back on the
 * job. This module is the one place both halves read the rules from.
 *
 * Where it lives on the job row (no new column, so no SQL to apply):
 *   checkpoints.build         the latest request: { mode, noTheme, status,
 *                             requestedAt, requestedBy, startedAt, finishedAt,
 *                             fingerprint, result, error }
 *   checkpoints.buildPreview  the latest SUCCESSFUL preview: { at, noTheme,
 *                             fingerprint, result } — what Build is checked against
 *
 * status: 'queued' → 'running' → 'done' | 'failed'.
 */

const crypto = require('node:crypto');

const MODES = Object.freeze(['preview', 'apply']);
const ACTIVE = new Set(['queued', 'running']);

/** A build still "running" after this long means the worker died mid-run. */
const RUNNING_TOO_LONG_MS = 2 * 60 * 60 * 1000;

function buildRequestOf(job) {
  const value = job?.checkpoints?.build;
  return value && typeof value === 'object' ? value : null;
}

function buildPreviewOf(job) {
  const value = job?.checkpoints?.buildPreview;
  return value && typeof value === 'object' ? value : null;
}

/**
 * What the preview was taken against. If the site is captured again (a new
 * IR), or pages are built from it since (the map checkpoint moves), the plan
 * the operator read is no longer the plan a build would carry out.
 */
function buildFingerprint(job) {
  const cp = job?.checkpoints || {};
  const parts = {
    ir: cp.normalize?.blobPath || '',
    irAt: cp.normalize?.at || '',
    mapAt: cp.map?.at || '',
    pages: Object.keys(cp.map?.pageIds || {}).length,
  };
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/**
 * Decide whether a request may be queued. Returns { ok: true, request } with
 * the record to store, or { ok: false, status, code, message } in plain words.
 */
function planBuildRequest(job, { mode, noTheme = false, userId = '', now = new Date() } = {}) {
  if (!MODES.includes(mode)) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `Unknown build step "${mode}" — use "preview" or "apply".` };
  }
  if (job?.status !== 'complete' || !job?.checkpoints?.normalize?.blobPath) {
    return {
      ok: false, status: 409, code: 'NOT_CAPTURED',
      message: 'This import has not finished copying the site yet, so there is nothing to build pages from.',
    };
  }
  const current = buildRequestOf(job);
  if (current && ACTIVE.has(current.status)) {
    const what = current.mode === 'apply' ? 'A build' : 'A preview';
    return {
      ok: false, status: 409, code: 'BUILD_IN_PROGRESS',
      message: `${what} is already ${current.status === 'queued' ? 'waiting for the import worker' : 'running'} for this import. Nothing new was started.`,
    };
  }
  const fingerprint = buildFingerprint(job);
  if (mode === 'apply') {
    const preview = buildPreviewOf(job);
    if (!preview) {
      return {
        ok: false, status: 409, code: 'PREVIEW_REQUIRED',
        message: 'Press "Preview Build" first — the build only runs after you have seen what it will do.',
      };
    }
    if (preview.fingerprint !== fingerprint) {
      return {
        ok: false, status: 409, code: 'PREVIEW_STALE',
        message: 'This import has changed since the preview (it was copied again, or pages were built from it). Press "Preview Build" again before building.',
      };
    }
  }
  return {
    ok: true,
    request: {
      mode,
      noTheme: Boolean(noTheme),
      status: 'queued',
      requestedAt: now.toISOString(),
      requestedBy: String(userId || ''),
      fingerprint,
    },
  };
}

/** Arguments for scripts/site_import_map.mjs. Never anything that publishes. */
function mapScriptArgs(jobId, request, resultFile) {
  const out = ['--job', String(jobId)];
  if (request.mode === 'apply') out.push('--apply');
  if (request.noTheme) out.push('--no-theme');
  out.push('--result-file', resultFile);
  return out;
}

/**
 * The last thing the script said before it stopped, as one plain line. The
 * mapper ends a failed run with "MAPPER FAILED: <reason>"; anything else
 * falls back to the last non-empty line of its error output.
 */
function failureReason(stderr, exitCode, signal) {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const failed = lines.reverse().find((l) => /MAPPER FAILED:/.test(l));
  if (failed) return failed.replace(/^.*MAPPER FAILED:\s*/, '');
  const errorLine = lines.find((l) => /^ERROR\b/.test(l));
  if (errorLine) return errorLine;
  if (signal) return `the build was stopped (${signal}) before it finished`;
  if (lines.length) return lines[0];
  return `the build script exited with code ${exitCode} without saying why`;
}

/**
 * The checkpoint patch to record once the script has finished. `job` is the
 * row read AFTER the run — an --apply run writes its own map checkpoint, and
 * that must be kept.
 */
function finishedCheckpoints(job, request, { ok, result, error, now = new Date() }) {
  const at = now.toISOString();
  const build = {
    ...request,
    status: ok ? 'done' : 'failed',
    finishedAt: at,
    result: result || null,
    error: ok ? '' : String(error || 'the build failed without saying why'),
  };
  const next = { ...(job.checkpoints || {}), build };
  if (ok && request.mode === 'preview') {
    next.buildPreview = { at, noTheme: Boolean(request.noTheme), fingerprint: buildFingerprint(job), result: result || null };
  }
  return next;
}

/**
 * A request left 'running' past the limit: the worker stopped partway (the
 * Mini restarted, the process was killed). Returns the failed record, or null.
 */
function staleRunning(request, now = Date.now()) {
  if (!request || request.status !== 'running') return null;
  const started = Date.parse(request.startedAt || request.requestedAt || '');
  if (Number.isFinite(started) && now - started < RUNNING_TOO_LONG_MS) return null;
  return {
    ...request,
    status: 'failed',
    finishedAt: new Date(now).toISOString(),
    error: 'The import worker stopped partway through this and never reported back. Nothing was published. Check Builder › Pages for drafts it may have made, then press "Preview Build" again.',
  };
}

/**
 * One worker pass over build requests (called from the import worker's
 * --drain, after the capture queue). Deps are injected so the whole sequence
 * is testable without a database or a child process:
 *   store      — listJobsWithBuildStatus, swapBuildRequest, getJob
 *   runScript  — async (jobId, request) => { ok, result, error }
 *   log        — line logger
 * Returns { ran, failed, reclaimed }. A request that cannot be claimed (it
 * moved) is skipped; a read that fails throws, like the capture queue.
 */
async function processBuildRequests({ store, runScript, log = () => {}, now = () => Date.now(), limit = 5 }) {
  const must = (res, what) => {
    if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
    return res.data;
  };
  let reclaimed = 0;
  for (const job of must(await store.listJobsWithBuildStatus('running', 20), 'list running builds')) {
    const request = buildRequestOf(job);
    const failed = staleRunning(request, now());
    if (!failed) continue;
    const swapped = await store.swapBuildRequest(job.id, request, { ...job.checkpoints, build: failed });
    if (swapped.ok) { reclaimed += 1; log(`build: ${job.id} was left running by a worker that stopped — marked failed`); }
  }

  let ran = 0;
  let failedCount = 0;
  for (let i = 0; i < limit; i += 1) {
    const queued = must(await store.listJobsWithBuildStatus('queued', 1), 'list queued builds');
    if (!queued.length) break;
    const job = queued[0];
    const request = buildRequestOf(job);
    const running = { ...request, status: 'running', startedAt: new Date(now()).toISOString() };
    const claimed = await store.swapBuildRequest(job.id, request, { ...job.checkpoints, build: running });
    if (!claimed.ok) {
      if (claimed.status === 409) continue; // somebody else took it, or it was re-queued
      throw new Error(`claim build ${job.id}: ${claimed.error || claimed.status}`);
    }
    log(`build: ${job.id} — ${request.mode === 'apply' ? 'building draft pages' : 'preview'}${request.noTheme ? ' (no theme)' : ''}`);
    let outcome;
    try {
      outcome = await runScript(job.id, running);
    } catch (err) {
      outcome = { ok: false, error: String(err?.message || err) };
    }
    const after = must(await store.getJob(job.id), `re-read ${job.id}`);
    const checkpoints = finishedCheckpoints(after, running, { ...outcome, now: new Date(now()) });
    must(await store.swapBuildRequest(job.id, running, checkpoints), `record build result for ${job.id}`);
    ran += 1;
    if (!outcome.ok) failedCount += 1;
    log(`build: ${job.id} — ${outcome.ok ? 'done' : `FAILED: ${outcome.error}`}`);
  }
  return { ran, failed: failedCount, reclaimed };
}

module.exports = {
  MODES,
  RUNNING_TOO_LONG_MS,
  buildRequestOf,
  buildPreviewOf,
  buildFingerprint,
  planBuildRequest,
  mapScriptArgs,
  failureReason,
  finishedCheckpoints,
  staleRunning,
  processBuildRequests,
};
