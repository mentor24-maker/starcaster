'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  getApiConfig,
  upsertApiConfig,
  deleteApiConfig,
  revealApiProviderField,
} = require('../lib/apiSettings');

// Phase 5. The edit form used to be prefilled with real secrets, which meant
// every visit to Settings > APIs pulled live credentials into the browser —
// including ones that exist only as production env vars. Values are masked now
// and fetched one at a time on an explicit, logged click.
//
// 'exa' is used throughout: it is a real provider in API_SCHEMAS with a single
// secret field, and it has no credentials in any environment, so these tests
// neither depend on nor disturb a configured provider.

const PROVIDER = 'exa';
const SECRET = 'test-secret-value-do-not-use-12345';

after(() => {
  // Leave the local store as we found it.
  try { deleteApiConfig(PROVIDER); } catch (_) { /* nothing to clean up */ }
});

test('getApiConfig masks secret values', () => {
  const saved = upsertApiConfig({ provider: PROVIDER, values: { api_key: SECRET } });
  if (!saved.ok && saved.status === 409) return; // read-only fs; nothing to assert
  assert.equal(saved.ok, true);

  const config = getApiConfig(PROVIDER);
  assert.equal(config.ok, true);
  const shown = String(config.data.values.api_key || '');
  assert.notEqual(shown, SECRET, 'the raw secret must not be returned');
  assert.match(shown, /\.\.\./, 'should be a masked preview');
});

test('getApiConfig reports which fields already hold a value', () => {
  const config = getApiConfig(PROVIDER);
  if (!config.ok) return;
  assert.equal(config.data.hasValue.api_key, true);
});

test('reveal returns the real value for one named field', () => {
  const revealed = revealApiProviderField(PROVIDER, 'api_key');
  if (!revealed.ok && revealed.status === 404) return; // not stored (read-only fs)
  assert.equal(revealed.ok, true);
  assert.equal(revealed.data.value, SECRET);
  assert.equal(revealed.data.field, 'api_key');
});

test('reveal rejects a field that does not belong to the provider', () => {
  const revealed = revealApiProviderField(PROVIDER, 'not_a_field');
  assert.equal(revealed.ok, false);
  assert.equal(revealed.status, 400);
});

test('reveal rejects an unknown provider', () => {
  const revealed = revealApiProviderField('not_a_provider', 'api_key');
  assert.equal(revealed.ok, false);
  assert.equal(revealed.status, 400);
});

test('reveal reports 404 for a field that is not set', () => {
  // linkedin is in API_SCHEMAS and unconfigured everywhere.
  const revealed = revealApiProviderField('linkedin', 'client_id');
  assert.equal(revealed.ok, false);
  assert.equal(revealed.status, 404);
});

test('a blank secret field keeps the stored value instead of clearing it', () => {
  // This is the behaviour a masked form REQUIRES. Without it, opening the form
  // and saving one changed field would wipe every other secret, because the
  // form no longer round-trips them.
  const again = upsertApiConfig({ provider: PROVIDER, values: { api_key: '' } });
  if (!again.ok && again.status === 409) return;
  assert.equal(again.ok, true, 'a blank required secret must not fail when one is stored');

  const revealed = revealApiProviderField(PROVIDER, 'api_key');
  assert.equal(revealed.ok, true);
  assert.equal(revealed.data.value, SECRET, 'the stored secret must survive a blank submission');
});

test('a non-blank value still replaces the stored one', () => {
  const replacement = 'replacement-secret-value-67890';
  const saved = upsertApiConfig({ provider: PROVIDER, values: { api_key: replacement } });
  if (!saved.ok && saved.status === 409) return;
  assert.equal(saved.ok, true);
  const revealed = revealApiProviderField(PROVIDER, 'api_key');
  assert.equal(revealed.data.value, replacement);
});

test('a required field that has never been set still errors when blank', () => {
  const result = upsertApiConfig({ provider: 'linkedin', values: { client_id: '' } });
  assert.equal(result.ok, false);
  assert.match(result.error, /required/i);
});
