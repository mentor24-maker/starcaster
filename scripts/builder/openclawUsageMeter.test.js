'use strict';

/**
 * AI Quota 3/5 (task 86bcvj7vc): every OpenClaw request writes one meter row.
 *
 * Every AI call the Mac Mini makes goes through OpenClaw straight to Anthropic,
 * so none of it reached Starcaster's meter; on Oct 28–30, 2026 that cost about
 * $35 before anybody knew. These tests hold the three halves together: the
 * client writes the row, the spend summary counts it per job, and the AI Quota
 * job list puts it next to the right job — and a call with no token counts is
 * "cost unknown", never $0.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// The client: one row per request that reached OpenClaw
// ---------------------------------------------------------------------------

const observeStore = require('../../lib/observeStore');
const client = require('../../lib/openclawResponsesClient.js');

// These tests are about the meter, not the Mini's daily limit
// (scripts/builder/miniAiLimit.test.js), so every request is let through.
require('../../lib/miniAiLimit').checkRequest = async () => ({ allowed: true });

/** Run one request against a stubbed gateway; return the rows it metered. */
async function meter(request, respond) {
  const saved = {
    fetch: global.fetch,
    logUsage: observeStore.logUsage,
    url: process.env.OPENCLAW_BASE_URL,
    key: process.env.OPENCLAW_API_KEY,
  };
  const rows = [];
  process.env.OPENCLAW_BASE_URL = 'http://127.0.0.1:18789';
  process.env.OPENCLAW_API_KEY = 'test-token';
  observeStore.logUsage = async (provider, usageType, count, scope, metadata) => {
    rows.push({ provider, usageType, count, scope, metadata });
  };
  global.fetch = respond;
  try {
    const res = await client.callOpenClawResponses(request);
    return { res, rows };
  } finally {
    global.fetch = saved.fetch;
    observeStore.logUsage = saved.logUsage;
    if (saved.url === undefined) delete process.env.OPENCLAW_BASE_URL; else process.env.OPENCLAW_BASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.OPENCLAW_API_KEY; else process.env.OPENCLAW_API_KEY = saved.key;
  }
}

const answer = (status, body) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

// The shape OpenClaw 2026.9.8 sends (toOpenAiResponsesUsage in its dist).
const USAGE = {
  input_tokens: 1300,
  input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 200 },
  output_tokens: 50,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 1350,
};

test('a request writes one row naming its job, with the tokens OpenClaw reported', async () => {
  const { res, rows } = await meter(
    { user: 'starcaster:openclaw-smoke', input: 'Is the browser signed in?' },
    answer(200, { output_text: 'yes', usage: USAGE }),
  );
  assert.equal(res.ok, true);
  assert.equal('sent' in res, false, 'the internal flag must not leak to callers');
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.provider, 'openclaw');
  assert.equal(row.usageType, 'llm_tokens');
  assert.equal(row.count, 1350);
  // The label without its per-request suffix (task 86bcvhy8c added it).
  assert.equal(row.metadata.job, 'starcaster:openclaw-smoke');
  assert.equal(row.metadata.ok, true);
  assert.equal(row.metadata.tokens_known, true);
  assert.equal(row.metadata.model, 'claude-sonnet-5-5');
  // input_tokens already holds the cache reads and writes — not counted twice.
  assert.equal(row.metadata.prompt_tokens, 100);
  assert.equal(row.metadata.cached_tokens, 1200);
  assert.equal(row.metadata.completion_tokens, 50);
  assert.ok(row.metadata.duration_ms >= 0);
});

test('all-zero usage is recorded as tokens unknown, not as a free call', async () => {
  // OpenClaw sends zeros, not nothing, when the provider reported no counts.
  const zeros = { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 } };
  for (const body of [{ output_text: 'x', usage: zeros }, { output_text: 'x' }]) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await meter({ user: 'starcaster:reddit-watch', input: 'go' }, answer(200, body));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata.tokens_known, false);
  }
});

test('a refused or timed-out request is metered as failed; an unreachable gateway is not metered', async () => {
  const refused = await meter({ user: 'starcaster:reddit-watch', input: 'go' }, answer(500, { error: { message: 'out of credit' } }));
  assert.equal(refused.res.ok, false);
  assert.equal(refused.rows.length, 1);
  assert.equal(refused.rows[0].metadata.ok, false);
  assert.equal(refused.rows[0].metadata.status, 500);

  const timedOut = await meter({ user: 'starcaster:reddit-watch', input: 'go' }, async () => {
    const err = new Error('aborted'); err.name = 'AbortError'; throw err;
  });
  assert.equal(timedOut.res.status, 504);
  assert.equal(timedOut.rows.length, 1, 'a timed-out agent may have spent');

  const down = await meter({ user: 'starcaster:reddit-watch', input: 'go' }, async () => { throw new TypeError('fetch failed'); });
  assert.equal(down.res.ok, false);
  assert.equal(down.rows.length, 0, 'nothing reached OpenClaw, so nothing was spent');
});

test('a meter that fails never fails the request', async () => {
  const saved = observeStore.logUsage;
  try {
    const { res } = await meter({ user: 'starcaster:reddit-watch', input: 'go' }, answer(200, { output_text: 'ok', usage: USAGE }));
    assert.equal(res.ok, true);
    observeStore.logUsage = async () => { throw new Error('database down'); };
    const out = await client.recordOpenClawCall({ label: 'x', ok: true, payload: { usage: USAGE } });
    assert.equal(out, undefined);
  } finally {
    observeStore.logUsage = saved;
  }
});

test('the job label drops the post id Facebook adds', () => {
  assert.equal(client.jobLabel('starcaster:facebook_personal:job-123'), 'starcaster:facebook_personal');
  assert.equal(client.jobLabel('starcaster:openclaw-smoke'), 'starcaster:openclaw-smoke');
  assert.equal(client.jobLabel(''), 'unlabelled');
});

// ---------------------------------------------------------------------------
// The AI Quota job list: every label any code sends belongs to a listed job
// ---------------------------------------------------------------------------

const { MINI_JOBS, miniJobs, listAiJobs } = require('../../lib/aiJobs');

/** Every `user: 'starcaster:...'` label in the Mini's OpenClaw callers. */
function labelsInSource() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(c|m)?js$/.test(entry.name) && !entry.name.endsWith('.test.js')) files.push(full);
    }
  };
  walk(path.join(ROOT, 'lib'));
  walk(path.join(ROOT, 'workers'));
  const labels = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/user:\s*'(starcaster:[a-z0-9_-]+)'/g)) labels.add(m[1]);
    for (const m of source.matchAll(/SESSION_PREFIX\s*=\s*'(starcaster:[a-z0-9_-]+)'/g)) labels.add(m[1]);
  }
  return labels;
}

test('every OpenClaw label the Mini sends is listed under a job, so none spends off the page', () => {
  const listed = new Set(MINI_JOBS.flatMap((job) => job.labels));
  const found = labelsInSource();
  // The gateway auth test is the Settings > APIs "Test" button — one tiny
  // call, shown under its own name if it ever runs.
  found.delete('starcaster:gateway-auth-test');
  assert.ok(found.size >= 8, `expected the known callers, found ${[...found].join(', ')}`);
  for (const label of found) assert.ok(listed.has(label), `${label} is sent to OpenClaw but no job in lib/aiJobs.js lists it`);
});

test('meter rows land on their job; a label nobody listed still appears', () => {
  const win = (calls, costUsd, unpricedCalls = 0) => ({ calls, costUsd, unpricedCalls });
  const jobs = miniJobs([
    { job: 'starcaster:youtube-outreach-poster', calls: 2, failedCalls: 1, costUsd: 0.5, unpricedCalls: 0, last24h: win(1, 0.25), last7d: win(2, 0.5) },
    { job: 'starcaster:reddit-post-reader', calls: 1, failedCalls: 0, costUsd: 0.1, unpricedCalls: 0, last24h: win(1, 0.1), last7d: win(1, 0.1) },
    { job: 'starcaster:openclaw-smoke', calls: 3, failedCalls: 0, costUsd: 0, unpricedCalls: 3, last24h: win(3, 0, 3), last7d: win(3, 0, 3) },
    { job: 'starcaster:something-new', calls: 1, failedCalls: 0, costUsd: 0.01, unpricedCalls: 0, last24h: win(1, 0.01), last7d: win(1, 0.01) },
  ]);
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  // Two labels, one job: posting.
  assert.equal(byId['outreach-posting'].usage.last24h.calls, 2);
  assert.equal(byId['outreach-posting'].usage.failedCalls, 1);
  assert.equal(byId['outreach-posting'].usage.last7d.costUsd.toFixed(2), '0.60');
  assert.equal(byId['openclaw-sign-in-check'].usage.last7d.unpricedCalls, 3);
  // A metered job with no rows made no calls — zeros, not "not metered".
  assert.equal(byId['reddit-watch'].metered, true);
  assert.equal(byId['reddit-watch'].usage.last7d.calls, 0);
  // Whisper runs locally and has no bill to meter.
  assert.equal(byId['studio-transcribe'].usage, null);
  assert.equal(byId['studio-transcribe'].metered, false);
  // Never dropped.
  assert.equal(byId['openclaw:starcaster:something-new'].usage.calls, 1);
  assert.equal(listAiJobs([], []).length, MINI_JOBS.length);
});

// ---------------------------------------------------------------------------
// The spend summary: per-job totals, and unknown tokens are unpriced
// ---------------------------------------------------------------------------

function loadStoreWithRows(rows) {
  const supabasePath = require.resolve('../../lib/supabase');
  const scopePath = require.resolve('../../lib/projectScope');
  const storePath = require.resolve('../../lib/observeStore');
  const saved = [supabasePath, scopePath, storePath].map((p) => [p, require.cache[p]]);
  const stub = (p, exports) => {
    require.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports };
  };
  stub(supabasePath, {
    sbQuery: async () => ({ ok: true, data: rows }),
    tableConfig: () => ({ observeUsageLogs: 'observe_usage_logs' }),
  });
  stub(scopePath, { scopedListQuery: async (_t, qs) => qs, scopedInsertRow: async (_t, row) => row });
  delete require.cache[storePath];
  const store = require(storePath);
  for (const [p, entry] of saved) { if (entry) require.cache[p] = entry; else delete require.cache[p]; }
  return store;
}

const OPENCLAW_ROW = (job, iso, extra = {}) => ({
  created_at: iso,
  provider: 'openclaw',
  usage_type: 'llm_tokens',
  usage_count: 1350,
  metadata: {
    model: 'claude-sonnet-5-5', feature: job, job, ok: true, tokens_known: true,
    prompt_tokens: 100, completion_tokens: 50, cached_tokens: 1200, ...extra,
  },
});

test('the summary counts OpenClaw calls per job, today and this week, and keeps them out of website features', async () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const { getAiSpendSummary } = loadStoreWithRows([
    OPENCLAW_ROW('starcaster:openclaw-smoke', '2026-10-30T11:00:00Z'),
    OPENCLAW_ROW('starcaster:openclaw-smoke', '2026-10-27T11:00:00Z', { ok: false }),
    OPENCLAW_ROW('starcaster:openclaw-smoke', '2026-10-10T11:00:00Z'),
    OPENCLAW_ROW('starcaster:reddit-watch', '2026-10-30T10:00:00Z', { tokens_known: false, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 }),
  ]);
  const res = await getAiSpendSummary(100, null, '2026-09-30T12:00:00Z', { now });
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.byFeature, [], 'Mini jobs are not website features');

  const smoke = res.data.byJob.find((j) => j.job === 'starcaster:openclaw-smoke');
  assert.equal(smoke.calls, 3);
  assert.equal(smoke.failedCalls, 1);
  assert.equal(smoke.last24h.calls, 1);
  assert.equal(smoke.last7d.calls, 2);
  // Sonnet 5.5 at $2/$10, cache charged at 1.25x input: 100*2 + 50*10 + 1200*2.5.
  const one = (100 * 2 + 50 * 10 + 1200 * 2 * 1.25) / 1e6;
  assert.equal(smoke.last7d.costUsd.toFixed(6), (2 * one).toFixed(6));

  // No token counts: counted, unpriced, and the page total admits it.
  const watch = res.data.byJob.find((j) => j.job === 'starcaster:reddit-watch');
  assert.equal(watch.last24h.calls, 1);
  assert.equal(watch.last24h.unpricedCalls, 1);
  assert.equal(watch.costUsd, 0);
  assert.equal(res.data.complete, false);
  assert.match(res.data.unpriced[0].reason, /cost is unknown/);
  // And it is in the page's own totals now, not beside them.
  assert.equal(res.data.recent.last24h.calls, 2);
});
