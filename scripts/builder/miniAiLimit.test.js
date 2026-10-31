'use strict';

/**
 * AI Quota 5/5 (task 86bcvj7zw): the Mini's daily brake on background AI.
 *
 * On Oct 28–30, 2026 the Mini's background checks drained the Anthropic
 * account two nights running. These tests hold the brake's promises: a
 * background job stops at the limit and says when; posting an approved reply
 * is never stopped but is counted; the bus hears once a day; and a count that
 * cannot be read stops the background jobs rather than waving them through.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const limit = require('../../lib/miniAiLimit');

// 2026-10-30 was Mountain DAYLIGHT time (UTC-6); 2026-11-02 is standard (UTC-7).
const OCT30_3PM_MT = Date.parse('2026-10-30T21:00:00.000Z');

function rows(n, startIso = '2026-10-30T09:00:00.000Z', job = 'starcaster:openclaw-smoke') {
  const start = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => ({
    created_at: new Date(start + i * 60000).toISOString(),
    metadata: { job },
  }));
}

/** Seams for checkRequest, with a record of what it did. */
function seams({ saved = { exists: true, miniDailyRequests: 3 }, calls = [], alarmOk = true, callsOk = true, claimWins = true, busOk = true } = {}) {
  const log = { reads: 0, claims: [], posts: [], releases: [] };
  return {
    log,
    deps: {
      node: 'mac-mini',
      readAlarm: async () => (alarmOk ? { ok: true, data: saved } : { ok: false, error: 'table missing' }),
      readCalls: async (since) => {
        log.reads += 1;
        log.since = since;
        return callsOk ? { ok: true, data: calls } : { ok: false, error: 'database down' };
      },
      claimPost: async (day) => { log.claims.push(day); return { ok: true, data: claimWins }; },
      releasePost: async (day) => { log.releases.push(day); return { ok: true }; },
      postBus: async (text) => { log.posts.push(text); return busOk ? { ok: true } : { ok: false, why: 'ClickUp 500' }; },
    },
  };
}

test('the day is Mountain time, across the daylight-saving change', () => {
  assert.deepEqual(limit.mountainDay(OCT30_3PM_MT), {
    day: '2026-10-30', startIso: '2026-10-30T06:00:00.000Z', endIso: '2026-10-31T06:00:00.000Z',
  });
  // 11pm Mountain on Oct 30 is already Oct 31 in UTC; it is still Oct 30 here.
  assert.equal(limit.mountainDay(Date.parse('2026-10-31T05:00:00.000Z')).day, '2026-10-30');
  // Nov 1 is 25 hours long: it starts on daylight time and ends on standard.
  assert.deepEqual(limit.mountainDay(Date.parse('2026-11-01T18:00:00.000Z')), {
    day: '2026-11-01', startIso: '2026-11-01T06:00:00.000Z', endIso: '2026-11-02T07:00:00.000Z',
  });
  assert.equal(limit.mountainDay(Date.parse('2026-11-02T18:00:00.000Z')).startIso, '2026-11-02T07:00:00.000Z');
});

test('the limit is reached by the Nth request, and the sentence says when, on Mountain time', () => {
  const calls = rows(3, '2026-10-30T09:10:00.000Z'); // 3:10, 3:11, 3:12 AM Mountain
  const s = limit.limitStatus({ limit: 3, calls, now: OCT30_3PM_MT });
  assert.equal(s.reached, true);
  assert.equal(s.reachedAt, calls[2].created_at);
  assert.equal(s.sentence.startsWith("Stopped for today: the Mini's AI limit (3 requests) was reached at 3:12 AM."), true, s.sentence);
  assert.equal(limit.limitStatus({ limit: 4, calls, now: OCT30_3PM_MT }).reached, false);
  // Zero is a real setting: no background AI at all today.
  assert.equal(limit.limitStatus({ limit: 0, calls: [], now: OCT30_3PM_MT }).reached, true);
});

test('a background job under the limit runs, and counts from Mountain midnight', async () => {
  const { deps, log } = seams({ calls: rows(2) });
  const gate = await limit.checkRequest('starcaster:reddit-watch', deps, OCT30_3PM_MT);
  assert.equal(gate.allowed, true);
  assert.equal(log.since, '2026-10-30T06:00:00.000Z');
  assert.equal(log.posts.length, 0);
});

test('at the limit a background job is refused with the sentence, and the bus hears once', async () => {
  const first = seams({ calls: rows(3) });
  const gate = await limit.checkRequest('starcaster:openclaw-smoke:ab12cd34', first.deps, OCT30_3PM_MT);
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, 'MINI_AI_LIMIT');
  assert.match(gate.error, /^Stopped for today: the Mini's AI limit \(3 requests\) was reached at /);
  assert.deepEqual(first.log.claims, ['2026-10-30']);
  assert.equal(first.log.posts.length, 1);
  assert.match(first.log.posts[0], /Mini AI limit \(mac-mini\)/);
  assert.match(first.log.posts[0], /openclaw-smoke 3/);

  // Someone already posted today: refused again, silently.
  const again = seams({ calls: rows(4), claimWins: false });
  const second = await limit.checkRequest('starcaster:substack-miner-notes-search', again.deps, OCT30_3PM_MT);
  assert.equal(second.allowed, false);
  assert.equal(again.log.posts.length, 0);
});

test('a bus line that was not delivered gives the day back, so the next refusal tries again', async () => {
  const { deps, log } = seams({ calls: rows(3), busOk: false });
  const gate = await limit.checkRequest('starcaster:reddit-post-reader', deps, OCT30_3PM_MT);
  assert.equal(gate.allowed, false);
  assert.deepEqual(log.releases, ['2026-10-30']);
});

test('posting an approved reply is never stopped — and is not even asked about', async () => {
  for (const label of ['starcaster:youtube-outreach-poster', 'starcaster:substack-notes-poster', 'starcaster:reddit-comments-poster', 'starcaster:facebook_personal:123']) {
    const { deps, log } = seams({ calls: rows(500) });
    // eslint-disable-next-line no-await-in-loop
    const gate = await limit.checkRequest(label, deps, OCT30_3PM_MT);
    assert.equal(gate.allowed, true, label);
    assert.equal(log.reads, 0, label);
  }
});

test('posts count against the day: a background job after them is stopped', async () => {
  const calls = [...rows(2, '2026-10-30T09:00:00.000Z', 'starcaster:youtube-outreach-poster'), ...rows(1, '2026-10-30T10:00:00.000Z')];
  const { deps } = seams({ calls });
  assert.equal((await limit.checkRequest('starcaster:reddit-watch', deps, OCT30_3PM_MT)).allowed, false);
});

test('a count that cannot be read stops background jobs; an unreadable setting falls back to 40', async () => {
  const blind = seams({ callsOk: false });
  const gate = await limit.checkRequest('starcaster:reddit-watch', blind.deps, OCT30_3PM_MT);
  assert.equal(gate.allowed, false);
  assert.match(gate.error, /could not be read: database down/);

  const noSetting = seams({ alarmOk: false, calls: rows(39) });
  assert.equal((await limit.checkRequest('starcaster:reddit-watch', noSetting.deps, OCT30_3PM_MT)).allowed, true);
  const atDefault = seams({ alarmOk: false, calls: rows(40) });
  assert.equal((await limit.checkRequest('starcaster:reddit-watch', atDefault.deps, OCT30_3PM_MT)).allowed, false);
});

test('a refused request never reaches OpenClaw and writes no meter row', async () => {
  const observeStore = require('../../lib/observeStore');
  const client = require('../../lib/openclawResponsesClient');
  const saved = { fetch: global.fetch, logUsage: observeStore.logUsage, url: process.env.OPENCLAW_BASE_URL, key: process.env.OPENCLAW_API_KEY };
  let fetched = 0;
  let metered = 0;
  process.env.OPENCLAW_BASE_URL = 'http://127.0.0.1:18789';
  process.env.OPENCLAW_API_KEY = 'test-token';
  global.fetch = async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{}' }; };
  observeStore.logUsage = async () => { metered += 1; };
  try {
    const { deps } = seams({ calls: rows(3) });
    const res = await client.callOpenClawResponses({ user: 'starcaster:openclaw-smoke', input: 'x', limitDeps: { ...deps } });
    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.equal(res.code, 'MINI_AI_LIMIT');
    assert.equal(fetched, 0);
    assert.equal(metered, 0);
  } finally {
    global.fetch = saved.fetch;
    observeStore.logUsage = saved.logUsage;
    if (saved.url === undefined) delete process.env.OPENCLAW_BASE_URL; else process.env.OPENCLAW_BASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.OPENCLAW_API_KEY; else process.env.OPENCLAW_API_KEY = saved.key;
  }
});

test('the sign-in check shows the limit\'s own sentence on the Outreach screen, and opens no alarm', async () => {
  const health = require('../../workers/youtube-outreach/health');
  const recorded = [];
  const posts = [];
  const sentence = "Stopped for today: the Mini's AI limit (1 request) was reached at 3:12 AM.";
  const run = await health.runHealthCheck({
    checks: [{ site: 'youtube', accountKey: 'dane', profile: 'dane-of-earth', who: 'Dane of Earth', record: async (r) => { recorded.push(r); return { ok: true }; } }],
    deps: {
      probe: async () => ({ up: true }),
      ask: async () => ({ ok: false, status: 429, code: 'MINI_AI_LIMIT', error: sentence }),
      extractJson: () => null,
      post: async (t) => { posts.push(t); },
      readLedger: () => ({}),
      writeLedger: () => {},
    },
  });
  assert.equal(run.results[0].state, 'cannot_tell');
  assert.equal(recorded[0].message, sentence);
  assert.equal(posts.length, 0);
});

test('every background label is a label a Mini job on the AI Quota page sends', () => {
  const { MINI_JOBS } = require('../../lib/aiJobs');
  const listed = new Set(MINI_JOBS.flatMap((j) => j.labels || []));
  for (const label of limit.BACKGROUND_LABELS) assert.equal(listed.has(label), true, label);
  // ...and is still sent by a caller, so a renamed job cannot slip its brake.
  const sources = ['lib', 'workers'].flatMap((dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true })
    .filter((f) => /\.js$/.test(f) && !/dist|\.test\./.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, dir, f), 'utf8')));
  for (const label of limit.BACKGROUND_LABELS) {
    assert.equal(sources.some((src) => src.includes(`'${label}'`) && !src.includes('BACKGROUND_LABELS = ')), true, `${label} is sent by nothing`);
  }
});

test('the setting: a whole number from 0, optional so other forms leave it alone', () => {
  const store = require('../../lib/aiSpendAlarmStore');
  const base = { dailyLimitUsd: 5, spikeMultiple: 3, alertEmail: '' };
  assert.equal(store.validateSettingsInput({ ...base, miniDailyRequests: 1 }).data.miniDailyRequests, 1);
  assert.equal(store.validateSettingsInput({ ...base, miniDailyRequests: 0 }).data.miniDailyRequests, 0);
  assert.equal('miniDailyRequests' in store.validateSettingsInput(base).data, false);
  assert.equal(store.validateSettingsInput({ ...base, miniDailyRequests: 2.5 }).ok, false);
  assert.equal(store.validateSettingsInput({ ...base, miniDailyRequests: -1 }).ok, false);
  assert.equal(store.normaliseRow(null).miniDailyRequests, 40);
  assert.equal(store.normaliseRow({ mini_daily_requests: 0 }).miniDailyRequests, 0);
});
