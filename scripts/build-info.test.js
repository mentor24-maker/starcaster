'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { getBuildInfo, describeRunningBuild, humanAge } = require('../lib/buildInfo');

// The point of this module is to make the Vercel redeploy trap checkable: an env
// var edited in the dashboard does not reach the deployment already serving
// traffic, so "this deployment was built 3 days ago" is the fact that turns an
// invisible problem into an obvious one.

test('humanAge reads in plain language', () => {
  const now = Date.parse('2026-07-30T12:00:00Z');
  assert.equal(humanAge('2026-07-30T11:59:30Z', now), 'just now');
  assert.equal(humanAge('2026-07-30T11:20:00Z', now), '40 minutes ago');
  assert.equal(humanAge('2026-07-30T04:00:00Z', now), '8 hours ago');
  assert.equal(humanAge('2026-07-27T12:00:00Z', now), '3 days ago');
});

test('humanAge uses singular units correctly', () => {
  const now = Date.parse('2026-07-30T12:00:00Z');
  assert.equal(humanAge('2026-07-29T12:00:00Z', now), '1 day ago');
});

test('humanAge is empty rather than wrong when the time is unknown', () => {
  assert.equal(humanAge(null), '');
  assert.equal(humanAge(''), '');
  assert.equal(humanAge('not-a-date'), '');
});

test('humanAge never reports a negative age', () => {
  // Clock skew between build machine and server must not produce "-5 minutes".
  const now = Date.parse('2026-07-30T12:00:00Z');
  assert.equal(humanAge('2026-07-30T12:05:00Z', now), 'just now');
});

test('getBuildInfo reports whether the build time is actually known', () => {
  const info = getBuildInfo();
  assert.equal(typeof info.known, 'boolean');
  // Must never claim a time it does not have.
  if (!info.known) assert.equal(info.builtAt, null);
});

test('getBuildInfo shortens the commit for display', () => {
  const info = getBuildInfo();
  if (info.commit) assert.equal(info.shortCommit, info.commit.slice(0, 7));
});

test('describeRunningBuild is empty when the build time is unknown', () => {
  const info = getBuildInfo();
  const sentence = describeRunningBuild();
  if (!info.known) {
    // A half-sentence is worse than none — the caller falls back to the
    // generic warning.
    assert.equal(sentence, '');
  } else {
    assert.match(sentence, /^This deployment was built /);
    assert.match(sentence, /\.$/);
  }
});

test('Vercel runtime env vars win over the stamp for commit and branch', () => {
  const originalSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const originalRef = process.env.VERCEL_GIT_COMMIT_REF;
  process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
  process.env.VERCEL_GIT_COMMIT_REF = 'main';
  try {
    const info = getBuildInfo();
    assert.equal(info.commit, 'abcdef1234567890');
    assert.equal(info.shortCommit, 'abcdef1');
    assert.equal(info.branch, 'main');
  } finally {
    if (originalSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = originalSha;
    if (originalRef === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
    else process.env.VERCEL_GIT_COMMIT_REF = originalRef;
  }
});
