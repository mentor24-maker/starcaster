'use strict';

/**
 * The throughput check's decisions, driven with no network, no token and no
 * clock of its own — which is the whole reason lib/loopThroughput.js holds no
 * IO.
 *
 * Every test here is written against a way this feature could fail QUIETLY.
 * That is not a stylistic preference: this is a monitor, and a monitor that
 * fails quietly is worse than not having one, because it converts "nobody is
 * watching" into "something is watching" and then stops anybody looking. The
 * headline case is the one the ticket names — **a stall detector that cannot
 * report a stall** — and it is the first test below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const lt = require('../../lib/loopThroughput.js');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Noon UTC, so every fixture instant sits comfortably inside its own UTC day
 * and no assertion here can be moved across a boundary by the clock. Every
 * call passes `calendar: lt.UTC_DAYS` for the same reason — the default is the
 * machine's LOCAL day, which is right for a person reading the report and a
 * flake in a test.
 */
const NOW = Date.parse('2026-08-31T12:00:00.000Z');
const UTC = lt.UTC_DAYS;

/** A ClickUp task, in the shape the API actually returns: millis as STRINGS. */
function task({ id = 't', status = 'queued', created = NOW - 30 * DAY, closed = null, updated = null } = {}) {
  return {
    id,
    status: { status },
    date_created: created === null ? null : String(created),
    date_closed: closed === null ? null : String(closed),
    date_updated: updated === null ? String(created) : String(updated),
  };
}

// --- THE HEADLINE: a stall must be reported as a stall -----------------------

/**
 * The 2026-08-31 fixture the ticket specifies: a week with tickets closing,
 * then 24 hours with none while 52 sit queued.
 *
 * BREAK TEST, run on 2026-08-31 before this was believed. Forcing `verdict()`
 * to always take the IDLE branch (`if (!queue || queue.openWork === 0)` →
 * `if (true)`) fails this test and three others — the empty-Queued-column
 * case, the loopsFiring case, and the report rendering — 4 failed, 15 passed.
 * Restoring the guard returns all 19 to green.
 *
 * Four rather than one because STALLED is asserted from four angles on
 * purpose, and that is the point worth keeping: a detector which cannot report
 * the thing it detects is the exact defect class this ticket was filed about,
 * so it is not left resting on a single assertion.
 */
test('2026-08-31: a week of closures, then 24h of nothing with 52 queued — STALLED', () => {
  const tasks = [];
  // Five days of real delivery, all inside the 7-day report window and all
  // ending before the 24h stall window opens: nine a day, days 6 through 2.
  for (let day = 6; day >= 2; day--) {
    for (let n = 0; n < 9; n++) {
      tasks.push(task({
        id: `live-${day}-${n}`, status: 'live',
        created: NOW - (day + 3) * DAY, closed: NOW - day * DAY + HOUR,
      }));
    }
  }
  // Then the morning that produced this ticket: 52 queued, nothing closing.
  for (let n = 0; n < 52; n++) {
    tasks.push(task({ id: `q-${n}`, status: 'queued', created: NOW - 6 * DAY, updated: NOW - 2 * HOUR }));
  }

  const queue = lt.queueShape(tasks);
  assert.equal(queue.queued, 52);
  assert.equal(queue.openWork, 52);

  const closed = lt.closedPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  assert.equal(closed.reduce((s, d) => s + d.count, 0), 45, 'the week did deliver');
  assert.equal(closed[closed.length - 1].count, 0, 'and today delivered nothing');

  const closedLast24h = lt.closedSince({ tasks, now: NOW });
  assert.equal(closedLast24h, 0);

  const v = lt.verdict({ closedLast24h, queue, loopsFiring: true });
  assert.equal(v.state, 'STALLED');
  assert.equal(v.stalled, true);
  assert.notEqual(v.exitCode, 0, 'a stall must not exit 0 — scripts branch on this');
  assert.match(v.why, /52 ticket\(s\) sat open/);
});

// --- the distinction that keeps it honest -----------------------------------

test('nothing closed and nothing to close is IDLE, not a stall — and says why', () => {
  const tasks = [task({ id: 'a', status: 'live', closed: NOW - 5 * DAY })];
  const v = lt.verdict({ closedLast24h: 0, queue: lt.queueShape(tasks), loopsFiring: true });
  assert.equal(v.state, 'IDLE');
  assert.equal(v.stalled, false);
  assert.equal(v.exitCode, 0);
  assert.match(v.why, /nothing to close/);
});

test('an empty Queued column is NOT an empty queue — work parked in review still counts', () => {
  // The merge side has stopped: nothing to claim, two tickets sitting in
  // review, nothing shipping. Gating the verdict on the Queued column alone
  // would call this healthy, which is the whole failure mode.
  const tasks = [
    task({ id: 'r1', status: 'in review' }),
    task({ id: 'r2', status: 'ready to launch' }),
  ];
  const queue = lt.queueShape(tasks);
  assert.equal(queue.queued, 0);
  assert.equal(queue.inFlight, 2);
  const v = lt.verdict({ closedLast24h: 0, queue, loopsFiring: true });
  assert.equal(v.state, 'STALLED');
});

test('a ticket closing inside the window is MOVING, whatever the depth', () => {
  const tasks = [
    task({ id: 'a', status: 'live', closed: NOW - 2 * HOUR }),
    ...Array.from({ length: 40 }, (_, i) => task({ id: `q${i}` })),
  ];
  const v = lt.verdict({
    closedLast24h: lt.closedSince({ tasks, now: NOW }), queue: lt.queueShape(tasks),
  });
  assert.equal(v.state, 'MOVING');
  assert.equal(v.exitCode, 0);
});

test('an unreadable queue is UNKNOWN and never healthy', () => {
  const v = lt.verdict({ unreadable: 'ClickUp returned HTTP 429' });
  assert.equal(v.state, 'UNKNOWN');
  assert.equal(v.stalled, false, 'it must not post a stall it cannot substantiate');
  assert.equal(v.exitCode, 2, 'and it must not exit 0 either');
  assert.match(v.why, /429/);
});

test('loopsFiring changes where the reader is sent, never whether it is a stall', () => {
  const queue = lt.queueShape([task({ id: 'q' })]);
  const firing = lt.verdict({ closedLast24h: 0, queue, loopsFiring: true });
  const dead = lt.verdict({ closedLast24h: 0, queue, loopsFiring: false });
  const unsure = lt.verdict({ closedLast24h: 0, queue, loopsFiring: null });
  for (const v of [firing, dead, unsure]) assert.equal(v.state, 'STALLED');
  assert.match(firing.why, /loops ARE firing/);
  assert.match(dead.why, /npm run heartbeat/);
  assert.match(unsure.why, /could not be determined/);
});

// --- reading the tickets ----------------------------------------------------

test('an open ticket carries no closure date, in either shape ClickUp uses', () => {
  assert.equal(lt.closedAt(task({ closed: null })), null);
  // "0" is the other shape. Parsed as an instant it is 1 Jan 1970, which would
  // fall silently off the far end of every window rather than erroring.
  assert.equal(lt.closedAt({ date_closed: '0' }), null);
  assert.equal(lt.closedAt({}), null);
  assert.equal(lt.closedAt(null), null);
});

test('closures land on the day they happened, and days with none read as 0', () => {
  const tasks = [
    task({ id: 'a', status: 'live', closed: Date.parse('2026-08-29T09:00:00.000Z') }),
    task({ id: 'b', status: 'live', closed: Date.parse('2026-08-29T22:00:00.000Z') }),
    task({ id: 'c', status: 'live', closed: Date.parse('2026-08-31T01:00:00.000Z') }),
    // Older than the window: must not be credited to its edge.
    task({ id: 'd', status: 'live', closed: Date.parse('2026-08-01T01:00:00.000Z') }),
  ];
  const rows = lt.closedPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r.count]));
  assert.equal(rows.length, 7);
  assert.equal(byDate['2026-08-29'], 2);
  assert.equal(byDate['2026-08-30'], 0);
  assert.equal(byDate['2026-08-31'], 1);
  assert.equal(rows.reduce((s, r) => s + r.count, 0), 3, 'the August 1st closure is outside the window');
});

test('queueShape counts every status and keeps closed work out of the open count', () => {
  const shape = lt.queueShape([
    task({ id: '1', status: 'queued' }),
    task({ id: '2', status: 'queued' }),
    task({ id: '3', status: 'building' }),
    task({ id: '4', status: 'in review' }),
    task({ id: '5', status: 'needs your input' }),
    task({ id: '6', status: 'live' }),
  ]);
  assert.equal(shape.queued, 2);
  assert.equal(shape.inFlight, 3);
  assert.equal(shape.openWork, 5);
  assert.equal(shape.closed, 1);
  assert.equal(shape.total, 6);
});

// --- the backlog curve ------------------------------------------------------

test('the backlog curve is reconstructed from creation and closure, not guessed', () => {
  const tasks = [
    // Filed before the window, still open: on every day.
    task({ id: 'old', status: 'queued', created: NOW - 20 * DAY }),
    // Filed on the 29th, closed on the 30th: on the 29th only.
    task({
      id: 'brief', status: 'live',
      created: Date.parse('2026-08-29T08:00:00.000Z'),
      closed: Date.parse('2026-08-30T08:00:00.000Z'),
    }),
    // Filed today: on today only.
    task({ id: 'new', status: 'queued', created: Date.parse('2026-08-31T08:00:00.000Z') }),
  ];
  const curve = lt.depthPerDay({ tasks, now: NOW, days: 4, calendar: UTC });
  const byDate = Object.fromEntries(curve.map((r) => [r.date, r.open]));
  assert.equal(byDate['2026-08-28'], 1);
  assert.equal(byDate['2026-08-29'], 2);
  assert.equal(byDate['2026-08-30'], 1);
  assert.equal(byDate['2026-08-31'], 2);
});

test('a plateau is a run of days at or above today, not a single reading', () => {
  const flat = lt.depthPlateau([
    { date: 'a', open: 3 }, { date: 'b', open: 51 }, { date: 'c', open: 52 }, { date: 'd', open: 51 },
  ]);
  assert.equal(flat.depth, 51);
  assert.equal(flat.days, 3, 'b, c and d are all at or above 51');
  assert.equal(flat.since, 'b');

  const yesterdayWasBetter = lt.depthPlateau([{ date: 'a', open: 1 }, { date: 'b', open: 9 }]);
  assert.equal(yesterdayWasBetter.days, 1);

  assert.deepEqual(lt.depthPlateau([]), { days: 0, since: null, depth: null });
});

// --- the rework bucket ------------------------------------------------------

test('the rework bucket comes from wipCap.classifyPrs, with ages looked up beside it', () => {
  const prs = [
    { number: 449, state: 'OPEN', body: 'https://app.clickup.com/t/aaa', createdAt: '2026-08-25T10:00:00Z' },
    { number: 480, state: 'OPEN', body: 'https://app.clickup.com/t/bbb', createdAt: '2026-08-30T10:00:00Z' },
    // In flight, not rework — its ticket is still being built.
    { number: 481, state: 'OPEN', body: 'https://app.clickup.com/t/ccc', createdAt: '2026-08-30T10:00:00Z' },
  ];
  const { rows, oldest, groups } = lt.reworkPrs({
    prs,
    ticketStatusById: { aaa: 'Queued', bbb: 'Queued', ccc: 'Building' },
    now: NOW,
  });
  assert.deepEqual(groups.queued, [449, 480], 'the bucket is classifyPrs own');
  assert.deepEqual(rows.map((r) => r.number), [449, 480], 'oldest first');
  assert.equal(oldest.number, 449);
  assert.ok(oldest.ageMs > 6 * DAY && oldest.ageMs < 7 * DAY);
});

test('a rework PR whose age cannot be read is still listed, sorted last', () => {
  // Dropping it would shrink the very number this report exists to show.
  const { rows, oldest } = lt.reworkPrs({
    prs: [
      { number: 1, state: 'OPEN', body: 'https://app.clickup.com/t/aaa' },
      { number: 2, state: 'OPEN', body: 'https://app.clickup.com/t/bbb', createdAt: '2026-08-30T10:00:00Z' },
    ],
    ticketStatusById: { aaa: 'Queued', bbb: 'Queued' },
    now: NOW,
  });
  assert.deepEqual(rows.map((r) => r.number), [2, 1]);
  assert.equal(rows[1].ageMs, null);
  assert.equal(oldest.number, 2, 'oldest is the oldest KNOWN age, never the unreadable one');
});

test('a ticket in Rework counts as claimable depth, never as work in flight', () => {
  // Task 86bbr1u9v. `queued` here means "what a build loop can claim", and
  // loop-build claims Rework AND Queued. Counting a send-back as in-flight
  // would make the stall detector report a healthy pipeline while the rework
  // pile rotted — the precise failure the Rework status was created to end.
  const tasks = [
    task({ id: 'r1', status: 'rework' }),
    task({ id: 'r2', status: 'Rework' }),
    task({ id: 'q1', status: 'queued' }),
    task({ id: 'b1', status: 'building' }),
  ];
  const queue = lt.queueShape(tasks);
  assert.equal(queue.queued, 3, 'two rework tickets plus one queued are all claimable');
  assert.equal(queue.inFlight, 1, 'only the one being built is in flight');
  assert.equal(queue.byStatus.rework, 2, 'and the census still names the status');

  // The verdict must follow: three claimable tickets and nothing closing is a
  // stall, not the "nothing to close" all-clear.
  const v = lt.verdict({ closedLast24h: 0, queue, loopsFiring: true });
  assert.equal(v.state, 'STALLED');
});

test('the rework bucket reads the real Rework status, not just tickets left in Queued', () => {
  // BREAK TEST: change `[...groups.rework, ...groups.queued]` back to
  // `groups.queued` and this reports an empty bucket on the day the status
  // shipped. Watched fail.
  const prs = [
    { number: 1, state: 'OPEN', body: 'https://app.clickup.com/t/sentback', createdAt: new Date(NOW - 6 * DAY).toISOString() },
    { number: 2, state: 'OPEN', body: 'https://app.clickup.com/t/notmigrated', createdAt: new Date(NOW - 2 * DAY).toISOString() },
    { number: 3, state: 'OPEN', body: 'https://app.clickup.com/t/building', createdAt: new Date(NOW - HOUR).toISOString() },
  ];
  const { rows, oldest } = lt.reworkPrs({
    prs,
    // Both sides of the migration at once: one ticket already moved to Rework,
    // one still sitting in Queued with its PR open. Both are half-built work
    // nothing is finishing, and reading only one of them is a silent zero on
    // one side of the migration or the other.
    ticketStatusById: { sentback: 'Rework', notmigrated: 'Queued', building: 'Building' },
    now: NOW,
  });
  assert.deepEqual(rows.map((r) => r.number), [1, 2], 'the in-flight PR is not rework');
  assert.equal(oldest.number, 1, 'oldest first');
});

test('no rework PRs is an empty bucket, not a crash', () => {
  const r = lt.reworkPrs({ prs: [], ticketStatusById: {}, now: NOW });
  assert.deepEqual(r.rows, []);
  assert.equal(r.oldest, null);
});

// --- the calendar ------------------------------------------------------------

test('a day key and that day end come from the same calendar and cannot disagree', () => {
  // The first draft bucketed closures by calendar day and measured the backlog
  // at "this time of day, N days ago" — a rolling boundary wearing a calendar
  // label. They disagreed by up to a day at every row.
  for (const cal of [lt.UTC_DAYS, lt.LOCAL_DAYS]) {
    const key = cal.key(NOW);
    assert.equal(cal.key(cal.end(key) - 1), key, 'the last instant of a day is still that day');
    assert.notEqual(cal.key(cal.end(key)), key, 'and the first instant of the next one is not');
  }
});

test('the day window is exactly N days, oldest first, ending today', () => {
  const w = lt.dayWindow({ now: NOW, days: 7, calendar: UTC });
  assert.equal(w.length, 7);
  assert.equal(w[6], '2026-08-31');
  assert.equal(w[0], '2026-08-25');
  assert.deepEqual([...w].sort(), w, 'oldest first');
});

// --- what a person and the bus actually read --------------------------------

test('the report names the verdict, the depth and the oldest rework PR', () => {
  const tasks = [task({ id: 'q', status: 'queued' })];
  const queue = lt.queueShape(tasks);
  const closed = lt.closedPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  const curve = lt.depthPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  const rework = lt.reworkPrs({
    prs: [{ number: 449, state: 'OPEN', body: 'https://app.clickup.com/t/aaa', createdAt: '2026-08-25T10:00:00Z' }],
    ticketStatusById: { aaa: 'Queued' },
    now: NOW,
  });
  const v = lt.verdict({ closedLast24h: 0, queue, loopsFiring: true });
  const out = lt.renderReport({
    verdict: v, closed, curve, plateau: lt.depthPlateau(curve), rework, queue, now: NOW,
  });
  assert.match(out, /STALLED/);
  assert.match(out, /#449/);
  assert.match(out, /1 queued/);
  assert.match(out, /2026-08-31/);
});

test('the bus post explains itself to somebody who was not already suspicious', () => {
  const tasks = [task({ id: 'q', status: 'queued' })];
  const queue = lt.queueShape(tasks);
  const closed = lt.closedPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  const curve = lt.depthPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  const text = lt.renderStallPost({
    verdict: lt.verdict({ closedLast24h: 0, queue, loopsFiring: true }),
    closed,
    plateau: lt.depthPlateau(curve),
    rework: { rows: [], oldest: null },
    queue,
    now: NOW,
    node: 'mac-mini',
  });
  assert.match(text, /not getting shorter/);
  assert.match(text, /npm run throughput/, 'it names the command that says more');
  assert.match(text, /\[CC-starcaster\]/, 'and signs itself, like every other bus post');
  assert.match(text, /shipped nothing/, 'and says what makes this different from a failure alarm');
});

// --- suppression -------------------------------------------------------------

test('suppression allows the first post and blocks a second inside the window', () => {
  const everyMs = 6 * HOUR;
  assert.equal(lt.dueAgain({ lastAt: '', now: NOW, everyMs }), true, 'never posted');
  assert.equal(lt.dueAgain({ lastAt: new Date(NOW - HOUR).toISOString(), now: NOW, everyMs }), false);
  assert.equal(lt.dueAgain({ lastAt: new Date(NOW - 7 * HOUR).toISOString(), now: NOW, everyMs }), true);
  // An unreadable stamp posts rather than staying silent: a corrupt file must
  // not be able to switch the alarm off.
  assert.equal(lt.dueAgain({ lastAt: 'not a date', now: NOW, everyMs }), true);
});

// --- the two numbers that must agree ----------------------------------------

/**
 * MEASURED ON LIVE DATA, 2026-08-31. The first real run printed "57 open" as
 * the last point of the backlog curve directly above "56 open in total" — two
 * readings of the same question, in one report, disagreeing by one. The cause
 * was ticket 86bb4uyvp, sitting in `live` with `date_closed` empty.
 *
 * BREAK TEST. Delete the `if (undatedClosure(t)) continue;` line from
 * depthPerDay and this test fails alone (the curve's last day reads 2, not 1).
 */
test("a finished ticket with no closure date does not haunt the curve forever", () => {
  const tasks = [
    task({ id: 'q', status: 'queued', created: NOW - 10 * DAY }),
    // Terminal status, no timestamp — exactly 86bb4uyvp's shape.
    task({ id: 'ghost', status: 'live', created: NOW - 10 * DAY, closed: null }),
  ];
  const queue = lt.queueShape(tasks);
  const curve = lt.depthPerDay({ tasks, now: NOW, days: 3, calendar: UTC });

  assert.equal(queue.openWork, 1, 'the status is the authoritative fact about now');
  assert.equal(curve[curve.length - 1].open, queue.openWork,
    "the curve's last point IS today's depth — they must never disagree");
  assert.equal(lt.undatedClosures(tasks), 1, 'and the guess is counted, not hidden');
});

test('the report says out loud that the curve had to guess', () => {
  const tasks = [task({ id: 'ghost', status: 'live', created: NOW - 10 * DAY, closed: null })];
  const curve = lt.depthPerDay({ tasks, now: NOW, days: 7, calendar: UTC });
  const out = lt.renderReport({
    verdict: lt.verdict({ closedLast24h: 0, queue: lt.queueShape(tasks) }),
    closed: lt.closedPerDay({ tasks, now: NOW, days: 7, calendar: UTC }),
    curve,
    plateau: lt.depthPlateau(curve),
    rework: { rows: [], oldest: null },
    queue: lt.queueShape(tasks),
    now: NOW,
    undated: lt.undatedClosures(tasks),
  });
  assert.match(out, /no closure date/);
});

test('an age reads as an age, not as "open ... ago"', () => {
  // ageText already ends in "ago"; the first draft rendered "open 8d 0h ago".
  const rework = lt.reworkPrs({
    prs: [{ number: 419, state: 'OPEN', body: 'https://app.clickup.com/t/aaa', createdAt: '2026-08-23T12:00:00Z' }],
    ticketStatusById: { aaa: 'Queued' },
    now: NOW,
  });
  const queue = lt.queueShape([task({ id: 'q' })]);
  const curve = lt.depthPerDay({ tasks: [task({ id: 'q' })], now: NOW, days: 7, calendar: UTC });
  const out = lt.renderReport({
    verdict: lt.verdict({ closedLast24h: 1, queue }),
    closed: lt.closedPerDay({ tasks: [], now: NOW, days: 7, calendar: UTC }),
    curve, plateau: lt.depthPlateau(curve), rework, queue, now: NOW,
  });
  assert.match(out, /opened 8d 0h ago/);
  assert.doesNotMatch(out, /open 8d 0h ago/);
});

// ---------------------------------------------------------------------------
// The 24-hour blind spot, and why it is NOT closed with a recency alarm
// (2026-09-02, task 86bbtmbwe).
//
// The premise held: `verdict` returns MOVING on `closedLast24h > 0`, so a
// stall shorter than the window is invisible. The proposed fix — call it a
// stall when nothing has closed for N hours — did not survive measurement.
// 189 closures over the fortnight to 2026-09-02 gave a p90 gap of 3.4h and a
// p95 of 10.2h, and the overnight gap this ticket was opened about was 7.2h:
// shorter than eleven other gaps in the same fortnight. A threshold low enough
// to catch it fires on most nights.
// ---------------------------------------------------------------------------

test('MOVING answers the question the tool actually asks', () => {
  // "35 tickets reached Live" is true and is not an answer to "is the queue
  // getting shorter?". On 2026-09-02 it read as an all-clear while open work
  // had gone 40 -> 56 in a week.
  const v = lt.verdict({
    closedLast24h: 33,
    queue: { openWork: 56, queued: 52, inFlight: 4 },
    trend: { first: 40, last: 56, delta: 16, days: 7 },
  });
  assert.strictEqual(v.state, 'MOVING', 'a growing backlog is not a fault — the verdict does not change');
  assert.match(v.why, /33 ticket\(s\) reached Live/);
  assert.match(v.why, /40 → 56 over 7 days \(up 16\)/);
});

test('MOVING says so when the backlog fell, too', () => {
  const v = lt.verdict({
    closedLast24h: 12, queue: { openWork: 20, queued: 18, inFlight: 2 },
    trend: { first: 34, last: 20, delta: -14, days: 7 },
  });
  assert.match(v.why, /34 → 20 over 7 days \(down 14\)/);
});

test('a long quiet spell is MENTIONED and never becomes a verdict', () => {
  // The night of 2026-09-01, replayed: 35 closed in the window, last one 7.2
  // hours ago, 48 queued. A recency alarm would call this STALLED. It must not
  // — by the measured distribution that night was around the 93rd percentile
  // and unremarkable.
  const v = lt.verdict({
    closedLast24h: 35,
    queue: { openWork: 55, queued: 48, inFlight: 7 },
    lastClose: { at: 0, ms: 7.2 * HOUR },
    trend: { first: 40, last: 55, delta: 15, days: 7 },
  });
  assert.strictEqual(v.state, 'MOVING', 'a 7.2h gap is an ordinary night here, not a stall');
  assert.strictEqual(v.exitCode, 0, 'and it must not post to the bus');
  assert.match(v.why, /Nothing has closed for 7\.2 hours/, 'but the reader is told');
});

test('a short quiet spell is not worth mentioning', () => {
  const v = lt.verdict({
    closedLast24h: 5, queue: { openWork: 10, queued: 8, inFlight: 2 },
    lastClose: { at: 0, ms: 20 * 60 * 1000 },
  });
  assert.ok(!/Nothing has closed/.test(v.why),
    'three quarters of real gaps are under an hour; saying so every run is noise');
});

test('the 24h window is still what decides MOVING — the blind spot is documented, not papered over', () => {
  // Deliberate. Nothing here turns a quiet spell into a stall, and a future
  // reader who wants to must read the measurement first.
  const v = lt.verdict({
    closedLast24h: 1,
    queue: { openWork: 55, queued: 48, inFlight: 7 },
    lastClose: { at: 0, ms: 23 * HOUR },
  });
  assert.strictEqual(v.state, 'MOVING');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'lib', 'loopThroughput.js'), 'utf8');
  assert.match(src, /p90\s+3\.38h/, 'the measured distribution is recorded next to the decision');
  assert.match(src, /would have fired on roughly eleven of the last fourteen nights/,
    'and the reason a recency threshold was rejected');
});

test('"nothing has ever closed" is not "closed a very long time ago"', () => {
  const NOW = Date.parse('2026-09-02T15:00:00.000Z');
  assert.strictEqual(lt.sinceLastClose({ tasks: [], now: NOW }), null);
  assert.strictEqual(lt.sinceLastClose({ tasks: [{ id: 'a' }], now: NOW }), null);
  const r = lt.sinceLastClose({ tasks: [
    { id: 'a', date_closed: String(NOW - 3 * HOUR) },
    { id: 'b', date_closed: String(NOW - 1 * HOUR) },
    { id: 'c', date_closed: '' },
  ], now: NOW });
  assert.strictEqual(r.ms, 1 * HOUR, 'the most recent closure wins');
});

test('a closure dated in the future is ignored rather than producing a negative age', () => {
  const NOW = Date.parse('2026-09-02T15:00:00.000Z');
  const r = lt.sinceLastClose({ tasks: [
    { id: 'a', date_closed: String(NOW + DAY) },
    { id: 'b', date_closed: String(NOW - 2 * HOUR) },
  ], now: NOW });
  assert.strictEqual(r.ms, 2 * HOUR);
});

test('the trend cannot go quiet on a rising backlog, which is what plateau does', () => {
  // The bug that prompted it: depthPlateau anchors on TODAY, so 55 -> 55 -> 56
  // reports a run of one day and the caller prints nothing — silence on the
  // worse of the two cases.
  const rising = [{ date: 'd1', open: 55 }, { date: 'd2', open: 55 }, { date: 'd3', open: 56 }];
  assert.strictEqual(lt.depthPlateau(rising).days, 1, 'plateau still says almost nothing here');
  const t = lt.depthTrend(rising);
  assert.deepStrictEqual([t.first, t.last, t.delta, t.days], [55, 56, 1, 3]);
});

test('the trend needs two points to mean anything', () => {
  assert.strictEqual(lt.depthTrend([]), null);
  assert.strictEqual(lt.depthTrend([{ date: 'd1', open: 5 }]), null);
  assert.strictEqual(lt.depthTrend(null), null);
});

test('a duration is said in the unit the reader thinks in', () => {
  assert.strictEqual(lt.hoursText(7.2 * HOUR), '7.2 hours');
  assert.strictEqual(lt.hoursText(20 * 60 * 1000), '20 minutes');
  assert.strictEqual(lt.hoursText(-1), 'an unknown time');
  assert.strictEqual(lt.hoursText('x'), 'an unknown time');
});

test('IDLE and STALLED are untouched by any of this', () => {
  const idle = lt.verdict({ closedLast24h: 0, queue: { openWork: 0, queued: 0, inFlight: 0 }, lastClose: { at: 0, ms: 40 * HOUR } });
  assert.strictEqual(idle.state, 'IDLE');
  assert.strictEqual(idle.exitCode, 0);
  const stalled = lt.verdict({ closedLast24h: 0, queue: { openWork: 12, queued: 10, inFlight: 2 }, loopsFiring: true });
  assert.strictEqual(stalled.state, 'STALLED');
  assert.strictEqual(stalled.exitCode, 1);
  const unknown = lt.verdict({ unreadable: 'ClickUp said 429' });
  assert.strictEqual(unknown.state, 'UNKNOWN');
  assert.strictEqual(unknown.exitCode, 2);
});

test('the caller reports the last closure and the trend, or none of this is visible', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'loop_throughput.mjs'), 'utf8');
  assert.match(code, /throughput\.sinceLastClose\(\{ tasks, now: NOW \}\)/);
  assert.match(code, /throughput\.depthTrend\(curve\)/);
  assert.match(code, /verdict\(\{ closedLast24h, queue, loopsFiring, trend, lastClose \}\)/,
    'both must reach the verdict, or the fix is inert in the thing that runs');
});
