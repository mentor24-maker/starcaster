'use strict';

/**
 * lib/siteImportStore.js unit tests — Supabase is faked via require-cache
 * injection (same pattern as scripts/builder/builderExtensionsShared.test.js),
 * so these pin the PostgREST query shapes, above all the atomic claim:
 * `claimed_at=is.null` is what makes "first claim wins" true.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/siteImportStore.js');

function loadStore(responder) {
  const calls = [];
  const fake = {
    isConfigured: () => true,
    sbQuery: async (options) => {
      calls.push(options);
      return responder(options, calls.length);
    },
    tableConfig: () => ({}),
    credentials: () => ({ url: 'fake', key: 'fake' }),
  };
  const original = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake };
  delete require.cache[storePath];
  const store = require(storePath);
  // Restore so other test files see the real module.
  if (original) require.cache[supabasePath] = original;
  else delete require.cache[supabasePath];
  delete require.cache[storePath];
  return { store, calls };
}

const JOB_ROW = {
  id: 'simp_1',
  project_id: 'proj_1',
  source_url: 'https://x.test/',
  status: 'queued',
  attempts: 2,
  checkpoints: {},
  coverage: {},
  cost: {},
};

test('claimJob: PATCH is guarded by claimed_at=is.null and bumps attempts', async () => {
  const { store, calls } = loadStore((options) => {
    if (options.method === 'PATCH') return { ok: true, status: 200, data: [{ ...JOB_ROW, claimed_by: 'host:1' }] };
    return { ok: true, status: 200, data: [JOB_ROW] };
  });
  const res = await store.claimJob('simp_1', 'host:1');
  assert.equal(res.ok, true);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.query.includes('claimed_at=is.null'), 'compare-and-set guard present');
  assert.equal(patch.body.attempts, 3);
  assert.equal(patch.body.claimed_by, 'host:1');
});

test('claimJob: zero rows back means someone else won — 409, not success', async () => {
  const { store } = loadStore((options) => {
    if (options.method === 'PATCH') return { ok: true, status: 200, data: [] };
    return { ok: true, status: 200, data: [JOB_ROW] };
  });
  const res = await store.claimJob('simp_1', 'host:1');
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
});

test('claimNextQueued: tries claimable jobs in order, tolerates lost races', async () => {
  let patches = 0;
  const { store } = loadStore((options) => {
    if (options.method === 'PATCH') {
      patches += 1;
      // First claim lost (another worker), second wins.
      return { ok: true, status: 200, data: patches < 2 ? [] : [{ ...JOB_ROW, id: 'simp_2' }] };
    }
    if (options.query && options.query.includes('status=eq.queued')) {
      return { ok: true, status: 200, data: [{ ...JOB_ROW, id: 'simp_1' }, { ...JOB_ROW, id: 'simp_2' }] };
    }
    // The project's other jobs (the duplicate backstop): none of this site.
    if (options.query && options.query.startsWith('project_id=eq.')) {
      return { ok: true, status: 200, data: [] };
    }
    return { ok: true, status: 200, data: [JOB_ROW] };
  });
  const res = await store.claimNextQueued('host:1');
  assert.equal(res.ok, true);
  assert.equal(res.data.id, 'simp_2');
});

// Task 86bcynqrt — the wavecenter incident: a second import of a site that
// had already finished was captured again in full while another waited.
test('claimNextQueued: an unconfirmed duplicate is marked failed, not run, and the next job is claimed', async () => {
  const done = { ...JOB_ROW, id: 'simp_1791865101467_8mi74x', source_url: 'https://www.wavecenter.com/', status: 'complete', created_at: '2026-10-13T12:00:00Z', finished_at: '2026-11-05T00:51:00Z' };
  const dup = { ...JOB_ROW, id: 'simp_1793638349324_xq8r45', source_url: 'https://wavecenter.com/', created_at: '2026-11-02T12:00:00Z' };
  const press = { ...JOB_ROW, id: 'simp_press', project_id: 'proj_2', source_url: 'https://www.pressplay.today/', created_at: '2026-11-03T12:00:00Z' };
  const queue = [dup, press];
  const failedWrites = [];
  const { store } = loadStore((options) => {
    if (options.method === 'PATCH' && options.body && options.body.status === 'failed') {
      failedWrites.push({ query: options.query, body: options.body });
      const id = decodeURIComponent(options.query.replace('id=eq.', ''));
      queue.splice(queue.findIndex((r) => r.id === id), 1);
      return { ok: true, status: 200, data: [{ ...dup, status: 'failed' }] };
    }
    if (options.method === 'PATCH') {
      const id = decodeURIComponent(options.query.split('&')[0].replace('id=eq.', ''));
      return { ok: true, status: 200, data: [{ ...[dup, press].find((r) => r.id === id), claimed_at: 'now' }] };
    }
    if (options.query.includes('status=eq.queued')) return { ok: true, status: 200, data: queue.slice() };
    if (options.query.startsWith('project_id=eq.proj_1')) return { ok: true, status: 200, data: [dup, done] };
    if (options.query.startsWith('project_id=eq.proj_2')) return { ok: true, status: 200, data: [press] };
    const id = decodeURIComponent(options.query.split('&')[0].replace('id=eq.', ''));
    return { ok: true, status: 200, data: [[dup, press, done].find((r) => r.id === id)] };
  });
  const res = await store.claimNextQueued('host:1');
  assert.equal(res.ok, true);
  assert.equal(res.data.id, 'simp_press');
  assert.equal(failedWrites.length, 1);
  assert.match(failedWrites[0].query, /simp_1793638349324_xq8r45/);
  assert.equal(
    failedWrites[0].body.error,
    'Not started: duplicate of www.wavecenter.com, imported Nov 4, 2026 (job simp_1791865101467_8mi74x)'
  );
});

test('claimNextQueued: if the project\'s jobs cannot be read, nothing is claimed', async () => {
  const methods = [];
  const { store } = loadStore((options) => {
    methods.push(options.method || 'GET');
    if (options.query && options.query.includes('status=eq.queued')) return { ok: true, status: 200, data: [JOB_ROW] };
    return { ok: false, status: 503, error: 'down' };
  });
  const res = await store.claimNextQueued('host:1');
  assert.equal(res.ok, false);
  assert.equal(methods.includes('PATCH'), false);
});

test('reclaimStale frees only claimed, unfinished, quiet jobs', async () => {
  const { store, calls } = loadStore(() => ({ ok: true, status: 200, data: [JOB_ROW] }));
  await store.reclaimStale(30);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.query.includes('claimed_at=not.is.null'));
  assert.ok(patch.query.includes('finished_at=is.null'));
  assert.ok(patch.query.includes('updated_at=lt.'));
  assert.equal(patch.body.status, 'queued');
  assert.equal(patch.body.claimed_at, null);
});

test('normalizeCaps merges partial overrides over defaults, ignores junk', () => {
  const { store } = loadStore(() => ({ ok: true, status: 200, data: [] }));
  const caps = store.normalizeCaps({ maxPages: 5, maxDepth: 'nope', maxBrowserSeconds: -3 });
  assert.equal(caps.maxPages, 5);
  assert.equal(caps.maxDepth, store.DEFAULT_CAPS.maxDepth);
  assert.equal(caps.maxBrowserSeconds, store.DEFAULT_CAPS.maxBrowserSeconds);
  assert.equal(store.normalizeCaps(null).maxPages, 60);
});

test('createJob validates inputs and stamps client authorization', async () => {
  const { store, calls } = loadStore(() => ({ ok: true, status: 201, data: [JOB_ROW] }));
  const bad = await store.createJob({ projectId: '', sourceUrl: 'https://x.test/' });
  assert.equal(bad.ok, false);
  const good = await store.createJob({
    projectId: 'proj_1',
    sourceUrl: 'https://x.test/',
    clientAuthorization: 'Delray deal ref 123',
  });
  assert.equal(good.ok, true);
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body[0].client_authorization, 'Delray deal ref 123');
  assert.equal(post.body[0].status, 'queued');
});

test('rowToJob supplies default caps when the column is missing', () => {
  const { store } = loadStore(() => ({ ok: true, status: 200, data: [] }));
  const job = store.rowToJob(JOB_ROW);
  assert.equal(job.caps.maxPages, 60);
  assert.equal(job.caps.pageTimeoutMs, 60000);
});
