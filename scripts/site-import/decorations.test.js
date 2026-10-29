'use strict';

/**
 * Decorative layers (task 86bctde48): the ::before/::after layers a capture
 * records travel through the normalizer onto the right section, with browser
 * defaults dropped and painted pictures joined to the asset manifest — and
 * the fidelity report lists each one instead of saying CANNOT TELL.
 *
 * The capture itself runs in a browser, which CI does not have; the browser
 * half is scripts/site-import/smoke_capture.mjs. These fixtures copy what
 * that capture recorded on alphire.agency on 2026-10-29: a starfield of
 * radial-gradient dots and a glowing ring on the hero, a cyan line on the
 * hero picture, and the same dark fade on four work cards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite, decorationStyles } = require('../../lib/site-import/dist/normalize.js');
const F = require('../../lib/site-import/dist/fidelity.js');

/** Every painting property as a real capture records it — defaults included,
 *  because the capture keeps what the browser says and normalize drops it. */
function computed(over = {}) {
  const base = {
    content: '""',
    'background-color': 'rgba(0, 0, 0, 0)',
    'background-image': 'none',
    'background-size': 'auto',
    'background-position': '0% 0%',
    'background-repeat': 'repeat',
    'border-radius': '0px',
    'box-shadow': 'none',
    opacity: '1',
    filter: 'none',
    'mix-blend-mode': 'normal',
    transform: 'none',
  };
  for (const side of ['top', 'right', 'bottom', 'left']) {
    base[`border-${side}-width`] = '0px';
    base[`border-${side}-style`] = 'none';
    base[`border-${side}-color`] = 'rgb(255, 255, 255)';
  }
  return { ...base, ...over };
}

function ring(colour) {
  const out = { 'border-radius': '50%', 'box-shadow': `${colour} 0px 0px 40px 0px` };
  for (const side of ['top', 'right', 'bottom', 'left']) {
    out[`border-${side}-width`] = '1px';
    out[`border-${side}-style`] = 'solid';
    out[`border-${side}-color`] = colour;
  }
  return out;
}

const STARS = [
  'radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.8) 0px, rgba(0, 0, 0, 0) 1.5px)',
  'radial-gradient(circle at 72% 18%, rgba(143, 231, 255, 0.8) 0px, rgba(0, 0, 0, 0) 1.5px)',
  'radial-gradient(circle at 40% 70%, rgba(255, 255, 255, 0.6) 0px, rgba(0, 0, 0, 0) 1px)',
].join(', ');

const HTML =
  '<body><div data-scim="0" class="wrap">' +
  '<section data-scim="1" class="alphire-hero"><h1 data-scim="2">Technology</h1>' +
  '<div data-scim="3" class="alphire-hero-visual"><p data-scim="4">Visual</p></div></section>' +
  '<section data-scim="5" class="work"><p data-scim="6">Work</p></section>' +
  '</div></body>';

function capture(decorations) {
  return {
    url: 'https://alphire.test/',
    finalUrl: 'https://alphire.test/',
    viewport: 'desktop',
    html: HTML,
    styles: {},
    rects: {},
    ...(decorations === undefined ? {} : { decorations }),
    fullPageScreenshot: '',
    sectionScreenshots: {},
    elementScreenshots: {},
    assetUrls: [],
    fontFamilies: [],
    meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
  };
}

const DECORATIONS = [
  { owner: '1', pseudo: 'before', label: 'section.alphire-hero', box: [0, 0, 1440, 900], boxFrom: 'offsets', zIndex: '-1',
    styles: computed({ 'background-image': STARS, 'background-size': '400px 400px' }) },
  { owner: '1', pseudo: 'after', label: 'section.alphire-hero', box: [776, 72, 837, 837], boxFrom: 'offsets', zIndex: '-1',
    styles: computed(ring('rgba(0, 229, 255, 0.35)')) },
  // 1px tall, rotated 17°: the box it paints over is wide AND tall.
  { owner: '3', pseudo: 'after', label: 'div.alphire-hero-visual', box: [745, 349, 664, 204], size: [694, 1], boxFrom: 'offsets', zIndex: 'auto',
    styles: computed({ 'background-image': 'linear-gradient(90deg, rgba(0, 0, 0, 0), rgb(0, 217, 255), rgba(0, 0, 0, 0))',
      transform: 'matrix(0.956305, -0.292372, 0.292372, 0.956305, 0, 0)' }) },
  { owner: '5', pseudo: 'after', label: 'section.work', box: [0, 1000, 1440, 300], boxFrom: 'owner', zIndex: 'auto',
    styles: computed({ 'background-image': 'url("https://alphire.test/img/stars.png")' }) },
  { owner: '0', pseudo: 'before', label: 'div.wrap', box: [0, 0, 1440, 2000], boxFrom: 'offsets', zIndex: '-2',
    styles: computed({ 'background-color': 'rgb(3, 5, 10)' }) },
];

const ASSET = {
  id: 'asset-stars', originalUrl: 'https://alphire.test/img/stars.png', storageUrl: '', contentHash: '',
  mimeType: 'image/png', byteSize: 1, altText: '', referencedBy: [{ pageUrl: 'https://alphire.test/', sourceId: '' }],
  status: 'downloaded', error: '',
};

function normalize(decorations, assets = []) {
  return normalizeSite({
    jobId: 'j', sourceUrl: 'https://alphire.test/', capturedAt: '2026-10-29T00:00:00.000Z',
    assets, pages: [{ desktop: capture(decorations) }],
  }).ir;
}

/* ---------- the normalizer ---------- */

test('each decoration lands on the section holding its owner, with its box', () => {
  const ir = normalize(DECORATIONS, [ASSET]);
  const [hero, work] = ir.pages[0].sections;
  assert.deepEqual(hero.decorations.map((d) => `${d.owner}::${d.pseudo}`),
    ['section.alphire-hero::before', 'section.alphire-hero::after', 'div.alphire-hero-visual::after']);
  assert.deepEqual(hero.decorations[1].box, { x: 776, y: 72, w: 837, h: 837 });
  assert.deepEqual(hero.decorations[2].size, { w: 694, h: 1 }, 'the line keeps its own size beside its rotated box');
  assert.deepEqual(hero.decorations[1].size, { w: 837, h: 837 }, 'a capture with no size falls back to the box');
  assert.equal(hero.decorations[0].onSectionRoot, true);
  assert.equal(hero.decorations[2].onSectionRoot, false, 'the hero picture is inside the section, not its root');
  assert.equal(hero.decorations[0].zIndex, '-1');
  assert.deepEqual(work.decorations.map((d) => d.owner), ['section.work']);
  assert.equal(work.decorations[0].boxFrom, 'owner');
});

test('a decoration whose owner is outside every section is kept on the page, not dropped', () => {
  const ir = normalize(DECORATIONS);
  assert.deepEqual(ir.pages[0].decorations.map((d) => d.owner), ['div.wrap']);
});

test('browser defaults are dropped; what paints is kept', () => {
  const ir = normalize(DECORATIONS);
  const [stars, ringDeco] = ir.pages[0].sections[0].decorations;
  assert.deepEqual(Object.keys(stars.styles).sort(), ['background-image', 'background-size']);
  assert.equal(ringDeco.styles['border-radius'], '50%');
  assert.match(ringDeco.styles['box-shadow'], /0, 229, 255/);
  assert.equal(ringDeco.styles['border-top-width'], '1px');
  assert.ok(!('content' in ringDeco.styles), 'an empty content string is not a picture');
  assert.ok(!('opacity' in ringDeco.styles) && !('transform' in ringDeco.styles));
});

test('a picture a decoration paints is joined to the downloaded asset', () => {
  const ir = normalize(DECORATIONS, [ASSET]);
  assert.deepEqual(ir.pages[0].sections[1].decorations[0].assetRefs, ['asset-stars']);
  assert.deepEqual(ir.pages[0].sections[0].decorations[0].assetRefs, [], 'gradients are not files');
});

test('an older capture leaves the field ABSENT — not an empty list', () => {
  const old = normalize(undefined);
  assert.ok(old.pages[0].sections.every((s) => !('decorations' in s)));
  assert.ok(!('decorations' in old.pages[0]));
  const none = normalize([]);
  assert.ok(none.pages[0].sections.every((s) => Array.isArray(s.decorations) && s.decorations.length === 0),
    'a capture that looked and found nothing says so with an empty list');
});

test('decorationStyles keeps a content picture and drops content text', () => {
  assert.equal(decorationStyles(computed({ content: 'url("https://x.test/a.png")' })).content, 'url("https://x.test/a.png")');
  assert.ok(!('content' in decorationStyles(computed({ content: '"★"', 'background-color': 'rgb(1, 2, 3)' }))));
});

/* ---------- the fidelity report ---------- */

function sectionFor(decorations) {
  const ir = normalize(decorations);
  return ir.pages[0].sections[0];
}
const ROW = { layout: '1', modules: [] };
function compare(section) {
  return F.compareSection(section, { rows: [{ ...ROW, id: `imps_${section.sourceId.replace(/[^a-zA-Z0-9]+/g, '')}` }], theme: null });
}

test('the Alphire hero lists three decorative layers: starfield dots, a glowing ring, a cyan line', () => {
  const r = compare(sectionFor(DECORATIONS));
  const listed = r.findings.filter((f) => f.category === 'decorative');
  assert.equal(listed.length, 3);
  assert.match(listed[0].what, /pattern of 3 dots \(radial gradients\) tiled every 400px 400px/);
  assert.match(listed[0].what, /section\.alphire-hero::before, 1440×900 at \(0, 0\)/);
  assert.match(listed[1].what, /a ring in #00e5ff with a #00e5ff glow/);
  assert.match(listed[2].what, /a gradient line in #00d9ff/);
  assert.ok(listed.every((f) => /does not rebuild/.test(f.imported)));
  assert.ok(!r.notMeasured.some((n) => n.category === 'decorative'), 'measured, so not CANNOT TELL');
});

test('identical layers on repeated cards read as one line with a count', () => {
  const fade = { 'background-image': 'linear-gradient(0deg, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0) 60%)' };
  const cards = [606, 788, 969, 1151].map((x) => ({
    owner: '3', pseudo: 'after', label: 'div.alphire-work-card', box: [x, 2563, 179, 360], boxFrom: 'offsets', zIndex: 'auto',
    styles: computed(fade),
  }));
  const listed = F.decorationFindings(sectionFor(cards).decorations);
  assert.equal(listed.length, 1);
  assert.match(listed[0].what, /4 copies: 179×360 at \(606, 2563\)/);
});

test('a capture that looked and found none reports nothing lost — and is not CANNOT TELL', () => {
  const r = compare(sectionFor([]));
  assert.deepEqual(r.findings.filter((f) => f.category === 'decorative'), []);
  assert.ok(!r.notMeasured.some((n) => n.category === 'decorative'));
});

test('an older capture is still CANNOT TELL for decorative layers', () => {
  const r = compare(sectionFor(undefined));
  assert.ok(r.notMeasured.some((n) => n.category === 'decorative' && /re-import/.test(n.why)));
});
