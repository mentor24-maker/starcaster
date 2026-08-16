'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectRevisionsToDrop,
  REVISIONS_PER_PAGE,
} = require('../../lib/builderPageRevisionsStore');

/**
 * Tiered retention for page history.
 *
 * Why it exists: a flat "keep the newest 25" was the whole rule until
 * 2026-08-15, and by that evening the Delray home page sat at EXACTLY 25
 * revisions covering about ninety minutes. On a build day the morning's
 * version was already gone — and the morning version is what you want at 5pm
 * when you find something broke at 10am.
 *
 * THIS IS THE ONLY CODE IN THE SYSTEM THAT DELETES HISTORY, and history is the
 * safety net every other part of this feature leans on. A bug here destroys the
 * recovery path silently. So the properties tested are mostly about what must
 * SURVIVE:
 *
 *  - the newest 25 always survive, whatever else is true
 *  - one milestone per hour survives for 7 days
 *  - one milestone per day survives for 30
 *  - a row whose timestamp cannot be read is KEPT, never cut on a guess
 *  - the tiers are exact at their boundaries, tested with an injected `now`
 *    rather than by sleeping
 */

const NOW = Date.parse('2026-08-15T18:00:00.000Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** n revisions, `stepMs` apart, the newest `startAgoMs` before NOW. */
function series(startId, count, startAgoMs, stepMs) {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    created_at: new Date(NOW - startAgoMs - i * stepMs).toISOString(),
  }));
}

test('a page under the cap loses nothing', () => {
  const rows = series(1, 10, 0, 5 * 60 * 1000);
  assert.deepEqual(selectRevisionsToDrop(rows, NOW), []);
});

test('60 saves in one hour: the newest 25 survive, plus that hour\'s first', () => {
  // The exact 2026-08-15 shape — a burst of editing inside a single hour.
  const rows = series(1, 60, 0, 60 * 1000); // one a minute, newest first
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  const kept = rows.filter((r) => !dropped.has(r.id));

  for (const row of rows.slice(0, REVISIONS_PER_PAGE)) {
    assert.ok(!dropped.has(row.id), `newest ${REVISIONS_PER_PAGE} must survive: ${row.id}`);
  }
  // Spanning ~60 minutes from 18:00 back to 17:00 touches two clock hours, so
  // two first-of-hour milestones join the 25.
  assert.ok(kept.length >= REVISIONS_PER_PAGE + 1, `kept ${kept.length}`);
  assert.ok(kept.length <= REVISIONS_PER_PAGE + 2, `kept ${kept.length}, expected the 25 plus milestones`);
});

test('the OLDEST revision in an hour is the one kept, not the newest', () => {
  // A revision holds the state BEFORE a save, so the earliest one in an hour
  // is the page as it stood when that hour began. Keeping the last would bank
  // the state after the hour's work, which is not a restore point worth having.
  // NOW is 18:00Z, so these three sit at 17:30 / 17:20 / 17:10 — one clock
  // hour. (Anchoring at NOW - 3*DAY exactly would put the first in the 18:00
  // bucket and all three would legitimately survive.)
  const rows = [
    { id: 1, created_at: new Date(NOW - 3 * DAY - 30 * 60 * 1000).toISOString() },
    { id: 2, created_at: new Date(NOW - 3 * DAY - 40 * 60 * 1000).toISOString() },
    { id: 3, created_at: new Date(NOW - 3 * DAY - 50 * 60 * 1000).toISOString() },
  ];
  // Beyond the newest-25 tier only if there are more than 25 newer rows.
  const padded = [...series(100, 30, 0, 60 * 1000), ...rows];
  const dropped = new Set(selectRevisionsToDrop(padded, NOW));
  assert.ok(!dropped.has(3), 'the earliest in the hour survives');
  assert.ok(dropped.has(1) && dropped.has(2), 'the later ones in that hour go');
});

test('one milestone per day survives across three days of editing', () => {
  const rows = [
    ...series(100, 30, 0, 60 * 1000),            // today's burst, fills the 25
    ...series(200, 5, 1 * DAY, 10 * 60 * 1000),  // yesterday
    ...series(300, 5, 2 * DAY, 10 * 60 * 1000),  // the day before
  ];
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  const survivors = rows.filter((r) => !dropped.has(r.id));
  for (const day of [200, 300]) {
    assert.ok(
      survivors.some((r) => r.id >= day && r.id < day + 100),
      `at least one revision must survive from the ${day} day`
    );
  }
});

test('nothing older than 30 days survives', () => {
  // Padded past REVISIONS_PER_PAGE: with only a handful of rows the newest-25
  // tier keeps everything and the age tiers never get a say.
  const rows = [
    ...series(1, 30, 0, 60 * 1000),
    { id: 90, created_at: new Date(NOW - 31 * DAY).toISOString() },
    { id: 91, created_at: new Date(NOW - 200 * DAY).toISOString() },
  ];
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  assert.ok(dropped.has(90), '31 days old must go');
  assert.ok(dropped.has(91), '200 days old must go');
});

test('a revision just inside 30 days survives', () => {
  const rows = [
    ...series(1, 30, 0, 60 * 1000),
    { id: 90, created_at: new Date(NOW - 29 * DAY).toISOString() },
  ];
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  assert.ok(!dropped.has(90), 'inside the daily window must survive');
});

test('the hourly window reaches back a full 7 days', () => {
  // Two revisions in the same hour, six days back: only the first survives,
  // which proves hourly bucketing (not daily) is still in force at day 6.
  const rows = [
    ...series(1, 30, 0, 60 * 1000),
    { id: 80, created_at: new Date(NOW - 6 * DAY - 10 * 60 * 1000).toISOString() },
    { id: 81, created_at: new Date(NOW - 6 * DAY - 20 * 60 * 1000).toISOString() },
    { id: 82, created_at: new Date(NOW - 6 * DAY - 2 * HOUR).toISOString() },
  ];
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  assert.ok(!dropped.has(81), 'first of its hour survives');
  assert.ok(dropped.has(80), 'the later one in that same hour goes');
  assert.ok(!dropped.has(82), 'a different hour keeps its own milestone');
});

test('a row with an unreadable timestamp is KEPT, never cut on a guess', () => {
  const rows = [
    ...series(1, 30, 0, 60 * 1000),
    { id: 77, created_at: '' },
    { id: 78, created_at: 'not a date' },
    { id: 79 },
  ];
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  for (const id of [77, 78, 79]) {
    assert.ok(!dropped.has(id), `undated row ${id} must survive — this code must never cut blind`);
  }
});

test('garbage input returns nothing to delete rather than throwing', () => {
  assert.deepEqual(selectRevisionsToDrop(null, NOW), []);
  assert.deepEqual(selectRevisionsToDrop(undefined, NOW), []);
  assert.deepEqual(selectRevisionsToDrop([], NOW), []);
  assert.deepEqual(selectRevisionsToDrop([{}, { id: 0 }], NOW), []);
});

test('what survives a long, busy history stays bounded', () => {
  // Two months of heavy editing: 20 saves an hour, 10 hours a day, 60 days.
  const rows = [];
  let id = 1;
  for (let day = 0; day < 60; day += 1) {
    for (let hour = 0; hour < 10; hour += 1) {
      for (let n = 0; n < 20; n += 1) {
        rows.push({
          id: id += 1,
          created_at: new Date(NOW - day * DAY - hour * HOUR - n * 3 * 60 * 1000).toISOString(),
        });
      }
    }
  }
  const dropped = new Set(selectRevisionsToDrop(rows, NOW));
  const kept = rows.length - dropped.size;
  // Ceiling: 25 fine-grained + one per hour for 7 days + one per day for 30.
  assert.ok(kept <= REVISIONS_PER_PAGE + 24 * 7 + 30, `kept ${kept}, above the tier ceiling`);
  assert.ok(kept > REVISIONS_PER_PAGE, `kept ${kept}, milestones are not being retained at all`);
});
