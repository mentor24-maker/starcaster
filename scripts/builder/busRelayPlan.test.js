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

test('only the Loop Queue watch may merge — Agent Response never can', () => {
  const { mergeEnabled } = require('./busRelayPlan.js');
  assert.equal(mergeEnabled(loopQueue), true);
  assert.equal(mergeEnabled(agentResponse), false);
});

test('an ad-hoc --list watch (no merge flag) can never merge anything', () => {
  const { mergeEnabled } = require('./busRelayPlan.js');
  assert.equal(mergeEnabled({ list: 'X', statuses: ['ready to launch'], handback: {} }), false);
  assert.equal(mergeEnabled(undefined), false);
});

// ---------------------------------------------------------------------------
// Delivery: what satisfies the handback gate (task 86bbjxew2, 2026-08-23).
// ---------------------------------------------------------------------------

const {
  BUS_RELAY_MARKER,
  deliveryVerdict,
  relayMarkerText,
  receiptText,
  busFailureBucket,
} = require('./busRelayPlan.js');

const AT = '2026-08-23T22:04:00.000Z';

test('delivered via chat: the party line worked, nothing else was needed', () => {
  const v = deliveryVerdict({ chatOk: true, receiptOk: false });
  assert.deepEqual(v, { ok: true, via: 'chat' });
  assert.equal(
    relayMarkerText({ ...v, channel: '2kydhxeu-474', at: AT }),
    '[bus-relay] sent to channel 2kydhxeu-474 at 2026-08-23T22:04:00.000Z',
  );
});

test('chat winning is not conditional on the receipt — it is preferred, not a tie', () => {
  assert.deepEqual(deliveryVerdict({ chatOk: true, receiptOk: true }), { ok: true, via: 'chat' });
});

test('delivered via the fallback: chat failed, the ticket receipt landed', () => {
  const v = deliveryVerdict({ chatOk: false, receiptOk: true });
  assert.deepEqual(v, { ok: true, via: 'ticket' });
  assert.equal(
    relayMarkerText({ ...v, channel: '2kydhxeu-474', at: AT }),
    '[bus-relay] chat unavailable, receipted on the ticket at 2026-08-23T22:04:00.000Z',
  );
});

test('delivered by neither: not delivered, no marker, and so no handback', () => {
  const v = deliveryVerdict({ chatOk: false, receiptOk: false });
  assert.deepEqual(v, { ok: false, via: 'none' });
  // Nothing to mark — a comment nobody received is retried next pass.
  assert.equal(relayMarkerText({ ...v, channel: 'X', at: AT }), null);
  // And the gate holds: fresh counts only delivered comments, so this task
  // stays exactly where it is. This is the non-goal made executable.
  assert.equal(handbackTarget(loopQueue, 'needs your input', 0), null);
});

test('every marker starts with the shared prefix, so "already relayed" still matches', () => {
  for (const via of ['chat', 'ticket']) {
    const text = relayMarkerText({ via, channel: 'C', at: AT });
    assert.ok(text.startsWith(BUS_RELAY_MARKER), `${via} marker must start with the prefix`);
  }
});

test('the receipt is a receipt, not a re-quote of his words', () => {
  const text = receiptText({ why: 'HTTP 400', target: 'Queued' });
  assert.match(text, /Your answer was read/);
  assert.match(text, /going back to Queued/);
  assert.match(text, /HTTP 400/);
  assert.match(text, /party line is unavailable/i);
});

test('a notify-only watch gets a receipt that promises no move it will not make', () => {
  const text = receiptText({ why: 'HTTP 400' });
  assert.match(text, /read and picked up/);
  assert.doesNotMatch(text, /going back to/);
});

test('a bus failure that still reached the ticket is skipped, not unchecked', () => {
  assert.equal(busFailureBucket({ delivered: true, cosmetic: false }), 'skipped');
});

test('a bus failure whose explanation is already on the ticket is cosmetic', () => {
  // The merge step's own three posts: each writes its real explanation as a
  // task comment first, so the bus post carries nothing that was lost.
  assert.equal(busFailureBucket({ delivered: false, cosmetic: true }), 'skipped');
});

test('a bus failure nobody was told about is still "could not fully verify"', () => {
  assert.equal(busFailureBucket({ delivered: false, cosmetic: false }), 'unchecked');
  assert.equal(busFailureBucket({}), 'unchecked');
});
