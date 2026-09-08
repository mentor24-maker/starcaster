'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { timestampOrError } = require('../../lib/storeInput');

/**
 * `lib/storeInput.js` is shared by three stores — project connections, video
 * sessions and video sources — so a defect in its timestamp validator is a
 * defect in all three at once, and none of them had a test on it.
 *
 * The one that brought this file into being: ISO 8601 lets the SECONDS field
 * carry a fraction, `ISO_DATETIME_RE` admits it on purpose, and the calendar
 * check then compared that fractional number against 59. So `21:54:59.096`
 * was refused as a second "which does not exist", while `21:54:58.096` was
 * fine — a validator that rejected one ordinary instant in every sixty.
 *
 * Every caller stamping "now" was rolling that die, because
 * `new Date().toISOString()` always emits milliseconds. It surfaced as a flaky
 * CI run and, once the X connection began storing a real expiry, as a client
 * being unable to connect their account if they pressed the button on the
 * wrong second (86bbpz1hu).
 */
test('a fractional 59th second is a real time, not a refusal', () => {
  for (const stamp of [
    '2026-09-03T21:54:59.096Z',
    '2026-09-03T21:54:59.9Z',
    '2026-09-03T21:54:59.999Z',
    '2026-09-03T23:59:59.500Z',
  ]) {
    const res = timestampOrError(stamp, 'expiresAt');
    assert.equal(res.ok, true, `${stamp} was refused: ${res.error || ''}`);
  }
});

test('the whole minute of fractional seconds is accepted, not just the 59th', () => {
  for (let second = 0; second < 60; second += 1) {
    const stamp = `2026-09-03T21:54:${String(second).padStart(2, '0')}.096Z`;
    const res = timestampOrError(stamp, 'recordedAt');
    assert.equal(res.ok, true, `${stamp} was refused: ${res.error || ''}`);
  }
});

/**
 * The fix is `Math.floor` on the seconds, and flooring must not soften the
 * check it is inside. A minute has sixty seconds; 60 is the rollover and 61 is
 * nonsense, fraction or no fraction.
 */
test('a second of 60 or more is still refused, fraction or not', () => {
  for (const stamp of [
    '2026-09-03T21:54:60Z',
    '2026-09-03T21:54:60.000Z',
    '2026-09-03T21:54:61.5Z',
    '2026-09-03T21:54:99.999Z',
  ]) {
    const res = timestampOrError(stamp, 'expiresAt');
    assert.equal(res.ok, false, `${stamp} was accepted as a real time`);
    assert.equal(res.status, 400);
    assert.match(res.error, /does not exist/);
  }
});

/** The neighbouring fields never carry a fraction in ISO, and still refuse. */
test('impossible hours and minutes are still refused', () => {
  assert.equal(timestampOrError('2026-09-03T24:00:00.000Z', 'expiresAt').ok, false);
  assert.equal(timestampOrError('2026-09-03T21:60:00.000Z', 'expiresAt').ok, false);
});

/** Unchanged behaviour, asserted so the fix above is not read as a loosening. */
test('impossible calendar dates are still refused', () => {
  assert.equal(timestampOrError('2026-02-30T21:54:59.096Z', 'expiresAt').ok, false);
  assert.equal(timestampOrError('2026-13-01T21:54:59.096Z', 'expiresAt').ok, false);
  assert.equal(timestampOrError('2026-02-29', 'expiresAt').ok, false, '2026 is not a leap year');
  assert.equal(timestampOrError('2028-02-29', 'expiresAt').ok, true, '2028 is a leap year');
});
