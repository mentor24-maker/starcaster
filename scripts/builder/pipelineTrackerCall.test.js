'use strict';

/**
 * pipelineTrackerCall.js — the pause switch and the stranded sweep on the
 * tracker (SC-794, review round 1).
 *
 * No tracker and no network: the ticket door is a fake object that records
 * what it was asked. The last tests drive the REAL pause store and the REAL
 * sweep through the translator, because the translator is only right if the
 * modules it serves read its answers the way they read ClickUp's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { trackerCall } = require('./pipelineTrackerCall.js');
const pause = require('./pipelinePause.js');
const store = require('./pipelinePauseStore.js');
const { sweepStranded } = require('./pipelineSweep.js');
const door = require('../lib/trackerDoor.cjs');

const HOUR = 60 * 60 * 1000;

/**
 * A fake ticket door: `work` and `bus` are door-shaped tasks; `comments` by id.
 *
 * The two EXPENSIVE reads are traps (SC-851): every closed ticket
 * (`listTasks({ includeClosed: true })`) and every comment in a project
 * (`getTaskCommentRecords`). From the MacBook those cost 851 requests and the
 * pause check never answered, so no path here may reach either one.
 */
function fakeDoor({ work = [], bus = [], comments = {}, fail = {} } = {}) {
  const log = [];
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  return {
    PROJECT: 'starcaster',
    BUS_PROJECT: 'starcaster-bus',
    log,
    forgetComments: () => log.push(['forget']),
    async listTasks({ project, includeClosed }) {
      log.push(['list', project, Boolean(includeClosed)]);
      if (includeClosed) throw new Error('TRAP: the every-closed-ticket read was used');
      if (fail.list) throw new Error(fail.list);
      return (project === 'starcaster' ? work : bus).map(door.asClickUpTask);
    },
    async findTasksNamed({ project, name }) {
      log.push(['named', project, name]);
      if (fail.named) throw new Error(fail.named);
      return (project === 'starcaster' ? work : bus).filter((t) => sameName(t.name, name)).map(door.asClickUpTask);
    },
    async getTaskCommentRecords() {
      throw new Error('TRAP: the every-comment-in-the-project read was used');
    },
    async readTaskComments(id) {
      log.push(['comments', id]);
      if (fail.comments) throw new Error(fail.comments);
      if (![...work, ...bus].some((t) => t.id === id)) throw new Error(`reading the comments on ticket ${id} on the tracker failed: HTTP 404: no ticket ${id}.`);
      return (comments[id] || []).map(door.asCommentRecord).reverse();
    },
    async getTask(id) { log.push(['get', id]); return { ok: false, why: `ticket ${id}: the door's answer had no ticket in it` }; },
    commentOnTask(id, text) { log.push(['comment', id, text]); if (fail.comment) throw new Error(fail.comment); return 'ok'; },
    moveTaskStatus(id, status, opts) { log.push(['status', id, status, opts]); if (fail.status) throw new Error(fail.status); return 'ok'; },
    async createTask(o) { log.push(['task', o.project, o.name, o.status]); return { ok: true, json: { id: 'SCBUS-9', name: o.name } }; },
  };
}

const iso = (ms) => new Date(ms).toISOString();

test('the queue reading is this project\'s open work plus the switch ticket by NAME, never every closed ticket', async () => {
  const d = fakeDoor({
    work: [{ id: 'SC-1', name: 'a build', status: 'building', updated: iso(Date.now()) }],
    bus: [
      { id: 'SCBUS-3', name: 'Node roll call', status: 'live' },
      { id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' },
    ],
  });
  const call = trackerCall({ door: d });
  const page0 = await call('GET', '/api/v2/list/tracker/task?archived=false&include_closed=true&page=0');
  assert.equal(page0.ok, true);
  assert.deepEqual(page0.json.tasks.map((t) => t.id), ['SC-1', 'SCBUS-4'], 'the roll call is not work and not the switch, so it is not read');
  assert.equal(page0.json.last_page, true);
  assert.deepEqual(d.log.filter((l) => l[0] === 'list' || l[0] === 'named'),
    [['list', 'starcaster', false], ['named', 'starcaster-bus', pause.SWITCH_TASK_NAME]]);
  const page1 = await call('GET', '/api/v2/list/tracker/task?page=1');
  assert.deepEqual(page1.json.tasks, []);
});

test('comments are read from that one ticket alone, all on the first page', async () => {
  const d = fakeDoor({
    bus: [{ id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' }],
    comments: { 'SCBUS-4': [{ id: 1, text: 'one', at: iso(1000) }, { id: 2, text: 'two', at: iso(2000) }] },
  });
  const call = trackerCall({ door: d });
  const out = await call('GET', '/api/v2/task/SCBUS-4/comment');
  assert.deepEqual(out.json.comments.map((c) => c.comment_text), ['two', 'one'], 'newest first, as ClickUp answered');
  assert.deepEqual(d.log, [['comments', 'SCBUS-4']], 'one read, of that ticket, with no listing first');
  const next = await call('GET', '/api/v2/task/SCBUS-4/comment?start=2000&start_id=2');
  assert.deepEqual(next.json.comments, [], 'the page after the first is the end of the trail');
  const unknown = await call('GET', '/api/v2/task/SC-404/comment');
  assert.equal(unknown.ok, false, 'a ticket that does not exist is a refusal, never "no comments"');
  assert.match(store.whyOf(unknown), /no ticket SC-404/);
});

test('when the bus is the project itself (SC-818), an open switch ticket is listed once', async () => {
  const d = fakeDoor({
    work: [
      { id: 'SC-1', name: 'a build', status: 'building', updated: iso(Date.now()) },
      { id: 'SC-9', name: pause.SWITCH_TASK_NAME, status: 'queued' },
    ],
  });
  const call = trackerCall({ door: d, project: 'starcaster', busProject: 'starcaster' });
  const page0 = await call('GET', '/api/v2/list/tracker/task?page=0');
  assert.deepEqual(page0.json.tasks.map((t) => t.id), ['SC-1', 'SC-9'], 'no ticket twice, so the switch is never "two switch tickets"');
  assert.deepEqual(d.log.filter((l) => l[0] === 'named'), [['named', 'starcaster', pause.SWITCH_TASK_NAME]]);
});

test('a failed read is a failed read: ok false with the reason, never a throw, never "no comments"', async () => {
  const d = fakeDoor({ work: [{ id: 'SC-1', name: 'x', status: 'building' }], fail: { comments: 'reading the comments on the starcaster tickets on the tracker failed: exit 1' } });
  const out = await trackerCall({ door: d })('GET', '/api/v2/task/SC-1/comment');
  assert.equal(out.ok, false);
  assert.match(store.whyOf(out), /exit 1/);
  const listed = await trackerCall({ door: fakeDoor({ fail: { list: 'tracker down' } }) })('GET', '/api/v2/list/x/task?page=0');
  assert.equal(listed.ok, false);
  assert.match(store.whyOf(listed), /tracker down/);
});

test('a comment write goes through the door and forgets the cached comments, so the read-back sees it', async () => {
  const d = fakeDoor();
  const out = await trackerCall({ door: d })('POST', '/api/v2/task/SCBUS-4/comment', { comment_text: 'hello', notify_all: false });
  assert.equal(out.ok, true);
  assert.deepEqual(d.log, [['comment', 'SCBUS-4', 'hello'], ['forget']]);
});

test('a status move is guarded on Building, and reports the status it landed in', async () => {
  const d = fakeDoor();
  const out = await trackerCall({ door: d })('PUT', '/api/v2/task/SC-7', { status: 'Queued', assignees: { add: [], rem: [] } });
  assert.equal(out.ok, true);
  assert.equal(out.json.status.status, 'queued');
  assert.deepEqual(d.log, [['status', 'SC-7', 'Queued', { ifStatus: 'Building' }]]);
  const refused = await trackerCall({ door: fakeDoor({ fail: { status: 'guard: the ticket is not "Building"' } }) })('PUT', '/api/v2/task/SC-7', { status: 'Queued' });
  assert.equal(refused.ok, false);
});

test('the switch is created in the bus project, never in the work queue', async () => {
  const d = fakeDoor();
  const out = await trackerCall({ door: d })('POST', '/api/v2/list/tracker/task', { name: pause.SWITCH_TASK_NAME, status: 'Live', description: 'seed' });
  assert.equal(out.ok, true);
  assert.deepEqual(d.log, [['task', 'starcaster-bus', pause.SWITCH_TASK_NAME, 'Live']]);
});

test('any other ClickUp path is refused out loud, and nothing is sent', async () => {
  const d = fakeDoor();
  const out = await trackerCall({ door: d })('POST', '/api/v3/workspaces/1/chat/channels/2/messages', { content: 'x' });
  assert.equal(out.ok, false);
  assert.match(store.whyOf(out), /no tracker equivalent/);
  assert.deepEqual(d.log, []);
});

// --- the real modules, through the translator --------------------------------

/** Both ways the store reads the switch: `check`'s (the switch alone) and the queue's. */
const READS = [
  ['the check (switch alone)', (call) => store.readSwitch({ call, list: 'tracker', findSwitch: call.findSwitch })],
  ['status (with the queue)', (call) => store.readSwitch({ call, list: 'tracker', withQueue: true, findSwitch: call.findSwitch })],
  ['no findSwitch given', (call) => store.readSwitch({ call, list: 'tracker' })],
];

for (const [label, read] of READS) {
  test(`${label}: no switch ticket on the tracker is a CONFIRMED absence: running, and certain`, async () => {
    const call = trackerCall({ door: fakeDoor({ bus: [{ id: 'SCBUS-3', name: 'Node roll call', status: 'live' }] }) });
    const sw = await read(call);
    const v = pause.pauseVerdict({ ...sw, comments: sw.comments || [] });
    assert.equal(sw.readable, true);
    assert.equal(sw.switchFound, false);
    assert.equal(v.code, 0);
    assert.notEqual(v.certain, false);
  });

  test(`${label}: a pause recorded on the switch ticket reads as PAUSED`, async () => {
    const at = iso(Date.now() - HOUR);
    const call = trackerCall({ door: fakeDoor({
      bus: [
        // A near-miss name is not the switch (the ClickUp archive is SC-155 on the real tracker).
        { id: 'SCBUS-1', name: `${pause.SWITCH_TASK_NAME} (ClickUp archive)`, status: 'live' },
        { id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' },
      ],
      comments: { 'SCBUS-4': [{ id: 7, text: pause.pauseRecord({ by: 'Dane', node: 'mac-mini', at, why: 'fast track' }), at }] },
    }) });
    const sw = await read(call);
    const v = pause.pauseVerdict({ ...sw, comments: sw.comments || [] });
    assert.equal(sw.switchFound, true);
    assert.equal(sw.task.id, 'SCBUS-4');
    assert.equal(v.code, 3);
    assert.equal(v.paused, true);
  });

  test(`${label}: a switch that cannot be FOUND counts as PAUSED, never as running`, async () => {
    const call = trackerCall({ door: fakeDoor({ fail: { named: 'the tracker did not answer', list: 'the tracker did not answer' } }) });
    const sw = await read(call);
    const v = pause.pauseVerdict({ ...sw, comments: [] });
    assert.equal(sw.readable, false);
    assert.match(sw.why, /the tracker did not answer/);
    assert.equal(v.code, 3);
    assert.equal(v.certain, false);
  });

  test(`${label}: a switch whose trail cannot be read counts as PAUSED`, async () => {
    const call = trackerCall({ door: fakeDoor({
      bus: [{ id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' }],
      fail: { comments: 'reading the comments on ticket SCBUS-4 on the tracker failed: timed out' },
    }) });
    const sw = await read(call);
    assert.equal(sw.readable, false);
    assert.equal(pause.pauseVerdict({ ...sw, comments: [] }).code, 3);
  });
}

test('the check reads the switch and its trail and NOTHING else: no work queue, no closed tickets', async () => {
  const at = iso(Date.now() - HOUR);
  const d = fakeDoor({
    work: [{ id: 'SC-1', name: 'a build', status: 'building', updated: iso(Date.now()) }],
    bus: [{ id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' }],
    comments: { 'SCBUS-4': [{ id: 7, text: pause.pauseRecord({ by: 'Dane', node: 'mac-mini', at, why: 'x' }), at }] },
  });
  const call = trackerCall({ door: d });
  await store.readSwitch({ call, list: 'tracker', findSwitch: call.findSwitch });
  assert.deepEqual(d.log, [['named', 'starcaster-bus', pause.SWITCH_TASK_NAME], ['comments', 'SCBUS-4']],
    'two reads in all — what makes it answer from the MacBook');
});

test('findSwitch never throws: a failed lookup is { readable: false, why }', async () => {
  const call = trackerCall({ door: fakeDoor({ fail: { named: 'HTTP 0: fetch failed' } }) });
  const found = await call.findSwitch();
  assert.equal(found.readable, false);
  assert.match(found.why, /HTTP 0: fetch failed/);
});

test('the sweep moves a stranded tracker build back to Queued, guarded on Building', async () => {
  const d = fakeDoor({ work: [{ id: 'SC-716', name: 'stuck', status: 'building', updated: iso(Date.now() - 4 * 24 * HOUR) }] });
  const call = trackerCall({ door: d });
  const queue = await store.fetchQueue({ call, list: 'tracker' });
  assert.equal(queue.readable, true);
  const { swept } = await sweepStranded({
    by: 'a test', queue, apply: true,
    buildStartFor: async () => ({ action: 'fresh', why: 'nothing built' }),
    clearLoopNote: async () => true,
    tryCall: call,
    findLocalWork: () => ({ verdict: 'none', work: [], unseen: [], unlooked: [] }),
    log: () => {},
  });
  assert.deepEqual(swept.map((s) => [s.id, s.destination]), [['SC-716', 'Queued']]);
  assert.deepEqual(d.log.filter((l) => l[0] === 'status'), [['status', 'SC-716', 'Queued', { ifStatus: 'Building' }]]);
  assert.equal(d.log.filter((l) => l[0] === 'comment').length, 1, 'the hand-back note went on first');
});
