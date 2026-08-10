'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  CODES,
  REDEPLOY_NOTE,
  describeCredentialFailure,
  codeFromHttpStatus,
} = require('../lib/credentialErrors');

// The bug these tests exist to prevent: on 2026-07-29 every X failure carried
// the same "do not paste a Bearer token" advice, including one whose real cause
// was a production deployment built before the good env values existed. Advice
// that names the wrong cause is the defect — not the missing advice.

test('the message leads with what happened, not with a guess at why', () => {
  const msg = describeCredentialFailure({ provider: 'x', code: CODES.REJECTED });
  assert.match(msg, /^X: the credentials were rejected\./);
});

test('provider detail is preserved verbatim', () => {
  const msg = describeCredentialFailure({
    provider: 'x',
    code: CODES.REJECTED,
    detail: 'Unauthorized (code 89: Invalid or expired token)',
  });
  assert.match(msg, /code 89: Invalid or expired token/);
});

test('a cause-specific fix appears when the client supplies one', () => {
  const msg = describeCredentialFailure({
    provider: 'x',
    code: CODES.REJECTED,
    fix: 'Regenerate the Access Token and Secret.',
  });
  assert.match(msg, /Regenerate the Access Token and Secret\./);
});

test('no fix is invented when the client cannot classify the failure', () => {
  const msg = describeCredentialFailure({ provider: 'x', code: CODES.REJECTED });
  assert.ok(!/Bearer/i.test(msg), 'must not volunteer bearer-token advice');
  assert.ok(!/developer\.x\.com/i.test(msg), 'must not volunteer portal steps');
});

test('rate limiting is not described as a credential problem', () => {
  const msg = describeCredentialFailure({ provider: 'x', code: CODES.RATE_LIMITED });
  assert.match(msg, /not a credential problem/);
});

test('an outage does not get the redeploy note', () => {
  const msg = describeCredentialFailure({ provider: 'x', code: CODES.UNREACHABLE });
  assert.ok(!msg.includes(REDEPLOY_NOTE));
});

test('a missing credential does not get the redeploy note — nothing is stale yet', () => {
  const msg = describeCredentialFailure({ provider: 'x', code: CODES.MISSING });
  assert.ok(!msg.includes(REDEPLOY_NOTE));
});

test('MISSING names the specific unset fields and their env var names', (t) => {
  // Depends on reddit being unconfigured — true in a clean checkout and in CI.
  // Skip rather than fail if this machine happens to have Reddit credentials.
  const { getProviderCredentialDiagnostics } = require('../lib/apiSettings');
  const diag = getProviderCredentialDiagnostics('reddit');
  const anySet = diag.ok && Object.values(diag.sources).some((s) => s !== 'missing');
  if (anySet) {
    t.skip('Reddit is configured in this environment');
    return;
  }
  const msg = describeCredentialFailure({ provider: 'reddit', code: CODES.MISSING });
  assert.match(msg, /Not set:/);
  assert.match(msg, /REDDIT_CLIENT_ID/);
});

test('an unknown provider degrades gracefully instead of throwing', () => {
  const msg = describeCredentialFailure({ provider: 'not_a_provider', code: CODES.REJECTED });
  assert.match(msg, /rejected/);
});

test('extra sentences are appended in order', () => {
  const msg = describeCredentialFailure({
    provider: 'x',
    code: CODES.REJECTED,
    extra: ['First extra.', 'Second extra.'],
  });
  assert.ok(msg.indexOf('First extra.') < msg.indexOf('Second extra.'));
});

test('HTTP status maps to the code that changes what the operator does', () => {
  assert.equal(codeFromHttpStatus(401), CODES.REJECTED);
  assert.equal(codeFromHttpStatus(403), CODES.INSUFFICIENT_SCOPE);
  assert.equal(codeFromHttpStatus(429), CODES.RATE_LIMITED);
  assert.equal(codeFromHttpStatus(503), CODES.UNREACHABLE);
});
