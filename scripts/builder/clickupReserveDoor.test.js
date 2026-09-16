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

const { clickupFetch, ledger, underTestRunner, _resetBudgetForTests } = require('../lib/clickup.cjs');

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
 * The other direction: a caller cannot opt out of the ledger by bringing its
 * own transport or by failing to connect. The ledger here is a FIXTURE one —
 * which is the whole of the rule, not a detail of the test. The door's answer
 * is never "a test does not count"; it is "a test counts onto the ledger it
 * declared, and onto no other".
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
 * THE SHAPE THAT INJECTS NOTHING (review round 2, 2026-09-15).
 *
 * The rule above turns on what the CALLER brought, so a test that brings
 * nothing is invisible to it: keep the real `api.clickup.com` URL, stub
 * `globalThis.fetch` in this very process, and the door sees live traffic in
 * every respect. `scripts/builder/bugReportForward.test.js` does exactly that
 * on purpose — it is proving that `lib/clickupForward.js` refuses a real
 * request because of the RUNNER and not because of the token, so it hands in
 * `env: {}` to defeat that refusal deliberately. Both guards were right on
 * their own and they cancelled out: five phantom requests per full suite run
 * landed on ~/.starcaster/clickup-ledger.jsonl, which is the one thing this
 * ticket's second acceptance criterion forbids.
 *
 * The fix is the third condition in `spendsClickUpBudget`, and it is about the
 * PROCESS rather than the caller: a test run may write to a ledger it declared
 * and may never write to the shared one. That is why these tests assert on the
 * shared file itself under a throwaway HOME — a headroom reading alone would
 * pass for the wrong reason if the write merely went somewhere else.
 * ══════════════════════════════════════════════════════════════════════════ */

test('a test run that injects NOTHING and stubs the global fetch leaves the shared ledger alone', async () => {
  ledger._resetForTests();
  _resetBudgetForTests();
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test must mark this process, or the rule has nothing to read');
  await withThrowawayHome(async (sharedLedger) => {
    // `env: {}` is the bugReportForward shape verbatim: no CLICKUP_LEDGER_PATH,
    // no caller kind, and nothing that could switch the rule off from outside.
    const env = {};
    await withStubbedGlobalFetch(async (calls) => {
      for (let i = 0; i < 5; i += 1) {
        const out = await clickupFetch(URL_REAL, { method: 'POST' }, { env, now: () => NOW + i });
        assert.equal(out.res.status, 200, 'the stubbed global is still reached — the request is not blocked');
        assert.equal(out.yielded, null);
      }
      assert.equal(calls.length, 5, 'all five went through the stub');
    });
    assert.equal(fs.existsSync(sharedLedger), false, "not one line may reach the operator's shared ledger");
  });
});

test('a test run that DID declare a ledger still records onto that one', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'scheduled' });
  _resetBudgetForTests();
  await withThrowawayHome(async (sharedLedger) => {
    await withStubbedGlobalFetch(async (calls) => {
      await clickupFetch(URL_REAL, { method: 'GET' }, { env, now: () => NOW });
      assert.equal(calls.length, 1);
    });
    assert.equal(
      ledger.headroom({ now: NOW + 1, env }).spent, 1,
      'the door still accounts for it — a test run is not exempt from its OWN ledger',
    );
    assert.equal(fs.existsSync(sharedLedger), false, 'and the shared one is untouched either way');
  });
});

/*
 * THE PROCESS HALF IS READ FROM THE REAL ENVIRONMENT, NOT THE HANDED-IN ONE.
 *
 * This is the whole reason the two guards cancelled out, so it is pinned
 * rather than left to the reader: an env handed to the door is the caller's to
 * choose, and `bugReportForward.test.js` chooses `{}` on purpose. If the rule
 * read the runner out of that env it would be off for exactly the test it has
 * to catch. `underTestRunner` is exported, so the predicate can be asked both
 * ways here without reaching into the door's internals.
 */
test('the runner is read from the real process env, which a handed-in env cannot switch off', () => {
  assert.equal(underTestRunner(process.env), true, 'this process IS a test run');
  assert.equal(underTestRunner({}), false, 'and an empty env would say otherwise — which is why it is not asked');
  assert.equal(underTestRunner({ VITEST: '1' }), true, 'vitest counts too');
});

/*
 * ONE DEFINITION, TWO DOORS. `lib/clickupForward.js` refuses a real request on
 * the same question, and until this round it kept its own copy of the
 * predicate. Two copies of a rule this quiet drift, and the drift is invisible
 * — each file goes on passing its own tests while the system stops agreeing
 * with itself. Asserting the identity is cheap and it cannot rot.
 */
test('both doors ask the SAME question object, so the two cannot drift apart', () => {
  const forwardSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'clickupForward.js'), 'utf8');
  assert.match(
    forwardSrc,
    /require\('\.\.\/scripts\/lib\/clickup\.cjs'\)/,
    'clickupForward must come through the door module',
  );
  assert.ok(
    /const \{[^}]*\bunderTestRunner\b[^}]*\} = require\('\.\.\/scripts\/lib\/clickup\.cjs'\)/.test(forwardSrc),
    'clickupForward must IMPORT underTestRunner rather than keep a second copy',
  );
  assert.doesNotMatch(
    forwardSrc,
    /function underTestRunner\b/,
    'a local redefinition is the drift this test exists to prevent',
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * A TRANSPORT THAT IS NOT CALLABLE FAILS CLOSED (review round 1, 2026-09-15).
 *
 * Reading "did the caller bring a transport" as `typeof === 'function'` gives
 * the right answer for every value but one: a present-but-non-callable
 * `fetchImpl` reads as "not injected" and quietly becomes the REAL `fetch`.
 * Measured on both branches with the global stubbed and the ledger pointed at
 * a fixture, so nothing was sent: before the change `{ fetchImpl: null }`
 * reached a TypeError inside the try and never left the machine; after it,
 * the global was reached once, status 200 — a real authenticated request to
 * api.clickup.com. Nothing in the tree passes a non-function today, which is
 * why it was latent rather than loud, and it is exactly the wrong direction
 * for the one function whose job is that nothing escapes accounting.
 *
 * Both halves are asserted here, because the fix has an obvious wrong shape:
 * `'fetchImpl' in opts` would also catch an explicit `fetchImpl: undefined`,
 * and undefined is the one value that legitimately means "use the real fetch"
 * (`reviewGateClickup.test.js` passes precisely that).
 * ══════════════════════════════════════════════════════════════════════════ */

/** Stand in for the global `fetch` and count whether it was reached at all —
 *  the only way to prove a refusal happened INSTEAD of a real request rather
 *  than after one. Restores the real global whatever the body does. */
async function withStubbedGlobalFetch(body) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{"ok":true}',
    };
  };
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('a present but non-callable fetchImpl is refused at the door, not sent as real traffic', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'interactive' });
  _resetBudgetForTests();
  await withStubbedGlobalFetch(async (calls) => {
    for (const bad of [null, 'https://example.test', 42, {}]) {
      await assert.rejects(
        () => clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: bad, env, now: () => NOW }),
        (err) => {
          assert.ok(err instanceof TypeError, `${JSON.stringify(bad)} must be refused as a TypeError`);
          assert.match(err.message, /not callable/);
          assert.match(err.message, /Refusing rather than quietly sending a real request/);
          return true;
        },
        `fetchImpl: ${JSON.stringify(bad)} must not be treated as "no transport given"`,
      );
    }
    assert.deepEqual(calls, [], 'the real fetch must not have been reached even once');
    assert.equal(
      ledger.headroom({ now: NOW + 1, env }).spent, 0,
      'and nothing was recorded — the refusal happens before any accounting',
    );
  });
});

test('an explicit fetchImpl: undefined still means "use the real fetch"', async () => {
  const { env } = fixture({ STARCASTER_CALLER: 'interactive' });
  _resetBudgetForTests();
  await withStubbedGlobalFetch(async (calls) => {
    const out = await clickupFetch(URL_REAL, { method: 'GET' }, { fetchImpl: undefined, env, now: () => NOW });
    assert.equal(out.res.status, 200, 'undefined is not a broken transport — it is the default');
    assert.equal(calls.length, 1, 'and it goes through the real fetch');
    assert.equal(
      ledger.headroom({ now: NOW + 1, env }).spent, 1,
      'counted as real traffic, because that is what it is',
    );
  });
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

/** Every spelling of "launch a child process" — the guard used to match the
 *  literal `spawnSync` alone, so a test written with `execFileSync` or `fork`
 *  was never collected at all (review round 1, 2026-09-15). */
const SPAWNERS = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork'];

/** Pull out the text between a call's parentheses, quotes and nesting
 *  respected. Needed because the question is per CALL SITE — "does THIS spawn
 *  declare a ledger" — and a whole-file search cannot answer it: a third spawn
 *  site in a file that already mentions `CLICKUP_LEDGER_PATH` twice passed the
 *  old guard for free, which is the exact shape it exists to catch. */
function callArgsAt(src, openParen) {
  let depth = 0;
  let quote = null;
  for (let i = openParen; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return null; // unbalanced — the file would not parse; let the syntax gate say so
}

/** The spawn call sites in `src` that carry a PRELOAD into a node child —
 *  `-r`/`--require`, which is the one mechanism by which a stubbed
 *  `globalThis.fetch` actually reaches the child. A spawn of `git` from the
 *  same file has no preload and is deliberately not flagged: a guard that
 *  cries wolf gets edited until it is quiet, which is worse than no guard. */
function preloadingSpawnCalls(src) {
  const out = [];
  const re = new RegExp(`\\b(${SPAWNERS.join('|')})\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const args = callArgsAt(src, re.lastIndex - 1);
    if (args === null) continue;
    if (!/'-r'|"-r"|`-r`|--require/.test(args)) continue;
    out.push({ spawner: m[1], args });
  }
  return out;
}

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
    .filter(({ src }) => src.includes('globalThis.fetch'))
    .flatMap(({ file, src }) => preloadingSpawnCalls(src).map((call) => ({ file, ...call })));

  // The detector must be able to find something, or it passes for the wrong
  // reason forever — the same self-check `clickupOneDoor.test.js` carries.
  assert.ok(
    spawners.length > 0,
    'no test stubs fetch in a spawned child any more — this guard is now checking '
    + 'nothing, so delete it or fix the search',
  );

  const missing = spawners
    .filter(({ args }) => !args.includes('CLICKUP_LEDGER_PATH'))
    .map(({ file, spawner }) => `${file}: ${spawner}(...)`);

  assert.deepEqual(missing, [],
    'these stub fetch in a spawned child without CLICKUP_LEDGER_PATH in that call\'s env, so '
    + "their invented requests land on the operator's shared ledger and make live jobs stand down");
});

/*
 * EVERY SPELLING GETS ITS OWN CONTROL — the same standard `clickupOneDoor`
 * holds itself to. The guard above is only worth the line it occupies if each
 * shape it claims to catch is PROVEN catchable, and the two things round 1
 * found wrong with it are both here as named cases: a spawner that is not
 * `spawnSync`, and a second call site in a file whose OTHER call site already
 * declares a ledger.
 */
const SPAWN_SHAPES = [
  {
    why: 'spawnSync — the original, and the only one the old guard could see',
    src: "spawnSync(process.execPath, ['-r', preload, SCRIPT], { env: { PATH } });",
    caught: true,
  },
  {
    why: 'execFileSync — never collected at all before round 1',
    src: "execFileSync(process.execPath, ['-r', preload, SCRIPT], { env: { PATH } });",
    caught: true,
  },
  {
    why: 'fork, with the preload spelled --require',
    src: "fork(SCRIPT, [], { execArgv: ['--require', preload], env: { PATH } });",
    caught: true,
  },
  {
    why: 'a SECOND call site in a file whose first one declares a ledger — the free pass',
    src: "spawnSync(process.execPath, ['-r', preload, SCRIPT], { env: { CLICKUP_LEDGER_PATH: a } });\n"
      + "spawnSync(process.execPath, ['-r', preload, SCRIPT], { env: { PATH } });",
    caught: true,
  },
  {
    why: 'a spawn with no preload — an unrelated child, deliberately NOT flagged',
    src: "spawnSync('git', ['status'], { env: { PATH } });",
    caught: false,
  },
];

test('the spawn guard catches every spelling it claims to, and cries wolf at none', () => {
  for (const shape of SPAWN_SHAPES) {
    const src = `globalThis.fetch = stub;\n${shape.src}`;
    const undeclared = preloadingSpawnCalls(src).filter(({ args }) => !args.includes('CLICKUP_LEDGER_PATH'));
    assert.equal(
      undeclared.length > 0, shape.caught,
      shape.caught
        ? `NOT CAUGHT: ${shape.why} — the guard would let this through`
        : `CRIED WOLF: ${shape.why} — the guard flagged a child that carries no fetch stub`,
    );
  }
});
