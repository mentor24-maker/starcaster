'use strict';

/**
 * A TEST RUN DOES NOT SPEND THE COMPANY'S CLICKUP TOKEN (2026-09-15, task
 * 86bc125u6).
 *
 * `clickupReserveDoor.test.js` proves the door obeys the reserve.
 * `clickupLedger.test.js` proves the decision behind it. This proves the half
 * that was missing, and that made `npm run test:builder` fail on an untouched
 * `main` for every unattended pass while passing for a session Dane was in:
 *
 *   a test fakes ClickUp by replacing the TRANSPORT, not the URL. The door saw
 *   `https://api.clickup.com/...`, counted every one of the suite's hundreds of
 *   spawned-CLI requests against the machine's real ledger, crossed the
 *   75-request scheduled ceiling inside one minute, and the reserve — working
 *   exactly as designed — started refusing the suite's own subprocesses. The
 *   tests read that refusal as a failed assertion, and which ones fell over
 *   moved run to run with the timing.
 *
 * Both directions are asserted here on purpose. The bug is fixed by making the
 * door ignore a test run; the DANGER in that fix is weakening the live reserve,
 * so the last two cases are the ones that matter most.
 *
 * BREAK-TESTED, each case naming the edit that makes it fail. Every one was
 * made, watched to fail, and reverted before this file was committed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { clickupFetch, ledger, underTestRunner, spendsCompanyBudget } = require('../lib/clickup.cjs');

const URL_REAL = 'https://api.clickup.com/api/v2/task/abc';
const NOW = 1_757_000_000_000;

/**
 * An env built FROM SCRATCH, exactly as the other reserve tests build theirs.
 * That is the point: `process.env` under `node --test` carries
 * NODE_TEST_CONTEXT, and an env assembled by hand does not — which is what
 * keeps the reserve's own tests testing the reserve.
 */
function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickup-testrun-'));
  ledger._resetForTests();
  return { env: { CLICKUP_LEDGER_PATH: path.join(dir, 'l.jsonl'), ...extra }, dir };
}

function spyFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{"ok":true}',
    };
  };
  return { impl, calls };
}

/** How many requests the ledger at this path is holding. */
function ledgerLines(env) {
  try {
    return fs.readFileSync(env.CLICKUP_LEDGER_PATH, 'utf8').split('\n').filter(Boolean).length;
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }
}

// ── The bug: the suite's own volume must not refuse the suite ───────────────

test('a scheduled caller under a test runner is NOT refused, however full the ledger is', async () => {
  // Break-test: drop `&& !underTestRunner(env)` from spendsCompanyBudget and
  // this yields, which is the failure the whole ticket is about.
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled', NODE_TEST_CONTEXT: 'child-v8' });
  for (let i = 0; i < 99; i += 1) ledger.record({ now: NOW + i, env });
  const spy = spyFetch();
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 100 });
  assert.equal(out.yielded, null, 'a fake request has spent nothing, so there is nothing to stand down from');
  assert.equal(spy.calls.length, 1, 'the request reaches its stand-in transport');
  assert.equal(out.res.status, 200);
});

test('a test run does not write to the machine ledger at all', async () => {
  // Break-test: change `if (spends)` back to `if (spendsClickUpBudget(url))`
  // at either record site and the count below becomes 1.
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled', NODE_TEST_CONTEXT: 'child-v8' });
  const spy = spyFetch();
  await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW });
  assert.equal(ledgerLines(env), 0, 'nothing of the token was spent, so nothing is recorded');
});

test('a test run whose transport fails is still not recorded', async () => {
  // The catch branch records too — deliberately, because an attempt that never
  // connected still spends a real request. A fake one still does not.
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled', NODE_TEST_CONTEXT: 'child-v8' });
  const boom = async () => { throw new Error('stand-in refused'); };
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: boom, env, now: () => NOW });
  assert.ok(out.transportError, 'the failure is still reported to the caller');
  assert.equal(ledgerLines(env), 0);
});

test('vitest is a test runner too', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled', VITEST: 'true' });
  for (let i = 0; i < 99; i += 1) ledger.record({ now: NOW + i, env });
  const spy = spyFetch();
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 100 });
  assert.equal(out.yielded, null);
  assert.equal(spy.calls.length, 1);
});

// ── The danger: the live reserve must be exactly as strict as it was ────────

test('THE PROTECTION IS INTACT: a genuinely scheduled job at the ceiling still yields', async () => {
  // This is the case the fix could have broken, and the reason both directions
  // are in one file. No test marker in this env — it is a real scheduled job.
  // Break-test: make underTestRunner return true unconditionally and this
  // stops yielding, which is the reserve silently switched off.
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  for (let i = 0; i < 80; i += 1) ledger.record({ now: NOW + i, env });
  const spy = spyFetch();
  const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW + 100 });
  assert.equal(spy.calls.length, 0, 'the request must not be sent');
  assert.ok(out.yielded, 'the reserve still refuses it');
  assert.match(out.yielded.why, /reserve is 25/);
});

test('THE PROTECTION IS INTACT: a real scheduled request is still recorded', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  const spy = spyFetch();
  await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: spy.impl, env, now: () => NOW });
  assert.equal(ledgerLines(env), 1, 'a real request spends, so it is counted');
});

// ── The predicate itself ───────────────────────────────────────────────────

test('what a test run is, said once', () => {
  assert.equal(underTestRunner({}), false);
  assert.equal(underTestRunner({ NODE_TEST_CONTEXT: 'child-v8' }), true);
  assert.equal(underTestRunner({ VITEST: 'true' }), true);
  // An env this function was never handed must not crash the door — it is on
  // the path of every ClickUp request the company makes.
  assert.equal(underTestRunner(null), false);
});

test('only api.clickup.com spends, and not even that under a test runner', () => {
  assert.equal(spendsCompanyBudget('https://api.clickup.com/x', {}), true);
  assert.equal(spendsCompanyBudget('http://127.0.0.1:9/x', {}), false);
  assert.equal(spendsCompanyBudget('not a url at all', {}), false);
  assert.equal(spendsCompanyBudget('https://api.clickup.com/x', { NODE_TEST_CONTEXT: 'child-v8' }), false);
});

test('the bug-report forwarder reads THIS definition, not its own copy', () => {
  // Task 86bc0zuvb filed 34 fake tickets into the operator's queue because a
  // test run reached real ClickUp. That guard and this one must never come to
  // disagree about what a test run is, so they share one function — asserted
  // here rather than trusted, because the drift would be silent.
  const forward = fs.readFileSync(path.join(__dirname, '../../lib/clickupForward.js'), 'utf8');
  assert.match(forward, /require\('\.\.\/scripts\/lib\/clickup\.cjs'\)/);
  assert.match(forward, /underTestRunner\s*[,}]/, 'it imports the shared predicate');
  assert.doesNotMatch(forward, /function underTestRunner/, 'and does not define a second one');
});

// ── The two backstops behind the door ──────────────────────────────────────

test('shouldYield exempts a test run, so the callers that SKIP the door are covered too', () => {
  // `scripts/clickup_direct.mjs` calls shouldYield directly at its loop
  // boundaries (`reserveGate()` in the bus relay) so a stop is legible instead
  // of happening mid-flight. That caller never touches clickupFetch, so the
  // door's own exemption cannot reach it.
  // Break-test: delete the underTestRunner branch at the top of shouldYield and
  // this yields, because the env below names a ledger that is over the line.
  const { env } = fixture({ NODE_TEST_CONTEXT: 'child-v8' });
  for (let i = 0; i < 99; i += 1) ledger.record({ now: NOW + i, env });
  const gate = ledger.shouldYield({ kind: 'scheduled', now: NOW + 100, env });
  assert.equal(gate.yield, false);
  assert.match(gate.why, /spent nothing/);
});

test('shouldYield still refuses a real scheduled job over the line', () => {
  const { env } = fixture({});
  for (let i = 0; i < 99; i += 1) ledger.record({ now: NOW + i, env });
  const gate = ledger.shouldYield({ kind: 'scheduled', now: NOW + 100, env });
  assert.equal(gate.yield, true, 'the protection this ticket must not weaken');
});

test('a test process cannot write the machine LIVE ledger, whatever env it is handed', () => {
  // The backstop behind the fix. `bugReportForward.test.js` legitimately hands
  // the door `env: {}` to mean "pretend you are a production server"; that
  // story must not be able to reach the real file.
  // Break-test: remove the defaultLedgerPath guard from record() and the line
  // count below goes up by one — which is exactly the leak this closed.
  const live = ledger.defaultLedgerPath();
  const before = fs.existsSync(live) ? fs.readFileSync(live, 'utf8').length : 0;
  const out = ledger.record({ now: NOW, env: {} });
  const after = fs.existsSync(live) ? fs.readFileSync(live, 'utf8').length : 0;
  assert.equal(after, before, 'the live ledger is untouched');
  assert.equal(out.ok, true, 'and this is not an error — nothing needed writing');
  assert.match(out.why, /live ledger is left alone/);
});

test('a test naming its OWN ledger path still records, so the reserve stays testable', () => {
  const { env } = fixture({});
  const out = ledger.record({ now: NOW, env });
  assert.equal(out.ok, true);
  assert.equal(ledgerLines(env), 1, 'the guard is narrow: only the default path is refused');
});
