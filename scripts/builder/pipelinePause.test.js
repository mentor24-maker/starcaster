'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pause = require('./pipelinePause.js');
const store = require('./pipelinePauseStore.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** A ClickUp comment, in the shape the API returns one. */
function comment(text, date) {
  return { id: String(date), date: String(date), comment_text: text };
}

// ---------------------------------------------------------------------------
// The record format: writer and reader are the same file, and must stay so.
// ---------------------------------------------------------------------------

test('a pause record round-trips through the parser', () => {
  const text = pause.pauseRecord({ by: 'Dane', node: 'macbook-pro', at: '2026-08-25T18:00:00.000Z', why: 'priority job on the deck' });
  const back = pause.parseRecord(text);
  assert.equal(back.kind, 'paused');
  assert.equal(back.by, 'Dane');
  assert.equal(back.node, 'macbook-pro');
  assert.equal(back.at, '2026-08-25T18:00:00.000Z');
  assert.equal(back.why, 'priority job on the deck');
});

test('a resume record round-trips, and is a different kind from a pause', () => {
  const back = pause.parseRecord(pause.resumeRecord({ by: 'Dane', at: '2026-08-25T19:00:00.000Z' }));
  assert.equal(back.kind, 'running');
  assert.equal(back.by, 'Dane');
});

test('a record with no "why" omits the line rather than writing an empty one', () => {
  const text = pause.resumeRecord({ by: 'Dane', at: 'now' });
  assert.ok(!/^why:/m.test(text), 'an empty field must not be written at all');
  assert.equal(pause.parseRecord(text).why, '');
});

test('prose that MENTIONS a marker is not a record', () => {
  // The marker must be the first line. A relayed bus message, or someone
  // pasting the trail into a note, must never steer the pipeline.
  assert.equal(pause.parseRecord(`I think someone left this on:\n${pause.PAUSE_MARKER}\nat: whenever`), null);
  assert.equal(pause.parseRecord('paused the pipeline earlier, see [pipeline] PAUSED above'), null);
  assert.equal(pause.parseRecord(''), null);
  assert.equal(pause.parseRecord(null), null);
});

// ---------------------------------------------------------------------------
// The trail: newest wins, in both directions.
// ---------------------------------------------------------------------------

test('the newest record wins — a resume after a pause means running', () => {
  const { state } = pause.readTrail([
    comment(pause.pauseRecord({ by: 'Dane', at: 'a' }), 1000),
    comment(pause.resumeRecord({ by: 'Dane', at: 'b' }), 2000),
  ]);
  assert.equal(state.paused, false);
});

test('the newest record wins — a pause after a resume means paused', () => {
  const { state } = pause.readTrail([
    comment(pause.resumeRecord({ by: 'Dane', at: 'a' }), 1000),
    comment(pause.pauseRecord({ by: 'Dane', at: 'b', why: 'deck' }), 2000),
  ]);
  assert.equal(state.paused, true);
  assert.equal(state.why, 'deck');
});

test('comment order in the array does not decide — the timestamp does', () => {
  const { state } = pause.readTrail([
    comment(pause.pauseRecord({ by: 'Dane', at: 'b' }), 2000),   // listed first, NEWER
    comment(pause.resumeRecord({ by: 'Dane', at: 'a' }), 1000),
  ]);
  assert.equal(state.paused, true);
});

test('a nag older than the state record is still the last thing the announcer said', () => {
  // Stopping the scan at the newest state record would re-announce the same
  // pause on every single pass, which is the noise the hourly rule exists to
  // prevent.
  const { state, lastNagAt } = pause.readTrail([
    comment(pause.pauseRecord({ by: 'Dane', at: 'a' }), 1000),
    comment(pause.nagRecord({ at: 'b' }), 2000),
  ]);
  assert.equal(state.paused, true);
  assert.equal(lastNagAt, 2000);
});

test('unrelated comments on the switch are ignored entirely', () => {
  const { state, lastNagAt } = pause.readTrail([
    comment('what is this ticket for?', 1000),
    comment('PR opened: https://github.com/x/y/pull/1', 2000),
  ]);
  assert.equal(state, null);
  assert.equal(lastNagAt, null);
});

// ---------------------------------------------------------------------------
// THE FAIL-SAFE. Acceptance criterion 3, tested both directions.
// ---------------------------------------------------------------------------

test('FAIL-SAFE: an unreadable switch is treated as PAUSED', () => {
  const v = pause.pauseVerdict({ readable: false, why: 'HTTP 500' });
  assert.equal(v.paused, true, 'an unreadable switch must stop the pipeline, not let it run');
  assert.equal(v.code, 3, 'and it must use the same exit code every caller already acts on');
  assert.equal(v.certain, false, 'while never claiming it KNOWS the pipeline is paused');
  assert.match(v.message, /HTTP 500/, 'the reason it could not read must reach the operator');
});

test('FAIL-SAFE, the other direction: a readable switch that says running does NOT pause', () => {
  // The guard is only worth anything if it can say yes. A check that returned
  // "paused" whatever it read would be indistinguishable from a broken
  // pipeline — which is the exact confusion this whole feature is about.
  const v = pause.pauseVerdict({
    readable: true,
    switchFound: true,
    comments: [comment(pause.resumeRecord({ by: 'Dane', at: 'x' }), 1000)],
  });
  assert.equal(v.paused, false);
  assert.equal(v.code, 0);
  assert.equal(v.certain, true);
});

test('a CONFIRMED absence is "running", not "unreadable"', () => {
  // A clean read of the list with no switch in it is an ANSWER: the pipeline
  // has never been paused. Treating that as unreadable would leave a repo that
  // has never used the feature permanently unable to build anything.
  const v = pause.pauseVerdict({ readable: true, switchFound: false });
  assert.equal(v.paused, false);
  assert.equal(v.code, 0);
  assert.equal(v.certain, true);
});

test('a switch that exists but carries no record is running', () => {
  const v = pause.pauseVerdict({ readable: true, switchFound: true, comments: [comment('hello', 1)] });
  assert.equal(v.paused, false);
});

test('a paused switch declines with code 3 and says who has the deck and why', () => {
  const v = pause.pauseVerdict({
    readable: true,
    switchFound: true,
    comments: [comment(pause.pauseRecord({ by: 'Dane', at: '2026-08-25T18:00:00.000Z', why: 'launch work' }), 5000)],
  });
  assert.equal(v.paused, true);
  assert.equal(v.code, 3);
  assert.equal(v.certain, true);
  assert.match(v.message, /Dane/);
  assert.match(v.message, /launch work/);
  assert.match(v.message, /normal outcome/i, 'a decline must not read as a failure');
});

// ---------------------------------------------------------------------------
// In flight vs stranded — the difference between waiting and rescuing.
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000;

function ticket(over = {}) {
  return { id: 'abc', name: 'a task', status: { status: 'Building' }, date_updated: String(NOW - 5 * MIN), ...over };
}

test('a ticket in Building is a build in flight', () => {
  const row = pause.classifyTicket(ticket(), { nowMs: NOW });
  assert.equal(row.kind, 'a build');
  assert.equal(row.stranded, false);
});

test('a ticket in Queued or Live is not in flight at all', () => {
  assert.equal(pause.classifyTicket(ticket({ status: { status: 'Queued' } }), { nowMs: NOW }), null);
  assert.equal(pause.classifyTicket(ticket({ status: { status: 'Live' } }), { nowMs: NOW }), null);
});

test('"In review" alone is a resting status — only the review claim note makes it a pass in flight', () => {
  const resting = ticket({ status: { status: 'In review' } });
  assert.equal(pause.classifyTicket(resting, { nowMs: NOW }), null,
    'a ticket WAITING for a reviewer must not hold a pause open forever');

  const working = ticket({ status: { status: 'In review' }, loopNote: `${pause.REVIEW_CLAIM_NOTE} — a review pass started 8/25 4:10pm` });
  assert.equal(pause.classifyTicket(working, { nowMs: NOW }).kind, 'a review');
});

test('a ticket untouched for longer than the threshold is STRANDED, not busy', () => {
  const old = ticket({ date_updated: String(NOW - 3 * HOUR) });
  assert.equal(pause.classifyTicket(old, { nowMs: NOW }).stranded, true);
});

test('the stranded threshold is generous enough not to yank a live build', () => {
  // A build pass stamps its Loop note at claim time and then says nothing
  // until the PR is open — routinely half an hour of real work. Calling that
  // stranded would hand the same job to a second builder.
  assert.ok(pause.STRANDED_AFTER_MS >= 60 * MIN, 'must be at least an hour');
  const busy = ticket({ date_updated: String(NOW - 45 * MIN) });
  assert.equal(pause.classifyTicket(busy, { nowMs: NOW }).stranded, false);
});

test('inFlight splits the two cases and never counts a ticket as both', () => {
  const { working, stranded } = pause.inFlight([
    ticket({ id: 'busy' }),
    ticket({ id: 'dead', date_updated: String(NOW - 5 * HOUR) }),
    ticket({ id: 'queued', status: { status: 'Queued' } }),
  ], { nowMs: NOW });
  assert.deepEqual(working.map((r) => r.id), ['busy']);
  assert.deepEqual(stranded.map((r) => r.id), ['dead']);
});

// ---------------------------------------------------------------------------
// The drain: pause must never promise decks it has not cleared.
// ---------------------------------------------------------------------------

test('a clean drain reports clear and exits 0', () => {
  const r = pause.drainReport({ ended: 'clear', working: [], waitedMs: 4 * MIN });
  assert.equal(r.clear, true);
  assert.equal(r.code, 0);
  assert.match(r.message, /decks are clear/);
});

test('--now says the decks are NOT clear and names exactly what it left', () => {
  const working = [{ id: 'zz1', name: 'Something big', kind: 'a build' }];
  const r = pause.drainReport({ ended: 'left', working });
  assert.equal(r.clear, false);
  assert.equal(r.code, 3);
  assert.match(r.message, /NOT clear/);
  assert.match(r.message, /zz1/, 'the ticket it left running must be named, not summarised as a count');
  assert.match(r.message, /Something big/);
});

test('a drain that timed out is not a clear drain either, and says how long it waited', () => {
  const r = pause.drainReport({ ended: 'timeout', working: [{ id: 'q9', name: 'Slow one', kind: 'a build' }], budgetMs: 30 * MIN });
  assert.equal(r.clear, false);
  assert.equal(r.code, 3);
  assert.match(r.message, /30 minutes/);
  assert.match(r.message, /q9/);
});

test('NO drain report claims the decks are clear unless they are', () => {
  // The one sentence this command must never be allowed to say over a running
  // build: the operator reads it and goes to work on the deck.
  for (const ended of ['left', 'timeout']) {
    const r = pause.drainReport({ ended, working: [{ id: 'x', name: 'n', kind: 'a build' }], budgetMs: MIN });
    assert.ok(!/decks are clear/.test(r.message), `"${ended}" must never report clear decks`);
  }
});

test('a drain mentions stranded tickets separately and does not wait on them', () => {
  const r = pause.drainReport({ ended: 'clear', working: [], stranded: [{ id: 'gone', name: 'Orphan', kind: 'a build' }] });
  assert.equal(r.code, 0, 'a stranded ticket must not hold the pause open forever');
  assert.match(r.message, /STRANDED/);
  assert.match(r.message, /gone/);
  assert.match(r.message, /resume/, 'and must say what puts it right');
});

// ---------------------------------------------------------------------------
// The announcement: two hours, then hourly.
// ---------------------------------------------------------------------------

test('a running pipeline is never announced', () => {
  assert.equal(pause.nagDecision({ paused: false, nowMs: NOW }).post, false);
});

test('a fresh pause says nothing for the first two hours', () => {
  const d = pause.nagDecision({ paused: true, sinceMs: NOW - 90 * MIN, lastNagAt: null, nowMs: NOW });
  assert.equal(d.post, false);
  assert.match(d.reason, /threshold/);
});

test('past two hours with nothing said yet, it speaks', () => {
  assert.equal(pause.nagDecision({ paused: true, sinceMs: NOW - 2 * HOUR - MIN, lastNagAt: null, nowMs: NOW }).post, true);
});

test('having just spoken, it stays quiet until the hour is up', () => {
  const base = { paused: true, sinceMs: NOW - 5 * HOUR, nowMs: NOW };
  assert.equal(pause.nagDecision({ ...base, lastNagAt: NOW - 20 * MIN }).post, false);
  assert.equal(pause.nagDecision({ ...base, lastNagAt: NOW - 61 * MIN }).post, true);
});

test('a pause with no readable timestamp is not announced on a guess', () => {
  const d = pause.nagDecision({ paused: true, sinceMs: null, lastNagAt: null, nowMs: NOW });
  assert.equal(d.post, false);
  assert.match(d.reason, /no readable pause time/);
});

test('the announcement says how to end it', () => {
  const m = pause.nagMessage({ by: 'Dane', why: 'launch', sinceMs: NOW - 3 * HOUR, nowMs: NOW });
  assert.match(m, /still PAUSED/);
  assert.match(m, /3 hours/);
  assert.match(m, /npm run pipeline -- resume/);
});

test('the resumed message is said once and reports what was swept', () => {
  const swept = [
    { id: 'a1', kind: 'a build', destination: 'Rework' },
    { id: 'b2', kind: 'a review', destination: 'In review' },
  ];
  assert.match(pause.resumedMessage({ by: 'Dane', pausedForMs: 30 * MIN, swept }), /a1/);
  assert.match(pause.resumedMessage({ by: 'Dane', pausedForMs: 30 * MIN, swept }), /b2/);
  assert.match(pause.resumedMessage({ by: 'Dane', pausedForMs: 30 * MIN, swept: [] }), /Nothing was left stranded/);
});

// ---------------------------------------------------------------------------
// Who may resume.
// ---------------------------------------------------------------------------

test('resume is refused without --operator-asked', () => {
  const a = pause.resumeAuthorization({});
  assert.equal(a.allowed, false);
  assert.equal(a.code, 2);
  assert.match(a.message, /only the operator/i);
  assert.match(a.message, /--operator-asked/, 'a refusal must say what would satisfy it');
});

test('resume is allowed with --operator-asked, and says it is on the record', () => {
  const a = pause.resumeAuthorization({ operatorAsked: true });
  assert.equal(a.allowed, true);
  assert.match(a.message, /recorded/i);
});

test('a swept ticket is told to look for its own branch before rebuilding', () => {
  const note = pause.sweptTicketNote({ at: 'now', by: 'Dane' });
  assert.match(note, /build-start/, 'half-finished work may already be pushed');
  assert.match(note, /Queued/);
});

// ---------------------------------------------------------------------------
// The store: every way a read can fail must arrive as "unreadable".
// ---------------------------------------------------------------------------

/** A fake ClickUp that answers from a table of path -> response. */
function fakeCall(routes) {
  return async (method, path) => {
    for (const [match, answer] of routes) {
      if (path.includes(match)) return typeof answer === 'function' ? answer(path) : answer;
    }
    return { res: { ok: false, status: 404 }, json: null };
  };
}
const OK = (json) => ({ res: { ok: true, status: 200 }, json });

test('the list read asks for CLOSED tasks — the switch rests in one', () => {
  // Without include_closed the lookup finds nothing, reports a confirmed
  // absence, and every actor runs straight through a live pause. This is the
  // single most likely way the whole feature fails silently.
  let seen = '';
  const call = async (m, p) => { seen = p; return OK({ tasks: [], last_page: true }); };
  return store.fetchQueue({ call, list: '1' }).then(() => {
    assert.match(seen, /include_closed=true/);
    assert.match(seen, /archived=false/);
  });
});

test('an HTTP failure on the list read is UNREADABLE, not an empty queue', () => {
  const call = async () => ({ res: { ok: false, status: 500 }, json: null });
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.readable, false);
    assert.match(sw.why, /500/);
    assert.equal(pause.pauseVerdict(sw).paused, true);
  });
});

test('a thrown fetch is UNREADABLE too, never a crash', () => {
  const call = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.readable, false);
    assert.match(sw.why, /ENOTFOUND/);
    assert.equal(pause.pauseVerdict(sw).code, 3);
  });
});

test('a clean list read with no switch in it is a confirmed absence', () => {
  const call = fakeCall([['/task?', OK({ tasks: [{ id: '1', name: 'Something else' }], last_page: true })]]);
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.readable, true);
    assert.equal(sw.switchFound, false);
    assert.equal(pause.pauseVerdict(sw).paused, false);
  });
});

test('the switch is found by name, case- and space-insensitively, and its trail read', () => {
  const call = fakeCall([
    ['/list/1/task', OK({ tasks: [{ id: 'sw', name: `  ${pause.SWITCH_TASK_NAME.toUpperCase()} ` }], last_page: true })],
    ['/task/sw/comment', OK({ comments: [comment(pause.pauseRecord({ by: 'Dane', at: 'x' }), 10)] })],
  ]);
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.switchFound, true);
    assert.equal(pause.pauseVerdict(sw).paused, true);
  });
});

test('a 404 on a configured switch id is NOT proof the switch is gone', () => {
  // Changed in review (PR #434). The id is only a shortcut past the list walk;
  // the switch's real identity is its NAME. Treating a 404 as a confirmed
  // absence let a stale CLICKUP_PAUSE_TASK talk `pause` into creating a SECOND
  // switch — two flags disagreeing, which is worse than no flag at all. So a
  // 404 falls back to the name lookup (covered below), and a 404 with an
  // UNREADABLE list is unreadable, never "no switch".
  const gone = fakeCall([['/task/zz', { res: { ok: false, status: 404 }, json: null }]]);
  const broken = fakeCall([['/task/zz', { res: { ok: false, status: 503 }, json: null }]]);
  return Promise.all([
    store.readSwitch({ call: gone, list: '1', pauseTaskId: 'zz' }),
    store.readSwitch({ call: broken, list: '1', pauseTaskId: 'zz' }),
  ]).then(([a, b]) => {
    assert.equal(a.readable, false, 'the fallback list read failed, so nothing is confirmed');
    assert.equal(pause.pauseVerdict(a).paused, true);
    assert.equal(b.readable, false);
    assert.equal(pause.pauseVerdict(b).paused, true);
  });
});

test('a 401 on a configured switch id names BOTH causes, because ClickUp conflates them', () => {
  // Driven live: a made-up task id comes back 401, not 404. Failing safe is
  // right, but "HTTP 401" alone reads as an expired token and sends the
  // diagnosis past the actual cause, which is a stale CLICKUP_PAUSE_TASK.
  const call = fakeCall([['/task/zz', { res: { ok: false, status: 401 }, json: null }]]);
  return store.readSwitch({ call, list: '1', pauseTaskId: 'zz' }).then((sw) => {
    assert.equal(sw.readable, false, 'it must still fail safe');
    assert.match(sw.why, /bad token/);
    assert.match(sw.why, /CLICKUP_PAUSE_TASK/, 'and name the one-line way out');
    assert.equal(pause.pauseVerdict(sw).code, 3);
  });
});

test('a failure reading the COMMENTS is unreadable — not "the switch exists and says nothing"', () => {
  const call = fakeCall([
    ['/list/1/task', OK({ tasks: [{ id: 'sw', name: pause.SWITCH_TASK_NAME }], last_page: true })],
    ['/task/sw/comment', { res: { ok: false, status: 500 }, json: null }],
  ]);
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.readable, false);
    assert.equal(pause.pauseVerdict(sw).paused, true);
  });
});

test('the store reads every page — a first-page-only read would miss the switch', () => {
  const pages = [
    OK({ tasks: [{ id: 'a', name: 'other' }], last_page: false }),
    OK({ tasks: [{ id: 'sw', name: pause.SWITCH_TASK_NAME }], last_page: true }),
  ];
  let i = 0;
  const call = async (m, p) => (p.includes('/comment') ? OK({ comments: [] }) : pages[i++]);
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.switchFound, true);
  });
});

// ---------------------------------------------------------------------------
// The wiring. Source-level, for the same reason clickupUrgentGuard.test.js is:
// clickup_direct.mjs needs a live Doppler token for anything past its own
// guard, so a subprocess test cannot run in CI.
// ---------------------------------------------------------------------------

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

/** Executable source only: comments explain the rules and must not satisfy them. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('bus-relay refuses to merge while the pipeline is paused', () => {
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  assert.match(code, /pipelinePauseStore\.readSwitch\(/, 'the relay must ASK, every pass, never remember');
  assert.match(code, /const mergingAllowed = mergeSwitchOn && !pauseState\.paused/,
    'merging must be gated on the pause state, not merely reported alongside it');
});

test('bus-relay asks about the pause BEFORE it merges anything', () => {
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  const asked = code.indexOf('pipelinePauseStore.readSwitch(');
  // The CALL, not the definition — `async function runMergeStep` sits far
  // above the bus-relay block, so anchoring on the bare name compares the
  // guard against the wrong thing and passes for free.
  const merged = code.indexOf('await runMergeStep({');
  assert.ok(asked > -1 && merged > -1, 'both the pause read and the merge call must exist');
  assert.ok(asked < merged, 'a check that runs after the merge protects nothing');
});

test('bus-relay is the announcer for a pause that has outlived two hours', () => {
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  assert.match(code, /pipelinePause\.nagDecision\(/);
  assert.match(code, /pipelinePause\.nagMessage\(/);
});

test('both loop skills check the pause before claiming, and neither may resume', () => {
  for (const skill of ['loop-build', 'loop-review']) {
    const text = read(`.claude/skills/${skill}/SKILL.md`);
    assert.match(text, /npm run pipeline -- check/, `${skill} must run the check`);
    assert.match(text, /exit 3/, `${skill} must say what a paused pipeline means`);
    assert.match(text, /Never resume it/, `${skill} must say the resume is the operator's`);
  }
});

test('CLAUDE.md carries the check, so a fresh session in any folder reads it on arrival', () => {
  // Acceptance criterion 8, and the whole point of criterion "visible to every
  // actor": the session that caused this ticket was hand-driven, not a loop,
  // and would only ever have seen it here.
  const text = read('CLAUDE.md');
  assert.match(text, /npm run pipeline -- check/);
  assert.match(text, /before merging anything/i);
  assert.match(text, /fails safe/i);
});

test('npm run pipeline exists and goes through Doppler like every other ClickUp command', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts.pipeline, 'the command the docs and skills name must exist');
  assert.match(pkg.scripts.pipeline, /doppler run/, 'the token is never handled by hand (DOCTRINE 4.1)');
  assert.match(pkg.scripts.pipeline, /scripts\/pipeline\.mjs/);
});

// ---------------------------------------------------------------------------
// The trail is READ WHOLE, or it is not read at all.
//
// The bug this section exists for (found in review, PR #434): the state is one
// comment on a task that ALSO collects an hourly reminder comment while it is
// paused. ClickUp hands back ~25 comments per page, newest first. So after
// about 25 reminders the PAUSE record scrolled off page one, an unpaged read
// found no state, and the switch reported the pipeline RUNNING — the two
// headline features cancelling each other out, failing OPEN, overnight, which
// is exactly when the reminder exists.
// ---------------------------------------------------------------------------

const PAGE = 25;

/** One pause followed by `nags` hourly reminders, oldest to newest. */
function pausedTrailWithNags(nags, t0 = 1_756_000_000_000) {
  const all = [comment(pause.pauseRecord({ by: 'Dane', at: new Date(t0).toISOString(), why: 'launch' }), t0)];
  for (let i = 1; i <= nags; i += 1) all.push(comment(pause.nagRecord({ by: 'Dane', at: 'x' }), t0 + i * HOUR));
  return all;
}
/** What ClickUp actually hands back to an unpaged read: newest 25 only. */
function firstPageOf(all) {
  return all.slice().sort((a, b) => Number(b.date) - Number(a.date)).slice(0, PAGE);
}

test('the WHOLE trail says paused, however many reminders sit on top of it', () => {
  const all = pausedTrailWithNags(30);
  const v = pause.pauseVerdict({ readable: true, switchFound: true, comments: all });
  assert.equal(v.paused, true);
  assert.equal(v.code, 3);
});

test('FAIL-SAFE: a truncated trail — reminders with no pause behind them — is NOT "running"', () => {
  // This is the exact repro from the send-back. Before the fix it returned
  // paused:false, code 0, on a pipeline that was genuinely paused.
  const truncated = firstPageOf(pausedTrailWithNags(30));
  assert.equal(truncated.length, PAGE, 'the fixture must be the page ClickUp really returns');
  assert.ok(truncated.every((c) => c.comment_text.startsWith(pause.NAG_MARKER)),
    'and it must contain no pause record at all — that IS the truncation');

  const v = pause.pauseVerdict({ readable: true, switchFound: true, comments: truncated });
  assert.equal(v.paused, true, 'a reminder only ever exists while paused');
  assert.equal(v.code, 3);
  assert.equal(v.certain, false, 'and it must not claim to be certain about it');
  assert.match(v.message, /INCOMPLETE/);
});

test('a switch with genuinely nothing on it is still "running" — the belt must not seize', () => {
  // The other direction: no records at all is a real answer, not a truncation.
  const v = pause.pauseVerdict({ readable: true, switchFound: true, comments: [comment('hello', 5)] });
  assert.equal(v.paused, false);
  assert.equal(v.code, 0);
});

test('a resume followed by reminders is running — the newest STATE still wins', () => {
  // Reminders are stale noise after a resume; they must not re-pause the line.
  const t0 = 1_756_000_000_000;
  const comments = [
    comment(pause.pauseRecord({ by: 'Dane', at: 'a' }), t0),
    comment(pause.nagRecord({ by: 'Dane', at: 'b' }), t0 + HOUR),
    comment(pause.resumeRecord({ by: 'Dane', at: 'c' }), t0 + 2 * HOUR),
  ];
  const v = pause.pauseVerdict({ readable: true, switchFound: true, comments });
  assert.equal(v.paused, false);
});

test('the store PAGES the switch trail, so a 30-reminder pause still reads as paused', () => {
  const all = pausedTrailWithNags(30).map((c, i) => ({ ...c, id: `c${i}` }));
  const newestFirst = all.slice().sort((a, b) => Number(b.date) - Number(a.date));
  const seen = [];
  const call = async (m, p) => {
    if (p.includes('/list/')) return OK({ tasks: [{ id: 'sw', name: pause.SWITCH_TASK_NAME }], last_page: true });
    seen.push(p);
    const m2 = /start_id=([^&]+)/.exec(p);
    const from = m2 ? newestFirst.findIndex((c) => c.id === decodeURIComponent(m2[1])) + 1 : 0;
    return OK({ comments: newestFirst.slice(from, from + PAGE) });
  };
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.ok(seen.length > 1, 'one unpaged GET is the bug — it must ask for the next page');
    assert.equal(sw.comments.length, all.length, 'and it must come back with the WHOLE trail');
    assert.equal(pause.pauseVerdict(sw).paused, true);
  });
});

test('a trail that never ends within the page budget is UNREADABLE, not running', () => {
  // Fail-safe again: "I stopped looking" must never be reported as "nothing there".
  const full = Array.from({ length: PAGE }, (_, i) => ({ ...comment('chatter', 1000 - i), id: `x${i}` }));
  const call = async (m, p) => (p.includes('/list/')
    ? OK({ tasks: [{ id: 'sw', name: pause.SWITCH_TASK_NAME }], last_page: true })
    : OK({ comments: full }));
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.readable, false);
    assert.equal(pause.pauseVerdict(sw).code, 3);
  });
});

// ---------------------------------------------------------------------------
// Paging the LIST: an absent flag means "fetch the next page", never "stop".
// ---------------------------------------------------------------------------

test('a list response with NO last_page field keeps paging instead of stopping', () => {
  // `last_page !== false` is true when the field is absent, so the old guard
  // read page 0 and reported the switch ABSENT — fail-open on the list read.
  const pages = [
    OK({ tasks: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, name: 'other' })) }), // no last_page
    OK({ tasks: [{ id: 'sw', name: pause.SWITCH_TASK_NAME }] }),
    OK({ tasks: [] }),
  ];
  let i = 0;
  const call = async (m, p) => (p.includes('/comment') ? OK({ comments: [] }) : pages[i++]);
  return store.readSwitch({ call, list: '1' }).then((sw) => {
    assert.equal(sw.switchFound, true, 'the switch was on page 2 and must be found');
  });
});

test('a list that never says it is done is UNREADABLE rather than silently short', () => {
  const call = async (m, p) => (p.includes('/comment')
    ? OK({ comments: [] })
    : OK({ tasks: [{ id: 'x', name: 'other' }] }));
  return store.fetchQueue({ call, list: '1', maxPages: 3 }).then((q) => {
    assert.equal(q.readable, false);
    assert.match(q.why, /incomplete/i);
  });
});

// ---------------------------------------------------------------------------
// A stale CLICKUP_PAUSE_TASK must not manufacture a second switch.
// ---------------------------------------------------------------------------

test('a configured switch id that no longer exists falls back to the NAME', () => {
  const call = async (m, p) => {
    if (p.includes('/task/gone')) return { res: { ok: false, status: 404 }, json: null };
    if (p.includes('/list/')) return OK({ tasks: [{ id: 'sw', name: pause.SWITCH_TASK_NAME }], last_page: true });
    return OK({ comments: [comment(pause.pauseRecord({ by: 'Dane', at: 'x' }), 10)] });
  };
  return store.readSwitch({ call, list: '1', pauseTaskId: 'gone' }).then((sw) => {
    assert.equal(sw.switchFound, true, 'a stale id is a stale SETTING, not a missing switch');
    assert.equal(pause.pauseVerdict(sw).paused, true, 'and a live pause must survive it');
  });
});

test('a stale id with no switch by name either is still a confirmed absence', () => {
  const call = async (m, p) => (p.includes('/task/gone')
    ? { res: { ok: false, status: 404 }, json: null }
    : OK({ tasks: [{ id: 'a', name: 'other' }], last_page: true }));
  return store.readSwitch({ call, list: '1', pauseTaskId: 'gone' }).then((sw) => {
    assert.equal(sw.readable, true);
    assert.equal(sw.switchFound, false);
  });
});

// ---------------------------------------------------------------------------
// "The decks are clear" is a promise, not a summary.
// ---------------------------------------------------------------------------

test('a drain with stranded tickets does NOT call the decks clear', () => {
  // A ticket becomes "stranded" merely by going 90 minutes untouched, and a CI
  // wait passes that routinely — so a live build can be sitting in that column
  // while the report told the operator the deck was his.
  const r = pause.drainReport({ ended: 'clear', working: [], stranded: [{ id: 'gone', name: 'Orphan', kind: 'a build' }] });
  assert.equal(r.code, 0, 'it still must not hold the pause open forever');
  assert.ok(!/decks are clear/.test(r.message), 'but it must not say the words either');
  assert.match(r.message, /NOT empty/);
  assert.match(r.message, /gone/);
});

// ---------------------------------------------------------------------------
// A stranded review keeps its finished build.
// ---------------------------------------------------------------------------

test('a stranded REVIEW is released where it stands, not sent back to Queued', () => {
  const note = pause.sweptTicketNote({ at: 'now', by: 'Dane', kind: 'a review' });
  assert.match(note, /In review/, 'its build is finished and its PR is open');
  assert.ok(!/Returned to Queued/.test(note), 'sending it back would throw that away');
});

test('the review claim note comes from loopNote, not a hand copy', () => {
  const loopNote = require('./loopNote.js');
  assert.equal(pause.REVIEW_CLAIM_NOTE, loopNote.REVIEW_CLAIM_NOTE);
  assert.ok(loopNote.loopNote('review-started', { at: '8/25 4:10pm' }).startsWith(pause.REVIEW_CLAIM_NOTE),
    'the drain identifies a live review by this exact text — two copies would drift');
});

// ---------------------------------------------------------------------------
// npm eats the flags. Every documented form must carry the `--`.
// ---------------------------------------------------------------------------

test('every documented `npm run pipeline` command carries the `--`', () => {
  // Confirmed on a real machine: `npm run pipeline resume --operator-asked`
  // exits 2 and is refused for missing the flag that was just typed, because
  // npm swallowed it. CLAUDE.md is the copy Dane reads, so the wrong form
  // there is the one he types first.
  const FILES = [
    'CLAUDE.md',
    'docs/LOOP_ENGINEERING.md',
    'docs/WORK-LOG.md',
    '.claude/skills/loop-build/SKILL.md',
    '.claude/skills/loop-review/SKILL.md',
    'scripts/pipeline.mjs',
    'scripts/builder/pipelinePause.js',
    'scripts/builder/pipelinePauseStore.js',
  ];
  const bad = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((ln, i) => {
      // "npm run pipeline" plus a SUBCOMMAND. Prose naming the script alone
      // ("the `npm run pipeline` command") has no subcommand and is fine.
      if (/npm run pipeline +(?!--)\S/.test(ln)) bad.push(`${f}:${i + 1}: ${ln.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `npm eats the flags without \`--\`:\n${bad.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Zero is an answer.
// ---------------------------------------------------------------------------

test('--wait-minutes 0 means zero, not the default', () => {
  // `Number(arg(...)) || 30` swallowed the falsy 0, so "pause but do not wait"
  // waited the full half hour — the opposite of what was typed.
  const argv = ['node', 'pipeline.mjs', 'pause', '--wait-minutes', '0'];
  assert.equal(pause.numericOption(argv, 'wait-minutes', 30), 0);
});

test('a missing or unparseable number still falls back', () => {
  assert.equal(pause.numericOption(['node', 'x', 'pause'], 'wait-minutes', 30), 30);
  assert.equal(pause.numericOption(['node', 'x', '--wait-minutes', 'soon'], 'wait-minutes', 30), 30);
  assert.equal(pause.numericOption(['node', 'x', '--wait-minutes', '--now'], 'wait-minutes', 30), 30,
    'the next FLAG is not this option\'s value');
  assert.equal(pause.numericOption(['node', 'x', '--wait-minutes', '5'], 'wait-minutes', 30), 5);
});

test('the resume sweep sends a stranded build back but leaves a stranded review', () => {
  // Source-level, like the bus-relay wiring tests above: the move itself needs
  // a live token. What must never come back is one unconditional move for
  // every stranded ticket regardless of what died on it.
  const code = withoutComments(read('scripts/pipeline.mjs'));
  assert.match(code, /const reviewing = s\.kind === 'a review'/,
    'the sweep must branch on what kind of pass died');
  const moved = code.indexOf('status: where.status');
  const branch = code.indexOf('if (reviewing)');
  assert.ok(branch > -1 && moved > -1 && branch < moved,
    'the review case must be handled BEFORE the move, or it is swept anyway');
  assert.match(code, /clearLoopNote\(task\)/, 'releasing a review means clearing its stale claim');
  // And the destination is never hard-coded: a half-built ticket goes to
  // Rework (task 86bbr1u9v), so a literal 'Queued' in the move is the bug.
  assert.doesNotMatch(code, /status: 'Queued'/,
    'the destination must come from strandedBuildDestination, not from a literal');
  assert.match(code, /strandedBuildDestination\(dest\.action\)/,
    'the sweep must ask where a stranded build belongs');
});

test('a stranded build goes to Rework only when something was actually built', () => {
  // The rule itself, not its wiring. Both destinations are claimable, so this
  // is about ORDER and about telling the truth — a half-built ticket dropped
  // back into Queued restarts the priority contest it has already been losing.
  assert.equal(pause.strandedBuildDestination('continue').status, 'Rework');
  assert.equal(pause.strandedBuildDestination('fresh').status, 'Queued');
  // A PR is named but unreadable: it still belongs with the half-built work.
  // buildStart refuses to guess because the cost there is a duplicate branch;
  // here the ticket is claimable either way and `build-start` asks again
  // before a line is written, so the only thing at stake is which queue it
  // waits in.
  assert.equal(pause.strandedBuildDestination('unknown').status, 'Rework');
  assert.equal(pause.strandedBuildDestination('who knows').status, 'Rework',
    'an unanticipated answer must not be resolved as fresh work');
  for (const action of ['continue', 'fresh', 'unknown']) {
    assert.ok(pause.strandedBuildDestination(action).why, `${action} must carry a reason`);
  }
});

test('the swept note names the destination it actually moved to', () => {
  // A note saying "Queued" above a move to "Rework" is a trail that
  // contradicts the board, and the trail is the only thing the next pass reads.
  const rework = pause.sweptTicketNote({ kind: 'a build', destination: 'Rework', why: 'its pull request is still open' });
  assert.match(rework, /Returned to Rework/);
  assert.match(rework, /its pull request is still open/);
  assert.doesNotMatch(rework, /Returned to Queued/);

  const queued = pause.sweptTicketNote({ kind: 'a build', destination: 'Queued', why: 'nothing has been built for it' });
  assert.match(queued, /Returned to Queued/);

  // A review is released where it stands and never names a destination.
  const review = pause.sweptTicketNote({ kind: 'a review' });
  assert.match(review, /stays in "In review"/);
  assert.doesNotMatch(review, /Returned to/);
});

// ---------------------------------------------------------------------------
// The report must match the sweep (task 86bbqw49y). The sweep itself was
// already right on 2026-08-31; the summary printed underneath it was not, and
// announced a ticket correctly left in "In review" as "returned to Queued".
// ---------------------------------------------------------------------------

test('a swept REVIEW is reported as released where it stands, never as Queued', () => {
  const line = pause.sweptSummary([{ id: '86bbq2y73', kind: 'a review', destination: 'In review' }]);
  assert.match(line, /86bbq2y73/);
  assert.match(line, /released in "In review"/);
  assert.doesNotMatch(line, /Queued/, 'a released review never went to Queued — saying so sends a reader to the wrong list');
  assert.doesNotMatch(line, /returned to/i);
});

test('a swept BUILD is still reported as returned to the status it went to', () => {
  const rework = pause.sweptSummary([{ id: 'a1', kind: 'a build', destination: 'Rework' }]);
  assert.match(rework, /a1 \(returned to Rework\)/);

  const queued = pause.sweptSummary([{ id: 'a1', kind: 'a build', destination: 'Queued' }]);
  assert.match(queued, /a1 \(returned to Queued\)/);
});

test('a MIXED sweep reports each kind accurately in one summary', () => {
  const line = pause.sweptSummary([
    { id: 'bld', kind: 'a build', destination: 'Queued' },
    { id: 'rev', kind: 'a review', destination: 'In review' },
  ]);
  assert.match(line, /2 stranded tickets unstuck/);
  assert.match(line, /bld \(returned to Queued\)/);
  assert.match(line, /rev \(released in "In review"\)/);
  // The failure this replaces: one destination asserted over the whole group.
  assert.doesNotMatch(line, /rev \(returned to Queued\)/);
});

test('an empty sweep says so rather than counting to zero', () => {
  assert.match(pause.sweptSummary([]), /No stranded tickets/);
  assert.doesNotMatch(pause.sweptSummary([]), /Queued/);
});

test('a bare id still prints as an id, not as [object Object]', () => {
  assert.match(pause.sweptSummary(['a1', 'b2']), /a1, b2/);
});

test('the stranded reason matches each kind, and a mixed list gets both', () => {
  const build = { id: 'bld', name: 'x', kind: 'a build' };
  const review = { id: 'rev', name: 'y', kind: 'a review' };

  const buildOnly = pause.strandedExplanation([build]).join('\n');
  assert.match(buildOnly, /bld/);
  assert.match(buildOnly, /only claim from Rework and Queued/);

  // The review's status is the one thing about it that is RIGHT. Telling a
  // reader the loops only claim from Queued sends them hunting for a status
  // problem that does not exist; the stale claim note is the actual fault.
  const reviewOnly = pause.strandedExplanation([review]).join('\n');
  assert.match(reviewOnly, /rev/);
  assert.match(reviewOnly, /stale claim note/);
  assert.doesNotMatch(reviewOnly, /only claim from Rework and Queued/);

  const both = pause.strandedExplanation([build, review]);
  assert.equal(both.length, 2, 'a mixed list needs both reasons, not one applied to both');
  assert.match(both.join('\n'), /only claim from Rework and Queued/);
  assert.match(both.join('\n'), /stale claim note/);
});

test('nothing stranded means nothing to explain', () => {
  assert.deepEqual(pause.strandedExplanation([]), []);
});
