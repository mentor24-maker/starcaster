'use strict';
// TEMPORARY — a deliberately failing test, opened only to make one PR go red
// so the stale-ready watch (task 86bbqp68c) could be watched actually firing.
// This branch is closed and deleted immediately afterwards; it must never merge.
const test = require('node:test');
const assert = require('node:assert');
test('deliberately red, for the 86bbqp68c rehearsal', () => {
  assert.equal(1, 2, 'this failure is on purpose');
});
