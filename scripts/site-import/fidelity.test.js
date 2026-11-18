'use strict';

/**
 * The fidelity report's judgement (lib/site-import/fidelity.ts, task
 * 86bctde11): given a captured section and the Builder rows it became, which
 * captured styles did the import fail to reproduce — and where it could not
 * look, does it say CANNOT TELL rather than "nothing lost"?
 *
 * The fixtures copy the shapes of the Alphire import (2026-10-27): a hero
 * whose background was a gradient, a 300-weight heading the theme turned to
 * 700, a picture the stylesheet painted and the import never placed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const F = require('../../lib/site-import/dist/fidelity.js');

const GRADIENT = 'linear-gradient(110deg, rgb(2, 3, 7) 0%, rgb(3, 17, 30) 100%)';

function heroSection(extra = {}) {
  return {
    sourceId: '0-04c07a43',
    type: 'unknown',
    screenshot: 'https://blob.test/SiteImport/j/shots/home.desktop.s1.png',
    rootStyles: { 'background-image': GRADIENT },
    elements: [
      {
        sourceId: '0-d3f12ffd',
        class: 'heading',
        html: '<h1>Technology that amplifies human potential.</h1>',
        textContent: 'Technology that amplifies human potential.',
        textLength: 42,
        computedStyles: { 'font-weight': '300', color: 'rgb(245, 251, 255)' },
        documentPosition: 0,
        depth: 4,
        assetRefs: [],
        box: { x: 110, y: 380, w: 549, h: 110 },
      },
    ],
    ...extra,
  };
}

function row(extra = {}) {
  return {
    id: 'imps_004c07a43',
    layout: 'single',
    background: { mode: 'none', color: '#ffffff', color2: '', imageUrl: '' },
    modules: [{
      id: 'impm_0d3f12ffd_4',
      type: 'text',
      text: '<h1>Technology that amplifies human potential.</h1>',
      settings: { importSourceIds: '0-d3f12ffd', importSectionSourceId: '0-04c07a43' },
    }],
    ...extra,
  };
}

const THEME = { headingWeights: { h1: 700 }, headingColor: '#000000', textColor: '#000000', linkColor: '#ffffff' };
const find = (r, category) => r.findings.filter((f) => f.category === category);

/* ---------- acceptance criterion 2: a gradient the import dropped is listed ---------- */

test('a captured gradient with no gradient on the imported row is listed under Background', () => {
  const r = F.compareSection(heroSection(), { rows: [row()], theme: THEME });
  assert.equal(r.status, 'compared');
  const bg = find(r, 'background');
  assert.equal(bg.length, 1, JSON.stringify(r.findings, null, 2));
  assert.match(bg[0].what, /linear gradient/);
  assert.match(bg[0].imported, /no background/);
});

test('the same gradient reproduced on the imported row is NOT listed (the control)', () => {
  const r = F.compareSection(heroSection(), {
    rows: [row({ background: { mode: 'gradient', color: '#020307', color2: '#03111e', imageUrl: '' } })],
    theme: THEME,
  });
  assert.deepEqual(find(r, 'background'), []);
});

test('layered and radial backgrounds are listed even when a gradient survived — Builder keeps one linear', () => {
  const layered = heroSection({
    rootStyles: { 'background-image': `radial-gradient(circle at 78% 38%, rgba(0, 208, 255, 0.2), rgba(0, 0, 0, 0) 26%), ${GRADIENT}` },
  });
  const r = F.compareSection(layered, {
    rows: [row({ background: { mode: 'gradient', color: '#020307', color2: '#03111e', imageUrl: '' } })],
    theme: THEME,
  });
  const bg = find(r, 'background');
  assert.equal(bg.length, 1);
  assert.match(bg[0].what, /2 layered backgrounds \(radial gradient \+ linear gradient\)/);
});

test('a fill the page surface already paints is not a loss', () => {
  const s = heroSection({ rootStyles: { 'background-color': 'rgb(255, 255, 255)' } });
  assert.deepEqual(find(F.compareSection(s, { rows: [row()], theme: THEME, surfaceColors: ['#ffffff'] }), 'background'), []);
  const dark = heroSection({ rootStyles: { 'background-color': 'rgb(3, 5, 10)' } });
  assert.equal(find(F.compareSection(dark, { rows: [row()], theme: THEME, surfaceColors: ['#ffffff'] }), 'background').length, 1);
});

/* ---------- acceptance criterion 3, and the never-"no differences" rule ---------- */

test('a section no imported row carries is CANNOT TELL, with no findings claimed', () => {
  const r = F.compareSection(heroSection(), { rows: [row({ id: 'imps_somethingelse' })], theme: THEME });
  assert.equal(r.status, 'cannot-tell');
  assert.match(r.reason, /no imported row/);
  assert.deepEqual(r.findings, []);
});

test('decorative layers are always named as not measurable — the capture does not record them', () => {
  const r = F.compareSection(heroSection(), { rows: [row()], theme: THEME });
  assert.ok(r.notMeasured.some((n) => n.category === 'decorative' && /::before/.test(n.why)));
});

test('a page it could not photograph is CANNOT TELL, never compared', () => {
  const base = { builderPageId: '1543', builderPageFound: true, cameraError: '', sectionsWithRows: 6, photographed: 6 };
  assert.equal(F.pageVerdict(base).status, 'compared');
  const noCamera = F.pageVerdict({ ...base, cameraError: 'no app answered', photographed: 0 });
  assert.equal(noCamera.status, 'cannot-tell');
  assert.match(noCamera.reason, /not photographed/);
  assert.equal(F.pageVerdict({ ...base, photographed: 0 }).status, 'cannot-tell');
  assert.equal(F.pageVerdict({ ...base, builderPageFound: false }).status, 'cannot-tell');
  assert.equal(F.pageVerdict({ ...base, builderPageId: undefined }).status, 'cannot-tell');
  assert.equal(F.pageVerdict({ ...base, sectionsWithRows: 0, photographed: 0 }).status, 'cannot-tell');
});

/* ---------- the other categories ---------- */

test('a heading weight the theme overrode is listed, with what the import shows instead', () => {
  const text = find(F.compareSection(heroSection(), { rows: [row()], theme: THEME }), 'text');
  const weight = text.find((f) => /font weight 300/.test(f.what));
  assert.ok(weight, JSON.stringify(text, null, 2));
  assert.match(weight.imported, /700 \(the theme's h1\)/);
});

test('a weight carried inline in the imported HTML is not listed', () => {
  const inline = row();
  inline.modules[0].text = '<h1 style="font-weight: 300">Technology that amplifies human potential.</h1>';
  const text = find(F.compareSection(heroSection(), { rows: [inline], theme: THEME }), 'text');
  assert.ok(!text.some((f) => /font weight/.test(f.what)));
});

test('a coloured glow is listed under Shadows, and a circle under Shapes', () => {
  const s = heroSection({
    containers: {
      35: {
        'box-shadow': 'rgb(0, 217, 255) 0px 0px 24px 0px',
        'border-radius': '50%',
      },
    },
    containerBoxes: { 35: { x: 205, y: 1173, w: 54, h: 54 } },
  });
  const r = F.compareSection(s, { rows: [row()], theme: THEME });
  assert.match(find(r, 'shadow')[0].what, /coloured glow \(#00d9ff 0px 0px 24px\)/);
  assert.match(find(r, 'shape')[0].what, /1 circle/);
});

test('content in one half plus a busy other half that the import left empty is a lost column', () => {
  const sides = { original: { left: 6, right: 7 }, imported: { left: 5, right: 0.2 } };
  const lost = find(F.compareSection(heroSection(), { rows: [row()], theme: THEME, sides }), 'columns');
  assert.equal(lost.length, 1);
  assert.match(lost[0].imported, /stacked/);
  // The import shows something there too: not lost.
  const kept = { ...sides, imported: { left: 5, right: 6 } };
  assert.deepEqual(find(F.compareSection(heroSection(), { rows: [row()], theme: THEME, sides: kept }), 'columns'), []);
  // The original's other half is empty: a narrow text block, not a column.
  const calm = { ...sides, original: { left: 6, right: 0.3 } };
  assert.deepEqual(find(F.compareSection(heroSection(), { rows: [row()], theme: THEME, sides: calm }), 'columns'), []);
  // No screenshot reading: said, not guessed.
  const blind = F.compareSection(heroSection(), { rows: [row()], theme: THEME, sides: { original: null, imported: null } });
  assert.ok(blind.notMeasured.some((n) => n.category === 'columns'));
});

test('a downloaded picture the page never shows is listed; fonts, icons and placed files are not', () => {
  const asset = (id, url, mimeType = 'image/png') => ({
    id, originalUrl: url, storageUrl: `https://blob.test/SiteImport/j/assets/${id}.png`, contentHash: '', mimeType,
    byteSize: 1, altText: '', referencedBy: [{ pageUrl: 'https://alphire.agency/', sourceId: '' }], status: 'downloaded', error: '',
  });
  const assets = [
    asset('a1', 'https://alphire.agency/wp-content/uploads/2026/10/hero_banner.png'),
    asset('a2', 'https://alphire.agency/logo.png'),
    asset('a3', 'https://fonts.gstatic.com/s/opensans.woff2', 'font/woff2'),
    asset('a4', 'https://alphire.agency/cropped-favicon_512x512-32x32.png'),
  ];
  const pageJson = JSON.stringify({ layoutSections: [{ modules: [{ settings: { url: 'https://blob.test/SiteImportApplied/p/assets/a2.png' } }] }] });
  const out = F.unplacedAssets(assets, 'https://alphire.agency', pageJson);
  assert.deepEqual(out.map((o) => o.asset.id), ['a1']);
  assert.match(out[0].finding.what, /hero_banner\.png/);
});

test('edgeDensity tells a smooth gradient from a busy picture', () => {
  const w = 40;
  const h = 20;
  const gradient = Buffer.alloc(w * h * 3);
  const noisy = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      gradient.fill(Math.round((x / w) * 40), i, i + 3);
      noisy.fill((x + y) % 2 ? 230 : 20, i, i + 3);
    }
  }
  const smooth = F.sideBusyness({ data: gradient, width: w, height: h, channels: 3 });
  const busy = F.sideBusyness({ data: noisy, width: w, height: h, channels: 3 });
  assert.ok(smooth.left < F.BUSY_EDGE_THRESHOLD && smooth.right < F.BUSY_EDGE_THRESHOLD, JSON.stringify(smooth));
  assert.ok(busy.left > F.BUSY_EDGE_THRESHOLD && busy.right > F.BUSY_EDGE_THRESHOLD, JSON.stringify(busy));
});

test('rowsForSection takes the first row and its band rows, nothing else', () => {
  const rows = [{ id: 'imps_004c07a43' }, { id: 'imps_004c07a43b1' }, { id: 'imps_004c07a43x' }, { id: 'imps_004c07a431' }];
  assert.deepEqual(F.rowsForSection('0-04c07a43', rows).map((r) => r.id), ['imps_004c07a43', 'imps_004c07a43b1']);
});

test('a glow the import carried onto a Button is not reported as lost (86bctde3a)', () => {
  const s = heroSection({
    elements: [{
      sourceId: '0-b1', class: 'button', html: '<button>Go</button>', textContent: 'Go', textLength: 2,
      computedStyles: { 'box-shadow': 'rgba(0, 217, 255, 0.18) 0px 0px 22px 0px, rgba(0, 217, 255, 0.04) 0px 0px 18px 0px inset' },
      documentPosition: 0, depth: 4, assetRefs: [], box: { x: 0, y: 0, w: 148, h: 54 },
    }],
  });
  const lostRow = row({ modules: [{ id: 'm', type: 'button', text: 'Go', settings: {} }] });
  assert.equal(find(F.compareSection(s, { rows: [lostRow], theme: THEME }), 'shadow').length, 1);
  const keptRow = row({ modules: [{ id: 'm', type: 'button', text: 'Go', settings: { buttonGlow: 'true', buttonGlowColor: '#00d9ff' } }] });
  assert.equal(find(F.compareSection(s, { rows: [keptRow], theme: THEME }), 'shadow').length, 0);
});

/* ---------------------------------------------------------------------------
 * Links (task SC-855). Bayside, 2026-11-17: the imported Top Menu jumped to
 * #services, #about and #contact, no section carried those names, and the
 * report run that evening had no category to say so in.
 * ------------------------------------------------------------------------ */

const linkEl = (sourceId, text, href, cls = 'link') => ({
  sourceId, class: cls, html: `<a href="${href}">${text}</a>`, textContent: text,
  textLength: text.length, computedStyles: {}, documentPosition: 0, depth: 1, assetRefs: [],
});

function baysideOriginal() {
  return {
    sections: [
      { sourceId: 'hdr', type: 'unknown', screenshot: '', elements: [
        linkEl('l1', 'Services', '#services'),
        linkEl('l2', 'About', '#about'),
        linkEl('l3', 'Contact', '#contact'),
        linkEl('l4', 'Pool Care Guide', 'https://baysidepools.example/pool-care-guide/'),
      ] },
      { sourceId: 'hero', type: 'unknown', screenshot: '', elements: [
        linkEl('b1', 'Get a quote', 'https://baysidepools.example/contact/', 'button'),
      ] },
    ],
  };
}

function baysideRows() {
  return [
    { id: 'impmenu_top_x', title: 'Top Menu', modules: [{ type: 'navigation', settings: { navItems: JSON.stringify([
      { id: 'n1', label: 'Services', href: '#services' },
      { id: 'n2', label: 'About', href: '#about' },
      { id: 'n3', label: 'Contact', href: '#contact' },
      { id: 'n4', label: 'More', href: '#' },
    ]) } }] },
    { id: 'imps_hero', title: 'Hero', modules: [
      { type: 'button', text: 'Get a quote', settings: { href: '/contact' } },
      { type: 'text', text: '<p>See our <a href="/pool-care-guide">care guide</a>.</p>' },
    ] },
    { id: 'imps_svc', title: 'Services', modules: [] },
  ];
}

const linkWhats = (out) => out.findings.map((f) => [f.what, f.imported]);

test('Links: the three dead menu jumps are named, the links that came across are not', () => {
  const out = F.linkFindings(baysideOriginal(), baysideRows(), { pageUrl: 'https://baysidepools.example/' });
  assert.deepEqual(linkWhats(out), [
    ['1 link(s) that jump to part of a page: "Services" (Top Menu)', 'jumps to #services, and nothing on the page has that name'],
    ['1 link(s) that jump to part of a page: "About" (Top Menu)', 'jumps to #about, and nothing on the page has that name'],
    ['1 link(s) that jump to part of a page: "Contact" (Top Menu)', 'jumps to #contact, and nothing on the page has that name'],
  ]);
  assert.deepEqual(out.notMeasured, []);
  assert.equal(F.countByCategory(out.findings).links, 3);
});

test('Links: once the sections carry the names, the jumps land', () => {
  const rows = baysideRows();
  rows[2].anchorName = 'services';
  rows[1].modules.push({ type: 'text', text: '<h2 id="about">About</h2><div id="contact"></div>' });
  assert.deepEqual(F.linkFindings(baysideOriginal(), rows, { pageUrl: 'https://baysidepools.example/' }).findings, []);
});

test('Links: a link the original had and the import lost is named', () => {
  const rows = baysideRows();
  rows[1].modules.pop(); // the care-guide link is gone
  const out = F.linkFindings(baysideOriginal(), rows, { pageUrl: 'https://baysidepools.example/' });
  const missing = out.findings.filter((f) => /the original page had/.test(f.what));
  assert.deepEqual(missing.map((f) => [f.what, f.imported]), [
    ['1 link(s) the original page had: "Pool Care Guide" → https://baysidepools.example/pool-care-guide/', 'no link with those words or that destination'],
  ]);
});

test('Links: a jump to another page is checked there, and is CANNOT TELL when that page was not read', () => {
  const rows = baysideRows();
  rows[1].modules.push(
    { type: 'button', text: 'Our team', settings: { href: '/about#team' } },
    { type: 'button', text: 'Their FAQ', settings: { href: 'page:77#sec-faq|/faq#faq' } },
  );
  const about = { id: 5, slug: 'about', layoutSections: [{ id: 's', anchorName: 'staff', modules: [] }] };
  const out = F.linkFindings({ sections: [] }, rows, { pages: [about] });
  assert.ok(out.findings.some((f) => /"Our team" \(Hero\)/.test(f.what) && /#team, and nothing on the page/.test(f.imported)));
  assert.deepEqual(out.notMeasured.map((n) => n.category), ['links']);
  assert.match(out.notMeasured[0].why, /^1 link\(s\) jump to part of a page this report did not read.*"Their FAQ" → page:77#sec-faq/);
  about.layoutSections[0].anchorName = 'team';
  assert.ok(!F.linkFindings({ sections: [] }, rows, { pages: [about] }).findings.some((f) => /Our team/.test(f.what)));
});

test('Links is one of the categories, so its count is reported even when zero', () => {
  assert.ok(F.FIDELITY_CATEGORIES.some((c) => c.key === 'links'));
  assert.equal(F.countByCategory([]).links, 0);
});
