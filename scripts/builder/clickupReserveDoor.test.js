'use strict';

/**
 * THE RESERVE, AT THE DOOR (2026-09-04, task 86bbugd8j).
 *
 * `clickupLedger.test.js` proves the decision. This proves the door actually
 * OBEYS it — that a scheduled job past the reserve never reaches the network,
 * and that an interactive one always does. The two are separate files because
 * they fail for different reasons: a wrong rule and a rule nobody applied.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { clickupFetch, ledger } = require('../lib/clickup.cjs');

const URL_REAL = 'https://api.clickup.com/api/v2/task/abc';
const NOW = 1_757_000_000_000;

function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickup-door-'));
  ledger._resetForTests();
  return { env: { CLICKUP_LEDGER_PATH: path.join(dir, 'l.jsonl'), ...extra }, dir };
}

/** A transport that records whether it was reached at all. */
function spyFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => ({ 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '90', 'x-ratelimit-reset': String(Math.floor(NOW / 1000) + 30) }[h] ?? null) },
      text: async () => '{"ok":true}',
    };
  };
  return { impl, calls };
}

test('a scheduled caller past the reserve never reaches the network', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  for (let i = 0; i < 80; i += 1) ledger.record({ now: NOW + i, env });
  const spy = spyFetch();
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 100 });
  assert.equal(spy.calls.length, 0, 'the request must not be sent');
  assert.ok(out.yielded, 'the caller is told it yielded');
  assert.equal(out.res, null);
  assert.equal(out.transportError, null, 'a yield is NOT dressed up as a network failure');
  assert.match(out.yielded.why, /reserve is 25/);
});

test('an interactive caller with the same budget goes straight through', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'interactive' });
  for (let i = 0; i < 99; i += 1) ledger.record({ now: NOW + i, env });
  const spy = spyFetch();
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 100 });
  assert.equal(spy.calls.length, 1);
  assert.equal(out.yielded, null);
  assert.equal(out.res.status, 200);
});

test('a scheduled caller with room goes through, and its request lands on the ledger', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  const spy = spyFetch();
  await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW });
  assert.equal(spy.calls.length, 1);
  const seen = ledger.headroom({ now: NOW + 1, env });
  assert.equal(seen.spent, 1, 'the door recorded the request for every other process to see');
  assert.equal(seen.source, 'clickup-header', "and kept ClickUp's own remaining count with it");
});

/*
 * A request that never leaves for ClickUp must not be recorded against
 * ClickUp's budget. Without this, `npm run test:builder` on the Mini would
 * write into the very ledger the live relay reads a second later.
 */
test('traffic to anything but api.clickup.com is not recorded against the budget', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  const spy = spyFetch();
  await clickupFetch('https://example.invalid/api/v2/task/abc', { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW });
  assert.equal(spy.calls.length, 1);
  assert.equal(ledger.headroom({ now: NOW + 1, env }).spent, 0);
});

/*
 * The door's contract is that it NEVER throws — a rejection escaping it once
 * uncapped the build loop (task 86bbm4zwd). A yield is a third outcome, not an
 * exception, and that has to stay true.
 */
test('yielding does not throw — the door still never throws', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled', CLICKUP_RESERVE: '100' });
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spyFetch().impl, env, now: () => NOW });
  assert.ok(out.yielded);
});
