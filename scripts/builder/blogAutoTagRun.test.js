'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BATCH_SIZE, tagsToAdd, tagsToRemoveOnUndo, undoDecision, assertBatch,
} = require('../../lib/blogAutoTagRun.js');

/**
 * The Auto-tag run's decisions (ticket 86bbw4dch). Pure, so no database:
 * what a run appends, what undo takes back, when undo refuses, batch size.
 */

test('tagsToAdd appends only what the post does not already carry, by near-duplicate key, once', () => {
  const got = tagsToAdd(['Pickleball', 'round robin'], [
    { tag: 'pickle ball' },      // carried, other spelling
    { tag: 'Round Robins' },     // carried, plural
    { tag: 'tennis mixer' },
    { tag: 'Tennis Mixers' },    // same as the previous suggestion
    { tag: 'junior tennis' },
    { tag: '' },
  ]);
  assert.deepEqual(got, ['tennis mixer', 'junior tennis']);
});

test('undo removes exactly what the run added and keeps a hand-added tag', () => {
  // Run added "tennis mixer" and "junior tennis"; author then added "events" by hand and removed "junior tennis".
  const { next, removed } = tagsToRemoveOnUndo(['pickleball', 'tennis mixer', 'events'], ['tennis mixer', 'junior tennis']);
  assert.deepEqual(removed, ['tennis mixer']);
  assert.deepEqual(next, ['pickleball', 'events']);
});

test('undo restores the tags array byte-for-byte when nothing changed in between', () => {
  const before = ['Delray Tennis', 'junior tennis'];
  const added = tagsToAdd(before, [{ tag: 'tennis programs' }, { tag: 'Brent Wellman' }]);
  const after = [...before, ...added];
  assert.deepEqual(tagsToRemoveOnUndo(after, added).next, before);
});

test('undo is case-insensitive on the added spelling but never touches a different tag', () => {
  const { next, removed } = tagsToRemoveOnUndo(['Tennis Mixer', 'tennis mixers'], ['tennis mixer']);
  assert.deepEqual(removed, ['Tennis Mixer']);
  assert.deepEqual(next, ['tennis mixers'], 'the plural is a different tag, not the one the run added');
});

test('undoDecision: missing, already undone, ok', () => {
  assert.equal(undoDecision([]), 'missing');
  assert.equal(undoDecision(null), 'missing');
  assert.equal(undoDecision([{ undoneAt: '2026-09-07T00:00:00Z' }, { undoneAt: '2026-09-07T00:00:00Z' }]), 'already-undone');
  assert.equal(undoDecision([{ undoneAt: '2026-09-07T00:00:00Z' }, { undoneAt: null }]), 'ok');
});

test('a batch is at most BATCH_SIZE ids, all non-empty', () => {
  assert.equal(BATCH_SIZE, 10);
  assert.equal(assertBatch(Array.from({ length: 10 }, (_, i) => `p${i}`)), '');
  assert.match(assertBatch(Array.from({ length: 11 }, (_, i) => `p${i}`)), /At most 10 posts per call/);
  assert.match(assertBatch([]), /required/);
  assert.match(assertBatch(['p1', '']), /non-empty/);
  assert.match(assertBatch('p1'), /required/);
});
