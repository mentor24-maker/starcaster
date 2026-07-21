'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { resolveProviderValues } = require('../lib/apiSettings');

test('a saved Settings value wins over an env var', () => {
  const merged = resolveProviderValues(
    { identifier: 'from-settings' },
    { identifier: 'from-env' }
  );
  assert.equal(merged.identifier, 'from-settings');
});

test('env fills in fields Settings has not set', () => {
  const merged = resolveProviderValues(
    { identifier: 'from-settings' },
    { identifier: 'from-env', app_password: 'env-secret' }
  );
  assert.equal(merged.identifier, 'from-settings');
  assert.equal(merged.app_password, 'env-secret');
});

test('an empty Settings value does NOT override env (falls back)', () => {
  const merged = resolveProviderValues(
    { app_password: '' },
    { app_password: 'env-secret' }
  );
  assert.equal(merged.app_password, 'env-secret');
});

test('fields present only in Settings are kept', () => {
  const merged = resolveProviderValues(
    { service_url: 'https://custom.example' },
    {}
  );
  assert.equal(merged.service_url, 'https://custom.example');
});

test('empty stored and empty env yields empty object', () => {
  assert.deepEqual(resolveProviderValues({}, {}), {});
  assert.deepEqual(resolveProviderValues(null, null), {});
});

test('inputs are not mutated', () => {
  const stored = { a: '1' };
  const env = { a: 'x', b: '2' };
  resolveProviderValues(stored, env);
  assert.deepEqual(stored, { a: '1' });
  assert.deepEqual(env, { a: 'x', b: '2' });
});
