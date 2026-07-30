'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { inspectValue, inspectProviderValues } = require('../lib/credentialShape');

const severities = (problems) => problems.map((p) => p.severity);
const messages = (problems) => problems.map((p) => p.message).join(' ');

// Every rule here targets a paste mistake that actually happens. The severity
// split is the important contract: errors are unambiguous and block the save,
// warnings are heuristics and must never block, because a provider changing its
// key format would otherwise lock the operator out of saving a valid key.

test('a clean value produces nothing', () => {
  assert.deepEqual(inspectValue({ provider: 'x', field: 'api_key', value: 'U0Ghabcdefghijklmnopqrstu', isSecret: true }), []);
});

test('an empty value is not a problem — required-ness is checked elsewhere', () => {
  assert.deepEqual(inspectValue({ provider: 'x', field: 'api_key', value: '', isSecret: true }), []);
});

test('a wrapped-in-quotes value is an error', () => {
  const out = inspectValue({ provider: 'anthropic', field: 'api_key', value: '"sk-ant-abc"', isSecret: true });
  assert.deepEqual(severities(out), ['error']);
  assert.match(messages(out), /wrapped in quotes/);
});

test('a line break is an error, reported once', () => {
  const out = inspectValue({ provider: 'openai', field: 'api_key', value: 'sk-abc\ndef', isSecret: true });
  // A newline is whitespace, so a naive rule would report both "line break" and
  // "contains a space" for the same defect.
  assert.equal(out.length, 1);
  assert.match(messages(out), /line break/);
});

test('a space inside a secret is an error', () => {
  const out = inspectValue({ provider: 'openai', field: 'api_key', value: 'sk-abc def', isSecret: true });
  assert.deepEqual(severities(out), ['error']);
  assert.match(messages(out), /contains a space/);
});

test('spaces in a NON-secret field are fine', () => {
  // Reddit's user_agent legitimately contains spaces, as do Drive folder names
  // and display names. Applying the secret rule to them would be a false alarm.
  assert.deepEqual(
    inspectValue({ provider: 'reddit', field: 'user_agent', value: 'starcaster by u/dane', isSecret: false }),
    []
  );
});

test('a truncated preview containing ... is an error', () => {
  const out = inspectValue({ provider: 'openai', field: 'api_key', value: 'sk-abc...xyz', isSecret: true });
  assert.deepEqual(severities(out), ['error']);
  assert.match(messages(out), /shortened preview/);
});

test('a masked placeholder is an error', () => {
  const out = inspectValue({ provider: 'openai', field: 'api_key', value: '********', isSecret: true });
  assert.deepEqual(severities(out), ['error']);
  assert.match(messages(out), /masked placeholder/);
});

test('an app-only Bearer token in the X access token field is an error', () => {
  // This is the mistake the old X error message asserted on every failure,
  // regardless of cause. It is now checked where it can actually be true.
  const out = inspectValue({ provider: 'x', field: 'access_token', value: 'AAAAAAAAAAAAAAAAAAAAAMLheAAA', isSecret: true });
  assert.deepEqual(severities(out), ['error']);
  assert.match(messages(out), /app-only Bearer token/);
});

test('a short X token is only a warning, never a block', () => {
  const out = inspectValue({ provider: 'x', field: 'access_token', value: '1822388-abcdefghijk', isSecret: true });
  assert.deepEqual(severities(out), ['warning']);
});

test('an unfamiliar key prefix is a warning, not an error', () => {
  // Providers change formats. Refusing to save a valid key because our pattern
  // is stale would be worse than the problem being prevented.
  const out = inspectValue({ provider: 'anthropic', field: 'api_key', value: 'xyz-brand-new-format-1234', isSecret: true });
  assert.deepEqual(severities(out), ['warning']);
});

test('errors suppress warnings for the same value', () => {
  // A quoted key also fails the prefix test *because* of the quotes; reporting
  // both sends the operator after a second, non-existent problem.
  const out = inspectValue({ provider: 'anthropic', field: 'api_key', value: '"not-the-usual-prefix"', isSecret: true });
  assert.deepEqual(severities(out), ['error']);
});

test('surrounding whitespace is a warning that names the Vercel trap', () => {
  const out = inspectValue({ provider: 'openai', field: 'api_key', value: '  sk-abc  ', isSecret: true });
  assert.deepEqual(severities(out), ['warning']);
  assert.match(messages(out), /Vercel/);
});

test('a Bluesky handle with a leading @ is an error', () => {
  const out = inspectValue({ provider: 'bluesky', field: 'identifier', value: '@dane.bsky.social', isSecret: false });
  assert.deepEqual(severities(out), ['error']);
});

test('a Supabase URL without https is an error', () => {
  const out = inspectValue({ provider: 'supabase', field: 'url', value: 'my-project.supabase.co', isSecret: false });
  assert.deepEqual(severities(out), ['error']);
});

test('inspectProviderValues separates errors from warnings', () => {
  const fields = [
    { key: 'api_key', label: 'API Key', secret: true },
    { key: 'account_name', label: 'Account Name', secret: false },
  ];
  const result = inspectProviderValues('x', { api_key: 'has space here', account_name: 'Dane Christensen' }, fields);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].label, 'API Key');
  // A display name with a space must not be flagged.
  assert.equal(result.warnings.filter((w) => w.field === 'account_name').length, 0);
});

test('inspectProviderValues is ok when only warnings are present', () => {
  const fields = [{ key: 'api_key', label: 'API Key', secret: true }];
  const result = inspectProviderValues('anthropic', { api_key: 'unfamiliar-prefix-value' }, fields);
  assert.equal(result.ok, true, 'warnings must never block a save');
  assert.equal(result.warnings.length, 1);
});

test('inspectProviderValues tolerates a missing schema', () => {
  const result = inspectProviderValues('x', { api_key: 'abc' }, null);
  assert.equal(typeof result.ok, 'boolean');
});
