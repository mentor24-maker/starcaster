'use strict';

/**
 * routes/siteImport.js unit tests — the store is faked via require-cache
 * injection; requests/responses are minimal Node-shaped stubs. Pins the
 * auth/scoping behavior (project-scoped reads, 401 without a session) and
 * the cancel semantics the worker relies on (checkpoints.cancelRequested).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const storePath = require.resolve('../../lib/siteImportStore.js');
const routePath = require.resolve('../../routes/siteImport.js');

const JOB = {
  id: 'simp_1',
  projectId: 'proj_1',
  sourceUrl: 'https://x.test/',
  status: 'queued',
  checkpoints: { capture: { at: 'now' } },
  coverage: {},
  cost: {},
  error: '',
  finishedAt: null,
};

function loadRoute(overrides = {}) {
  const calls = [];
  const fakeStore = {
    createJob: async (input) => { calls.push(['createJob', input]); return { ok: true, status: 201, data: { ...JOB, ...input } }; },
    listJobs: async (projectId) => { calls.push(['listJobs', projectId]); return { ok: true, status: 200, data: [JOB] }; },
    getJob: async (id, projectId) => { calls.push(['getJob', id, projectId]); return { ok: true, status: 200, data: { ...JOB } }; },
    listAssets: async (jobId) => { calls.push(['listAssets', jobId]); return { ok: true, status: 200, data: [] }; },
    updateJob: async (id, patch) => { calls.push(['updateJob', id, patch]); return { ok: true, status: 200, data: { ...JOB, ...patch } }; },
    ...overrides,
  };
  const original = require.cache[storePath];
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };
  delete require.cache[routePath];
  const route = require(routePath);
  if (original) require.cache[storePath] = original;
  else delete require.cache[storePath];
  delete require.cache[routePath];
  return { route, calls };
}

function makeReq({ authed = true, projectId = 'proj_1', body } = {}) {
  return {
    method: 'GET',
    url: '/',
    headers: { host: 'test.local' },
    socket: { remoteAddress: '127.0.0.1' },
    authUser: authed ? { id: 'user_1' } : null,
    projectContext: projectId ? { project: { id: projectId }, projects: [{ id: projectId }] } : undefined,
    _parsedJsonBody: body ?? {},
  };
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { this.body = String(chunk || ''); },
  };
  res.json = () => JSON.parse(res.body || '{}');
  return res;
}

test('401 without a session', async () => {
  const { route } = loadRoute();
  const res = makeRes();
  const handled = await route.handle(makeReq({ authed: false }), res, '/api/site-import/jobs', 'GET');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
});

test('POST /jobs requires an active project', async () => {
  const { route } = loadRoute();
  const res = makeRes();
  await route.handle(makeReq({ projectId: '' , body: { sourceUrl: 'https://a.test/' } }), res, '/api/site-import/jobs', 'POST');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PROJECT_REQUIRED');
});

test('POST /jobs rejects junk URLs, normalizes bare domains', async () => {
  const { route, calls } = loadRoute();
  const bad = makeRes();
  await route.handle(makeReq({ body: { sourceUrl: 'not a url at all' } }), bad, '/api/site-import/jobs', 'POST');
  assert.equal(bad.statusCode, 400);

  const good = makeRes();
  await route.handle(makeReq({ body: { sourceUrl: 'clientsite.com' } }), good, '/api/site-import/jobs', 'POST');
  assert.equal(good.statusCode, 201);
  const created = calls.find(([name]) => name === 'createJob');
  assert.equal(created[1].sourceUrl, 'https://clientsite.com/');
  assert.equal(created[1].projectId, 'proj_1');
});

test('job reads are project-scoped', async () => {
  const { route, calls } = loadRoute();
  const res = makeRes();
  await route.handle(makeReq(), res, '/api/site-import/jobs/simp_1', 'GET');
  assert.equal(res.statusCode, 200);
  const read = calls.find(([name]) => name === 'getJob');
  assert.deepEqual(read, ['getJob', 'simp_1', 'proj_1']);
});

test('cancel merges cancelRequested into checkpoints', async () => {
  const { route, calls } = loadRoute();
  const res = makeRes();
  await route.handle(makeReq(), res, '/api/site-import/jobs/simp_1/cancel', 'POST');
  assert.equal(res.statusCode, 200);
  const update = calls.find(([name]) => name === 'updateJob');
  assert.equal(update[2].checkpoints.cancelRequested, true);
  // Existing checkpoints must survive the merge — the worker's stage
  // re-runnability depends on them.
  assert.deepEqual(update[2].checkpoints.capture, { at: 'now' });
});

test('cancel on a finished job is a 409', async () => {
  const { route } = loadRoute({
    getJob: async () => ({ ok: true, status: 200, data: { ...JOB, status: 'complete', finishedAt: 'then' } }),
  });
  const res = makeRes();
  await route.handle(makeReq(), res, '/api/site-import/jobs/simp_1/cancel', 'POST');
  assert.equal(res.statusCode, 409);
});

test('unknown subpath 404s; foreign prefix is not handled', async () => {
  const { route } = loadRoute();
  const res = makeRes();
  await route.handle(makeReq(), res, '/api/site-import/nope', 'GET');
  assert.equal(res.statusCode, 404);
  const untouched = await route.handle(makeReq(), makeRes(), '/api/other', 'GET');
  assert.equal(untouched, false);
});
