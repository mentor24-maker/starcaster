'use strict';

/**
 * ClickUp access for scripts that need JSON answers (`clickup_direct.mjs`'s
 * `queue`/`comments` print for humans; this returns objects).
 *
 * READS are native here — list tasks, read comments — because there is no
 * clean JSON-dump command to shell out to.
 *
 * WRITES shell out to `scripts/clickup_direct.mjs` (the same way this repo's
 * scripts shell out to `gh`), so a status move inherits that command's
 * hard-won safety rails rather than re-deriving them: read-back verification
 * that the status actually stuck (statuses are per-list — a bare PUT 200s a
 * status the list does not have), automatic assignee clearing on a move to a
 * machine status, and the 401/429 coaching. A second, weaker copy of those
 * rules is exactly the drift this tool exists to catch, so it does not keep
 * one.
 *
 * Token contract: CLICKUP_API_TOKEN from the environment, supplied by Doppler
 * via `npm run <script>` — never handled by an agent (DOCTRINE 4.1). The
 * shell-outs inherit the same environment, so they need no token of their own.
 */

const path = require('path');
const { retryDecision } = require('../builder/clickupRetry.js');
const ledger = require('./clickupLedger.cjs');
const { callerKind } = require('./clickupCaller.cjs');
const { execFileSync } = require('child_process');

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
const ROOT = path.join(__dirname, '..', '..');
const DIRECT = path.join(ROOT, 'scripts', 'clickup_direct.mjs');

/**
 * EVERY CALL OUT OF THIS FILE HAS A DEADLINE, and until 2026-09-02 none of
 * them did (task 86bbqz7rg, review round 2).
 *
 * Node's `fetch` has no default request timeout and `execFileSync` has no
 * default `timeout:`, so a half-open connection to ClickUp does not fail — it
 * waits, effectively forever. For a script somebody is watching that is an
 * annoyance. For a SCHEDULED job it is the worst available outcome: launchd
 * will not start a second copy while the first is still going, so the caller
 * never exits, never prints, never returns non-zero, and
 * `report_job_failure.mjs` never fires. The only thing that eventually
 * notices is the 25-hour roll call, which would announce that the job has
 * "stopped firing" about a job that is firing and stuck — sending the next
 * reader to launchd instead of to a stuck socket.
 *
 * A deadline turns that into an ordinary loud failure: the call throws with a
 * message that names the timeout, the caller's existing catch treats it like
 * any other failed read, and the next run tries again.
 *
 * KNOWN RESIDUAL, BY DESIGN: `listTasks` pages, so a ClickUp that is slow but
 * still answering is bounded at (pages x timeout), not at one timeout — up to
 * 50 x 60s in the worst case. A call that HANGS throws on the first page and
 * does not multiply, which is the failure this bound exists for. A caller on
 * a tight schedule passes a smaller `timeoutMs` to bring the product under its
 * own cadence; `scripts/pulse_publish.mjs` does exactly that and shows the
 * arithmetic.
 */
const HTTP_TIMEOUT_MS = Number(process.env.CLICKUP_HTTP_TIMEOUT_MS) || 60 * 1000;
const SHELL_TIMEOUT_MS = Number(process.env.CLICKUP_SHELL_TIMEOUT_MS) || 2 * 60 * 1000;

/**
 * The API root. A constant in every real run; overridable ONLY so the deadline
 * above can be proven against a server that deliberately never answers, which
 * is the one thing a pure test of the message cannot show
 * (`scripts/builder/clickupTimeouts.test.js`).
 */
const API_BASE = process.env.CLICKUP_API_BASE || 'https://api.clickup.com';

// ── THE ONE DOOR TO CLICKUP ───────────────────────────────────────────────────
/**
 * The single place in this repo that calls `fetch` against api.clickup.com
 * (2026-09-03, task 86bbugcdb).
 *
 * WHY. The limit is per TOKEN, and there is one token for the whole company.
 * Six files each opened their own connection, four of them counted nothing,
 * and only one read `x-ratelimit-*` at all — and printed the numbers to stderr
 * rather than keeping them. So nothing in the system could answer "how much
 * budget is left?", and on 2026-09-03 a bus-relay pass spending 114 requests
 * against a ~100/minute allowance was rate-limited on every pass for hours,
 * which disabled the auto-merge lane for 271 consecutive passes.
 *
 * THIS FUNCTION NEVER THROWS. That is a safety property, not a style choice.
 * `fetch` REJECTS on a transport failure rather than resolving with a non-ok
 * response; when that rejection escaped, it killed the process with exit 1 —
 * and `loop-build` reads exit 1 as "could not tell, so proceed, unbounded by
 * the cap". A routine network blip therefore UNCAPPED the loop (task
 * 86bbm4zwd). Callers get `transportError` set and decide for themselves
 * whether to throw; the two existing callers do NOT agree on the answer, so
 * this one does not pick for them.
 *
 * It counts at the ATTEMPT, not the success: a request that failed to connect
 * still spent whatever the attempt costs, and for a budget you would rather
 * over-count than under-count.
 */
const budget = {
  requests: 0,
  limit: null,
  remaining: null,
  resetSeconds: null,
  at: 0,
};

/**
 * `fetchImpl` is injectable (2026-09-04, task 86bbugcpa) so that a caller with
 * its own test fakes can come through the door instead of routing around it.
 * `lib/clickupForward.js` runs on the bug reporter's request path and its
 * tests drive every ClickUp failure shape through a substitute transport; the
 * alternative was leaving it outside the door, which is exactly the second
 * door this whole ticket exists to close.
 *
 * It is the door's OWN counter that a caller cannot opt out of by bringing its
 * own `fetch`: `budget.requests` measures the ATTEMPT, and answers "what did
 * this pass cost". The machine-wide LEDGER is a different question — "what has
 * been taken from the one company token" — and a faked transport takes nothing
 * from it. `spendsClickUpBudget` is where those two part company; read it
 * before changing either (task 86bc0wrxg).
 */
async function clickupFetch(url, init = {}, opts = {}) {
  const { env = process.env, now = Date.now } = opts;
  // Whether the caller BROUGHT its own transport is the fact the accounting
  // turns on (task 86bc0wrxg), so read it as a fact rather than as a default.
  //
  // A PRESENT BUT NON-CALLABLE `fetchImpl` FAILS CLOSED, LOUDLY. Reading the
  // fact with `typeof === 'function'` quietly turned one into the real `fetch`
  // below — so `{ fetchImpl: null }`, which used to reach a TypeError inside
  // the try and never leave the machine, would instead have sent a real
  // authenticated request to api.clickup.com. Nothing in the tree passes a
  // non-function today, so this is latent; it is guarded anyway because this
  // is the one function whose job is that nothing escapes accounting, and
  // fail-open is the wrong direction for it (review round 1, 2026-09-15).
  //
  // This does NOT weaken the never-throws contract three paragraphs down.
  // That contract is about RUNTIME conditions — a network blip that threw here
  // once uncapped the build loop (task 86bbm4zwd) — and those still come back
  // as `transportError`. A transport that is not callable is a CALLER BUG: it
  // fires deterministically on every call, before any network, so it can only
  // ever be found the moment the broken code first runs.
  //
  // The test is `!== undefined`, never `'fetchImpl' in opts`: an explicit
  // `fetchImpl: undefined` is the one value that legitimately means "use the
  // real fetch", and `reviewGateClickup.test.js` passes exactly that.
  if (opts.fetchImpl !== undefined && typeof opts.fetchImpl !== 'function') {
    throw new TypeError(
      `clickupFetch: fetchImpl was given as ${describeTransport(opts.fetchImpl)}, which is not callable. `
      + 'Pass a function, or omit it (or pass undefined) to use the real fetch. '
      + 'Refusing rather than quietly sending a real request to ClickUp.',
    );
  }
  const injectedTransport = typeof opts.fetchImpl === 'function';
  const fetchImpl = injectedTransport ? opts.fetchImpl : fetch;
  // THE RESERVE, ENFORCED AT THE DOOR (2026-09-04, task 86bbugd8j).
  //
  // Scheduled jobs are expected to stop at their own loop boundaries, where a
  // stop is legible and the pass can still print what it did not reach. This
  // is the BACKSTOP behind that: a job that never checks, or checks and then
  // keeps going, still cannot spend the budget an interactive session needs.
  //
  // It refuses rather than throws, because this function's contract is that it
  // never throws — a rejection escaping here once uncapped the build loop
  // (task 86bbm4zwd). `yielded` is a THIRD outcome alongside a response and a
  // transport error, and both call sites handle it by name. An interactive
  // caller can never reach this branch.
  //
  // ONLY REAL CLICKUP TRAFFIC touches the machine's ledger, and "real" means
  // the host, the transport AND the process — `spendsClickUpBudget` below,
  // which has the incident behind each. Until 2026-09-15 it meant the host
  // alone, and the part that was missing is the one the whole test suite uses,
  // so `npm run test:builder` on the Mini wrote into the same ledger the live
  // relay reads a second later: the suite yielded against its own traffic and
  // reported failures that were not real, and real scheduled jobs stood down
  // alongside it. The door's OWN counter still counts every attempt: it
  // answers "what did this pass cost", which is a different question from
  // "what has been taken from the token".
  const who = callerKind({ env });
  const spends = spendsClickUpBudget(url, { injectedTransport, env, realEnv: process.env });
  const verdict = spends
    ? ledger.shouldYield({ kind: who.kind, now: now(), env })
    : { yield: false, why: whyNothingIsSpent(url, injectedTransport) };
  if (verdict.yield) {
    return { res: null, json: null, text: null, transportError: null, yielded: { ...verdict, caller: who } };
  }
  budget.requests += 1;
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    // Counted on this machine's ledger even though it never arrived: the
    // attempt is what the budget is spent by, and under-counting is the
    // unsafe direction.
    if (spends) ledger.record({ now: now(), env, kind: who.kind });
    return { res: null, json: null, text: null, transportError: err, yielded: null };
  }
  // Only a REAL answer from ClickUp carries a real rate-limit reading. A faked
  // transport's headers are invented, and letting them through here overwrote
  // this process's notion of what ClickUp had left — which then went into the
  // ledger as `rem`, so invented traffic reported invented headroom. Same rule
  // as the ledger write below, and it must be the same condition (86bc0wrxg).
  if (spends) recordLimits(res);
  if (spends) {
    ledger.record({
      now: now(),
      env,
      kind: who.kind,
      rem: budget.remaining,
      reset: budget.resetSeconds,
      limit: budget.limit,
    });
  }
  let text;
  try {
    text = await res.text();
  } catch (err) {
    // The body can fail mid-stream after a perfectly good set of headers — a
    // dropped connection reads as a rejection here, not at the line above.
    return { res, json: null, text: null, transportError: err, yielded: null };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
  return { res, json, text, transportError: null, yielded: null };
}

/** Name what was handed in, so the refusal above says `null` or `an object`
 *  rather than making whoever hit it go and print the value themselves. */
function describeTransport(value) {
  if (value === null) return 'null';
  return `a ${typeof value}`;
}

/**
 * Does this request actually spend the company's one ClickUp token?
 *
 * THREE conditions, and the two after the host are the ones that cost a
 * morning each (2026-09-15, task 86bc0wrxg).
 *
 * 1. THE HOST. `api.clickup.com` is the only host that spends the token, so a
 *    request to a stand-in server or a deliberately-invalid host has spent
 *    nothing.
 *
 * 2. THE TRANSPORT. A caller that brought its own `fetchImpl` sent nothing
 *    through this door's network stack, so nothing of the token was spent
 *    either — even though the URL still says `api.clickup.com`, which is what
 *    most of the test suite does. The host check alone closed only the first
 *    case, while its comment read as a guarantee that both were closed, which
 *    is why this went unnoticed: `npm run test:builder` wrote a few hundred
 *    phantom requests into the very ledger the live relay reads a second
 *    later. The suite then yielded against its own invented traffic and
 *    reported ~22 failures that were not real (build pass on 86bc0w6my,
 *    PR #712), and every scheduled job on the machine stood down for the next
 *    minute for nothing.
 *
 *    The door's OWN accounting tests still have to drive this path with a
 *    fake transport — proving that a scheduled caller past the reserve stops,
 *    and that a request that goes through lands on the ledger. So a faked
 *    request may still be counted, but ONLY against a ledger that is itself a
 *    fixture (`CLICKUP_LEDGER_PATH`). That is what makes it impossible —
 *    rather than merely unlikely — for a faked request to reach the shared
 *    ledger at ~/.starcaster/clickup-ledger.jsonl: it is structural, not a
 *    hostname a future test could happen to choose differently.
 *
 * 3. THE RUNNER. Conditions 1 and 2 both turn on something the CALLER chose,
 *    so a test that chooses neither is invisible to them — it keeps the real
 *    URL and stubs `globalThis.fetch` in its own process, injecting nothing.
 *    From the door's point of view that is live traffic in every respect, and
 *    `bugReportForward.test.js` does it deliberately (proving that the refusal
 *    in `lib/clickupForward.js` reads the runner, not the token, so it hands
 *    in `env: {}` to defeat that refusal on purpose). Both halves are correct
 *    on their own and they cancelled out: five phantom requests per suite run
 *    landed on the operator's shared ledger, which is the one thing this
 *    ticket's acceptance criterion forbids (review round 2, 2026-09-15).
 *
 *    So the last condition is not about the caller at all — it is about the
 *    PROCESS. A test run may write to a ledger of its own
 *    (`CLICKUP_LEDGER_PATH`, exactly as in condition 2) and may never write to
 *    the shared one. That closes the class rather than this one shape: a test
 *    nobody has written yet, in whatever style, cannot reach the operator's
 *    ledger through this door at all.
 *
 *    IT UNDER-COUNTS, AND THAT IS THE RIGHT DIRECTION HERE. The door's standing
 *    rule is to over-count rather than under-count, because an uncounted real
 *    request makes every other process on the machine read a number that is too
 *    small. The exception is bounded to a process that (a) is a test runner and
 *    (b) declared no ledger of its own: a real request from there is already a
 *    defect — `lib/clickupForward.js` refuses one outright — its process exits
 *    in seconds, and the alternative is writing invented traffic into the file
 *    the live relay reads a second later. The door's OWN counter
 *    (`budget.requests`) is untouched by all three conditions, so "what did this
 *    pass cost" still counts every attempt.
 */
function spendsClickUpBudget(url, { injectedTransport = false, env = process.env, realEnv = process.env } = {}) {
  let host;
  try { host = new URL(String(url)).host; } catch { return false; }
  if (host !== 'api.clickup.com') return false;
  const faked = injectedTransport || underTestRunner(realEnv);
  if (!faked) return true;
  return Boolean(env.CLICKUP_LEDGER_PATH);
}

/**
 * Is THIS PROCESS a test run?
 *
 * `node --test` sets `NODE_TEST_CONTEXT` and vitest sets `VITEST`, each in the
 * process it actually runs. The answer is read from the REAL `process.env` and
 * never from an env a caller handed in, because a test is entitled to hand in
 * `{}` on purpose: `bugReportForward.test.js` does exactly that, to prove that
 * `lib/clickupForward.js`'s own refusal reads the runner rather than the
 * token. Reading the handed-in env would let that deliberate choice reach
 * through and switch this off as well — which is how the two guards cancelled
 * each other out (review round 2, 2026-09-15).
 *
 * ONE definition, exported, because `lib/clickupForward.js` asks the same
 * question at its own door and two copies of a predicate drift apart.
 *
 * It is DEFINED one floor down, in `clickupLedger.cjs`, and re-exported here
 * (2026-09-15, task 86bc125u6). The ledger asks the same question for itself —
 * `shouldYield` has a caller that skips this door entirely, and `record` keeps
 * a test process off the machine's live file — and the ledger cannot require
 * this module back without a cycle. So the bottom of the stack owns it and
 * every floor above reads the one answer.
 */
const { underTestRunner } = ledger;

/** Say WHICH of the three conditions spared the budget, so a yield verdict
 *  that never fired still explains itself to whoever is reading the log. */
function whyNothingIsSpent(url, injectedTransport) {
  let host = null;
  try { host = new URL(String(url)).host; } catch { /* an unparseable URL reaches nothing */ }
  if (host !== 'api.clickup.com') return 'not a request to api.clickup.com — nothing of the token is spent';
  if (injectedTransport) return 'the caller supplied its own transport, so nothing left this machine for ClickUp — nothing of the token is spent';
  return 'this process is a test run, which may not spend the company token onto the shared ledger — nothing of the token is spent';
}

/** Keep the live rate-limit state instead of printing it and throwing it away.
 *  A header ClickUp did not send leaves the previous reading alone rather than
 *  overwriting it with null — a missing header is "no news", not "no budget". */
function recordLimits(res) {
  // A response without headers is not a crash. Real ClickUp always sends them,
  // but an injected transport need not, and the door must not be the thing
  // that breaks when a caller hands it a simpler shape than a real Response.
  if (!res || !res.headers || typeof res.headers.get !== 'function') return;
  const limit = res.headers.get('x-ratelimit-limit');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (limit == null && remaining == null) return;
  if (limit != null) budget.limit = Number(limit);
  if (remaining != null) budget.remaining = Number(remaining);
  if (reset != null) budget.resetSeconds = Number(reset);
  budget.at = Date.now();
}

/** What is left, for a caller that wants to decide something with it. A copy,
 *  so a caller cannot edit the counter it is reading. */
function getBudget() {
  const secs = Number.isFinite(budget.resetSeconds)
    ? Math.max(0, budget.resetSeconds - Math.floor(Date.now() / 1000))
    : null;
  return { ...budget, resetsInSeconds: secs };
}

function requireToken() {
  if (!TOKEN) {
    throw new Error(
      'CLICKUP_API_TOKEN is not set. Run this via `npm run <script>` so Doppler supplies it ' +
      '(package.json wraps it in `doppler run --project starcaster --config dev`).'
    );
  }
}

async function call(method, apiPath, body, { timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  // See scripts/builder/clickupRetry.js for the decision and its reasoning —
  // notably why a 429, unlike a timeout, is safe to repeat even for a write.
  // `npm run reconcile` reported fourteen tickets it "could not check" on
  // 2026-09-03, every one an HTTP 429 it had the time to wait out.
  let attempt = 0;
  let waitedMs = 0;
  for (;;) {
    attempt += 1;
    const out = await callOnce(method, apiPath, body, { timeoutMs });
    if (out.status !== 429) return out;
    const decision = retryDecision({
      status: 429,
      attempt,
      elapsedMs: waitedMs,
      resetSeconds: out.resetSeconds,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    console.error(`  ClickUp ${decision.retry ? 'rate limit' : 'rate limit — not retrying'}: ${decision.why}`);
    if (!decision.retry) return out;
    await new Promise((r) => setTimeout(r, decision.waitMs));
    waitedMs += decision.waitMs;
  }
}

/**
 * WHAT A PASS COSTS, in the units ClickUp throttles on (task 86bbtqytq).
 *
 * `clickup_direct.mjs` has counted its own requests since the relay's interval
 * was set, and closes every pass with "requests this pass: N". The scripts on
 * THIS client — reconcile, stale-ready — had no such number, so the one
 * question the ticket asked about scheduling reconcile more often ("measure
 * before you schedule it; a watchdog that exhausts the rate limit takes the
 * relay down with it") could only be answered by arithmetic on the source.
 *
 * A counter, not an estimate: comment paging makes the real figure depend on
 * how chatty each ticket is, which no reading of the code produces.
 *
 * ONE COUNTER, AND IT IS THE ONE DOOR'S (resolved 2026-09-04, round 3).
 *
 * This branch and `main` grew a counter each, within hours, and they were
 * written to disagree on purpose about what a request IS:
 *
 *   - the one door counts at the ATTEMPT — "a request that failed to connect
 *     still spent whatever the attempt costs, and for a budget you would
 *     rather over-count than under-count";
 *   - this file's counted after `requireToken()` — "a missing token is a
 *     request that never left the machine, and counting attempts there would
 *     inflate exactly the number the ticket asked to be measured".
 *
 * Keeping both is the "keep both sides" shape DOCTRINE 6.7 was written about,
 * so there is now one, and it is `budget.requests`. The losing argument turns
 * out to cost nothing here, which is why the merge is safe rather than a coin
 * flip: `clickupFetch` is reached from exactly one place in this file
 * (`callOnce`, below), and `requireToken()` guards that line — so a missing
 * token throws before the door is opened and is not counted either way. The
 * two counters were numerically identical for every caller of this module.
 *
 * KNOWN UNDER-COUNT, unchanged by any of this and worth knowing before you
 * schedule anything on the figure: WRITES from this module shell out to
 * `scripts/clickup_direct.mjs`, a separate process with its own budget. They
 * really are spent against the same per-token limit, and this number does not
 * see them. It is a floor for a pass's cost, not the whole of it.
 */
const requestsMade = () => budget.requests;

/**
 * Test seam: forget this process's rate-limit reading between cases.
 *
 * `budget` is deliberately process-global — a live pass's last real reading
 * from ClickUp stays true until the next one. In a test file that makes every
 * case inherit the one before it, and that is not a cosmetic annoyance: the
 * reading is written into the ledger as `rem`, so one earlier case's cheerful
 * "90 remaining" made a later case unable to yield no matter how much traffic
 * it faked. Two tests written against the broken code passed for that reason
 * alone (2026-09-15, task 86bc0wrxg) — an assertion that could not fail.
 * Mirrors `ledger._resetForTests`; nothing in production calls either.
 */
function _resetBudgetForTests() {
  budget.requests = 0;
  budget.limit = null;
  budget.remaining = null;
  budget.resetSeconds = null;
  budget.at = 0;
}

/**
 * A scheduled job stopping at the reserve, as an error a caller can recognise.
 *
 * A distinct type rather than a string match: `report_job_failure.mjs` and the
 * loop lanes need to tell "the budget ran out and I stopped on purpose" from
 * "ClickUp broke". They are different events with different fixes, and a
 * yield that reads as a failure sends the next reader hunting for an outage.
 */
class ClickUpReserveYield extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ClickUpReserveYield';
    this.yielded = details || null;
  }
}


/**
 * THE THIRD OUTCOME, IN THE SHAPE EVERY CALLER ALREADY READS (2026-09-15,
 * task 86bc0w6my).
 *
 * `clickupFetch` has three outcomes — a response, a transport error, and a
 * yield — and the docstring above `yielded` used to say "both call sites
 * handle it by name". There were FIVE, and four of them did not: they wrote
 * `const { res } = out; res.ok`, and a yield hands back `res: null`. So the
 * one thing built to be quiet and self-clearing arrived as
 * `TypeError: Cannot read properties of null (reading 'ok')`, which every
 * layer above then dressed up as a network fault. On 2026-09-15 that stopped
 * the build and review loops on the Mini with the message "the pipeline is
 * being treated as PAUSED" while the pipeline was running perfectly.
 *
 * The lesson is not "remember to check `yielded`" — four call sites already
 * failed to remember. It is that the check has to be cheap and the words have
 * to be written once. So the vocabulary lives HERE, beside the door that
 * produces the outcome, and `clickupReserveCallSites.test.js` fails if a new
 * call site does not use it.
 */

/**
 * A STRING, not a number, and that is the whole point.
 *
 * Eighteen places in `clickup_direct.mjs` format a failure as
 * `HTTP ${res.status}`. With a numeric sentinel every one of them printed
 * `HTTP -1`, which is not an HTTP status, means nothing to a reader, and sends
 * them looking for a network fault — the exact thing DOCTRINE 2.2 is about. As
 * a string, those same messages say what actually happened without any of them
 * being edited. Every numeric comparison in this repo (`!== 429`, `=== 401`,
 * `=== 404`, `=== 0`) keeps behaving correctly, because a string equals none
 * of them: a yield is not retried and not mistaken for an auth problem.
 */
const YIELDED_STATUS = 'YIELDED (the ClickUp reserve)';

/**
 * Exit 7 means "I stopped on purpose at the ClickUp reserve", and it is not 1.
 * A scheduled job that yields has NOT done its work — so it must not exit 0 —
 * but it also has not failed, and reporting it as a failure would put a
 * ClickUp outage on the bus every time the budget got tight.
 */
const EXIT_YIELDED = 7;

/**
 * The yield, travelling in the ordinary `{ res, json, text }` shape.
 *
 * The same trick a transport failure plays, and for the same reason: hundreds
 * of call sites across this repo are written around that shape, so a new
 * outcome has to arrive in it or every one of them needs editing. Status 0 is
 * already taken by "never left the machine"; 429 is ClickUp refusing. This is
 * US refusing.
 */
function yieldedResult(yielded) {
  return {
    res: { ok: false, status: YIELDED_STATUS, headers: { get: () => null } },
    json: null,
    text: (yielded && yielded.why) || YIELDED_STATUS,
    yielded: yielded || null,
  };
}

/**
 * Did this result stop at the ClickUp reserve rather than fail?
 *
 * A yield travels with `res.ok === false`, which is indistinguishable from a
 * refusal to any caller that only asks `ok`. Every place that branches on
 * failure and means something different by "the server said no" has to ask
 * this first. Accepts a raw door result, a `yieldedResult`, and the
 * `{ res, yielded }` shape non-fatal readers hand back.
 */
function stoppedAtReserve(out) {
  return Boolean(out && (out.yielded || (out.res && out.res.status === YIELDED_STATUS)));
}

/**
 * What a reader is told when a scheduled job stops at the reserve — ONE
 * wording, for every command that can hit it.
 *
 * It says the three things the 2026-09-15 incident proved a reader needs, in
 * this order: that nothing failed, that it clears itself, and — explicitly —
 * that this is NOT a network or token fault. That last line is not padding.
 * The message it replaces ("could not reach ClickUp") sent the next reader
 * hunting for an outage that was never there.
 *
 * Returned as a string rather than printed, so a caller can put it on stderr,
 * in a ClickUp comment, or inside a larger verdict.
 */
function reserveStopMessage(label, why) {
  return [
    `${label} STOPPED — the ClickUp reserve, not a failure.`,
    String(why || YIELDED_STATUS),
    '',
    'What this means: this is a scheduled job, and the ClickUp budget for this minute',
    'is down to the reserve kept for the sessions Dane is actually talking to. The job',
    'stopped instead of spending it. Nothing is half-done that was not already half-done;',
    'the next scheduled pass picks up where this one stopped.',
    'It is NOT a network fault and NOT a token problem — do not go looking for one.',
    'To run this by hand anyway, from a session Dane is in, run it WITHOUT',
    'STARCASTER_CALLER=scheduled — interactive callers never yield.',
  ].join('\n');
}

async function callOnce(method, apiPath, body, { timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  requireToken();
  // Through the one door. This file's contract is to THROW on a transport
  // failure — every caller here is written around that — so the no-throw
  // result is converted back at exactly this line, and nowhere else.
  const out = await clickupFetch(`${API_BASE}${apiPath}`, {
    method,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    // The deadline covers the response HEADERS. Reading the body is bounded by
    // the same signal, because aborting the signal also errors a body that is
    // still streaming.
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (out.yielded) {
    throw new ClickUpReserveYield(
      `ClickUp ${method} ${apiPath} was not sent: ${out.yielded.why}`,
      out.yielded,
    );
  }
  if (out.transportError) {
    const where = out.res ? `${method} ${apiPath} (reading the response body)` : `${method} ${apiPath}`;
    throw new Error(timeoutAwareMessage(out.transportError, where, timeoutMs));
  }
  const { res, json } = out;
  const text = out.text;
  // resetSeconds is surfaced so the retry loop above can wait exactly as long
  // as ClickUp asks, rather than guessing.
  return { ok: res.ok, status: res.status, json, text, resetSeconds: res.headers.get('x-ratelimit-reset') };
}

/**
 * Name the timeout when it was one. A caller that logs `The operation was
 * aborted` sends its reader looking for a bug in this file; one that logs the
 * deadline sends them to the network, which is where the fault is.
 *
 * Both shapes are checked because they are produced by different layers:
 * `AbortSignal.timeout` rejects with a DOMException named `TimeoutError`, and
 * an abort arriving while the body streams surfaces as `AbortError`.
 */
function timeoutAwareMessage(err, what, timeoutMs) {
  const name = String(err?.name || '');
  const timedOut = name === 'TimeoutError' || name === 'AbortError' || err?.code === 'ABORT_ERR';
  if (timedOut) {
    return `ClickUp ${what} did not answer within ${Math.round(timeoutMs / 1000)}s and was abandoned `
      + '(a hung connection, not an error response — the request was given up on, not retried)';
  }
  return `ClickUp ${what} failed: ${String(err?.message || err).slice(0, 300)}`;
}

/**
 * Every non-archived task in a list, across all pages.
 *
 * Termination is "an empty page OR ClickUp says last_page===true", never
 * "last_page !== false": the API can OMIT last_page, and `undefined !== false`
 * is true, so the old sentinel returned after page 0 and silently truncated
 * any list past 100 tasks. An empty page always terminates, so an absent flag
 * just means "fetch the next page" rather than "stop and hope".
 */
async function listTasks(listId, { includeClosed = false, timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  // includeClosed: ClickUp's v2 list endpoint omits closed-type statuses
  // (`Live` among them) unless asked. Opt-in, so callers that want only open
  // work are unaffected.
  const tasks = [];
  const closedParam = includeClosed ? '&include_closed=true' : '';
  for (let page = 0; page < 50; page++) {
    const out = await call(
      'GET',
      `/api/v2/list/${listId}/task?archived=false${closedParam}&page=${page}`,
      undefined,
      { timeoutMs },
    );
    if (!out.ok) throw new Error(`listTasks(${listId}) page ${page}: HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
    const batch = Array.isArray(out.json.tasks) ? out.json.tasks : [];
    tasks.push(...batch);
    if (batch.length === 0 || out.json.last_page === true) return tasks;
  }
  throw new Error(`listTasks(${listId}): stopped after 50 pages — implausibly large, treat as incomplete`);
}

/** ClickUp hands back at most this many comments per page, newest first. */
const COMMENT_PAGE_SIZE = 25;

/**
 * The PAGING RULE for a task's comments — the rule only, with no transport and
 * no failure policy of its own.
 *
 * The endpoint returns ~25 comments, newest first, and a chatty task scrolls
 * its own history off page one. `start`/`start_id`, seeded from the OLDEST
 * comment of each page, walks backwards through the rest.
 *
 * It lives here, injected rather than hard-wired, because a second copy of
 * this rule is not a second copy of some code — it is a second answer to
 * "have I read the whole trail", and the two disagree silently. The pipeline
 * pause switch learned that the expensive way on 2026-08-25: its state is one
 * comment on a task that also gets an hourly reminder comment, so after about
 * 25 hours the PAUSE record scrolled off page one, an unpaged read found no
 * state, and the pause reported itself as RUNNING — the one feature whose
 * whole premise is failing safe, failing open.
 *
 * `get(path)` answers `{ ok, json }` and MUST NOT throw; what a failed read
 * means is the caller's decision, and the two callers decide differently (this
 * file throws, the pause store reports "unreadable", which means "paused").
 *
 *   complete: true   the whole trail is in `comments`, newest-first.
 *   complete: false  it is NOT all there — `failed` carries the bad response,
 *                    or `capped` says it ran past `maxPages`.
 */
async function pageComments({ get, taskId, maxPages = 40 }) {
  const comments = [];
  let query = '';
  for (let page = 0; page < maxPages; page += 1) {
    const out = await get(`/api/v2/task/${taskId}/comment${query}`);
    if (!out || out.ok !== true) return { complete: false, comments, failed: out || null, capped: false };
    const batch = Array.isArray(out.json && out.json.comments) ? out.json.comments : [];
    comments.push(...batch);
    // A short page is the end of the trail. There is no `last_page` on this
    // endpoint, so the page size IS the terminator.
    if (batch.length < COMMENT_PAGE_SIZE) return { complete: true, comments, failed: null, capped: false };
    const oldest = batch[batch.length - 1];
    // No cursor to seed the next page with: stop rather than re-request the
    // same page forever. Reported as INCOMPLETE, because it is.
    if (!oldest || !oldest.id || !oldest.date) return { complete: false, comments, failed: null, capped: true };
    query = `?start=${encodeURIComponent(oldest.date)}&start_id=${encodeURIComponent(oldest.id)}`;
  }
  return { complete: false, comments, failed: null, capped: true };
}

/**
 * Every comment on a task, oldest first, across ALL pages.
 *
 * Throws on an incomplete read — the same choice `listTasks` makes above. A
 * caller here wants the trail, and half a trail that looks whole is how a
 * reader concludes something never happened.
 */
/**
 * A task's comments as RECORDS — `{ id, date, user, comment_text }`,
 * oldest-first.
 *
 * `getTaskComments` below flattens these to bare strings, which is all most
 * callers want. A caller that has to decide something about a comment needs
 * more than its text: `mergeOnComment.findPullRequest` sorts by `date` to pick
 * the newest `PR opened:` line and returns the `id` so the decision can be
 * marked as spent. Handed strings instead, it silently sees every comment as
 * equally old and returns whichever it met first — which is the OLDEST, the
 * opposite of the rule it documents.
 *
 * That is not hypothetical: the reconciler passed strings, so it could not use
 * that parser at all, wrote its own loose regex over prose, and closed a live
 * ticket on another ticket's pull request (86bbuv66c, 2026-09-04).
 *
 * `user` CARRIES AUTHORSHIP, and it is here because dropping it made a whole
 * class of question unaskable (2026-09-05, task 86bbv05ay). Every other reader
 * of a merge command in this repo — `mergeDecision`, `liveApprovalAt`,
 * `autoMergeLane` — decides authorship by numeric user id, and a reader handed
 * these records could not: it would have had to fall back to the text alone,
 * which reads "merge" typed by anybody as Dane's authorization. Passing the
 * field through costs nothing and keeps the reconciler asking the SAME question
 * the merge path asks, rather than a weaker second version of it.
 *
 * It is passed through verbatim rather than reduced to an id, because
 * `machineComment.isMachineComment` needs the text and the callers need the
 * name for the evidence line they write.
 */
async function getTaskCommentRecords(taskId) {
  const out = await pageComments({ get: (p) => call('GET', p), taskId });
  if (!out.complete) {
    if (out.capped) {
      throw new Error(`getTaskComments(${taskId}): stopped without reaching the end of the trail — treat as incomplete`);
    }
    const f = out.failed || {};
    throw new Error(`getTaskComments(${taskId}): HTTP ${f.status} ${(f.json && f.json.err) || String(f.text || '').slice(0, 200)}`);
  }
  // API order is newest-first within a page; reverse the whole set to oldest-first.
  return out.comments.reverse().map((c) => ({
    id: String(c.id ?? ''),
    date: c.date,
    user: c.user || null,
    comment_text: c.comment_text || '',
  }));
}

async function getTaskComments(taskId) {
  return (await getTaskCommentRecords(taskId)).map((c) => c.comment_text);
}

/**
 * The one bounded door to `clickup_direct.mjs`.
 *
 * Both write helpers below go through it so the deadline is written once —
 * `postBusMessage` is a subprocess that talks to ClickUp over the same network
 * as the fetches above, and an unbounded one hangs a scheduled job exactly as
 * completely (task 86bbqz7rg, review round 2). `run` is injectable so the
 * timeout and the message it produces can be tested without a real hang.
 */
function runDirect(args, { input, what, timeoutMs = SHELL_TIMEOUT_MS, run = execFileSync } = {}) {
  requireToken();
  try {
    return run('node', [DIRECT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    }).trim();
  } catch (err) {
    throw new Error(`${what} failed: ${shellFailureDetail(err, timeoutMs)}`);
  }
}

/**
 * What actually went wrong with a shell-out. A killed child reports its signal
 * and nothing else useful, so a bare `err.stderr` on a timeout is empty — and
 * "failed: " with nothing after it is the log line that sends somebody hunting
 * for a bug in this file instead of at a stuck socket.
 */
function shellFailureDetail(err, timeoutMs) {
  if (err?.killed || err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT') {
    return `it did not finish within ${Math.round(timeoutMs / 1000)}s and was killed `
      + '(most likely a ClickUp call that hung rather than failed)';
  }
  const detail = (err?.stderr || err?.stdout || err?.message || '').toString().trim();
  return detail.slice(0, 300);
}

/**
 * Move a task's status through the verified direct door. Throws on any
 * outcome that is not a confirmed, stuck change — including the per-list
 * "that status does not exist" 200 that a bare PUT would report as success.
 * Returns the command's own report line.
 */
/**
 * Move a task, through the one verified door.
 *
 * `ifStatus` makes the move a GUARDED one: `clickup status --if-status` re-reads
 * the task and exits 3 without writing if it is no longer wearing that status,
 * which `runDirect` surfaces as a throw. A caller that read a status, thought
 * about it, and then wrote wants this — the thinking is the window. Added for
 * the reconciler's authorized close (86bbv05ay), where the gap between reading
 * the ticket and closing it spans a `gh` call and a comment post, and a ticket
 * Dane moved himself in that gap must be left exactly where he put it.
 */
function moveTaskStatus(taskId, status, { timeoutMs = SHELL_TIMEOUT_MS, ifStatus = null } = {}) {
  const guard = ifStatus ? ['--if-status', String(ifStatus)] : [];
  return runDirect(['status', '--task', String(taskId), '--status', status, ...guard], {
    what: `move task ${taskId} -> "${status}"${ifStatus ? ` (only while it is "${ifStatus}")` : ''}`,
    timeoutMs,
  });
}

/**
 * Comment on a task through the direct door.
 *
 * A DURABLE surface, which is why it exists (2026-09-03, task 86bbtqpxd). The
 * reconciler used to report a contradiction to the bus and nowhere else, so a
 * finding about one specific ticket competed with every other message in the
 * room and was read as traffic. A comment lands on the ticket the finding is
 * ABOUT, where the next reader of that ticket cannot miss it — and it survives
 * the channel scrolling.
 */
function commentOnTask(taskId, text, { timeoutMs = SHELL_TIMEOUT_MS } = {}) {
  return runDirect(['comment', '--task', String(taskId), '--body-file', '-'], {
    input: text,
    what: `comment on task ${taskId}`,
    timeoutMs,
  });
}

/** Post to the bus through the direct door (inherits its quota reporting). */
function postBusMessage(channelId, text, { timeoutMs = SHELL_TIMEOUT_MS } = {}) {
  return runDirect(['chat', '--channel', String(channelId), '--body-file', '-'], {
    input: text,
    what: `post to bus channel ${channelId}`,
    timeoutMs,
  });
}

module.exports = {
  WORKSPACE,
  // The one door, and the budget it keeps (task 86bbugcdb).
  clickupFetch,
  getBudget,
  // The reserve (task 86bbugd8j): the ledger, who is asking, and the error a
  // scheduled job gets when it stops.
  ledger,
  callerKind,
  // "Is this process a test run?" — one definition, because
  // `lib/clickupForward.js` refuses a real request on the same question and a
  // second copy of it would drift (task 86bc0wrxg, review round 2).
  underTestRunner,
  ClickUpReserveYield,
  // The third outcome's shared vocabulary (task 86bc0w6my). Every caller of
  // `clickupFetch` outside this file must use these rather than inventing its
  // own; `clickupReserveCallSites.test.js` holds them to it.
  YIELDED_STATUS,
  EXIT_YIELDED,
  yieldedResult,
  stoppedAtReserve,
  reserveStopMessage,
  COMMENT_PAGE_SIZE,
  HTTP_TIMEOUT_MS,
  SHELL_TIMEOUT_MS,
  runDirect,
  shellFailureDetail,
  // The raw door, for callers that need an endpoint this module has no opinion
  // about (the heartbeat's roll call reads and rewrites a task description).
  // Exported rather than re-implemented: a second fetch wrapper is a second
  // place for the token contract and the JSON/non-JSON handling to drift.
  call,
  requestsMade,
  _resetBudgetForTests,
  listTasks,
  pageComments,
  getTaskComments,
  getTaskCommentRecords,
  moveTaskStatus,
  commentOnTask,
  postBusMessage,
};
