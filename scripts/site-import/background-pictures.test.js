'use strict';

/**
 * An empty box whose only content is a background picture imports as an
 * Image module in its place (task 86bctde3p). Before this, normalize walked
 * the box as a wrapper and emitted nothing, so its picture matched no
 * element: Alphire's hero banner was downloaded with `sourceId: ""` and never
 * placed or promoted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite, countCapturedByClass } = require('../../lib/site-import/dist/normalize.js');
const { mapSite } = require('../../lib/site-import/dist/map.js');

const HERO = 'https://site.test/images/hero_banner.png';
const ASSET = {
  id: 'a-hero', originalUrl: HERO, storageUrl: 'SiteImport/j/assets/hero_banner.png',
  contentHash: 'h', mimeType: 'image/png', byteSize: 1, altText: '',
  referencedBy: [{ pageUrl: 'https://site.test/', sourceId: '' }], status: 'downloaded', error: '',
};

/** One page: a heading, then the box under test (data-scim "2"). */
function capture(boxStyles, boxRect = [720, 100, 600, 400], inner = '') {
  return {
    jobId: 'j', sourceUrl: 'https://site.test/', capturedAt: '', assets: [ASSET],
    pages: [{
      desktop: {
        url: 'https://site.test/', finalUrl: 'https://site.test/', viewport: 'desktop',
        html: '<html><body><main data-scim="0"><section data-scim="1"><h1 data-scim="3">Alphire</h1>' +
          `<div class="hero-art" data-scim="2">${inner}</div></section></main></body></html>`,
        styles: { 0: {}, 1: {}, 2: boxStyles, 3: { 'font-size': '48px' } },
        rects: { 0: [0, 0, 1440, 600], 1: [0, 0, 1440, 600], 2: boxRect, 3: [80, 100, 600, 60] },
        fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
        assetUrls: [{ url: HERO, via: 'css-background', elementKey: '2' }],
        fontFamilies: [], meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
      },
    }],
  };
}

const PICTURE = {
  'background-image': `url("${HERO}")`,
  'background-size': 'cover',
  'background-position': '50% 50%',
};

function elementsOf(ir) {
  return ir.pages[0].sections.flatMap((s) => s.elements);
}

test('an empty box painting a picture becomes one image element carrying the asset', () => {
  const { ir, coverage } = normalizeSite(capture(PICTURE));
  const images = elementsOf(ir).filter((e) => e.class === 'image');
  assert.equal(images.length, 1, JSON.stringify(elementsOf(ir)));
  const [img] = images;
  assert.deepEqual(img.assetRefs, ['a-hero']);
  assert.deepEqual(img.backgroundImage, { size: 'cover', position: '50% 50%' });
  assert.deepEqual(img.box, { x: 720, y: 100, w: 600, h: 400 });
  // Where it is used is now known, so the asset is no longer orphaned.
  assert.deepEqual(ir.assets[0].referencedBy, [{ pageUrl: 'https://site.test/', sourceId: img.sourceId }]);
  // Both counters see it — completeness, not a phantom extra.
  assert.equal(coverage.captured.image, 1);
  assert.equal(coverage.emitted.image, 1);
  assert.deepEqual(coverage.dropped, {});
});

test('the mapper places it as an Image module, after the heading, and promotes the asset', () => {
  const out = mapSite(normalizeSite(capture(PICTURE)).ir, { existingSlugs: [] });
  const modules = out.pages[0].sections.flatMap((s) => s.modules || []);
  const image = modules.find((m) => m.type === 'image');
  assert.ok(image, JSON.stringify(modules));
  assert.equal(image.settings.url, ASSET.storageUrl);
  const order = modules.map((m) => m.type);
  assert.ok(order.indexOf('image') > order.indexOf('text'), `the picture keeps its place after the heading: ${order}`);
  assert.ok(out.copyPlan.assets.some((a) => a.assetId === 'a-hero' || a.id === 'a-hero' || JSON.stringify(a).includes('a-hero')),
    'the picture is promoted into the project');
  assert.equal(out.report.assets.promoted, 1);
});

test('an empty box with no picture still yields nothing — no blank modules', () => {
  const { ir, coverage } = normalizeSite(capture({ 'background-color': 'rgb(0, 0, 0)' }));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'image'));
  assert.equal(coverage.captured.image, undefined);
  const modules = mapSite(ir, { existingSlugs: [] }).pages[0].sections.flatMap((s) => s.modules || []);
  assert.ok(!modules.some((m) => m.type === 'image'));
});

test('a gradient alone is not a picture', () => {
  const { ir } = normalizeSite(capture({ 'background-image': 'linear-gradient(red, blue)' }));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'image'));
});

test('a picture smaller than 40x40 is an icon, not content', () => {
  const { ir } = normalizeSite(capture(PICTURE, [720, 100, 24, 24]));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'image'));
});

test('a box with content keeps being a wrapper — its words are not swallowed', () => {
  const { ir } = normalizeSite(capture(PICTURE, undefined, '<span>Launch faster</span>'));
  const els = elementsOf(ir);
  assert.ok(!els.some((e) => e.class === 'image'));
  assert.ok(els.some((e) => e.textContent === 'Launch faster'));
});

test('raw HTML alone (no styles) counts no picture, as before', () => {
  assert.deepEqual(countCapturedByClass(capture(PICTURE).pages[0].desktop.html), { heading: 1 });
});
