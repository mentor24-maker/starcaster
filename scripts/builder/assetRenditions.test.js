'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  planRenditions,
  classifyImage,
  isOversizedImage,
  shouldBuildForSource,
  renditionKeyForAsset,
  renditionStoragePath,
  generateRenditionBuffers,
} = require(path.join(__dirname, '..', '..', 'lib', 'assetRenditions'));
const { normalizeRenditions } = require(path.join(__dirname, '..', '..', 'lib', 'assetsStore'));

const widthsOf = (plan) => plan.filter((r) => r.format === 'webp').map((r) => r.width);
const socialOf = (plan) => plan.find((r) => r.role === 'social');

test('a wide original gets the full ladder plus its own width on top', () => {
  const plan = planRenditions(1536);
  assert.deepStrictEqual(widthsOf(plan), [300, 600, 1200, 1536]);
  assert.strictEqual(plan.find((r) => r.role === 'full').width, 1536);
  assert.strictEqual(socialOf(plan).width, 1200);
});

test('nothing is ever enlarged', () => {
  // The tall AI images: 1024 wide, 1536 high. A 1200 rung would be an upscale.
  const plan = planRenditions(1024);
  assert.deepStrictEqual(widthsOf(plan), [300, 600, 1024]);
  assert.ok(widthsOf(plan).every((w) => w <= 1024));
  // The social copy shrinks to the original rather than inventing pixels.
  assert.strictEqual(socialOf(plan).width, 1024);
});

test('the top rung is always present, so a page never falls back to the original', () => {
  for (const source of [640, 1024, 1201, 1536, 1920, 4000]) {
    const plan = planRenditions(source);
    const full = plan.find((r) => r.role === 'full');
    assert.ok(full, `no full rung for a ${source}px source`);
    assert.strictEqual(full.width, Math.min(source, 1920));
    assert.strictEqual(Math.max(...widthsOf(plan)), full.width);
  }
});

test('an enormous upload is capped rather than copied at full size', () => {
  assert.deepStrictEqual(widthsOf(planRenditions(4000)), [300, 600, 1200, 1920]);
});

test('a width that collides with a ladder rung is not emitted twice', () => {
  const plan = planRenditions(1200);
  assert.deepStrictEqual(widthsOf(plan), [300, 600, 1200]);
  assert.strictEqual(plan.filter((r) => r.width === 1200 && r.format === 'webp').length, 1);
});

test('an image with no width plans nothing rather than guessing', () => {
  assert.deepStrictEqual(planRenditions(0), []);
});

test('oversized picks the big images and leaves the small ones alone', () => {
  const image = (extra) => ({ assetType: 'Image', location: 'https://example.com/a.png', ...extra });

  assert.ok(isOversizedImage(image({ imageWidth: 1536, imageHeight: 1024, size: 2400000 })));
  assert.ok(isOversizedImage(image({ imageWidth: 1024, imageHeight: 1536, size: 2400000 })), 'tall counts too');
  assert.ok(!isOversizedImage(image({ imageWidth: 800, imageHeight: 600, size: 900000 })), 'small but heavy: not worth a 1200 rung');
  // The 188 rows with no recorded dimensions fall back to file size.
  assert.ok(isOversizedImage(image({ size: 900000 })));
  assert.ok(!isOversizedImage(image({ size: 40000 })));
  assert.ok(!isOversizedImage({ assetType: 'Video', location: 'https://example.com/a.mp4', size: 9000000 }));
  assert.ok(!isOversizedImage(image({ location: '', size: 9000000 })), 'nothing to download');
});

test('storage paths are stable, so a re-run overwrites instead of piling up', () => {
  const previousRoot = process.env.BLOB_ASSETS_ROOT;
  process.env.BLOB_ASSETS_ROOT = 'APP/Assets';
  try {
    const key = renditionKeyForAsset({ location: 'https://cdn.example.com/APP/Assets/Image/1753248000000_Foo.png' });
    assert.strictEqual(renditionStoragePath(key, { width: 600, format: 'webp', role: 'web' }),
      `APP/Assets/Renditions/${key}/w600.webp`);
    assert.strictEqual(renditionStoragePath(key, { width: 1200, format: 'jpeg', role: 'social' }),
      `APP/Assets/Renditions/${key}/social-w1200.jpg`);
    assert.ok(key.startsWith('1753248000000_Foo-'), `key should stay readable, got ${key}`);
  } finally {
    if (previousRoot === undefined) delete process.env.BLOB_ASSETS_ROOT;
    else process.env.BLOB_ASSETS_ROOT = previousRoot;
  }
});

test('the rendition key follows the file, not the database row', () => {
  const location = 'https://cdn.example.com/APP/Assets/Image/1753248000000_Foo.png';

  // Local asset 5 and live asset 5 are different pictures in the one shared
  // Blob store; only the file may decide the path.
  assert.strictEqual(
    renditionKeyForAsset({ id: 5, location }),
    renditionKeyForAsset({ id: 991, location }),
    'the same file must land in the same folder whatever its row id'
  );

  // The library holds the same PNG under two ids — one set of copies serves both.
  assert.strictEqual(
    renditionKeyForAsset({ id: 248, location }),
    renditionKeyForAsset({ id: 310, location })
  );

  // Two different files never collide, even when the file names match.
  assert.notStrictEqual(
    renditionKeyForAsset({ location: 'https://a.example.com/photos/hero.png' }),
    renditionKeyForAsset({ location: 'https://b.example.com/photos/hero.png' })
  );

  assert.strictEqual(renditionKeyForAsset({ location: '' }), '');
  assert.strictEqual(renditionKeyForAsset({}), '');
  // A name that sanitises away entirely still gets a usable folder.
  assert.ok(renditionKeyForAsset({ location: 'https://example.com/%20%20/' }).length > 0);
});

test('half-written rendition rows are dropped rather than served', () => {
  const cleaned = normalizeRenditions([
    { w: 600, h: 400, format: 'webp', bytes: 51200, url: 'https://cdn/w600.webp' },
    { w: 300, h: 200, format: 'webp', bytes: 20480, url: 'https://cdn/w300.webp' },
    { w: 1200, url: '' },
    { url: 'https://cdn/unknown.webp' },
    null,
    'nope',
  ]);
  assert.deepStrictEqual(cleaned.map((r) => r.w), [300, 600], 'sorted smallest first, junk removed');
  assert.deepStrictEqual(normalizeRenditions(undefined), []);
  assert.deepStrictEqual(normalizeRenditions('[]'), []);
});

test('real pixels: a wide PNG becomes the ladder, and every rung is smaller than the original', async () => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return; // sharp is a dependency; if it is genuinely absent the library errors loudly elsewhere.
  }

  const source = await sharp({
    create: { width: 1536, height: 1024, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .png()
    .toBuffer();

  const result = await generateRenditionBuffers(source);
  assert.ok(result.ok, result.error);
  assert.deepStrictEqual(result.data.map((r) => r.width), [300, 600, 1200, 1536, 1200]);
  assert.strictEqual(result.data.at(-1).format, 'jpeg');
  assert.strictEqual(result.data.at(-1).role, 'social');

  // Aspect ratio survives.
  for (const rung of result.data) {
    assert.strictEqual(Math.round((rung.width / rung.height) * 100), Math.round((1536 / 1024) * 100));
  }
  // The point of the exercise: the top rung beats the original PNG on bytes.
  const full = result.data.find((r) => r.role === 'full');
  assert.ok(full.buffer.length < source.length, 'the full rung should be smaller than the original PNG');
});

test('a transparent PNG keeps its alpha in webp and lands on white in the social jpeg', async () => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return;
  }

  const source = await sharp({
    create: { width: 1400, height: 1400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();

  const result = await generateRenditionBuffers(source);
  assert.ok(result.ok, result.error);

  const webp = result.data.find((r) => r.format === 'webp');
  assert.ok((await sharp(webp.buffer).metadata()).hasAlpha, 'webp should keep transparency');

  const social = result.data.find((r) => r.role === 'social');
  const { data } = await sharp(social.buffer).raw().toBuffer({ resolveWithObject: true });
  // Black would mean the flatten background was left at its default.
  assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240, 'transparent areas should flatten to white, not black');
});

test('an image the library never measured is "unknown", not "small"', () => {
  const image = (extra) => ({ assetType: 'Image', location: 'https://example.com/a.png', ...extra });

  // The site importer stores images with no dimensions AND size 0. Reading that
  // as "small" skipped a 2.7 MB, 1994px-wide PNG and left the Delray home page
  // serving full-size originals after a completed sweep (2026-08-12).
  assert.strictEqual(classifyImage(image({ size: 0 })), 'unknown');
  assert.strictEqual(classifyImage(image({})), 'unknown');
  assert.ok(isOversizedImage(image({ size: 0 })), 'unmeasured images must still be looked at');

  // A recorded measurement is trusted, in both directions.
  assert.strictEqual(classifyImage(image({ imageWidth: 800, imageHeight: 600, size: 0 })), 'no');
  assert.strictEqual(classifyImage(image({ imageWidth: 1994, imageHeight: 789 })), 'yes');
  assert.strictEqual(classifyImage(image({ size: 900000 })), 'yes');

  // Things that are not images, or have nothing to fetch, are still excluded.
  assert.strictEqual(classifyImage({ assetType: 'Video', location: 'https://e.com/v.mp4' }), 'no');
  assert.strictEqual(classifyImage(image({ location: '' })), 'no');
});

test('the verdict after downloading uses the real pixels, not the stored ones', () => {
  // The Delray case: stored as 0x0 and 0 bytes, actually 1994x789 and 2.7 MB.
  assert.ok(shouldBuildForSource({ width: 1994, height: 789, bytes: 2739 * 1024 }));
  // Tall images count on their long edge.
  assert.ok(shouldBuildForSource({ width: 989, height: 1280, bytes: 883 * 1024 }));
  // Small pixels but a heavy file is still worth re-encoding.
  assert.ok(shouldBuildForSource({ width: 960, height: 379, bytes: 900 * 1024 }));
  // Genuinely small: no copies, and the caller records the measurement so this
  // image is never downloaded again.
  assert.ok(!shouldBuildForSource({ width: 960, height: 379, bytes: 99 * 1024 }));
  assert.ok(!shouldBuildForSource({ width: 0, height: 0, bytes: 0 }));
});
