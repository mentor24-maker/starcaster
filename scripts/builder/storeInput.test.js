'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { timestampOrError, toSpecDateTime } = require('../../lib/storeInput');

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

/**
 * An invalid time-zone OFFSET reported as an invalid SECOND (86bbmpj9r).
 *
 * `calendarError` read the time fields with
 * `text.slice(11).split(/[:+\-Zz]/)`, which also cuts at the sign of a zone
 * offset. So `2026-08-26T12:34+61:00` handed back ['12','34','61','00'] and the
 * 61 that is an impossible offset was reported as an impossible second — on a
 * string carrying no seconds field at all. The refusal was correct; the reason
 * it gave was invented, which is a caller told to fix a field they never sent.
 */
test('an impossible zone offset is refused AS AN OFFSET, not as a second', () => {
  const res = timestampOrError('2026-08-26T12:34+61:00', 'recordedAt');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /time-zone offset of \+61:00/);
  assert.doesNotMatch(res.error, /second/,
    'the offset was reported as a second — the reason is about a field the caller never sent');
});

test('an offset out of range is refused whichever half is wrong', () => {
  for (const [stamp, shown] of [
    ['2026-08-26T12:34+61:00', '+61:00'],
    ['2026-08-26T12:34-99:00', '-99:00'],
    ['2026-08-26T12:34:56+05:71', '+05:71'],
    ['2026-08-26T12:34:56+2400', '+24:00'],
  ]) {
    const res = timestampOrError(stamp, 'recordedAt');
    assert.equal(res.ok, false, `${stamp} was accepted`);
    assert.match(res.error, /time-zone offset/);
    assert.ok(res.error.includes(shown), `${stamp} named the wrong offset: ${res.error}`);
  }
});

/**
 * Reading the offset must not stop the SECONDS being read. The split it
 * replaced was doing both jobs at once, so the obvious way to fix the offset is
 * to stop parsing past the time — which would take the fractional-second fix
 * above with it, silently, since 59.096 would then never be compared to 59.
 */
test('the seconds are still read when a zone offset follows them', () => {
  assert.equal(timestampOrError('2026-08-26T12:34:59.096+05:00', 'recordedAt').ok, true);
  assert.equal(timestampOrError('2026-08-26T12:34:60+05:00', 'recordedAt').ok, false);
  assert.equal(timestampOrError('2026-08-26T24:00:00+05:00', 'recordedAt').ok, false);
  assert.equal(timestampOrError('2026-08-26T12:60:00+05:00', 'recordedAt').ok, false);
});

/**
 * A colon-less offset (`-0500`) is valid ISO 8601 and is NOT in the ECMAScript
 * Date Time String Format, so `new Date` fell through to the engine-specific
 * fallback parser this module's own note says it will not depend on. V8 reads
 * it correctly today — so nothing was wrong on this machine, and "the stored
 * instant depends on who parsed it" is exactly the class of bug that note is
 * about. The colon is written in before parsing, which keeps the input accepted
 * and puts the answer back on the spec.
 *
 * Asserted as an EQUALITY between the two spellings rather than against a
 * hard-coded instant: the property is that they mean the same moment.
 */
test('a colon-less zone offset means the same instant as the spelled-out one', () => {
  for (const [terse, spelled] of [
    ['2026-08-26T12:34:56-0500', '2026-08-26T12:34:56-05:00'],
    ['2026-08-26T12:34:56+0530', '2026-08-26T12:34:56+05:30'],
    ['2026-08-26T12:34-0800', '2026-08-26T12:34-08:00'],
  ]) {
    const a = timestampOrError(terse, 'recordedAt');
    const b = timestampOrError(spelled, 'recordedAt');
    assert.equal(a.ok, true, `${terse} was refused: ${a.error || ''}`);
    assert.equal(b.ok, true, `${spelled} was refused: ${b.error || ''}`);
    assert.equal(a.value, b.value, `${terse} and ${spelled} stored different instants`);
  }
});

/** Unchanged behaviour, pinned so the offset work above is not read as a loosening. */
test('a zone that is absent or Z is still read as UTC', () => {
  assert.equal(timestampOrError('2026-08-26T12:34:56', 'recordedAt').value,
    timestampOrError('2026-08-26T12:34:56Z', 'recordedAt').value);
  assert.equal(timestampOrError('2026-08-26T12:34:56z', 'recordedAt').value,
    '2026-08-26T12:34:56.000Z');
});

/**
 * The string handed to `new Date` is always in the ECMAScript Date Time String
 * Format, so the spec'd parser answers and the implementation-defined fallback
 * never does.
 *
 * This is asserted on the STRING rather than on the instant because on V8 the
 * instant is identical either way — `-0500` happens to be read correctly, so a
 * test written against the return value cannot fail whether the colon is
 * written in or not, and a fix nothing can fail on is a fix that gets deleted.
 * The engine dependency is the defect; the stored value only becomes wrong on
 * an engine that reads the fallback differently.
 */
test('every date-time is normalized into the format the spec defines', () => {
  // The format: YYYY-MM-DDTHH:mm[:ss[.sss]] then Z or ±HH:mm — colon required.
  const SPEC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|z|[+-]\d{2}:\d{2})$/;
  for (const input of [
    '2026-08-26T12:34:56-0500',   // colon-less offset — valid ISO, not valid here
    '2026-08-26T12:34+0530',
    '2026-08-26 12:34:56',        // a space instead of the T, as ffprobe emits
    '2026-08-26 12:34:56-0800',
    '2026-08-26T12:34:56',        // no zone at all
    '2026-08-26T12:34:56.789Z',
    '2026-08-26T12:34:56+05:00',
  ]) {
    const out = toSpecDateTime(input, false);
    assert.match(out, SPEC,
      `${input} was handed to new Date as "${out}", which is outside the `
      + 'ECMAScript Date Time String Format — the engine\'s fallback parser answers it');
  }

  // A date with no time is already UTC per the language spec and is left alone.
  assert.equal(toSpecDateTime('2026-08-26', true), '2026-08-26');
});
