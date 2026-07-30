'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  describeIdentityChange,
  isMissingTable,
  recordVerifiedIdentity,
  getKnownIdentity,
} = require('../lib/credentialIdentityStore');
const {
  findStaleEnvVars,
  describeStaleEnvVars,
  fetchEnvMetadata,
  clearCache,
} = require('../lib/vercelEnvAudit');

// Both features ship before their prerequisites exist — the Supabase migration
// has to be applied by hand, and the Vercel token has to be created by the
// operator. So the contract under test is mostly about degrading honestly:
// never break the verification being annotated, and never claim a check that
// did not happen.

// ── identity drift ─────────────────────────────────────────────────────────

test('a missing table is recognised as "not installed", not as an error', () => {
  assert.equal(isMissingTable({ status: 404 }), true);
  assert.equal(isMissingTable({ status: 400, error: 'relation "x" does not exist' }), true);
  assert.equal(isMissingTable({ status: 400, error: '42P01 undefined_table' }), true);
  assert.equal(isMissingTable({ status: 500, error: 'timeout' }), false);
});

test('recording an identity never throws when the table is absent', async () => {
  const result = await recordVerifiedIdentity({
    projectId: 'test-project',
    provider: 'x',
    identity: { label: '@someone', id: '123' },
  });
  assert.equal(typeof result.tracked, 'boolean');
  assert.equal(result.changed, false, 'must not claim drift it cannot verify');
});

test('an identity with no label or id is not recorded', async () => {
  // Plain API-key providers report no identity. Recording a blank would create
  // phantom drift on the next check.
  const result = await recordVerifiedIdentity({
    projectId: 'test-project',
    provider: 'anthropic',
    identity: { label: '', id: '' },
  });
  assert.equal(result.tracked, false);
  assert.equal(result.changed, false);
});

test('reading an unknown identity returns null rather than throwing', async () => {
  const known = await getKnownIdentity({ projectId: 'nope', provider: 'nope' });
  assert.equal(known, null);
});

test('describeIdentityChange says nothing when nothing changed', () => {
  assert.equal(describeIdentityChange({ changed: false, previous: null }, '@a'), '');
  assert.equal(describeIdentityChange({ changed: true, previous: null }, '@a'), '');
});

test('describeIdentityChange names both accounts when it changed', () => {
  const msg = describeIdentityChange(
    { changed: true, previous: { label: '@dachristensen', id: '18223886' } },
    '@someone_else'
  );
  assert.match(msg, /@dachristensen/);
  assert.match(msg, /@someone_else/);
  assert.match(msg, /wrong account/);
});

test('describeIdentityChange stays quiet if both labels are the same', () => {
  const msg = describeIdentityChange({ changed: true, previous: { label: '@same', id: '' } }, '@same');
  assert.equal(msg, '');
});

// ── Vercel env staleness ───────────────────────────────────────────────────

test('staleness reports checked:false with a reason when no token is set', async () => {
  const original = process.env.VERCEL_API_TOKEN;
  delete process.env.VERCEL_API_TOKEN;
  clearCache();
  try {
    const result = await findStaleEnvVars(['X_API_KEY']);
    assert.equal(result.checked, false);
    assert.match(result.reason, /VERCEL_API_TOKEN/);
    assert.deepEqual(result.stale, []);
  } finally {
    if (original === undefined) delete process.env.VERCEL_API_TOKEN;
    else process.env.VERCEL_API_TOKEN = original;
    clearCache();
  }
});

test('fetchEnvMetadata never throws without a token', async () => {
  const original = process.env.VERCEL_API_TOKEN;
  delete process.env.VERCEL_API_TOKEN;
  clearCache();
  try {
    const meta = await fetchEnvMetadata();
    assert.equal(meta.checked, false);
    assert.deepEqual(meta.vars, {});
  } finally {
    if (original === undefined) delete process.env.VERCEL_API_TOKEN;
    else process.env.VERCEL_API_TOKEN = original;
    clearCache();
  }
});

test('an empty name list is a valid check with nothing stale', async () => {
  const result = await findStaleEnvVars([]);
  // No names to check is not a failure; it just has no findings.
  assert.equal(Array.isArray(result.stale), true);
  assert.equal(result.stale.length, 0);
});

test('describeStaleEnvVars is empty unless something is actually stale', () => {
  assert.equal(describeStaleEnvVars(null), '');
  assert.equal(describeStaleEnvVars({ checked: true, stale: [] }), '');
  assert.equal(describeStaleEnvVars({ checked: false, stale: [{ name: 'A' }] }), '');
});

test('describeStaleEnvVars reads correctly for one and for many', () => {
  const one = describeStaleEnvVars({ checked: true, stale: [{ name: 'X_API_KEY' }] });
  assert.match(one, /X_API_KEY was edited in Vercel AFTER/);
  assert.match(one, /Redeploy/);

  const many = describeStaleEnvVars({
    checked: true,
    stale: [{ name: 'A_KEY' }, { name: 'B_KEY' }, { name: 'C_KEY' }],
  });
  assert.match(many, /A_KEY, B_KEY and C_KEY were edited/);
});
