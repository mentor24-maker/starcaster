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
    return { ok: true, status: 200, data: [JOB_ROW] };
  });
  const res = await store.claimNextQueued('host:1');
  assert.equal(res.ok, true);
  assert.equal(res.data.id, 'simp_2');
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
