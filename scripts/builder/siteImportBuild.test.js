'use strict';

/**
 * lib/siteImportBuild.js — the Site Import screen's "Preview build" / "Build
 * draft pages" (task 86bcz9wcx). Pins: Build refuses without a preview and
 * after the job changed; a request already waiting is not doubled; the worker
 * pass claims, runs, keeps what the build script wrote, and records a result;
 * a build a dead worker left "running" is named as failed; and the script is
 * never asked to do anything but a dry run or --apply.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const build = require('../../lib/siteImportBuild.js');

const CAPTURED = {
  id: 'simp_1',
  status: 'complete',
  checkpoints: {
    normalize: { at: '2026-11-05T10:00:00.000Z', blobPath: 'https://blob/ir.json' },
  },
};

function withCheckpoints(job, extra) {
  return { ...job, checkpoints: { ...job.checkpoints, ...extra } };
}

test('preview may be queued on a captured job', () => {
  const plan = build.planBuildRequest(CAPTURED, { mode: 'preview', userId: 'u1', now: new Date('2026-11-05T11:00:00Z') });
  assert.equal(plan.ok, true);
  assert.equal(plan.request.status, 'queued');
  assert.equal(plan.request.mode, 'preview');
  assert.equal(plan.request.requestedBy, 'u1');
  assert.equal(plan.request.fingerprint, build.buildFingerprint(CAPTURED));
});

test('nothing may be queued before the copy has finished', () => {
  const plan = build.planBuildRequest({ ...CAPTURED, status: 'capturing' }, { mode: 'preview' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'NOT_CAPTURED');
});

test('an unknown mode is refused', () => {
  const plan = build.planBuildRequest(CAPTURED, { mode: 'publish' });
  assert.equal(plan.ok, false);
  assert.equal(plan.status, 400);
});

test('build refuses without a preview, in plain words', () => {
  const plan = build.planBuildRequest(CAPTURED, { mode: 'apply' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'PREVIEW_REQUIRED');
  assert.match(plan.message, /Preview Build/);
});

test('build is allowed once a preview matches the job', () => {
  const job = withCheckpoints(CAPTURED, { buildPreview: { at: 'x', fingerprint: build.buildFingerprint(CAPTURED) } });
  const plan = build.planBuildRequest(job, { mode: 'apply', noTheme: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.request.noTheme, true);
});

test('build refuses when the job changed since the preview (re-captured, or built since)', () => {
  const preview = { at: 'x', fingerprint: build.buildFingerprint(CAPTURED) };
  const recaptured = withCheckpoints(CAPTURED, {
    buildPreview: preview,
    normalize: { at: '2026-11-06T00:00:00.000Z', blobPath: 'https://blob/ir2.json' },
  });
  assert.equal(build.planBuildRequest(recaptured, { mode: 'apply' }).code, 'PREVIEW_STALE');
  const builtSince = withCheckpoints(CAPTURED, {
    buildPreview: preview,
    map: { at: '2026-11-05T12:00:00.000Z', pageIds: { '/': 'p1' } },
  });
  assert.equal(build.planBuildRequest(builtSince, { mode: 'apply' }).code, 'PREVIEW_STALE');
});

test('a request already waiting or running is not doubled', () => {
  for (const status of ['queued', 'running']) {
    const job = withCheckpoints(CAPTURED, { build: { mode: 'preview', status } });
    const plan = build.planBuildRequest(job, { mode: 'preview' });
    assert.equal(plan.code, 'BUILD_IN_PROGRESS', status);
  }
  const done = withCheckpoints(CAPTURED, { build: { mode: 'preview', status: 'done' } });
  assert.equal(build.planBuildRequest(done, { mode: 'preview' }).ok, true);
});

test('the script is asked for a dry run or --apply, never anything that publishes', () => {
  assert.deepEqual(build.mapScriptArgs('j', { mode: 'preview' }, '/tmp/r.json'), ['--job', 'j', '--result-file', '/tmp/r.json']);
  assert.deepEqual(
    build.mapScriptArgs('j', { mode: 'apply', noTheme: true }, '/tmp/r.json'),
    ['--job', 'j', '--apply', '--no-theme', '--result-file', '/tmp/r.json']
  );
});

test('failure reason is the mapper\'s own last word', () => {
  const stderr = 'noise\n\nMAPPER FAILED: Job has no normalize checkpoint — run the import worker first.\n';
  assert.equal(build.failureReason(stderr, 1), 'Job has no normalize checkpoint — run the import worker first.');
  assert.match(build.failureReason('', null, 'SIGTERM'), /stopped \(SIGTERM\)/);
  assert.match(build.failureReason('', 3), /exited with code 3/);
});

test('a finished preview is recorded as the preview Build is checked against', () => {
  const request = { mode: 'preview', status: 'running', requestedAt: 'r' };
  const next = build.finishedCheckpoints(CAPTURED, request, { ok: true, result: { pages: [] }, now: new Date('2026-11-05T12:00:00Z') });
  assert.equal(next.build.status, 'done');
  assert.equal(next.buildPreview.fingerprint, build.buildFingerprint(CAPTURED));
  assert.equal(next.normalize.blobPath, CAPTURED.checkpoints.normalize.blobPath, 'other checkpoints are kept');
});

test('a failed run records the reason and leaves the previous preview alone', () => {
  const job = withCheckpoints(CAPTURED, { buildPreview: { at: 'old', fingerprint: 'f' } });
  const next = build.finishedCheckpoints(job, { mode: 'preview', status: 'running' }, { ok: false, error: 'boom' });
  assert.equal(next.build.status, 'failed');
  assert.equal(next.build.error, 'boom');
  assert.equal(next.buildPreview.at, 'old');
});

test('a build left running by a dead worker is named as failed after the limit', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const fresh = { status: 'running', startedAt: new Date(now - 10 * 60000).toISOString() };
  assert.equal(build.staleRunning(fresh, now), null);
  const old = { status: 'running', startedAt: new Date(now - build.RUNNING_TOO_LONG_MS - 1).toISOString() };
  const failed = build.staleRunning(old, now);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Nothing was published/);
  assert.equal(build.staleRunning({ status: 'queued' }, now), null);
});

function fakeStore(rows) {
  const writes = [];
  const byId = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  return {
    writes,
    byId,
    async listJobsWithBuildStatus(status, limit) {
      const out = [...byId.values()].filter((j) => j.checkpoints?.build?.status === status).slice(0, limit);
      return { ok: true, data: structuredClone(out) };
    },
    async swapBuildRequest(id, expected, checkpoints) {
      const row = byId.get(id);
      const cur = row?.checkpoints?.build;
      if (!cur || cur.status !== expected.status || cur.requestedAt !== expected.requestedAt) {
        return { ok: false, status: 409, error: 'moved' };
      }
      row.checkpoints = structuredClone(checkpoints);
      writes.push([id, checkpoints.build.status]);
      return { ok: true, data: structuredClone(row) };
    },
    async getJob(id) {
      return { ok: true, data: structuredClone(byId.get(id)) };
    },
  };
}

test('worker pass: claims a queued preview, runs it, records the result and the preview', async () => {
  const job = withCheckpoints(CAPTURED, { build: { mode: 'preview', status: 'queued', requestedAt: 'r1' } });
  const store = fakeStore([job]);
  const seen = [];
  const out = await build.processBuildRequests({
    store,
    runScript: async (id, request) => {
      seen.push([id, request.status]);
      return { ok: true, result: { pages: [{ path: '/', slug: 'home', name: 'Home', action: 'create' }] } };
    },
  });
  assert.deepEqual(out, { ran: 1, failed: 0, reclaimed: 0 });
  assert.deepEqual(seen, [['simp_1', 'running']], 'marked running before the script starts');
  const row = store.byId.get('simp_1');
  assert.equal(row.checkpoints.build.status, 'done');
  assert.equal(row.checkpoints.buildPreview.result.pages[0].name, 'Home');
});

test('worker pass: keeps the map checkpoint an --apply run wrote while it ran', async () => {
  const job = withCheckpoints(CAPTURED, { build: { mode: 'apply', status: 'queued', requestedAt: 'r2' } });
  const store = fakeStore([job]);
  await build.processBuildRequests({
    store,
    runScript: async (id) => {
      const row = store.byId.get(id);
      row.checkpoints.map = { at: 'later', pageIds: { '/': 'p1' } };
      return { ok: true, result: { applied: { created: 1, updated: 0, pages: 1 } } };
    },
  });
  const row = store.byId.get('simp_1');
  assert.deepEqual(row.checkpoints.map.pageIds, { '/': 'p1' });
  assert.equal(row.checkpoints.build.status, 'done');
  assert.equal(row.checkpoints.buildPreview, undefined, 'a build is not a preview');
});

test('worker pass: a script that throws is recorded as failed, not lost', async () => {
  const job = withCheckpoints(CAPTURED, { build: { mode: 'preview', status: 'queued', requestedAt: 'r3' } });
  const store = fakeStore([job]);
  const out = await build.processBuildRequests({ store, runScript: async () => { throw new Error('spawn ENOENT'); } });
  assert.equal(out.failed, 1);
  const row = store.byId.get('simp_1');
  assert.equal(row.checkpoints.build.status, 'failed');
  assert.equal(row.checkpoints.build.error, 'spawn ENOENT');
});

test('worker pass: an abandoned running build is marked failed', async () => {
  const job = withCheckpoints(CAPTURED, {
    build: { mode: 'apply', status: 'running', requestedAt: 'r4', startedAt: '2026-01-01T00:00:00Z' },
  });
  const store = fakeStore([job]);
  const out = await build.processBuildRequests({ store, runScript: async () => ({ ok: true }) });
  assert.equal(out.reclaimed, 1);
  assert.equal(store.byId.get('simp_1').checkpoints.build.status, 'failed');
});

test('worker pass: a read that fails stops the pass loudly', async () => {
  const store = { listJobsWithBuildStatus: async () => ({ ok: false, status: 500, error: 'db down' }) };
  await assert.rejects(build.processBuildRequests({ store, runScript: async () => ({ ok: true }) }), /db down/);
});
