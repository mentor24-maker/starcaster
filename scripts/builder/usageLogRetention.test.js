'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * observe_usage_logs retention (ClickUp 86bcy80hd).
 *
 * The pass deletes rows from a table that also holds the AI-spend meter, so
 * these tests are about what must NEVER happen: an AI-spend row deleted, a
 * recent request row deleted, an unbounded delete, a failure reported as a
 * clean run. A fake PostgREST evaluates the real query strings against rows.
 */

const { pruneRequestLogs, requestRowFilter, KEEP_DAYS } = require('../../lib/usageLogRetention');

const NOW = Date.parse('2026-11-04T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

/** A tiny PostgREST: understands eq., lt., lte., order=id.asc and limit. */
function fakeDb(rows, { failOn = null } = {}) {
  const db = rows.map((r) => ({ ...r }));
  const calls = [];
  const matches = (row, qs) => {
    const params = new URLSearchParams(qs);
    for (const [key, raw] of params) {
      if (['select', 'order', 'limit'].includes(key)) continue;
      const value = decodeURIComponent(raw);
      const [op, ...rest] = value.split('.');
      const want = rest.join('.');
      const have = row[key];
      if (op === 'eq' && String(have) !== want) return false;
      if (op === 'lt' && !(key === 'created_at' ? Date.parse(have) < Date.parse(want) : Number(have) < Number(want))) return false;
      if (op === 'lte' && !(Number(have) <= Number(want))) return false;
    }
    return true;
  };
  async function query({ method, query: qs, headers }) {
    calls.push({ method, qs, headers });
    if (failOn === method) return { ok: false, status: 504, error: 'timed out' };
    const hit = db.filter((r) => matches(r, qs)).sort((a, b) => a.id - b.id);
    if (method === 'GET') {
      const limit = Number(new URLSearchParams(qs).get('limit')) || hit.length;
      return { ok: true, status: 200, data: hit.slice(0, limit).map((r) => ({ id: r.id })) };
    }
    if (method === 'DELETE') {
      for (const r of hit) db.splice(db.indexOf(r), 1);
      return { ok: true, status: 200, data: hit.map((r) => ({ id: r.id })) };
    }
    throw new Error(`unexpected ${method}`);
  }
  return { db, calls, query };
}

function seed() {
  const rows = [];
  let id = 1;
  for (let d = 200; d >= 0; d -= 1) {
    rows.push({ id: id++, provider: 'vercel', usage_type: 'api_request', created_at: iso(d) });
    rows.push({ id: id++, provider: 'vercel', usage_type: 'api_request', created_at: iso(d) });
  }
  // AI-spend meter rows, old and new — every one of these must survive.
  rows.push({ id: id++, provider: 'anthropic', usage_type: 'llm_tokens', created_at: iso(120) });
  rows.push({ id: id++, provider: 'openclaw', usage_type: 'llm_tokens', created_at: iso(90) });
  rows.push({ id: id++, provider: 'vertex_veo', usage_type: 'video_generation_job', created_at: iso(180) });
  // Same usage_type name from a different writer: not ours to delete.
  rows.push({ id: id++, provider: 'other', usage_type: 'api_request', created_at: iso(150) });
  return rows;
}

test('deletes only vercel request rows older than the window; AI-spend rows survive', async () => {
  const { db, query } = fakeDb(seed());
  const result = await pruneRequestLogs({ query, table: 't', now: NOW, batchSize: 50, maxBatches: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.data.complete, true);
  assert.equal(result.data.stoppedBecause, 'nothing-left');

  const oldRequests = db.filter((r) => r.usage_type === 'api_request' && r.provider === 'vercel'
    && Date.parse(r.created_at) < NOW - KEEP_DAYS * DAY);
  assert.equal(oldRequests.length, 0, 'every old request row is gone');
  assert.equal(result.data.deleted, (200 - KEEP_DAYS) * 2, 'and the count reported is the count deleted');

  const recent = db.filter((r) => r.usage_type === 'api_request' && r.provider === 'vercel');
  assert.equal(recent.length, (KEEP_DAYS + 1) * 2, 'the last 30 days of request rows are untouched');
  assert.equal(db.filter((r) => r.usage_type === 'llm_tokens').length, 2, 'AI-spend rows untouched');
  assert.equal(db.filter((r) => r.usage_type === 'video_generation_job').length, 1);
  assert.equal(db.filter((r) => r.provider === 'other').length, 1, 'another writer\'s api_request row untouched');
});

test('every request it sends carries the full row filter — no delete is ever open-ended', async () => {
  const { calls, query } = fakeDb(seed());
  await pruneRequestLogs({ query, table: 't', now: NOW, batchSize: 50, maxBatches: 100 });
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.ok(deletes.length > 1);
  for (const c of calls) {
    assert.match(c.qs, /usage_type=eq\.api_request/);
    assert.match(c.qs, /provider=eq\.vercel/);
    assert.match(c.qs, /created_at=lt\./);
  }
  for (const c of deletes) assert.match(c.qs, /&id=lte\.\d+/, 'each delete is bounded by the ids just read');
});

test('stops at the batch limit and says the backlog is not finished', async () => {
  const { db, query } = fakeDb(seed());
  const result = await pruneRequestLogs({ query, table: 't', now: NOW, batchSize: 10, maxBatches: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.data.complete, false);
  assert.equal(result.data.stoppedBecause, 'batch-limit');
  assert.equal(result.data.deleted, 30);
  assert.equal(db.length, seed().length - 30);
});

test('stops when the time budget runs out', async () => {
  const { query } = fakeDb(seed());
  let t = 0;
  const result = await pruneRequestLogs({ query, table: 't', now: NOW, batchSize: 10, maxBatches: 100, timeBudgetMs: 25, clock: () => (t += 10) });
  assert.equal(result.data.complete, false);
  assert.equal(result.data.stoppedBecause, 'time-budget');
});

test('a failed read or delete is reported as a failure, never as a clean pass', async () => {
  for (const failOn of ['GET', 'DELETE']) {
    const { query } = fakeDb(seed(), { failOn });
    const result = await pruneRequestLogs({ query, table: 't', now: NOW });
    assert.equal(result.ok, false, `${failOn} failure`);
    assert.equal(result.data.complete, false);
    assert.match(result.error, /timed out/);
  }
});

test('an empty table is a complete run with nothing deleted', async () => {
  const { query } = fakeDb([]);
  const result = await pruneRequestLogs({ query, table: 't', now: NOW });
  assert.deepEqual([result.ok, result.data.deleted, result.data.complete], [true, 0, true]);
});

test('the filter pins both columns', () => {
  const f = requestRowFilter('2026-10-05T12:00:00.000Z');
  assert.match(f, /^usage_type=eq\.api_request&provider=eq\.vercel&created_at=lt\./);
});

test('the scheduled route is cron-only and on the schedule', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/observe/usage-logs/prune'), 'scheduled in vercel.json');
  const index = fs.readFileSync(path.join(root, 'routes', 'index.js'), 'utf8');
  assert.match(index, /'\/api\/observe\/usage-logs\/prune'/, 'listed in CRON_PATHS, or the scheduler is refused as unauthenticated');
});

test('a session without the cron flag is refused before anything is deleted', async () => {
  const supabasePath = require.resolve('../../lib/supabase.js');
  const real = require(supabasePath);
  let touched = false;
  require.cache[supabasePath].exports = { ...real, sbQuery: async () => { touched = true; return { ok: true, data: [] }; } };
  try {
    const observe = require('../../routes/observe.js');
    let status = 0; let body = '';
    const res = {
      statusCode: 0,
      setHeader() {}, writeHead(s) { status = s; }, end(b) { body = String(b || ''); status = status || this.statusCode; },
    };
    const req = { cronPublish: false, authUser: { id: 'u1' }, projectContext: { project: { id: 'p1' } }, headers: {} };
    const handled = await observe.handle(req, res, '/api/observe/usage-logs/prune', 'GET');
    assert.equal(handled, true);
    assert.equal(status || res.statusCode, 403);
    assert.match(body, /CRON_ONLY/);
    assert.equal(touched, false, 'no database call was made');
  } finally {
    require.cache[supabasePath].exports = real;
  }
});
