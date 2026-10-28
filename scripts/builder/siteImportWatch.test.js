'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const watch = require('../../lib/siteImportWatch.js');

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const job = (over = {}) => ({
  id: 'simp_1',
  sourceUrl: 'https://alphire.agency/',
  projectId: 'p1',
  status: 'queued',
  claimedAt: null,
  createdAt: ago(14 * 24 * HOUR),
  ...over,
});

test('a job queued 14 days with no claim raises the alarm (the alphire incident)', () => {
  const judged = watch.judge({ jobs: [job()], now: NOW });
  assert.equal(judged.verdict, watch.VERDICT.WAITING);
  assert.equal(judged.stale.length, 1);
  const decided = watch.plan({ judged, state: {}, now: NOW });
  assert.deepEqual(decided.alarm.map((j) => j.id), ['simp_1']);
  const text = watch.renderAlarm({ jobs: decided.alarm, node: 'mac-mini', at: 'now' });
  assert.match(text, /alphire\.agency/);
  assert.match(text, /waiting 14 days/);
});

test('a job queued under an hour is not an alarm yet', () => {
  const judged = watch.judge({ jobs: [job({ createdAt: ago(59 * 60 * 1000) })], now: NOW });
  assert.equal(judged.verdict, watch.VERDICT.OK);
});

test('a claimed or running job is not waiting, however old', () => {
  const judged = watch.judge({
    jobs: [job({ claimedAt: ago(HOUR) }), job({ id: 'simp_2', status: 'capturing' }), job({ id: 'simp_3', status: 'failed' })],
    now: NOW,
  });
  assert.equal(judged.verdict, watch.VERDICT.OK);
});

test('a queued job with no readable date is counted, never dropped', () => {
  const judged = watch.judge({ jobs: [job({ createdAt: null })], now: NOW });
  assert.equal(judged.verdict, watch.VERDICT.WAITING);
  assert.match(watch.renderAlarm({ jobs: judged.stale, node: 'n', at: 'a' }), /unreadable time/);
});

test('no reading is CANNOT TELL, never OK', () => {
  const judged = watch.judge({ jobs: null, error: 'docker is not running', now: NOW });
  assert.equal(judged.verdict, watch.VERDICT.CANNOT_TELL);
  assert.equal(watch.EXIT[judged.verdict], 2);
  assert.match(judged.reason, /docker is not running/);
});

test('each job is named once, and cleared once when it leaves the queue', () => {
  const judged = watch.judge({ jobs: [job()], now: NOW });
  const first = watch.plan({ judged, state: {}, now: NOW });
  assert.equal(first.alarm.length, 1);

  const second = watch.plan({ judged, state: first.next, now: NOW + HOUR });
  assert.equal(second.alarm.length, 0, 'the same waiting job is not named twice');
  assert.equal(second.cleared.length, 0);

  const pickedUp = watch.judge({ jobs: [job({ claimedAt: ago(0) })], now: NOW + 2 * HOUR });
  const third = watch.plan({ judged: pickedUp, state: second.next, now: NOW + 2 * HOUR });
  assert.deepEqual(third.cleared, ['simp_1']);
  assert.deepEqual(third.next.alarmed, {});
});

test('a CANNOT TELL keeps what was already named and repeats at most every 6h', () => {
  const named = watch.plan({ judged: watch.judge({ jobs: [job()], now: NOW }), state: {}, now: NOW });
  const blind = watch.judge({ jobs: null, error: 'x', now: NOW });

  const first = watch.plan({ judged: blind, state: named.next, now: NOW });
  assert.equal(first.cannotTell, true);
  assert.deepEqual(first.cleared, [], 'not being able to look is not the job being picked up');
  assert.ok(first.next.alarmed.simp_1);

  const soon = watch.plan({ judged: blind, state: first.next, now: NOW + HOUR });
  assert.equal(soon.cannotTell, false);
  const later = watch.plan({ judged: blind, state: first.next, now: NOW + 7 * HOUR });
  assert.equal(later.cannotTell, true);
});

test('waitText reads as plain words', () => {
  assert.equal(watch.waitText(25 * 60 * 1000), '25 minutes');
  assert.equal(watch.waitText(3 * HOUR), '3 hours');
  assert.equal(watch.waitText(14 * 24 * HOUR), '14 days');
});
