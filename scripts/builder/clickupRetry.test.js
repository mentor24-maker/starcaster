'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  retryDecision, waitMsFor,
  MAX_ATTEMPTS, TOTAL_DEADLINE_MS, DEFAULT_WAIT_MS, MAX_WAIT_MS, MIN_WAIT_MS,
} = require('./clickupRetry.js');

const NOW = 1_700_000_000;

test('a 429 retries, and waits exactly as long as ClickUp asks', () => {
  const d = retryDecision({ status: 429, attempt: 1, resetSeconds: NOW + 34, nowSeconds: NOW });
  assert.equal(d.retry, true);
  assert.equal(d.waitMs, 34_000);
});

/*
 * x-ratelimit-reset is an ABSOLUTE epoch-seconds timestamp, not a duration.
 * Passing it to a sleep unsubtracted would wait decades, so the subtraction is
 * pinned on its own.
 */
test('the reset header is read as a timestamp, not a duration', () => {
  assert.equal(waitMsFor({ resetSeconds: NOW + 12, nowSeconds: NOW }), 12_000);
  assert.notEqual(waitMsFor({ resetSeconds: NOW + 12, nowSeconds: NOW }), (NOW + 12) * 1000);
});

test('a missing or unparseable reset header falls back to a bounded default', () => {
  assert.equal(waitMsFor({}), DEFAULT_WAIT_MS);
  assert.equal(waitMsFor({ resetSeconds: 'later', nowSeconds: NOW }), DEFAULT_WAIT_MS);
});

test('a window already past still waits the floor — never a busy loop', () => {
  assert.equal(waitMsFor({ resetSeconds: NOW - 500, nowSeconds: NOW }), MIN_WAIT_MS);
});

test('a wildly wrong header is capped — the window is per-minute', () => {
  assert.equal(waitMsFor({ resetSeconds: NOW + 86_400, nowSeconds: NOW }), MAX_WAIT_MS);
});

/*
 * THE THINGS THAT MUST NOT RETRY. A 401 is a bad or expired token and a 404 is
 * a bad id; repeating either is a slower route to the same answer, and
 * hammering a 401 against an expiring credential is how a rate limit becomes a
 * lockout. These are the easy ones to get wrong by widening a condition.
 */
for (const status of [200, 400, 401, 403, 404, 409, 500, 502, 0]) {
  test(`HTTP ${status} is never retried`, () => {
    const d = retryDecision({ status, attempt: 1, resetSeconds: NOW + 5, nowSeconds: NOW });
    assert.equal(d.retry, false);
    assert.match(d.why, /not a rate limit/);
  });
}

test('retries are bounded by attempt count', () => {
  const d = retryDecision({
    status: 429, attempt: MAX_ATTEMPTS, resetSeconds: NOW + 2, nowSeconds: NOW,
  });
  assert.equal(d.retry, false);
  assert.match(d.why, /still rate limited after/);
});

/*
 * THE DEADLINE, which is the criterion that keeps a scheduled job from eating
 * its own interval: launchd will not start a second copy while the first is
 * running, so an unbounded wait does not delay one pass, it deletes every pass
 * after it.
 */
test('retries are bounded by a total deadline, independently of attempt count', () => {
  const d = retryDecision({
    status: 429,
    attempt: 2,
    elapsedMs: TOTAL_DEADLINE_MS - 1_000,
    resetSeconds: NOW + 60,
    nowSeconds: NOW,
  });
  assert.equal(d.retry, false, 'a wait past the ceiling must be refused even with attempts left');
  assert.match(d.why, /ceiling/);
});

test('the deadline counts time already waited, not just this one wait', () => {
  const under = retryDecision({
    status: 429, attempt: 2, elapsedMs: 0, resetSeconds: NOW + 60, nowSeconds: NOW,
  });
  const over = retryDecision({
    status: 429, attempt: 2, elapsedMs: 60_000, resetSeconds: NOW + 60, nowSeconds: NOW,
  });
  assert.equal(under.retry, true);
  assert.equal(over.retry, false);
});

test('every refusal carries a reason — "it gave up" with no why is the defect', () => {
  for (const d of [
    retryDecision({ status: 401 }),
    retryDecision({ status: 429, attempt: MAX_ATTEMPTS }),
    retryDecision({ status: 429, attempt: 2, elapsedMs: TOTAL_DEADLINE_MS, resetSeconds: NOW + 30, nowSeconds: NOW }),
  ]) {
    assert.equal(d.retry, false);
    assert.ok(d.why && d.why.length > 20, `a refusal with no usable reason: ${JSON.stringify(d.why)}`);
  }
});

/*
 * Four attempts of at most ~65s each could in principle exceed the deadline;
 * the deadline is what actually bounds the wall clock, so pin that the two
 * limits cannot disagree in the dangerous direction.
 */
test('no sequence of retries can exceed the total deadline', () => {
  let waited = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS + 2; attempt += 1) {
    const d = retryDecision({
      status: 429, attempt, elapsedMs: waited, resetSeconds: NOW + 65, nowSeconds: NOW,
    });
    if (!d.retry) break;
    waited += d.waitMs;
  }
  assert.ok(waited <= TOTAL_DEADLINE_MS, `waited ${waited}ms, ceiling is ${TOTAL_DEADLINE_MS}ms`);
});
