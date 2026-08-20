'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultWatches, handbackTarget } = require('./busRelayPlan.js');

const watches = defaultWatches({ agentResponseList: 'AR', loopQueueList: 'LQ' });
const agentResponse = watches.find((w) => w.list === 'AR');
const loopQueue = watches.find((w) => w.list === 'LQ');

test('both standing watches exist and carry their statuses', () => {
  assert.deepEqual(agentResponse.statuses, ['pending response', 'responding']);
  assert.deepEqual(loopQueue.statuses, ['needs your input', 'ready to launch']);
});

test('an answered "needs your input" ticket goes back to Queued', () => {
  assert.equal(handbackTarget(loopQueue, 'needs your input', 1), 'Queued');
});

test('status match is case-insensitive (ClickUp echoes lowercase, humans type anything)', () => {
  assert.equal(handbackTarget(loopQueue, 'Needs Your Input', 2), 'Queued');
});

test('"ready to launch" is notify-only: a comment never moves it', () => {
  assert.equal(handbackTarget(loopQueue, 'ready to launch', 1), null);
});

test('no fresh comment, no move — a parked ticket with old comments stays parked', () => {
  assert.equal(handbackTarget(loopQueue, 'needs your input', 0), null);
});

test('the Agent Response list never hands anything back', () => {
  assert.equal(handbackTarget(agentResponse, 'pending response', 3), null);
});

test('a watch with no handback table at all is safe', () => {
  assert.equal(handbackTarget({ statuses: [] }, 'needs your input', 1), null);
});

test('an unknown status is never moved even with fresh comments', () => {
  assert.equal(handbackTarget(loopQueue, 'building', 1), null);
});
