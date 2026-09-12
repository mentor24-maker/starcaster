'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The repeat rule's two doors. A request body is refused with a sentence the
 * admin can act on; a row read back is never refused, only trimmed. The
 * failure guarded against is the quiet one: a rule that could not be saved
 * as written being dropped, so the event saves as a one-off and says "Saved".
 */

const {
  RecurrenceError, parseRecurrence, parseOverrides, readRecurrence, readOverrides,
} = require('../../lib/eventRecurrence');
const { readEventPatch, repeatProblem } = require('../../routes/events');

test('a weekly rule is normalised: days de-duplicated and sorted, interval defaulted', () => {
  assert.deepEqual(
    parseRecurrence({ freq: 'Weekly', weekdays: [3, 1, 3] }),
    { freq: 'weekly', interval: 1, weekdays: [1, 3], until: null },
  );
  assert.equal(parseRecurrence(null), null);
  assert.equal(parseRecurrence(''), null);
});

test('a rule that cannot be saved as written is refused, not dropped', () => {
  const bad = [
    { freq: 'monthly', weekdays: [1] },
    { freq: 'weekly', weekdays: [] },
    { freq: 'weekly', weekdays: [7] },
    { freq: 'weekly', weekdays: [1], interval: 0 },
    { freq: 'weekly', weekdays: [1], until: '2026-02-30' },
    '{not json',
    [1, 2],
  ];
  for (const rule of bad) {
    assert.throws(() => parseRecurrence(rule), RecurrenceError, JSON.stringify(rule));
  }
  assert.throws(() => readEventPatch({ recurrence: { freq: 'weekly', weekdays: [] } }), /at least one day/);
});

test('single-date changes: last one per date wins, empty ones vanish, bad times refuse', () => {
  assert.deepEqual(parseOverrides([
    { date: '2026-09-14', cancelled: true },
    { date: '2026-09-16', startTime: '09:00' },
    { date: '2026-09-14' },
  ]), [{ date: '2026-09-16', startTime: '09:00' }]);
  assert.throws(() => parseOverrides([{ date: '2026-09-14', startTime: '9am' }]), /HH:MM/);
  assert.throws(() => parseOverrides([{ date: '2026-09-14', startTime: '10:00', endTime: '09:00' }]), /not after/);
  assert.throws(() => parseOverrides([{ date: 'Monday', cancelled: true }]), /not a date/);
});

test('a row read back never throws — it keeps what it can read', () => {
  assert.equal(readRecurrence({ freq: 'monthly' }), null);
  assert.deepEqual(readOverrides([{ date: 'nope' }, { date: '2026-09-14', cancelled: true }]), [{ date: '2026-09-14', cancelled: true }]);
  assert.deepEqual(readOverrides('garbage'), []);
});

test('a repeating event needs a start date and a real time zone', () => {
  const rule = { freq: 'weekly', interval: 1, weekdays: [1], until: null };
  assert.equal(repeatProblem({ recurrence: null }), '');
  assert.match(repeatProblem({ recurrence: rule, timezone: 'America/New_York' }), /start date/);
  assert.match(repeatProblem({ recurrence: rule, startsAt: '2026-09-14T12:30:00Z', timezone: 'Florida' }), /time zone/);
  assert.equal(repeatProblem({ recurrence: rule, startsAt: '2026-09-14T12:30:00Z', timezone: 'America/New_York' }), '');
  // 9pm on Sep 14 in Florida is Sep 15 in UTC; a repeat ending Sep 14 is fine.
  assert.equal(repeatProblem({ recurrence: { ...rule, until: '2026-09-14' }, startsAt: '2026-09-15T01:00:00Z', timezone: 'America/New_York' }), '');
  assert.match(repeatProblem({ recurrence: { ...rule, until: '2026-09-13' }, startsAt: '2026-09-15T01:00:00Z', timezone: 'America/New_York' }), /ends/);
});
