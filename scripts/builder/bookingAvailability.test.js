'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Booking calendar, slice 1 of 6 (SC-909): which times can a visitor book?
 *
 * The calendar is in America/Denver, so every expected time is written twice:
 * the wall time the operator set, and the UTC instant the function returns.
 * Denver is UTC-7 in winter (MST) and UTC-6 in summer (MDT).
 */

const { freeSlots, isSlotFree } = require('../../lib/bookingAvailability.js');
const { wallTimeToUtcMillis } = require('../../lib/wallTimeUtc.js');

const WEEKDAY_MORNINGS = [{ start: '09:00', end: '12:00' }];

function calendar(overrides = {}) {
  return {
    timeZone: 'America/Denver',
    weeklyHours: {
      sun: [], mon: WEEKDAY_MORNINGS, tue: WEEKDAY_MORNINGS, wed: WEEKDAY_MORNINGS,
      thu: WEEKDAY_MORNINGS, fri: WEEKDAY_MORNINGS, sat: [],
    },
    blockedDates: [],
    meetingMinutes: 60,
    gapMinutes: 0,
    minNoticeMinutes: 0,
    daysAhead: 365,
    ...overrides,
  };
}

// Monday 2026-11-23, midnight to midnight in Denver (MST, UTC-7).
const MONDAY = { from: '2026-11-23T07:00:00.000Z', to: '2026-11-24T07:00:00.000Z' };
const LONG_AGO = Date.parse('2026-11-01T00:00:00Z');

function starts(slots) {
  return slots.map((slot) => slot.startsAt);
}

test('a normal day offers every meeting that fits its opening hours, in UTC', () => {
  const slots = freeSlots({ calendar: calendar(), ...MONDAY, now: LONG_AGO });
  // 9:00, 10:00, 11:00 MST. 12:00 would end after closing.
  assert.deepEqual(slots, [
    { startsAt: '2026-11-23T16:00:00.000Z', endsAt: '2026-11-23T17:00:00.000Z' },
    { startsAt: '2026-11-23T17:00:00.000Z', endsAt: '2026-11-23T18:00:00.000Z' },
    { startsAt: '2026-11-23T18:00:00.000Z', endsAt: '2026-11-23T19:00:00.000Z' },
  ]);
});

test('a day with no opening hours offers nothing', () => {
  // Saturday 2026-11-28.
  const slots = freeSlots({
    calendar: calendar(), from: '2026-11-28T07:00:00Z', to: '2026-11-29T07:00:00Z', now: LONG_AGO,
  });
  assert.deepEqual(slots, []);
});

test('a blocked date offers nothing, and the days either side are untouched', () => {
  const cal = calendar({ blockedDates: ['2026-11-24'] });
  const slots = freeSlots({ calendar: cal, from: MONDAY.from, to: '2026-11-26T07:00:00Z', now: LONG_AGO });
  const days = new Set(starts(slots).map((iso) => iso.slice(0, 10)));
  assert.deepEqual([...days], ['2026-11-23', '2026-11-25']);
});

test('a slot inside the minimum notice is not offered', () => {
  // Now is 8:30 MST; two hours' notice means nothing before 10:30.
  const slots = freeSlots({
    calendar: calendar({ minNoticeMinutes: 120 }), ...MONDAY, now: Date.parse('2026-11-23T15:30:00Z'),
  });
  assert.deepEqual(starts(slots), ['2026-11-23T18:00:00.000Z']);
});

test('the gap spaces the day out and keeps clear of a booked meeting', () => {
  const cal = calendar({ gapMinutes: 30 });
  // An empty day: 9:00 and 10:30 (10:30 to 11:30), nothing at 12:00.
  assert.deepEqual(starts(freeSlots({ calendar: cal, ...MONDAY, now: LONG_AGO })), [
    '2026-11-23T16:00:00.000Z', '2026-11-23T17:30:00.000Z',
  ]);
  // A meeting booked 11:00-11:30 needs 30 clear minutes before it, which
  // 10:30-11:30 does not leave, so 10:30 goes; 9:00 ends a full gap clear.
  const booked = [{ startsAt: '2026-11-23T18:00:00Z', endsAt: '2026-11-23T18:30:00Z', status: 'booked' }];
  assert.deepEqual(starts(freeSlots({ calendar: cal, bookings: booked, ...MONDAY, now: LONG_AGO })), [
    '2026-11-23T16:00:00.000Z',
  ]);
  // One ending 9:30 sits inside 9:00's own slot and 10:30 is a full gap clear.
  const early = [{ startsAt: '2026-11-23T15:30:00Z', endsAt: '2026-11-23T16:30:00Z', status: 'booked' }];
  assert.deepEqual(starts(freeSlots({ calendar: cal, bookings: early, ...MONDAY, now: LONG_AGO })), [
    '2026-11-23T17:30:00.000Z',
  ]);
});

test('an existing booking removes its slot; a cancelled one does not', () => {
  const booked = [{ startsAt: '2026-11-23T17:00:00Z', endsAt: '2026-11-23T18:00:00Z', status: 'booked' }];
  assert.deepEqual(starts(freeSlots({ calendar: calendar(), bookings: booked, ...MONDAY, now: LONG_AGO })), [
    '2026-11-23T16:00:00.000Z', '2026-11-23T18:00:00.000Z',
  ]);
  const cancelled = [{ ...booked[0], status: 'cancelled' }];
  assert.equal(freeSlots({ calendar: calendar(), bookings: cancelled, ...MONDAY, now: LONG_AGO }).length, 3);
});

test('other busy time (the Google calendar, slice 5) blocks a slot the same way', () => {
  const busy = [{ startsAt: '2026-11-23T16:15:00Z', endsAt: '2026-11-23T16:45:00Z' }];
  assert.deepEqual(starts(freeSlots({ calendar: calendar(), busy, ...MONDAY, now: LONG_AGO })), [
    '2026-11-23T17:00:00.000Z', '2026-11-23T18:00:00.000Z',
  ]);
});

test('spring forward: the skipped hour offers no slot, and the hours after it move to MDT', () => {
  // Sunday 2027-03-14: Denver clocks jump from 2:00 MST to 3:00 MDT.
  const cal = calendar({ meetingMinutes: 30, weeklyHours: { sun: [{ start: '01:00', end: '04:00' }] } });
  const slots = freeSlots({ calendar: cal, from: '2027-03-14T07:00:00Z', to: '2027-03-15T06:00:00Z', now: LONG_AGO });
  assert.deepEqual(starts(slots), [
    '2027-03-14T08:00:00.000Z', // 1:00 MST
    '2027-03-14T08:30:00.000Z', // 1:30 MST
    '2027-03-14T09:00:00.000Z', // 3:00 MDT (2:00 and 2:30 never happen)
    '2027-03-14T09:30:00.000Z', // 3:30 MDT
  ]);
  // The Monday after: 9:00 is now MDT, UTC-6.
  const monday = freeSlots({ calendar: calendar(), from: '2027-03-15T06:00:00Z', to: '2027-03-16T06:00:00Z', now: LONG_AGO });
  assert.equal(monday[0].startsAt, '2027-03-15T15:00:00.000Z');
});

test('fall back: the repeated hour is offered once, and a meeting lasts its real length', () => {
  // Sunday 2026-11-01: Denver clocks fall from 2:00 MDT back to 1:00 MST.
  const cal = calendar({ weeklyHours: { sun: [{ start: '00:00', end: '03:00' }] } });
  const slots = freeSlots({
    calendar: cal, from: '2026-11-01T06:00:00Z', to: '2026-11-02T07:00:00Z', now: Date.parse('2026-10-01T00:00:00Z'),
  });
  assert.deepEqual(slots, [
    { startsAt: '2026-11-01T06:00:00.000Z', endsAt: '2026-11-01T07:00:00.000Z' }, // 0:00 MDT
    { startsAt: '2026-11-01T07:00:00.000Z', endsAt: '2026-11-01T08:00:00.000Z' }, // 1:00 MDT, the first one
    { startsAt: '2026-11-01T09:00:00.000Z', endsAt: '2026-11-01T10:00:00.000Z' }, // 2:00 MST
  ]);
});

test('nothing is offered further ahead than daysAhead', () => {
  // Now is Sunday 22 Nov, 5pm in Denver; one day ahead allows Monday only.
  const slots = freeSlots({
    calendar: calendar({ daysAhead: 1 }), from: MONDAY.from, to: '2026-11-26T07:00:00Z',
    now: Date.parse('2026-11-23T00:00:00Z'),
  });
  assert.deepEqual([...new Set(starts(slots).map((iso) => iso.slice(0, 10)))], ['2026-11-23']);
});

test('only slots starting inside the range come back, earliest first', () => {
  const slots = freeSlots({
    calendar: calendar(), from: '2026-11-23T16:30:00Z', to: '2026-11-23T18:00:00Z', now: LONG_AGO,
  });
  assert.deepEqual(starts(slots), ['2026-11-23T17:00:00.000Z']);
});

test('the range may be given as milliseconds, as routes/booking.js sends it', () => {
  const asText = freeSlots({ calendar: calendar(), ...MONDAY, now: LONG_AGO });
  const asMillis = freeSlots({
    calendar: calendar(), from: Date.parse(MONDAY.from), to: Date.parse(MONDAY.to), now: LONG_AGO,
  });
  assert.equal(asText.length, 3);
  assert.deepEqual(asMillis, asText);
});

test('isSlotFree accepts exactly a free slot and nothing near it', () => {
  const args = { calendar: calendar(), now: LONG_AGO };
  assert.equal(isSlotFree(args, '2026-11-23T16:00:00Z', '2026-11-23T17:00:00Z'), true);
  assert.equal(isSlotFree(args, '2026-11-23T16:15:00Z', '2026-11-23T17:15:00Z'), false);
  assert.equal(isSlotFree(args, '2026-11-23T16:00:00Z', '2026-11-23T16:30:00Z'), false);
  const booked = [{ startsAt: '2026-11-23T16:00:00Z', endsAt: '2026-11-23T17:00:00Z' }];
  assert.equal(isSlotFree({ ...args, bookings: booked }, '2026-11-23T16:00:00Z', '2026-11-23T17:00:00Z'), false);
});

test('bad input is refused out loud, never answered with an empty day', () => {
  assert.throws(() => freeSlots({ calendar: calendar({ timeZone: 'Mars/Olympus' }), ...MONDAY }), /timeZone/);
  assert.throws(() => freeSlots({ calendar: calendar({ meetingMinutes: 0 }), ...MONDAY }), /meetingMinutes/);
  assert.throws(() => freeSlots({ calendar: calendar(), from: 'soon', to: MONDAY.to }), /from/);
  assert.throws(() => freeSlots({ calendar: calendar(), from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' }), /at most/);
});

test('wallTimeToUtcMillis: ordinary, skipped and repeated wall times', () => {
  const at = (y, mo, d, h, mi) => wallTimeToUtcMillis({ y, mo, d, h, mi }, 'America/Denver');
  assert.equal(new Date(at(2026, 11, 23, 9, 0)).toISOString(), '2026-11-23T16:00:00.000Z');
  assert.equal(new Date(at(2026, 7, 1, 9, 0)).toISOString(), '2026-07-01T15:00:00.000Z');
  assert.equal(at(2027, 3, 14, 2, 30), null, 'the clocks skip 2:30');
  assert.equal(new Date(at(2026, 11, 1, 1, 30)).toISOString(), '2026-11-01T07:30:00.000Z', 'the first 1:30');
  assert.equal(new Date(wallTimeToUtcMillis({ y: 2026, mo: 6, d: 1, h: 9, mi: 0 }, 'Asia/Kolkata')).toISOString(), '2026-06-01T03:30:00.000Z');
  assert.equal(wallTimeToUtcMillis({ y: 2026, mo: 6, d: 1, h: 9, mi: 0 }, 'Not/AZone'), null);
});
