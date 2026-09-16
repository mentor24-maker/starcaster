'use strict';

/**
 * A TEST RUN DOES NOT WRITE THE MACHINE'S CLICKUP LEDGER (2026-09-15, task
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
 * so the cases marked THE PROTECTION IS INTACT are the ones that matter most.
 *
 * WHAT THIS FILE OWNS AFTER THE 2026-09-15 CATCH-UP MERGE (task 86bc16xwc).
 * The door's own half of this fix landed on `main` first, under task
 * 86bc0wrxg, by a route two review rounds hardened, and
 * `clickupReserveDoor.test.js` pins it: a faked request declaring no ledger of
 * its own is not counted at all, and one that DOES declare a ledger spends
 * against that one. Six cases here restated that in this branch's own words
 * and were dropped rather than kept as a second, slightly different copy.
 *
 * What survives is the part that is still only here, and it is one statement:
 * `record` refuses the machine's LIVE ledger from a test process, whatever env
 * it is handed — the backstop behind the door, for a write the door never saw.
 * Everything else below is the danger half: proof that none of it weakened the
 * live reserve.
 *
 * BREAK-TESTED, each case naming the edit that makes it fail. Every one was
 * made, watched to fail, and reverted before this file was committed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { clickupFetch, ledger, underTestRunner } = require('../lib/clickup.cjs');

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

// ── The backstop behind the door ───────────────────────────────────────────

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
