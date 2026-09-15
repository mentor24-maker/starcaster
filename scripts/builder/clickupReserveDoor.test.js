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

const { clickupFetch, ledger, _resetBudgetForTests } = require('../lib/clickup.cjs');

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

/* ══════════════════════════════════════════════════════════════════════════
 * A FAKED REQUEST SPENDS NOTHING (2026-09-15, task 86bc0wrxg).
 *
 * The four tests above all inject a transport AND point the ledger at a
 * fixture, which is the shape that must keep working — the door's accounting
 * cannot be tested any other way. Every OTHER suite in this repo injects a
 * transport and leaves the ledger alone, and those were being counted: one
 * test file wrote 34 phantom requests into ~/.starcaster/clickup-ledger.jsonl,
 * the whole suite several hundred against a 100-per-minute allowance. The
 * suite then yielded against its own invented traffic (22 failures that were
 * not real) and the live relay, the pulse and both loop lanes stood down with
 * it.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A transport with NO rate-limit headers — which is what every other suite in
 * this repo actually hands the door (`{ ok, status, json, text }` and nothing
 * else). It matters: `spyFetch` above returns `x-ratelimit-remaining: 90` on
 * every call, so the ledger keeps reading ClickUp's own cheerful number back
 * and a scheduled caller never yields however many requests it fakes. Written
 * with headers, the two tests below passed against the BROKEN code as well —
 * assertions that could not fail, which is the trap `docs/DOCTRINE.md` names.
 */
function plainFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  return { impl, calls };
}

/** Run `fn` with a throwaway HOME, so the SHARED ledger path — the real one,
 *  resolved from `os.homedir()` when no fixture overrides it — lands somewhere
 *  this test can inspect and nothing can be written to the operator's. */
async function withThrowawayHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clickup-home-'));
  const had = Object.prototype.hasOwnProperty.call(process.env, 'HOME');
  const prev = process.env.HOME;
  process.env.HOME = home;
  const shared = path.join(home, '.starcaster', 'clickup-ledger.jsonl');
  // AWAITED, not merely returned. The first draft of this helper restored HOME
  // in a `finally` around a call that returns a promise, so HOME went back
  // before a single assertion ran and every reading came off the operator's
  // REAL ledger — which is how this test first "failed": it read live entries
  // stamped months ahead of the fixture clock. A guard that silently stops
  // guarding is the thing this whole ticket is about.
  try {
    assert.equal(os.homedir(), home, 'the throwaway HOME must actually be in effect');
    return await fn(shared);
  } finally {
    if (had) process.env.HOME = prev; else delete process.env.HOME;
  }
}

test('a faked transport does not touch the shared ledger, even on the real ClickUp URL', async () => {
  ledger._resetForTests();
  _resetBudgetForTests();
  await withThrowawayHome(async (sharedLedger) => {
    // No CLICKUP_LEDGER_PATH: this is exactly what reworkClaim.test.js and the
    // other suites look like from the door's point of view.
    const env = { STARCASTER_CALLER: 'scheduled' };
    const spy = spyFetch();
    const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW });
    assert.equal(spy.calls.length, 1, 'the fake transport is still reached');
    assert.equal(out.yielded, null);
    assert.equal(fs.existsSync(sharedLedger), false, 'nothing may be written to the shared ledger');
    assert.equal(ledger.headroom({ now: NOW + 1, env }).spent, 0, 'and nothing is counted against the budget');
  });
});

test('a faked transport does not make a scheduled caller yield against its own test traffic', async () => {
  ledger._resetForTests();
  _resetBudgetForTests();
  await withThrowawayHome(async (sharedLedger) => {
    const env = { STARCASTER_CALLER: 'scheduled' };
    const spy = plainFetch();
    // 500 faked requests — five times ClickUp's whole per-minute allowance.
    for (let i = 0; i < 500; i += 1) {
      await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + i });
    }
    assert.equal(spy.calls.length, 500, 'every one of them goes through');
    const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 500 });
    assert.equal(out.yielded, null, 'a scheduled caller must not stand down for traffic that never left the machine');
    assert.equal(out.res.status, 200);
    assert.equal(fs.existsSync(sharedLedger), false, 'and 500 faked requests left the shared ledger untouched');
  });
});

/*
 * The same run, the same second, differing ONLY in the caller kind: that pair
 * is the ticket's acceptance criterion, stated here as a test so it cannot
 * quietly stop being true. Before the fix the scheduled column yielded.
 */
test('scheduled and interactive callers get the same answer for faked traffic', async () => {
  ledger._resetForTests();
  _resetBudgetForTests();
  await withThrowawayHome(async (sharedLedger) => {
    const answers = [];
    for (const kind of ['scheduled', 'interactive']) {
      const env = { STARCASTER_CALLER: kind };
      const spy = plainFetch();
      for (let i = 0; i < 200; i += 1) {
        await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + i });
      }
      const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 200 });
      answers.push({ kind, yielded: Boolean(out.yielded), status: out.res && out.res.status });
    }
    assert.deepEqual(answers, [
      { kind: 'scheduled', yielded: false, status: 200 },
      { kind: 'interactive', yielded: false, status: 200 },
    ]);
    assert.equal(fs.existsSync(sharedLedger), false, 'neither column wrote to the shared ledger');
  });
});

/*
 * The other direction, which is what makes the rule structural rather than a
 * blanket "tests do not count": the REAL transport is still counted, and no
 * caller can opt out of the ledger except by not sending the request.
 */
test('the real transport is still counted — a caller cannot opt out of the ledger', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  // No `fetchImpl`, so the door reaches for the global `fetch`. Point it at a
  // host that cannot resolve: the attempt still spends, which is the door's
  // existing contract (it counts the ATTEMPT, not the success) — and it is the
  // contract this change must not have weakened.
  const out = await clickupFetch(URL_REAL, {
    method: 'GET',
    signal: AbortSignal.timeout(1),
  }, { env, now: () => NOW });
  assert.equal(out.res, null, 'the aborted attempt produced no response');
  assert.ok(out.transportError, 'and it failed at the transport');
  assert.equal(ledger.headroom({ now: NOW + 1, env }).spent, 1, 'a real attempt is recorded even when it never arrived');
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE OTHER SHAPE, WHICH THE DOOR CANNOT SEE FROM THE INSIDE.
 *
 * The rule above turns on "did the caller bring its own transport", and that
 * covers every suite that calls `clickupFetch` directly. It does NOT cover a
 * test that spawns the real CLI with `globalThis.fetch` replaced in a preload:
 * nothing is injected, so from the door's point of view that is live traffic
 * in every respect, and there is no honest way for it to tell (Node's own
 * `fetch` carries no native marker to compare against — measured, not
 * assumed). Two suites did exactly that and wrote 42 phantom requests into the
 * operator's ledger per run.
 *
 * So that half is declared by the harness — one `CLICKUP_LEDGER_PATH` in the
 * spawned child's env — and this guard is what stops the next one forgetting.
 * A convention nothing checks is how the first one happened.
 * ══════════════════════════════════════════════════════════════════════════ */

test('a test that stubs fetch in a spawned child gives that child its own ledger', () => {
  const dir = __dirname;
  // THE SHAPE THAT MATTERS is a preload replacing `globalThis.fetch` plus a
  // spawn — a stubbed transport in another process, which is precisely what
  // the door cannot see. Matching on "mentions clickup_direct.mjs" instead was
  // the first draft and it flagged two files that merely READ the CLI's source
  // for their own assertions; a guard that cries wolf gets edited until it is
  // quiet, which is worse than no guard.
  //
  // This file is skipped because it is the one describing the rule: every
  // string the detector looks for appears in its own prose, so it matches
  // itself and always will.
  const SELF = path.basename(__filename);
  const spawners = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.test.js') && f !== SELF)
    .map((f) => ({ file: f, src: fs.readFileSync(path.join(dir, f), 'utf8') }))
    .filter(({ src }) => src.includes('globalThis.fetch') && src.includes('spawnSync'));

  // The detector must be able to find something, or it passes for the wrong
  // reason forever — the same self-check `clickupOneDoor.test.js` carries.
  assert.ok(
    spawners.length > 0,
    'no test stubs fetch in a spawned child any more — this guard is now checking '
    + 'nothing, so delete it or fix the search',
  );

  const missing = spawners
    .filter(({ src }) => !src.includes('CLICKUP_LEDGER_PATH'))
    .map(({ file }) => file);

  assert.deepEqual(missing, [],
    'these stub fetch in a spawned child without CLICKUP_LEDGER_PATH in its env, so '
    + "their invented requests land on the operator's shared ledger and make live jobs stand down");
});
