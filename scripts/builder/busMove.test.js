'use strict';

// SC-818: moving the bus into the starcaster project, which already holds
// ClickUp-era copies of every board under the same names.

const test = require('node:test');
const assert = require('node:assert/strict');
const { planBusMove, checkMoved, archiveName, commentsSince } = require('../../lib/busMove.js');
const trackerBus = require('../../lib/spirality.cjs').requireSpirality('lib/trackerBus.js');
const trackerForward = require('../../lib/trackerForward.js');

// The two projects as they stood on 2026-11-16.
const OLD = [
  { id: 'SC-404', name: 'Team chat', created: '2026-09-08T00:00:00Z' },
  { id: 'SC-249', name: 'Pipeline pulse', created: '2026-08-20T00:00:00Z' },
  { id: 'SC-182', name: 'Node roll call', created: '2026-08-19T00:00:00Z' },
  { id: 'SC-715', name: 'SQL waiting for you', created: '2026-10-28T00:00:00Z' },
  { id: 'SC-738', name: 'Broken links on client sites', created: '2026-11-01T00:00:00Z' },
  { id: 'SC-155', name: 'Pipeline pause switch', created: '2026-08-25T00:00:00Z' },
  { id: 'SC-818', name: 'Move StarCaster\'s bus into the StarCaster project', created: '2026-11-16T00:00:00Z' },
];
const BUS = [
  { id: 'SCBUS-1', name: 'Team chat', created: '2026-11-12T16:24:02Z' },
  { id: 'SCBUS-2', name: 'Pipeline pulse', created: '2026-11-13T01:31:45Z' },
  { id: 'SCBUS-3', name: 'Node roll call', created: '2026-11-13T02:19:59Z' },
  { id: 'SCBUS-4', name: 'SQL waiting for you', created: '2026-11-13T02:21:41Z' },
  { id: 'SCBUS-5', name: 'Broken links on client sites', created: '2026-11-13T07:44:47Z' },
  { id: 'SCBUS-6', name: 'Weekly report: 2026-11-09 to 2026-11-15 — write the narrative', created: '2026-11-16T14:00:54Z' },
];
const copy = (list) => list.map((t) => ({ ...t, tags: [...(t.tags || [])] }));
// SC-155's newest record: RUNNING, 2026-09-01.
const SWITCH_READ = Object.freeze({ 'SC-155': Date.parse('2026-09-01T00:00:00Z') });
const plan0 = (project, bus, lastWrittenAt = SWITCH_READ) => planBusMove({ projectTickets: project, busTickets: bus, lastWrittenAt });

/** Carry a plan out on in-memory projects the way the tracker would: a move keeps the creation date. */
function carryOut(plan, project, bus) {
  let n = 900;
  for (const r of plan.renames) project.find((t) => t.id === r.id).name = r.to;
  for (const m of plan.moves) {
    const i = bus.findIndex((t) => t.id === m.id);
    const [t] = bus.splice(i, 1);
    project.push({ ...t, id: `SC-${n += 1}`, from: m.id, tags: m.tag ? [...t.tags, 'noticeboard'] : t.tags });
  }
  return { project, bus };
}

test('the plan renames every old copy, the pause switch included, and moves every bus ticket', () => {
  const plan = plan0(copy(OLD), copy(BUS));
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.cutoff, Date.parse('2026-11-12T16:24:02Z'), 'the cutoff is the bus\'s oldest ticket, SCBUS-1');
  assert.deepEqual(plan.kept, []);
  assert.deepEqual(plan.renames.map((r) => [r.id, r.to]), [
    ['SC-404', 'Team chat (ClickUp archive)'],
    ['SC-249', 'Pipeline pulse (ClickUp archive)'],
    ['SC-182', 'Node roll call (ClickUp archive)'],
    ['SC-715', 'SQL waiting for you (ClickUp archive)'],
    ['SC-738', 'Broken links on client sites (ClickUp archive)'],
    ['SC-155', 'Pipeline pause switch (ClickUp archive)'],
  ]);
  assert.deepEqual(plan.moves.map((m) => [m.id, m.tag]), [
    ['SCBUS-1', true], ['SCBUS-2', true], ['SCBUS-3', true], ['SCBUS-4', true], ['SCBUS-5', true],
    ['SCBUS-6', false],
  ], 'the narrative ticket is work: moved, never tagged a noticeboard');
});

test('two "Team chat" tickets in one project: after the plan, every lookup finds the MOVED one, not the older archive', () => {
  // Without the renames, oldest-wins picks SC-404 (Sep 8) over the moved SCBUS-1 (Nov 12).
  const unplanned = [...copy(OLD), { ...BUS[0], id: 'SC-901' }];
  assert.equal(trackerForward.pickTeamChat(unplanned.map((t) => ({ ...t, createdAt: t.created }))).id, 'SC-404', 'the failure this guards against');

  const { project, bus } = carryOut(plan0(copy(OLD), copy(BUS)), copy(OLD), copy(BUS));
  const moved = (from) => project.find((t) => t.from === from).id;
  // lib/trackerForward.js (the relay's alarms): createdAt, oldest wins.
  assert.equal(trackerForward.pickTeamChat(project.map((t) => ({ ...t, createdAt: t.created }))).id, moved('SCBUS-1'));
  // Spirality's lib/trackerBus.js (bus-post, the review gate): date_created, oldest wins.
  assert.equal(trackerBus.pickTeamChat(project.map((t) => ({ ...t, date_created: String(Date.parse(t.created)) }))).id, moved('SCBUS-1'));
  // The roll call and the pulse take the first match in list order: only one is left to match.
  for (const [name, from] of [['Node roll call', 'SCBUS-3'], ['Pipeline pulse', 'SCBUS-2']]) {
    assert.deepEqual(project.filter((t) => t.name === name).map((t) => t.id), [moved(from)]);
  }
  // No ticket is the pause switch any more, as before the move.
  assert.equal(project.filter((t) => t.name === 'Pipeline pause switch').length, 0);
  assert.deepEqual(bus, []);
  const boards = BUS.slice(0, 5).map((t) => t.name);
  assert.deepEqual(checkMoved({ projectTickets: project, busTickets: bus, boards }), { ok: true, problems: [] });
});

test('a rerun after a partial run plans only what is left, and never renames a moved board', () => {
  const plan = plan0(copy(OLD), copy(BUS));
  const project = copy(OLD);
  const bus = copy(BUS);
  // Renames done, then the run stopped after moving Team chat.
  carryOut({ renames: plan.renames, moves: plan.moves.slice(0, 1) }, project, bus);
  const again = plan0(project, bus);
  assert.deepEqual(again.renames, [], 'the moved Team chat has no copy left on the bus, so it is not an old copy');
  assert.deepEqual(again.moves.map((m) => m.id), ['SCBUS-2', 'SCBUS-3', 'SCBUS-4', 'SCBUS-5', 'SCBUS-6']);
  carryOut(again, project, bus);
  assert.deepEqual(plan0(project, bus), { cutoff: null, renames: [], kept: [], moves: [], problems: [] }, 'an empty bus is an empty plan');
});

test('a board already tagged is not tagged twice; an unreadable project or a doubled board is a refusal', () => {
  const tagged = planBusMove({ projectTickets: [], busTickets: [{ id: 'SCBUS-1', name: 'Team chat', tags: [{ name: 'Noticeboard' }] }] });
  assert.equal(tagged.moves[0].tag, false);
  assert.match(planBusMove({ projectTickets: null, busTickets: [] }).problems[0], /could not be read/);
  const doubled = planBusMove({ projectTickets: [], busTickets: [{ id: 'SCBUS-1', name: 'Team chat' }, { id: 'SCBUS-7', name: 'team chat ' }] });
  assert.match(doubled.problems[0], /two "team chat " tickets \(SCBUS-1 and SCBUS-7\)/);
});

test('the check refuses two of a board, an untagged board, or a bus not empty', () => {
  const two = checkMoved({ projectTickets: [{ id: 'SC-404', name: 'Team chat', tags: ['noticeboard'] }, { id: 'SC-901', name: 'Team chat', tags: ['noticeboard'] }], busTickets: [], boards: ['Team chat'] });
  assert.equal(two.ok, false);
  assert.match(two.problems[0], /holds 2 "Team chat" ticket\(s\) \(SC-404, SC-901\)/);
  const untagged = checkMoved({ projectTickets: [{ id: 'SC-901', name: 'Team chat', tags: [] }], busTickets: [{ id: 'SCBUS-6' }], boards: ['Team chat'] });
  assert.deepEqual(untagged.problems, ['SC-901 "Team chat" is not tagged noticeboard', 'the bus project still holds 1 ticket(s): SCBUS-6']);
  assert.equal(checkMoved({ projectTickets: null, busTickets: [], boards: [] }).ok, false);
  assert.equal(archiveName(' Team chat '), 'Team chat (ClickUp archive)');
});

// Round 3 of review: only the ClickUp-era copies are archived, never a switch in use.
const FRESH_SWITCH = { id: 'SC-950', name: 'Pipeline pause switch', created: '2026-11-17T07:00:00Z' };

test('a fresh "Pipeline pause switch" beside SC-155: only SC-155 is renamed, the fresh one is left alone', () => {
  const plan = plan0([...copy(OLD), FRESH_SWITCH], copy(BUS), { ...SWITCH_READ, 'SC-950': Date.parse('2026-11-17T07:00:05Z') });
  assert.deepEqual(plan.problems, []);
  const switches = plan.renames.filter((r) => r.from === 'Pipeline pause switch').map((r) => r.id);
  assert.deepEqual(switches, ['SC-155']);
  assert.deepEqual(plan.kept.map((k) => k.id), ['SC-950']);
  assert.match(plan.kept[0].why, /created 2026-11-17T07:00:00\.000Z, after 2026-11-12T16:24:02\.000Z/);
});

test('an old switch somebody wrote to after the cutoff is in use: left alone, never archived', () => {
  const plan = plan0(copy(OLD), copy(BUS), { 'SC-155': Date.parse('2026-11-17T07:00:00Z') });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.renames.some((r) => r.id === 'SC-155'), false, 'a pause posted in the gap must not be lifted by renaming its ticket');
  assert.deepEqual(plan.kept.map((k) => k.id), ['SC-155']);
  assert.match(plan.kept[0].why, /last written 2026-11-17/);
});

test('an old switch whose comments were not read is a refusal, not a guess', () => {
  const plan = plan0(copy(OLD), copy(BUS), {});
  assert.match(plan.problems.join('\n'), /SC-155 "Pipeline pause switch" was not read for its newest record/);
  const never = plan0(copy(OLD), copy(BUS), { 'SC-155': null });
  assert.deepEqual(never.problems, [], 'a switch with no comments at all was never used: archived');
  assert.equal(never.renames.some((r) => r.id === 'SC-155'), true);
});

test('a board copy created after the cutoff is a refusal, and so is a missing date', () => {
  const fresh = plan0([...copy(OLD), { id: 'SC-951', name: 'Node roll call', created: '2026-11-17T08:00:00Z' }], copy(BUS));
  assert.match(fresh.problems.join('\n'), /SC-951 "Node roll call" was created 2026-11-17T08:00:00\.000Z, after the bus's own boards/);
  const undated = plan0(copy(OLD), [{ id: 'SCBUS-1', name: 'Team chat' }]);
  assert.match(undated.problems.join('\n'), /SCBUS-1 on the bus has no readable creation date/);
  // The tracker's own shape: date_created as a ms string.
  const ms = plan0([{ id: 'SC-404', name: 'Team chat', created: String(Date.parse('2026-09-08T00:00:00Z')) }], [{ id: 'SCBUS-1', name: 'Team chat', created: String(Date.parse(BUS[0].created)) }]);
  assert.deepEqual(ms.renames.map((r) => r.id), ['SC-404']);
});

test('comments posted on the old copies after the merge are named', () => {
  const since = Date.parse('2026-11-17T06:30:00Z');
  const got = commentsSince([
    { id: 'SC-404', name: 'Team chat', comments: [
      { createdAt: '2026-11-17T06:00:00Z', body: 'before the merge' },
      { createdAt: '2026-11-17T06:40:00Z', body: '[relay] alarm: heartbeat missed\nsecond line' },
    ] },
    { id: 'SC-182', name: 'Node roll call', comments: [] },
  ], since);
  assert.deepEqual(got, [{ id: 'SC-404', name: 'Team chat', at: '2026-11-17T06:40:00.000Z', firstLine: '[relay] alarm: heartbeat missed' }]);
});

test('the check re-checks a board an earlier run moved, not only this run\'s', () => {
  const project = [
    { id: 'SC-901', name: 'Team chat', tags: [] },
    { id: 'SC-902', name: 'Pipeline pulse', tags: ['noticeboard'] },
    { id: 'SC-404', name: 'Team chat (ClickUp archive)', tags: [] },
  ];
  const verdict = checkMoved({ projectTickets: project, busTickets: [], boards: ['Pipeline pulse'] });
  assert.deepEqual(verdict.problems, ['SC-901 "Team chat" is not tagged noticeboard']);
});
