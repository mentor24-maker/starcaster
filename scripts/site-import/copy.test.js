'use strict';

/**
 * scripts/lib/site_import_copy.mjs — one image the origin refuses must not
 * stop a whole site from being built (task 86bct8t95, alphire.agency
 * 2026-10-27), and a failure writing to OUR storage must still stop it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/site_import_copy.mjs');

test('an asset the origin refuses is skipped and named; the rest are copied', async () => {
  const { copyPromotedAssets, SourceUnreachableError } = await load();
  const copy = async (from, to) => {
    if (from.includes('hubspot')) throw new SourceUnreachableError(`HTTP 403 copying ${from}`);
    return `https://blob.test/${to}`;
  };
  const urlMap = new Map();
  const skipped = await copyPromotedAssets([
    { assetId: 'a1', fromUrl: 'https://blob.test/job/a1.png' },
    { assetId: 'a2', fromUrl: 'https://no-cache.hubspot.com/cta/x.png' },
    { assetId: 'a3', fromUrl: 'https://blob.test/job/a3.jpg' },
  ], copy, 'SiteImportApplied/p1', urlMap);

  assert.equal(urlMap.size, 2);
  assert.equal(urlMap.get('https://blob.test/job/a3.jpg'), 'https://blob.test/SiteImportApplied/p1/assets/a3.jpg');
  assert.deepEqual(skipped.map((s) => s.assetId), ['a2']);
  assert.match(skipped[0].reason, /403/);
});

test('a failure writing to our own storage still stops the run', async () => {
  const { copyPromotedAssets } = await load();
  const copy = async () => { throw new Error('Blob copy to SiteImportApplied/p1/assets/a1.png: 500'); };
  await assert.rejects(
    copyPromotedAssets([{ assetId: 'a1', fromUrl: 'https://blob.test/job/a1.png' }], copy, 'SiteImportApplied/p1', new Map()),
    /Blob copy/,
  );
});
