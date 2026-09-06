'use strict';

/**
 * THE MACHINE-LOCAL CLICKUP SPEND LEDGER — and the reserve that scheduled
 * jobs leave alone (2026-09-04, task 86bbugd8j).
 *
 * WHAT IT IS FOR
 * The operator's decision, 2026-09-03: **scheduled jobs yield.** "You are
 * never blocked by a background job." So a background job stops before it
 * spends the last of the minute's ClickUp budget, and the sessions Dane is
 * actually talking to keep the rest.
 *
 * WHY A FILE AND NOT A COUNTER
 * ClickUp throttles per TOKEN, and there is one token for the whole company.
 * The one door (`scripts/lib/clickup.cjs`) counts requests, but only its OWN
 * process's — and on this machine the relay, both loop lanes, the pulse and
 * any hand-run command are five separate processes spending against one
 * allowance. On 2026-09-03 a relay pass reporting `requests this pass: 97`
 * was, from its own point of view, within budget, and it 429'd, because it
 * was not alone. A per-process counter cannot answer the question this file
 * exists to answer, so the record has to live outside the process.
 *
 * ══ THE HONEST LIMIT, WHICH IS NOT A GUARANTEE ══════════════════════════════
 * THIS LEDGER CANNOT SEE THE OTHER MACHINE. The Mac Mini and the MacBook Pro
 * spend against the SAME per-token limit and share no filesystem. Nothing
 * here coordinates them. So this reduces collisions; it does not eliminate
 * them, and it must never be read as a promise that a scheduled job cannot
 * 429 — which is exactly why the 429-retry behaviour in
 * `scripts/builder/clickupRetry.js` ships first and stays. A cross-machine
 * mechanism would be its own ticket and its own decision (the ticket says so
 * in as many words, and it is a Non-goal here).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE RESERVE IS MEASURED, NOT GUESSED (the ticket's first acceptance
 * criterion). `scripts/measure_clickup_headroom.mjs` reads the relay's own
 * launchd log — 853 paired passes over 2026-08-25..2026-09-04 — and reports:
 *
 *   requests THIS pass spent     p50  32   p90  94   p99 114   max 123
 *   remaining at end of pass     p50  71   p90  97   min   1
 *   OTHER processes, same minute p50   0   p90  10   p95  19   p99  47   max 57
 *
 * and a direct reading of five real interactive loop commands run back to back
 * inside one minute (`waiting`, `get`, `comments`, `queue`, `waiting`) cost
 * SIX requests in total — 1 each for the reads, 3 for `waiting`.
 *
 * So the reserve is 25: four times the measured dense interactive minute, and
 * above the p95 (19) of everything else spending alongside the relay. It is
 * deliberately not sized for that p99 of 47, because that tail is dominated by
 * the OTHER SCHEDULED JOBS on this machine — and after this change they yield
 * too, so the reserve does not have to cover them.
 *
 * WHAT IT COSTS, stated rather than discovered later: 83% of the 853 measured
 * relay passes fit inside the 75 requests a scheduled job may now spend in a
 * minute. The other 17% will stop early and finish on a later pass instead of
 * driving `remaining` down to single digits — which is the point. A pass that
 * ends the minute at 6 remaining is a pass that has already taken the budget
 * an interactive session was about to need.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** ClickUp's limit is per minute; so is this window. */
const WINDOW_MS = 60 * 1000;

/** What ClickUp allows a token per minute, when it has not told us otherwise. */
const DEFAULT_LIMIT = 100;

/**
 * THE RESERVE — how much of the minute a scheduled job must leave behind.
 * Measured; see the header. Overridable ONLY through the environment, which is
 * what makes the break-test in the ticket possible (set it to 0 and the
 * yielding test fails; set it to 100 and nothing scheduled may spend at all).
 */
const DEFAULT_RESERVE = 25;

/** A timestamp further ahead than this means a clock moved, not a fast job. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 1000;

/** A reset further ahead than this is not a ClickUp minute; it is nonsense. */
const MAX_RESET_AHEAD_MS = 5 * 60 * 1000;

/** Rewrite the file when it passes this, keeping only what still matters. */
const MAX_BYTES = 256 * 1024;

/**
 * And never keep more than this many records, however recent they are. At
 * ClickUp's own ceiling of 100 requests a minute this is more than twenty
 * minutes of the busiest traffic the API will allow — far more than the one
 * minute any reading uses — so it can only ever discard records that are
 * already irrelevant.
 */
const MAX_ENTRIES = 2000;

/** How often (in appends) to bother checking the size. */
const PRUNE_EVERY = 200;

function ledgerPath(env = process.env) {
  if (env.CLICKUP_LEDGER_PATH) return env.CLICKUP_LEDGER_PATH;
  return path.join(os.homedir(), '.starcaster', 'clickup-ledger.jsonl');
}

function reserveSize(env = process.env) {
  const raw = env.CLICKUP_RESERVE;
  if (raw == null || raw === '') return DEFAULT_RESERVE;
  const n = Number(raw);
  // An unparseable override is NOT a licence to spend freely: fall back to the
  // measured reserve rather than to zero.
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RESERVE;
}

/**
 * A write failure LATCHES for the life of the process, and is reported as
 * "budget unknown" rather than swallowed.
 *
 * A job that cannot record its own spend does not merely mis-report itself —
 * it makes every OTHER process on this machine read a number that is too
 * small, which is the unsafe direction. So the first failed append makes this
 * process's readings unknown, and a scheduled job with an unknown reading
 * yields. That is loud, and loud gets fixed.
 */
let writeFailure = null;

/** Test seam: forget the latch (and the append counter) between cases. */
function _resetForTests() {
  writeFailure = null;
  appendsSincePrune = 0;
}

let appendsSincePrune = 0;

/**
 * Record ONE request against this machine's budget.
 *
 * Called from the one door, at the ATTEMPT — the same instant, and for the
 * same reason, the door's own counter increments: a request that failed to
 * connect still spent whatever the attempt costs, and for a budget you would
 * rather over-count than under-count.
 *
 * `rem`/`reset` are ClickUp's own `x-ratelimit-remaining` / `x-ratelimit-reset`
 * when the response carried them. They are the authoritative reading, and
 * writing them here is what lets a DIFFERENT process on this machine start
 * from ClickUp's number instead of from its own guess.
 *
 * Never throws. A ledger that crashed the caller would be a worse bug than
 * the one it exists to fix.
 */
function record({ n = 1, rem = null, reset = null, limit = null, now = Date.now(), env = process.env, kind = null } = {}) {
  const file = ledgerPath(env);
  const line = JSON.stringify({
    t: now,
    n,
    rem: Number.isFinite(rem) ? rem : null,
    res: Number.isFinite(reset) ? reset : null,
    lim: Number.isFinite(limit) ? limit : null,
    p: process.pid,
    // Clamped, so the two byte-size bounds below can be reasoned about at all.
    // Every other field is a number; this is the only one a caller could make
    // arbitrarily long, and a record whose size is unbounded makes MAX_ENTRIES
    // and MAX_BYTES disagree about how big the file can get.
    k: kind == null ? null : String(kind).slice(0, 16),
  }) + '\n';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // O_APPEND: the kernel places a short line atomically at the end, so two
    // processes appending in the same millisecond do not interleave.
    fs.appendFileSync(file, line, { flag: 'a' });
  } catch (err) {
    writeFailure = `the ledger at ${file} could not be written (${String(err && err.message || err).slice(0, 120)})`;
    return { ok: false, why: writeFailure };
  }
  appendsSincePrune += 1;
  if (appendsSincePrune >= PRUNE_EVERY) {
    appendsSincePrune = 0;
    prune({ file, now });
  }
  return { ok: true, why: null };
}

/**
 * Keep the file from growing without bound.
 *
 * KNOWN RACE, bounded and deliberate: an append landing between the read and
 * the rename is lost. It is a handful of requests at most, in the direction of
 * under-counting, and it can only happen at the moment the file is being
 * rewritten (once per 200 appends per process). The alternative — a lock file —
 * is a new way for a scheduled job to hang, which is a worse trade for a
 * counter whose whole job is to be approximately right within one minute.
 */
function prune({ file, now = Date.now() }) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  if (stat.size <= MAX_BYTES) return;
  try {
    // TWO bounds, because either one alone leaks. Time alone does not bound a
    // burst — a hundred requests a minute for five minutes is still five
    // hundred lines and nothing prunes them. Count alone does not bound a
    // quiet week's slow accumulation of stale readings. Both, and the file
    // cannot grow past MAX_ENTRIES lines whatever the traffic looks like.
    const keep = readLines(file)
      .filter((e) => e && Number.isFinite(e.t) && e.t >= now - MAX_RESET_AHEAD_MS)
      .slice(-MAX_ENTRIES)
      .map((e) => JSON.stringify(e))
      .join('\n');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, keep ? `${keep}\n` : '');
    fs.renameSync(tmp, file);
  } catch {
    // A prune that fails is a big file, not a wrong answer. Leave it.
  }
}

/**
 * Every record in the file, torn lines survived.
 *
 * A record always ends in a newline, so a half-written one can only ever be
 * the LAST line — and the next append then fuses onto it, producing something
 * like `{"t":{"t":175...,"n":1}`. Dropping that whole line would silently lose
 * a real request, which is the under-counting direction and the unsafe one, so
 * a failed parse is retried from the line's last `{`. That recovers the fusion
 * exactly and costs only the fragment that was already lost.
 *
 * A line that still will not parse is dropped. One lost request out of a
 * hundred is not worth a lock file — and a lock file is a new way for a
 * scheduled job to hang, which is a far worse trade.
 */
function readLines(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
      continue;
    } catch { /* fall through to the salvage below */ }
    const brace = line.lastIndexOf('{');
    if (brace <= 0) continue;
    try { out.push(JSON.parse(line.slice(brace))); } catch { /* genuinely unreadable */ }
  }
  return out;
}

/**
 * WHAT IS LEFT OF THIS MINUTE, as best this machine can tell.
 *
 *   { known, remaining, reserve, limit, spent, source, reason }
 *
 * `known: false` is the fail-safe state and it means exactly one thing to a
 * caller: budget unknown, so do not spend into the reserve. It matches how the
 * pipeline pause switch treats a flag it cannot read — an unreadable safety
 * record counts as the safe answer, never as the convenient one.
 *
 * An ABSENT file is not unknown. It is the ordinary state of the first process
 * after every reset, and nothing has been spent. Treating absence as unknown
 * would make the first scheduled job of every minute yield, which is the
 * "yields incorrectly, so the relay never completes" failure the ticket's Risk
 * section names.
 */
function headroom({ now = Date.now(), env = process.env } = {}) {
  const reserve = reserveSize(env);
  const file = ledgerPath(env);
  const base = { reserve, limit: DEFAULT_LIMIT, remaining: null, spent: null, source: null };

  if (writeFailure) {
    return { ...base, known: false, reason: writeFailure };
  }

  let entries;
  try {
    entries = readLines(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ...base, known: true, remaining: DEFAULT_LIMIT, spent: 0, source: 'empty', reason: 'no ledger yet — nothing has spent on this machine' };
    }
    return { ...base, known: false, reason: `the ledger at ${file} could not be read (${String(err.message || err).slice(0, 120)})` };
  }

  if (!entries.length) {
    return { ...base, known: true, remaining: DEFAULT_LIMIT, spent: 0, source: 'empty', reason: 'the ledger is empty — nothing has spent on this machine' };
  }

  const newest = entries.reduce((a, b) => (Number(b.t) > Number(a.t) ? b : a));
  if (Number(newest.t) > now + CLOCK_SKEW_TOLERANCE_MS) {
    return { ...base, known: false, reason: 'the ledger holds a request timestamped in the future — this machine\'s clock moved, so a one-minute window means nothing' };
  }

  // The current window. ClickUp's own reset is the truth when we have a fresh
  // one; a rolling minute is the fallback.
  const anchor = entries
    .filter((e) => Number.isFinite(e.res) && e.res * 1000 > now && e.res * 1000 <= now + MAX_RESET_AHEAD_MS)
    .reduce((a, b) => (a === null || Number(b.t) > Number(a.t) ? b : a), null);
  const implausible = entries.some((e) => Number.isFinite(e.res) && e.res * 1000 > now + MAX_RESET_AHEAD_MS);
  if (implausible) {
    return { ...base, known: false, reason: 'the ledger holds a rate-limit reset minutes into the future — the reading is not trustworthy' };
  }
  const windowStart = anchor ? (anchor.res * 1000) - WINDOW_MS : now - WINDOW_MS;
  const inWindow = entries.filter((e) => Number.isFinite(e.t) && e.t >= windowStart && e.t <= now + CLOCK_SKEW_TOLERANCE_MS);
  const spent = inWindow.reduce((sum, e) => sum + (Number.isFinite(e.n) ? e.n : 0), 0);

  // ClickUp's own number, when a request in THIS window brought one back, minus
  // whatever this machine has spent since that answer arrived. This is the
  // reading that sees the other machine — the header counts its spend too.
  const observed = inWindow
    .filter((e) => Number.isFinite(e.rem) && Number.isFinite(e.res) && e.res * 1000 > now)
    .reduce((a, b) => (a === null || Number(b.t) > Number(a.t) ? b : a), null);

  if (observed) {
    const since = inWindow
      .filter((e) => Number(e.t) > Number(observed.t))
      .reduce((sum, e) => sum + (Number.isFinite(e.n) ? e.n : 0), 0);
    const limit = Number.isFinite(observed.lim) ? observed.lim : DEFAULT_LIMIT;
    return {
      ...base,
      limit,
      known: true,
      remaining: Math.max(0, observed.rem - since),
      spent,
      source: 'clickup-header',
      reason: `ClickUp said ${observed.rem} left; ${since} request(s) went out on this machine since`,
    };
  }

  return {
    ...base,
    known: true,
    remaining: Math.max(0, DEFAULT_LIMIT - spent),
    spent,
    source: 'ledger-count',
    reason: `${spent} request(s) recorded on this machine in the last minute; ClickUp has not told us a remaining count in this window`,
  };
}

/**
 * THE DECISION: may this caller spend a request right now?
 *
 * Interactive sessions are never told to yield — that IS the operator's
 * decision, not a shortcut. Scheduled jobs yield when the remaining budget has
 * reached the reserve, and when the reading cannot be taken at all.
 */
function shouldYield({ kind, now = Date.now(), env = process.env } = {}) {
  if (kind !== 'scheduled') {
    return { yield: false, why: `an ${kind || 'interactive'} caller never yields — the reserve exists to protect it`, headroom: null };
  }
  const h = headroom({ now, env });
  if (!h.known) {
    return {
      yield: true,
      why: `the ClickUp budget cannot be read, so a scheduled job must not spend into the ${h.reserve}-request reserve — ${h.reason}`,
      headroom: h,
    };
  }
  if (h.remaining <= h.reserve) {
    return {
      yield: true,
      why: `${h.remaining} of ${h.limit} ClickUp requests left this minute and the reserve is ${h.reserve} — `
        + `a scheduled job stops here so the sessions Dane is talking to are not blocked (${h.reason})`,
      headroom: h,
    };
  }
  return { yield: false, why: `${h.remaining} left, reserve ${h.reserve} — room to spend`, headroom: h };
}

module.exports = {
  WINDOW_MS,
  DEFAULT_LIMIT,
  DEFAULT_RESERVE,
  MAX_BYTES,
  MAX_ENTRIES,
  PRUNE_EVERY,
  ledgerPath,
  reserveSize,
  record,
  headroom,
  shouldYield,
  _resetForTests,
};
