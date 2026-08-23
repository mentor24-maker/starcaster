'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loopNote, heartbeatNote, KNOWN_TRANSITIONS } = require('./loopNote.js');

test('each transition composes its intended, operator-facing wording', () => {
  assert.equal(loopNote('claimed', { at: '10:12am' }), '🔨 building — claimed 10:12am');
  assert.equal(loopNote('pr-open', { at: '10:20am', pr: 351 }), '🔀 PR #351 open — waiting for a review pass (10:20am)');
  assert.equal(loopNote('verified', { at: '11:00am' }), '👀 verified — waiting on Dane to say "merge" (11:00am)');
  assert.equal(loopNote('sent-back', { at: '11:05am' }), '↩ returned to the line with notes for the builder (11:05am)');
  assert.equal(loopNote('merged', { at: '8/20' }), '✅ live 8/20');
  assert.equal(loopNote('escalated', { at: '9:00am' }), '🙋 needs Dane — a question is waiting (9:00am)');
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
  assert.deepEqual(KNOWN_TRANSITIONS.sort(), ['claimed', 'escalated', 'merged', 'pr-open', 'sent-back', 'verified'].sort());
});
