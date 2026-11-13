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

/** A fake ticket door: `work` and `bus` are door-shaped tasks; `comments` by id. */
function fakeDoor({ work = [], bus = [], comments = {}, fail = {} } = {}) {
  const log = [];
  const notIn = (id, project) => new Error(`ticket ${id} is not in the ${project} project on the tracker`);
  return {
    PROJECT: 'starcaster',
    BUS_PROJECT: 'starcaster-bus',
    log,
    forgetComments: () => log.push(['forget']),
    async listTasks({ project, includeClosed }) {
      log.push(['list', project, Boolean(includeClosed)]);
      if (fail.list) throw new Error(fail.list);
      return (project === 'starcaster' ? work : bus).map(door.asClickUpTask);
    },
    async getTaskCommentRecords(id, { project }) {
      log.push(['comments', id, project]);
      if (fail.comments) throw new Error(fail.comments);
      const inProject = (project === 'starcaster' ? work : bus).some((t) => t.id === id);
      if (!inProject) throw notIn(id, project);
      return (comments[id] || []).map(door.asCommentRecord).reverse();
    },
    async getTask(id) { log.push(['get', id]); return { ok: false, why: `ticket ${id}: the door's answer had no ticket in it` }; },
    commentOnTask(id, text) { log.push(['comment', id, text]); if (fail.comment) throw new Error(fail.comment); return 'ok'; },
    moveTaskStatus(id, status, opts) { log.push(['status', id, status, opts]); if (fail.status) throw new Error(fail.status); return 'ok'; },
    async createTask(o) { log.push(['task', o.project, o.name, o.status]); return { ok: true, json: { id: 'SCBUS-9', name: o.name } }; },
  };
}

const iso = (ms) => new Date(ms).toISOString();

test('the queue reading is this project\'s open work plus every bus ticket, all on page 0', async () => {
  const d = fakeDoor({
    work: [{ id: 'SC-1', name: 'a build', status: 'building', updated: iso(Date.now()) }],
    bus: [{ id: 'SCBUS-3', name: 'Node roll call', status: 'live' }],
  });
  const call = trackerCall({ door: d });
  const page0 = await call('GET', '/api/v2/list/tracker/task?archived=false&include_closed=true&page=0');
  assert.equal(page0.ok, true);
  assert.deepEqual(page0.json.tasks.map((t) => t.id), ['SC-1', 'SCBUS-3']);
  assert.equal(page0.json.last_page, true);
  assert.deepEqual(d.log.filter((l) => l[0] === 'list'), [['list', 'starcaster', false], ['list', 'starcaster-bus', true]]);
  const page1 = await call('GET', '/api/v2/list/tracker/task?page=1');
  assert.deepEqual(page1.json.tasks, []);
});

test('comments come from the project the ticket was seen in, all on the first page', async () => {
  const d = fakeDoor({
    bus: [{ id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' }],
    comments: { 'SCBUS-4': [{ id: 1, text: 'one', at: iso(1000) }, { id: 2, text: 'two', at: iso(2000) }] },
  });
  const call = trackerCall({ door: d });
  await call('GET', '/api/v2/list/x/task?page=0');
  const out = await call('GET', '/api/v2/task/SCBUS-4/comment');
  assert.deepEqual(out.json.comments.map((c) => c.comment_text), ['two', 'one'], 'newest first, as ClickUp answered');
  assert.deepEqual(d.log.filter((l) => l[0] === 'comments'), [['comments', 'SCBUS-4', 'starcaster-bus']], 'read from the bus project straight away');
  const next = await call('GET', '/api/v2/task/SCBUS-4/comment?start=2000&start_id=2');
  assert.deepEqual(next.json.comments, [], 'the page after the first is the end of the trail');
});

test('an id never listed is tried in this project, then the bus project', async () => {
  const d = fakeDoor({ bus: [{ id: 'SCBUS-4', name: 'x', status: 'live' }], comments: { 'SCBUS-4': [{ id: 1, text: 'hi', at: iso(1) }] } });
  const out = await trackerCall({ door: d })('GET', '/api/v2/task/SCBUS-4/comment');
  assert.equal(out.ok, true);
  assert.deepEqual(d.log.map((l) => l.slice(0, 3)), [['comments', 'SCBUS-4', 'starcaster'], ['comments', 'SCBUS-4', 'starcaster-bus']]);
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

test('no switch ticket on the tracker is a CONFIRMED absence: running, and certain', async () => {
  const call = trackerCall({ door: fakeDoor({ bus: [{ id: 'SCBUS-3', name: 'Node roll call', status: 'live' }] }) });
  const sw = await store.readSwitch({ call, list: 'tracker' });
  const v = pause.pauseVerdict({ ...sw, comments: sw.comments || [] });
  assert.equal(sw.readable, true);
  assert.equal(sw.switchFound, false);
  assert.equal(v.code, 0);
  assert.notEqual(v.certain, false);
});

test('a pause recorded on the bus project\'s switch ticket reads as PAUSED', async () => {
  const at = iso(Date.now() - HOUR);
  const call = trackerCall({ door: fakeDoor({
    bus: [{ id: 'SCBUS-4', name: pause.SWITCH_TASK_NAME, status: 'live' }],
    comments: { 'SCBUS-4': [{ id: 7, text: pause.pauseRecord({ by: 'Dane', node: 'mac-mini', at, why: 'fast track' }), at }] },
  }) });
  const sw = await store.readSwitch({ call, list: 'tracker' });
  const v = pause.pauseVerdict({ ...sw, comments: sw.comments || [] });
  assert.equal(sw.switchFound, true);
  assert.equal(v.code, 3);
  assert.equal(v.paused, true);
});

test('a tracker that cannot be read counts as PAUSED, never as running', async () => {
  const call = trackerCall({ door: fakeDoor({ fail: { list: 'the tracker did not answer' } }) });
  const sw = await store.readSwitch({ call, list: 'tracker' });
  const v = pause.pauseVerdict({ ...sw, comments: [] });
  assert.equal(sw.readable, false);
  assert.equal(v.code, 3);
  assert.equal(v.certain, false);
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
