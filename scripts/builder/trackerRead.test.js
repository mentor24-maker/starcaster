'use strict';

/**
 * scripts/tracker_read.mjs — the narrow read-only reader (SC-851).
 *
 * The network half is the door's own tracker client; what is tested here is
 * the part that is this file's: which name counts as the same name, and that
 * what it prints is the shape scripts/lib/trackerDoor.cjs parses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const door = require('../lib/trackerDoor.cjs');
const { SWITCH_TASK_NAME } = require('./pipelinePause.js');

const load = () => import('../tracker_read.mjs');

test('a name matches the way the pause store matches the switch, and a near miss does not', async () => {
  const { sameName } = await load();
  assert.equal(sameName(`  ${SWITCH_TASK_NAME.toUpperCase()} `, SWITCH_TASK_NAME), true);
  assert.equal(sameName(`${SWITCH_TASK_NAME} (ClickUp archive)`, SWITCH_TASK_NAME), false,
    'the archived ClickUp switch (SC-155) is not the switch');
});

test('a named row reads back through trackerDoor as the same task', async () => {
  const { namedRow } = await load();
  const row = namedRow({ id: 'SC-9', name: 'x', status: { status: 'live' }, date_created: '1700000000000', date_updated: '1700000500000' });
  assert.deepEqual(row, { id: 'SC-9', name: 'x', status: 'live', created: new Date(1700000000000).toISOString(), updated: new Date(1700000500000).toISOString() });
  const task = door.asClickUpTask(row);
  assert.equal(task.status.status, 'live');
  assert.equal(task.date_updated, '1700000500000');
});

test('a comment row reads back through trackerDoor as the same comment record', async () => {
  const { commentRow } = await load();
  const row = commentRow({ id: 5931, comment_text: '[pipeline] RUNNING', user: { id: 1, username: 'Dane' }, date: '1788310577634' });
  const rec = door.asCommentRecord(row);
  assert.deepEqual(rec, { id: '5931', comment_text: '[pipeline] RUNNING', user: { id: 1, username: 'Dane' }, date: '1788310577634' });
});
