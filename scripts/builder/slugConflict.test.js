'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldRetryWithoutPublishColumns,
  describeSlugConflict,
} = require('../../lib/builderPagesStore');

/**
 * A duplicate page address must FAIL, never be quietly written as a NULL slug.
 *
 * The store carries a schema-compat fallback: if an insert fails because the
 * deployment's table has no `slug`/`is_published` column, it retries with those
 * columns dropped rather than failing the whole save. The test for that was the
 * error message containing the word "slug" — and a duplicate-key violation
 * names the column too, so it matched. The retry then inserted the page with no
 * slug at all, which the database stores as NULL.
 *
 * That is not a cosmetic difference. The public site picks the root page by
 * ranking the empty slug first and `home` second, and a NULL slug reads as
 * empty — so the orphan outranks the real home page. On 2026-08-15 a Bulk
 * Create whose "Home" menu item collided with the existing home page produced
 * exactly that: delraytennis.starcaster.pro started serving an empty template
 * skeleton, with every page's content still perfectly intact in the database.
 *
 * Both directions matter here. The first test is the bug; the second is the
 * schema-compat behaviour that has to keep working, since deleting the fallback
 * outright would break deployments that genuinely lack the columns.
 */

test('a duplicate slug is NOT retried without the slug column', () => {
  const duplicate = {
    ok: false,
    status: 409,
    error: 'duplicate key value violates unique constraint "builder_landing_page_project_id_slug_key"',
  };
  assert.equal(
    shouldRetryWithoutPublishColumns(duplicate),
    false,
    'retrying strips the slug and writes NULL, which takes over the site root'
  );
});

test('the bare Postgres code for a unique violation is caught too', () => {
  assert.equal(
    shouldRetryWithoutPublishColumns({ ok: false, error: 'error 23505 on slug' }),
    false
  );
});

test('a genuinely missing column still retries', () => {
  const missing = {
    ok: false,
    status: 400,
    error: "column builder_landing_page.slug does not exist",
  };
  assert.equal(
    shouldRetryWithoutPublishColumns(missing),
    true,
    'schema-compat fallback must survive: older deployments lack the column'
  );

  assert.equal(
    shouldRetryWithoutPublishColumns({ ok: false, error: 'column "is_published" does not exist' }),
    true
  );
});

test('a duplicate slug is reported in words, with the address that clashed', () => {
  const res = describeSlugConflict(
    { ok: false, status: 409, error: 'duplicate key value violates unique constraint "x_slug_key"' },
    { slug: 'court-fees' }
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.code, 'slug_taken');
  assert.match(res.error, /court-fees/);
  assert.doesNotMatch(res.error, /duplicate key/, 'raw Postgres text should not reach the operator');
});

test('unrelated failures pass through untouched', () => {
  const other = { ok: false, status: 500, error: 'connection reset' };
  assert.equal(describeSlugConflict(other, { slug: 'about' }), other);
});
