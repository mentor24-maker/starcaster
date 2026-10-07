'use strict';

/**
 * Small pictures keep their size through Site Import (task 86bcebvg9).
 *
 * Every imported picture is Width 100% of its column. The image module never
 * draws a picture larger than its FILE, so this only bit pictures whose file
 * has more pixels than the source page showed: Dane of Earth's Substack,
 * Medium and Patreon wordmarks are 1600px files shown at about 150px, and
 * arrived filling the column. The importer now records the shown width as the
 * module's Max Width (`maxWidthPx`) — for small pictures only, so a photo that
 * filled its column on the source still fills it here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapSite } = require('../../lib/site-import/dist/map.js');
const { serializeBuilderDocument } = require('../../lib/builder/document.js');

const MAP_OPTS = { existingSlugs: [] };
const box = (x, y, w, h) => ({ x, y, w, h });

function el(sourceId, cls, html, extra = {}) {
  return {
    sourceId,
    class: cls,
    html,
    textContent: cls === 'image' ? '' : html.replace(/<[^>]+>/g, ''),
    textLength: 0,
    computedStyles: {},
    documentPosition: 0,
    depth: 3,
    assetRefs: [],
    ...extra,
  };
}

function irOf(elements, { assets = [], styleSummary } = {}) {
  return {
    irVersion: '1.0',
    jobId: 'job-image-size',
    sourceUrl: 'https://pics.test/',
    capturedAt: '2026-10-07T00:00:00.000Z',
    assets,
    taxonomy: { navs: [], pageOrder: ['/'] },
    pages: [{
      url: 'https://pics.test/',
      path: '/',
      title: 'Pictures',
      metaDescription: '',
      ogTags: {},
      canonicalUrl: '',
      lang: 'en',
      screenshots: { desktop: '', tablet: '', mobile: '' },
      sections: [{ sourceId: '0-sec', type: 'unknown', screenshot: '', elements }],
    }],
    tokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
    coverage: {},
    ...(styleSummary ? { styleSummary } : {}),
  };
}

const imagesOf = (out) =>
  out.pages.flatMap((p) => p.sections.flatMap((s) => s.modules)).filter((m) => m.type === 'image');

const asset = (id, url, width) => ({
  id, originalUrl: url, storageUrl: '', contentHash: '', mimeType: 'image/png', byteSize: 1,
  ...(width ? { width, height: Math.round(width / 5) } : {}),
  altText: '', referencedBy: [], status: 'downloaded', error: '',
});

test('the Delray footer Facebook icon (24px on the source page) is not imported at full width', () => {
  // The real element from the delraytennis.com reference capture. On main it
  // is still a `link` (a linked picture was dropped until task 86bcebrwp,
  // PR #780, taught normalize to call it an image); this test feeds it to the
  // mapper as the image it is, so it holds before and after that lands.
  const { ir } = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'wordpress.expected.json'), 'utf8')
  );
  const source = ir.pages
    .flatMap((p) => p.sections.flatMap((s) => s.elements))
    .find((e) => e.html.includes('facebook_11.png'));
  assert.ok(source, 'the Facebook icon is in the Delray fixture');
  assert.match(source.html, /width="24"/);

  const out = mapSite(irOf([{ ...source, class: 'image' }]), MAP_OPTS);
  const [icon] = imagesOf(out);
  assert.equal(icon.settings.size, '100');
  assert.equal(icon.settings.maxWidthPx, '24');
});

test('a 1600px wordmark shown at 150px keeps its 150px', () => {
  const url = 'https://pics.test/substack_wordmark.png';
  const out = mapSite(irOf([
    el('0-p', 'text', '<p>Read me on Substack, Medium and Patreon, every week.</p>', { box: box(0, 0, 1000, 40) }),
    el('0-w', 'image', `<img src="${url}" alt="Substack">`, { box: box(0, 60, 150, 26), assetRefs: ['a1'] }),
  ], { assets: [asset('a1', url, 1600)] }), MAP_OPTS);
  const [wordmark] = imagesOf(out);
  assert.equal(wordmark.settings.maxWidthPx, '150');
});

test('a photo that filled its column still fills it — no cap', () => {
  const out = mapSite(irOf([
    el('0-p', 'text', '<p>About the club, and what we do here.</p>', { box: box(0, 0, 1000, 40) }),
    el('0-a', 'image', '<img src="https://pics.test/courts.jpg">', { box: box(0, 60, 1000, 600) }),
  ]), MAP_OPTS);
  assert.equal(imagesOf(out)[0].settings.maxWidthPx, undefined);
});

test('the 1103px flyer (no positions, declared width only) is untouched', () => {
  const out = mapSite(irOf([
    el('0-f', 'image', '<img src="https://pics.test/flyer.png" width="1103" height="1400">'),
  ]), MAP_OPTS);
  const [flyer] = imagesOf(out);
  assert.equal(flyer.settings.size, '100');
  assert.equal(flyer.settings.maxWidthPx, undefined);
});

test('a picture whose file is no bigger than it was shown gets no setting (the module already holds it there)', () => {
  const url = 'https://pics.test/badge.png';
  const out = mapSite(irOf([
    el('0-b', 'image', `<img src="${url}" width="40">`, { assetRefs: ['a1'] }),
  ], { assets: [asset('a1', url, 40)] }), MAP_OPTS);
  assert.equal(imagesOf(out)[0].settings.maxWidthPx, undefined);
});

test('a linked icon whose anchor is a full-width block still reads as 24px', () => {
  // The box of a linked picture is the anchor's; the <img> width says 24.
  const out = mapSite(irOf([
    el('0-p', 'text', '<p>Follow us for court news and events.</p>', { box: box(0, 0, 1000, 40) }),
    el('0-i', 'image', '<a href="https://social.test/"><img src="https://pics.test/fb.png" width="24" height="24"></a>', {
      box: box(0, 60, 1000, 24),
    }),
  ]), MAP_OPTS);
  assert.equal(imagesOf(out)[0].settings.maxWidthPx, '24');
});

test('in a side-by-side row, "small" is measured against the picture\'s own column', () => {
  const row = (logoWidth) => irOf([
    el('0-l1', 'image', '<img src="https://pics.test/logo.png">', { box: box(0, 0, logoWidth, 80) }),
    el('0-l2', 'text', '<p>A spacer the width of the column, beside nothing.</p>', { box: box(0, 100, 300, 40) }),
    el('0-r', 'text', '<p>The right-hand column of copy, which is long.</p>', { box: box(340, 0, 660, 300) }),
  ]);
  // 120px in a 300px column is small; 200px in it is not.
  assert.equal(imagesOf(mapSite(row(120), MAP_OPTS))[0].settings.maxWidthPx, '120');
  assert.equal(imagesOf(mapSite(row(200), MAP_OPTS))[0].settings.maxWidthPx, undefined);
});

test('a section holding only a logo is judged against the site\'s content width, not the logo', () => {
  const ir = irOf(
    [el('0-logo', 'image', '<img src="https://pics.test/logo.png">', { box: box(400, 0, 200, 60) })],
    { styleSummary: { pageBackgrounds: [], backgroundsByArea: [], headerBackgrounds: [], buttons: [], contentWidths: [{ value: '1000', count: 9 }] } }
  );
  assert.equal(imagesOf(mapSite(ir, MAP_OPTS))[0].settings.maxWidthPx, '200');
});

test('a layout table\'s small pictures are capped by their declared width', () => {
  const out = mapSite(irOf([
    el('0-t', 'table', '<table><tr><td><img src="https://pics.test/a.png" width="120"></td><td><img src="https://pics.test/b.png" width="900"></td></tr></table>'),
  ]), MAP_OPTS);
  assert.deepEqual(imagesOf(out).map((m) => m.settings.maxWidthPx), ['120', undefined]);
});

test('Max Width survives the Builder\'s own normalization', () => {
  const out = mapSite(irOf([
    el('0-i', 'image', '<img src="https://pics.test/fb.png" width="24">'),
  ]), MAP_OPTS);
  const doc = serializeBuilderDocument({ layoutSections: out.pages[0].sections });
  const image = doc.sections.flatMap((s) => s.modules).find((m) => m.type === 'image');
  assert.equal(image.settings.maxWidthPx, '24');
});
