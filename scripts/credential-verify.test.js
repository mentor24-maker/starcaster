'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  NOT_VERIFIABLE,
  VERIFIERS,
  verifiableProviders,
  isVerifiable,
  verifyProvider,
} = require('../lib/credentialVerify');
const { CODES, codeFromHttpStatus } = require('../lib/credentialErrors');

// These tests guard the two honesty rules. Both come from real defects:
// Telegram's old "test" only checked that fields were filled in and never
// contacted Telegram, so it passed with a bogus token; and the UI's
// hand-written if/else chain is why Buffer and YouTube silently had no test.

test('every registered verifier is a function', () => {
  for (const [provider, fn] of Object.entries(VERIFIERS)) {
    assert.equal(typeof fn, 'function', `${provider} verifier must be callable`);
  }
});

test('the verifiable list is sorted and non-empty', () => {
  const list = verifiableProviders();
  assert.ok(list.length > 0);
  assert.deepEqual(list, [...list].sort());
});

test('isVerifiable is case- and whitespace-insensitive', () => {
  assert.equal(isVerifiable('  X  '), true);
  assert.equal(isVerifiable('X'), true);
  // 'linkedin' is defined in API_SCHEMAS but has no verifier.
  assert.equal(isVerifiable('linkedin'), false);
});

test('an unverifiable provider is NOT reported as a credential failure', async () => {
  const res = await verifyProvider('linkedin');
  assert.equal(res.ok, false);
  assert.equal(res.code, NOT_VERIFIABLE);
  // The distinction that matters: nothing was tested, so it must not claim the
  // credentials were rejected or blame the operator's values.
  assert.notEqual(res.code, CODES.REJECTED);
  assert.match(res.message, /no live check for this provider/i);
});

test('an unverifiable provider says presence was checked, not validity', async () => {
  const res = await verifyProvider('linkedin');
  assert.match(res.message, /Presence of the values was checked, not validity/i);
});

test('an unknown provider is handled without throwing', async () => {
  const res = await verifyProvider('totally_made_up');
  assert.equal(res.ok, false);
  assert.equal(res.code, NOT_VERIFIABLE);
});

test('an empty provider is rejected cleanly', async () => {
  const res = await verifyProvider('');
  assert.equal(res.ok, false);
  assert.ok(res.message);
});

test('a verifier that throws is reported, not propagated', async () => {
  const original = VERIFIERS.x;
  VERIFIERS.x = async () => { throw new Error('boom'); };
  try {
    const res = await verifyProvider('x');
    assert.equal(res.ok, false);
    assert.equal(res.code, CODES.UNREACHABLE);
    assert.match(res.detail, /boom/);
  } finally {
    VERIFIERS.x = original;
  }
});

test('every result carries the uniform shape', async () => {
  const res = await verifyProvider('linkedin');
  for (const key of ['provider', 'ok', 'code', 'identity', 'detail', 'message', 'checkedAt']) {
    assert.ok(key in res, `missing ${key}`);
  }
  assert.doesNotThrow(() => new Date(res.checkedAt).toISOString());
});

test('an external 400 is NOT translated to MISSING', () => {
  // YouTube answers an invalid API key with 400. Reporting that as "not
  // configured" sends the operator hunting for a value that is already set —
  // caught by running the registry against the live API. The MISSING
  // translation applies only to our own clients' pre-flight 400, in
  // fromLegacyResult.
  assert.notEqual(codeFromHttpStatus(400), CODES.MISSING);
});

test('the registry covers every platform the old UI chain hand-coded', () => {
  // public/js/settings.js had a branch per platform; these are the ones it knew.
  for (const platform of ['x', 'bluesky', 'reddit', 'facebook', 'threads', 'instagram', 'telegram']) {
    assert.equal(isVerifiable(platform), true, `${platform} must be in the registry`);
  }
});

test('Buffer is verifiable — it had a client check but no UI path', () => {
  assert.equal(isVerifiable('buffer'), true);
});

test('the ten previously unverifiable live integrations are covered', () => {
  // Measured against origin/main before this work: these had credentials set
  // but no way to check them short of triggering the feature.
  for (const provider of [
    'supabase', 'anthropic', 'brave', 'openai', 'gemini',
    'openclaw', 'youtube', 'buffer', 'google_drive', 'resend',
  ]) {
    assert.equal(isVerifiable(provider), true, `${provider} must be verifiable`);
  }
});
