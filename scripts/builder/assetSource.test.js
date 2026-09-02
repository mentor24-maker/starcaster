'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ASSET_SOURCE_ADMIN_MEDIA_MANAGER,
  normalizeAssetSource,
  isKnownAssetSource,
} = require('../../lib/assetSource');

/**
 * `assets.source` records WHICH SURFACE an upload came through. It is declared
 * by the client rather than stamped from the endpoint, because the two upload
 * endpoints the Assets screen uses (/api/assets/import-image and
 * /api/assets/upload-google-drive) are shared with the Builder and the asset
 * picker — stamping by endpoint would label a Builder upload as a Media
 * Manager one.
 *
 * Client-declared means the allowlist is the whole guard, so these tests are
 * mostly about what it must REFUSE.
 */

test('the Media Manager source survives a round trip', () => {
  assert.equal(normalizeAssetSource(ASSET_SOURCE_ADMIN_MEDIA_MANAGER), 'admin-media-manager');
  assert.equal(isKnownAssetSource(ASSET_SOURCE_ADMIN_MEDIA_MANAGER), true);
});

test('case and surrounding whitespace do not create a second variant', () => {
  // One typo'd variant makes the filter quietly incomplete: the row is stored,
  // the upload succeeds, and it never appears under the filter again.
  assert.equal(normalizeAssetSource('  Admin-Media-Manager  '), 'admin-media-manager');
  assert.equal(normalizeAssetSource('ADMIN-MEDIA-MANAGER'), 'admin-media-manager');
});

test('an unrecognised source normalizes to empty, never stored as-is', () => {
  for (const value of ['site-import', 'admin_media_manager', 'adminmediamanager', 'nonsense']) {
    assert.equal(normalizeAssetSource(value), '', `expected ${value} to be refused`);
    assert.equal(isKnownAssetSource(value), false);
  }
});

test('missing and malformed input mean "origin not recorded", not a crash', () => {
  for (const value of [undefined, null, '', '   ', 0, false, {}, []]) {
    assert.equal(normalizeAssetSource(value), '');
  }
});

test('empty is NOT a known source', () => {
  // Every row written before the column existed carries ''. If '' ever counted
  // as a known source, the Media Manager filter would claim all of them.
  assert.equal(isKnownAssetSource(''), false);
});

// ── The filter is applied ON TOP of the tenant scope, never instead of it ──

test('listAssets asks the tenant scope for its query before adding the source filter', async () => {
  const projectScope = require('../../lib/projectScope');
  const supabase = require('../../lib/supabase');

  const originalScoped = projectScope.scopedListQuery;
  const originalQuery = supabase.sbQuery;
  const seen = { scopedCalledWith: null, finalQuery: null };

  projectScope.scopedListQuery = async (table, query, scope) => {
    seen.scopedCalledWith = { table, query, scope };
    // Stand in for what the real scope adds.
    return `${query}&project_id=eq.${scope.projectId}`;
  };
  supabase.sbQuery = async ({ query }) => {
    seen.finalQuery = query;
    return { ok: true, status: 200, data: [] };
  };

  try {
    // Required fresh so the stubs above are the ones it closes over.
    delete require.cache[require.resolve('../../lib/assetsStore')];
    const { listAssets } = require('../../lib/assetsStore');

    await listAssets({ projectId: 'proj_1', userId: 'u1', projectIds: ['proj_1'] }, {
      source: ASSET_SOURCE_ADMIN_MEDIA_MANAGER,
    });

    assert.match(seen.scopedCalledWith.query, /source=eq\.admin-media-manager/);
    assert.match(seen.finalQuery, /project_id=eq\.proj_1/);
    assert.match(seen.finalQuery, /source=eq\.admin-media-manager/);

    // An unrecognised filter must widen back to the full (still scoped) list
    // rather than returning nothing — an empty result reads as "this project
    // has no assets", which is a far more confusing answer than ignoring it.
    await listAssets({ projectId: 'proj_1', userId: 'u1', projectIds: ['proj_1'] }, {
      source: 'not-a-real-source',
    });
    assert.doesNotMatch(seen.finalQuery, /source=eq\./);
    assert.match(seen.finalQuery, /project_id=eq\.proj_1/);
  } finally {
    projectScope.scopedListQuery = originalScoped;
    supabase.sbQuery = originalQuery;
    delete require.cache[require.resolve('../../lib/assetsStore')];
  }
});
