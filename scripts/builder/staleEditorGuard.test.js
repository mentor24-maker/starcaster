'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isStaleEdit } = require('../../lib/builderPagesStore');
const { buildLandingPagePatch } = require('../../routes/builder');

/**
 * The stale-editor guard.
 *
 * Why it exists: on 2026-08-15 two people had the Delray home page open at
 * once. One added an "EVENTS" section; the other saved a copy loaded before
 * that change and the section vanished — 41 sections down to 40, 84 modules
 * down to 80, with no warning of any kind. The page revision history had
 * banked the lost version, so it was recoverable, but only after diffing raw
 * layout JSON out of production by hand. Last-write-wins with no warning is
 * the bug; recovery was the consolation prize.
 *
 * The properties that matter, and what breaks if each regresses:
 *
 *  - a genuinely stale save is refused (or we are back to silent data loss)
 *  - the guard FAILS OPEN on anything it cannot read (or a bad timestamp
 *    anywhere in the stack stops the Builder accepting saves at all — far
 *    worse than the problem being solved)
 *  - an absent expected value never blocks (propagation, scripts and any
 *    older client must keep working exactly as they do today)
 *  - the control field never reaches the database as a column (the patch
 *    builder is a whitelist; a leak here would try to write updated_at)
 */

test('a save from a copy loaded before someone else saved is stale', () => {
  assert.equal(
    isStaleEdit('2026-08-15T22:51:12.118061+00:00', '2026-08-15T23:27:28.894633+00:00'),
    true
  );
});

test('a save from the current copy is not stale', () => {
  const now = '2026-08-15T23:27:28.894633+00:00';
  assert.equal(isStaleEdit(now, now), false);
});

test('microsecond precision survives: identical strings never compare stale', () => {
  // Date.parse truncates to milliseconds, so a byte-identical timestamp must
  // short-circuit on the string rather than round-trip through Date.
  const withMicros = '2026-08-15T23:27:28.894633+00:00';
  assert.equal(isStaleEdit(withMicros, withMicros), false);
});

test('an older live value is not stale (clock skew must not block a save)', () => {
  assert.equal(
    isStaleEdit('2026-08-15T23:27:28.894633+00:00', '2026-08-15T22:51:12.118061+00:00'),
    false
  );
});

test('fails open: a missing expected value never blocks a save', () => {
  assert.equal(isStaleEdit('', '2026-08-15T23:27:28.894633+00:00'), false);
  assert.equal(isStaleEdit(null, '2026-08-15T23:27:28.894633+00:00'), false);
  assert.equal(isStaleEdit(undefined, '2026-08-15T23:27:28.894633+00:00'), false);
});

test('fails open: a page with no updated_at at all never blocks a save', () => {
  assert.equal(isStaleEdit('2026-08-15T23:27:28.894633+00:00', ''), false);
  assert.equal(isStaleEdit('2026-08-15T23:27:28.894633+00:00', null), false);
});

test('fails open: garbage on either side never blocks a save', () => {
  assert.equal(isStaleEdit('not a date', '2026-08-15T23:27:28.894633+00:00'), false);
  assert.equal(isStaleEdit('2026-08-15T23:27:28.894633+00:00', 'not a date'), false);
  assert.equal(isStaleEdit('not a date', 'also not a date'), false);
});

test('expectedUpdatedAt is a control field, never a column to write', () => {
  // buildLandingPagePatch is a whitelist. If it ever starts passing this
  // through, updatePage would try to PATCH updated_at from the client.
  const built = buildLandingPagePatch({
    name: 'Home',
    layoutSections: [],
    expectedUpdatedAt: '2026-08-15T23:27:28.894633+00:00',
  });
  assert.equal(built.error, undefined);
  assert.ok(!('expectedUpdatedAt' in built.patch), 'must not reach the row builder');
  assert.ok(!('updatedAt' in built.patch), 'must not reach the row builder');
  assert.ok(!('updated_at' in built.patch), 'must not reach the row builder');
});
