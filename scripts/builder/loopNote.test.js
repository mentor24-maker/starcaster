'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loopNote, heartbeatNote, KNOWN_TRANSITIONS } = require('./loopNote.js');

test('each transition composes its intended, operator-facing wording', () => {
  assert.equal(loopNote('claimed', { at: '10:12am' }), '🔨 building — claimed 10:12am');
  assert.equal(loopNote('pr-open', { at: '10:20am', pr: 351 }), '🔀 PR #351 open — waiting for a review pass (10:20am)');
  assert.equal(loopNote('review-started', { at: '8/23 3:41am' }), '🔍 being checked — a review pass started 8/23 3:41am');
  assert.equal(loopNote('verified', { at: '11:00am' }), '👀 verified — waiting on Dane to say "merge" (11:00am)');
  assert.equal(loopNote('sent-back', { at: '11:05am' }), '↩ returned to the line with notes for the builder (11:05am)');
  assert.equal(loopNote('merged', { at: '8/20' }), '✅ live 8/20');
  assert.equal(loopNote('escalated', { at: '9:00am' }), '🙋 needs Dane — a question is waiting (9:00am)');
});

test('the review claim is dated, not just clocked — staleness must be decidable across days', () => {
  // A second reviewer reads this note to decide "is a review already running
  // on this ticket?". A bare "3:41am" cannot tell today's claim from
  // yesterday's abandoned one, and getting that wrong either duplicates the
  // work or deadlocks the ticket forever.
  const note = loopNote('review-started', { at: '8/23 3:41am' });
  assert.match(note, /8\/23/, 'the review claim must carry the date the caller passed');
});

test('an unknown transition throws — a silently-wrong note is worse than a loud failure', () => {
  assert.throws(() => loopNote('nonsense', { at: 'x' }), /unknown loop-note transition "nonsense"/);
});

test('pr-open without a PR number is refused', () => {
  assert.throws(() => loopNote('pr-open', { at: 'x' }), /needs a PR number/);
});

test('a missing time degrades to "just now" rather than printing undefined', () => {
  assert.equal(loopNote('claimed', {}), '🔨 building — claimed just now');
});

test('the heartbeat names the count and what is next', () => {
  assert.equal(heartbeatNote({ at: '10:48am', inLine: 33, nextUp: 'Fix the thing' }),
    'pass finished 10:48am — 33 in line, next up: "Fix the thing"');
});

test('the heartbeat handles an empty queue honestly', () => {
  assert.equal(heartbeatNote({ at: '10:48am', inLine: 0 }),
    'pass finished 10:48am — queue empty, nothing waiting');
});

test('KNOWN_TRANSITIONS lists exactly the composable transitions', () => {
  assert.deepEqual(KNOWN_TRANSITIONS.sort(),
    ['auto-merge-armed', 'auto-merge-cancelled', 'claimed', 'escalated', 'merged',
      'pr-open', 'review-started', 'sent-back', 'verified'].sort());
});

test('the armed note says when, in his own clock, and how to stop it', () => {
  // Lane A (task 86bbkw2au). The ticket stays in Ready to launch either way,
  // so this note is the ONLY thing that tells "waiting on your word" apart
  // from "merging shortly unless you object" in the queue view.
  assert.equal(loopNote('auto-merge-armed', { deadline: '9:15pm' }),
    '🤖 auto-merge at 9:15pm unless you say stop');
});

test('an armed note without a deadline is refused, not rendered', () => {
  // "auto-merge at undefined unless you say stop" is worse than no note at
  // all: it tells him something is coming and refuses to say when.
  assert.throws(() => loopNote('auto-merge-armed', {}), /needs a deadline/);
  assert.throws(() => loopNote('auto-merge-armed', { at: '9:15pm' }), /needs a deadline/,
    'the send time is not the deadline, and must not be silently used as one');
});

test('the cancelled note puts it back in his hands', () => {
  assert.equal(loopNote('auto-merge-cancelled', { at: '8:20pm' }),
    '✋ auto-merge stopped — back to waiting on your word (8:20pm)');
});
