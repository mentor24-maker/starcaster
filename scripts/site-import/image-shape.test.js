'use strict';

/**
 * Imported pictures keep their shape (task 86bctde2b).
 *
 * The Image module could only round its corners in whole pixels, so Site
 * Import had nowhere to put a circle or the organic blob alphire.agency draws
 * its hero picture as (`border-radius: 50% 45% 52% 48% / 48% 52% 48% 52%`),
 * and it never read a picture's radius at all — which also meant every square
 * picture arrived with the module's 18px default corners. The importer now
 * carries the browser's computed radius into the module's Shape.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { mapSite, importedImageShape } = require('../../lib/site-import/dist/map.js');
const { serializeBuilderDocument } = require('../../lib/builder/document.js');

const MAP_OPTS = { existingSlugs: [] };
const ALPHIRE_BLOB = '50% 45% 52% 48% / 48% 52% 48% 52%';

function el(sourceId, html, extra = {}) {
  return {
    sourceId,
    class: 'image',
    html,
    textContent: '',
    textLength: 0,
    computedStyles: {},
    documentPosition: 0,
    depth: 3,
    assetRefs: [],
    ...extra,
  };
}

function irOf(elements, sectionExtra = {}) {
  return {
    irVersion: '1.0',
    jobId: 'job-image-shape',
    sourceUrl: 'https://shapes.test/',
    capturedAt: '2026-10-28T00:00:00.000Z',
    assets: [],
    taxonomy: { navs: [], pageOrder: ['/'] },
    pages: [{
      url: 'https://shapes.test/',
      path: '/',
      title: 'Shapes',
      metaDescription: '',
      ogTags: {},
      canonicalUrl: '',
      lang: 'en',
      screenshots: { desktop: '', tablet: '', mobile: '' },
      sections: [{ sourceId: '0-sec', type: 'unknown', screenshot: '', elements, ...sectionExtra }],
    }],
    tokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
    coverage: {},
  };
}

/** Map, then round-trip through the SERVER normalizer, so a key the saved
 *  page would drop fails here rather than on a live import. */
function savedImage(elements, sectionExtra) {
  const out = mapSite(irOf(elements, sectionExtra), MAP_OPTS);
  const doc = serializeBuilderDocument({ layoutSections: out.pages[0].sections });
  return doc.sections.flatMap((s) => s.modules).find((m) => m.type === 'image');
}

test('the Alphire hero blob arrives as a Custom shape with its elliptical radii', () => {
  const image = savedImage([
    el('0-hero', '<img src="https://shapes.test/hero.png">', {
      computedStyles: { 'border-radius': ALPHIRE_BLOB },
      box: { x: 700, y: 120, w: 560, h: 520 },
    }),
  ]);
  assert.equal(image.settings.imageShape, 'custom');
  assert.equal(image.settings.imageShapeRadii, ALPHIRE_BLOB);
});

test('a picture whose wrapper is its frame takes the wrapper\'s shape', () => {
  // `.frame { border-radius: 50%; overflow: hidden }` around a square <img>:
  // the radius is on the box, not the picture.
  const image = savedImage(
    [el('0-face', '<img src="https://shapes.test/face.png">', {
      box: { x: 100, y: 100, w: 200, h: 200 },
      containers: ['card', 'frame'],
    })],
    {
      containers: {
        card: { 'border-radius': '12px', 'background-color': 'rgb(255, 255, 255)' },
        frame: { 'border-radius': '50%', 'box-shadow': 'rgb(0, 255, 255) 0px 0px 30px 0px' },
      },
      containerBoxes: {
        card: { x: 60, y: 60, w: 600, h: 400 },
        frame: { x: 98, y: 98, w: 204, h: 204 },
      },
    }
  );
  assert.equal(image.settings.imageShape, 'circle');
});

test('a card the picture merely sits in does not lend it its corners', () => {
  const image = savedImage(
    [el('0-pic', '<img src="https://shapes.test/pic.png">', {
      box: { x: 100, y: 100, w: 300, h: 200 },
      containers: ['card'],
    })],
    {
      containers: { card: { 'border-radius': '24px', 'background-color': 'rgb(255, 255, 255)' } },
      containerBoxes: { card: { x: 60, y: 60, w: 600, h: 500 } },
    }
  );
  assert.equal(image.settings.imageShape, undefined);
  assert.equal(image.settings.borderRadius, '0');
});

test('a square-cornered picture stays square instead of taking the 18px default', () => {
  const image = savedImage([el('0-sq', '<img src="https://shapes.test/sq.png">', { box: { x: 0, y: 0, w: 300, h: 200 } })]);
  assert.equal(image.settings.borderRadius, '0');
  assert.equal(image.settings.imageShape, undefined);
});

test('importedImageShape: each kind of computed radius', () => {
  const landscape = { w: 300, h: 200 };
  const square = { w: 200, h: 200 };
  assert.deepEqual(importedImageShape('', landscape), { borderRadius: '0' });
  assert.deepEqual(importedImageShape('0px', landscape), { borderRadius: '0' });
  assert.deepEqual(importedImageShape('12px', landscape), { borderRadius: '12' });
  assert.deepEqual(importedImageShape('12.6px', landscape), { borderRadius: '13' });
  assert.deepEqual(importedImageShape('50%', square), { imageShape: 'circle' });
  assert.deepEqual(importedImageShape('100px', square), { imageShape: 'circle' });
  // 50% of a landscape box is an oval — Custom, not a squashed Circle.
  assert.deepEqual(importedImageShape('50%', landscape), { imageShape: 'custom', imageShapeRadii: '50%' });
  // A pill: fully rounded ends on a wide box.
  assert.deepEqual(importedImageShape('9999px', landscape), { imageShape: 'custom', imageShapeRadii: '9999px' });
  assert.deepEqual(importedImageShape('12px 0px 0px 12px', landscape), {
    imageShape: 'custom', imageShapeRadii: '12px 0px 0px 12px',
  });
  assert.deepEqual(importedImageShape(ALPHIRE_BLOB, landscape), { imageShape: 'custom', imageShapeRadii: ALPHIRE_BLOB });
  // Something the module cannot draw leaves the default alone rather than guess.
  assert.deepEqual(importedImageShape('calc(10px + 2em)', landscape), {});
});
