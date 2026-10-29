'use strict';

/**
 * Section and card surfaces (lib/site-import/surfaces.ts, task 86bce9wx3):
 * an imported section keeps its band's background and spacing, and a grid of
 * cards keeps each card's fill, border, corners, shadow and padding — on
 * daneofearth.org they all arrived as plain boxes on white.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');
const { mapSite, reportReconciles } = require('../../lib/site-import/dist/map.js');
const { planSectionGrid } = require('../../lib/site-import/dist/columns.js');
const {
  readSurface, readGradient, readGradientLayers, readGradientBackground, shadowPreset, keepCellFill,
} = require('../../lib/site-import/dist/surfaces.js');
const template = require('../../lib/builder/template.js');

/* ---------- a synthetic capture: band + 2x2 cards, a lone card, a photo band ---------- */

const BAND = {
  'background-color': 'rgb(238, 238, 238)',
  'padding-top': '60px', 'padding-bottom': '60px', 'padding-left': '40px', 'padding-right': '40px',
};
const CARD = {
  'background-color': 'rgb(255, 255, 255)',
  'border-radius': '12px',
  'box-shadow': 'rgba(0, 0, 0, 0.1) 0px 4px 16px 0px',
  'padding-top': '24px', 'padding-right': '24px', 'padding-bottom': '24px', 'padding-left': '24px',
  ...Object.fromEntries(['top', 'right', 'bottom', 'left'].flatMap((s) => [
    [`border-${s}-width`, '1px'], [`border-${s}-style`, 'solid'], [`border-${s}-color`, 'rgb(221, 221, 221)'],
  ])),
};
const TEXT = { color: 'rgb(51, 51, 51)', 'font-size': '16px' };

function capture() {
  const styles = {};
  const rects = {};
  const parts = [];
  let n = 0;
  const box = (tag, st, rect, inner, attrs = '') => {
    const key = String(n++);
    styles[key] = { ...TEXT, ...st };
    rects[key] = rect;
    return `<${tag} data-scim="${key}"${attrs}>${inner()}</${tag}>`;
  };
  const card = (x, y, letter) =>
    box('div', CARD, [x, y, 480, 200], () =>
      box('h3', {}, [x + 24, y + 24, 432, 30], () => `Card ${letter}`) +
      box('p', {}, [x + 24, y + 64, 432, 60], () => `About ${letter}.`), ' class="card"');

  parts.push(box('header', {}, [0, 0, 1200, 80], () => box('p', {}, [20, 20, 200, 30], () => 'Site name')));
  parts.push(box('section', BAND, [0, 100, 1200, 700], () =>
    box('h2', {}, [100, 160, 1000, 40], () => 'Our work') +
    box('div', {}, [100, 220, 1000, 440], () =>
      card(100, 220, 'A') + card(620, 220, 'B') + card(100, 460, 'C') + card(620, 460, 'D'))));
  parts.push(box('section', {}, [0, 860, 1200, 300], () =>
    box('div', CARD, [100, 880, 600, 200], () =>
      box('h2', {}, [124, 904, 552, 40], () => 'Solo card') +
      box('p', {}, [124, 954, 552, 60], () => 'On the page itself.'), ' class="card"') +
    box('p', {}, [100, 1100, 1000, 30], () => 'A line outside the card.')));
  parts.push(box('section', {
    'background-color': 'rgb(2, 27, 73)',
    'background-image': 'url("https://example.org/hero.jpg")',
    'padding-top': '200px',
  }, [0, 1200, 1200, 400], () =>
    box('span', { 'background-image': 'url("https://example.org/phone.png")', 'padding-left': '20px' },
      [100, 1400, 160, 24], () => box('p', {}, [120, 1400, 140, 24], () => '555-0100'))));

  return {
    url: 'https://example.org/', finalUrl: 'https://example.org/', viewport: 'desktop',
    html: `<html><body>${parts.join('')}</body></html>`,
    styles, rects, pageBackground: 'rgb(255, 255, 255)',
    fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
    assetUrls: [], fontFamilies: [],
    meta: { title: 'Example', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en' },
  };
}

const ASSETS = [
  {
    id: 'hero', originalUrl: 'https://example.org/hero.jpg', storageUrl: 'https://blob.example/hero.jpg',
    contentHash: '', mimeType: 'image/jpeg', byteSize: 1, altText: '', referencedBy: [], status: 'downloaded', error: '',
  },
];

function importIt(desktop = capture()) {
  const { ir } = normalizeSite({
    jobId: 'j', sourceUrl: 'https://example.org/', capturedAt: '', assets: ASSETS, pages: [{ desktop }],
  });
  const out = mapSite(ir, { existingSlugs: [] });
  return { ir, out, sections: out.pages[0].sections };
}

const holding = (sections, pattern) =>
  sections.find((s) => s.modules.some((m) => pattern.test(JSON.stringify(m.settings || {}) + (m.text || ''))));
const byTitle = (sections, title) => sections.filter((s) => s.title === `Imported: ${title}`);

/* ---------- normalize ---------- */

test('normalize records the painted boxes around each element, outermost first', () => {
  const { ir } = importIt();
  const band = ir.pages[0].sections[1];
  assert.ok(band.containers, 'the band section lists its containers');
  const cardText = band.elements.find((e) => e.textContent === 'Card A');
  assert.equal(cardText.containers.length, 2, 'band, then card');
  assert.equal(band.containers[cardText.containers[0]]['background-color'], 'rgb(238, 238, 238)');
  assert.equal(band.containers[cardText.containers[1]]['border-radius'], '12px');
  assert.equal(band.rootStyles['padding-top'], '60px');
});

test('a background picture on an icon-sized box is not recorded as a surface', () => {
  const { ir } = importIt();
  const photo = ir.pages[0].sections[3];
  const phone = photo.elements.find((e) => e.textContent === '555-0100');
  assert.equal(phone.containers.length, 1, 'only the band — the phone glyph box paints nothing usable');
  assert.match(photo.containers[phone.containers[0]]['background-image'], /hero\.jpg/);
});

/* ---------- map: bands ---------- */

test('a band keeps its colour and outer padding across every row it became', () => {
  const { sections, out } = importIt();
  const rows = [byTitle(sections, 'Our work')[0], ...byTitle(sections, 'Card A'), ...byTitle(sections, 'Card C')];
  assert.equal(rows.length, 3, 'heading row, then one row per pair of cards');
  for (const row of rows) assert.deepEqual([row.background.mode, row.background.color], ['color', '#eeeeee']);
  assert.equal(rows[0].paddingTop, '60');
  assert.equal(rows[0].paddingBottom, undefined, 'no gap inside the band');
  assert.equal(rows[2].paddingBottom, '60');
  assert.equal(rows[0].joinWithPrevious, undefined);
  assert.equal(rows[1].joinWithPrevious, true, 'later rows join the first, so the band reads as one');
  assert.equal(rows[2].joinWithPrevious, true);
  assert.ok(reportReconciles(out.report));
});

test('a band with a background photo uses the copied asset, and the run copies it', () => {
  const { sections, out } = importIt();
  const row = sections.find((s) => s.modules.some((m) => /555-0100/.test(m.text)));
  assert.equal(row.background.mode, 'image');
  assert.equal(row.background.imageUrl, 'https://blob.example/hero.jpg');
  assert.equal(row.background.color, '#021b49');
  assert.equal(row.paddingTop, '160', 'clamped to Builder\'s 160');
  assert.ok(out.copyPlan.assets.some((a) => a.assetId === 'hero'));
});

/* ---------- map: cards ---------- */

test('a 2x2 grid of cards is two rows of two, and every column wears its card', () => {
  const { sections } = importIt();
  const [ab] = byTitle(sections, 'Card A');
  const [cd] = byTitle(sections, 'Card C');
  for (const row of [ab, cd]) {
    assert.equal(row.layout, 'two-column');
    for (const col of ['left', 'right']) {
      assert.equal(row.cellBackgrounds[col].mode, 'color');
      assert.equal(row.cellBackgrounds[col].color, '#fffffe', 'white nudged so Builder keeps it');
      assert.equal(row.cellBorderWidth[col], '1');
      assert.equal(row.cellBorderColor[col], '#dddddd');
      assert.equal(row.cellBorderStyle[col], 'solid');
      assert.equal(row.cellBorderRadius[col], '12');
      assert.equal(row.cellShadow[col], 'medium');
      assert.equal(row.cellPaddingTop[col], '24');
      assert.equal(row.cellPaddingLeft[col], '24');
    }
  }
});

test('a white card on the white page keeps its frame and drops the fill that matches the theme', () => {
  const { sections } = importIt();
  const [card] = byTitle(sections, 'Solo card');
  assert.equal(card.cellBackgrounds, undefined);
  assert.equal(card.cellBorderWidth.main, '1');
  assert.equal(card.cellShadow.main, 'medium');
  assert.equal(card.background.mode, 'none', 'no band on this section');
  const outside = sections.find((s) => s.modules.some((m) => /outside the card/.test(m.text)));
  assert.notEqual(outside, card, 'the line outside the card is not poured into it');
  assert.equal(outside.cellBorderWidth, undefined);
});

test('Builder keeps every setting the import writes (read back through the server template)', () => {
  const { sections } = importIt();
  const saved = template.normalizeLayoutSections(
    sections.map(({ sourceElementIds, dispositions, ...s }) => s)
  );
  const ab = saved.find((s) => s.title === 'Imported: Card A');
  assert.equal(ab.joinWithPrevious, true);
  assert.deepEqual([ab.cellBackgrounds.left.mode, ab.cellBackgrounds.left.color], ['color', '#fffffe']);
  assert.equal(ab.cellBorderRadius.right, '12');
  assert.equal(ab.cellShadow.left, 'medium');
  assert.equal(ab.cellPaddingTop.left, '24');
  const work = saved.find((s) => s.title === 'Imported: Our work');
  assert.equal(work.paddingTop, '60');
  assert.equal(work.background.color, '#eeeeee');
  const photo = saved.find((s) => s.background.mode === 'image');
  assert.equal(photo.background.imageUrl, 'https://blob.example/hero.jpg');
});

test('the cell fills Builder wipes are the ones keepCellFill nudges (SYNC POINT)', () => {
  for (const color of ['#ffffff', '#eef6ff', '#f0fdf4']) {
    const cell = (c) => template.normalizeLayoutSections([{
      id: 's', title: '', layout: 'single', modules: [],
      cellBackgrounds: { main: { mode: 'color', color: c } },
    }])[0].cellBackgrounds.main;
    assert.equal(cell(color).mode, 'none', `${color} is wiped as-is`);
    assert.equal(cell(keepCellFill(color)).mode, 'color', `${color} survives once nudged`);
  }
  assert.equal(keepCellFill('#336699'), '#336699');
});

test('two plain bands in one wrapper stay two rows, each with its own colour', () => {
  // One wrapper, two full-width bands of single-column text and no cards —
  // nothing but the band itself keeps their rows apart.
  const styles = {
    0: {}, 1: { 'background-color': 'rgb(17, 34, 51)' }, 2: { color: 'rgb(0, 0, 0)' },
    3: { 'background-color': 'rgb(170, 187, 204)' }, 4: { color: 'rgb(0, 0, 0)' },
    5: {}, 6: { color: 'rgb(0, 0, 0)' },
  };
  const rects = {
    0: [0, 0, 1200, 400], 1: [0, 0, 1200, 200], 2: [100, 80, 1000, 40],
    3: [0, 200, 1200, 200], 4: [100, 280, 1000, 40], 5: [0, -60, 1200, 60], 6: [100, -40, 200, 20],
  };
  const desktop = {
    ...capture(),
    // The header beside it keeps the wrapper from being opened up into two
    // sections before the mapper ever sees it — a real page's shape.
    html: '<html><body><header data-scim="5"><p data-scim="6">Site</p></header>' +
      '<div data-scim="0"><div data-scim="1"><p data-scim="2">First band</p></div>' +
      '<div data-scim="3"><p data-scim="4">Second band</p></div></div></body></html>',
    styles, rects,
  };
  const { ir, sections } = importIt(desktop);
  assert.equal(ir.pages[0].sections.filter((x) => /First|Second/.test(JSON.stringify(x.elements))).length, 1,
    'both bands sit in ONE imported section, as on daneofearth.org');
  const first = holding(sections, /First band/);
  const second = holding(sections, /Second band/);
  assert.notEqual(first, second, 'the two bands are not poured into one row');
  assert.equal(first.background.color, '#112233');
  assert.equal(second.background.color, '#aabbcc');
  assert.equal(second.joinWithPrevious, undefined, 'a different band never joins');
});

test('a plain white page wrapper does not hide the coloured bands inside it', () => {
  // Divi (#main-content), Elementor and most WordPress themes paint their main
  // wrapper white. Round 2 of 86bce9wx3 took that wrapper as the band and
  // poured the real bands into single cells as fills.
  const pad = { 'padding-top': '54px', 'padding-bottom': '54px' };
  const styles = {
    0: { 'background-color': 'rgb(255, 255, 255)' },
    1: { 'background-color': 'rgb(6, 75, 109)', ...pad }, 2: { color: 'rgb(0, 0, 0)' },
    3: { 'background-color': 'rgb(238, 238, 238)', ...pad }, 4: { color: 'rgb(0, 0, 0)' },
    5: {}, 6: { color: 'rgb(0, 0, 0)' },
  };
  const rects = {
    0: [0, 0, 1200, 400], 1: [0, 0, 1200, 200], 2: [100, 80, 1000, 40],
    3: [0, 200, 1200, 200], 4: [100, 280, 1000, 40], 5: [0, -60, 1200, 60], 6: [100, -40, 200, 20],
  };
  const desktop = {
    ...capture(),
    html: '<html><body><header data-scim="5"><p data-scim="6">Site</p></header>' +
      '<div data-scim="0"><div data-scim="1"><p data-scim="2">Teal band</p></div>' +
      '<div data-scim="3"><p data-scim="4">Grey band</p></div></div></body></html>',
    styles, rects,
  };
  const { sections } = importIt(desktop);
  const teal = holding(sections, /Teal band/);
  const grey = holding(sections, /Grey band/);
  assert.notEqual(teal, grey);
  for (const [row, color] of [[teal, '#064b6d'], [grey, '#eeeeee']]) {
    assert.deepEqual([row.background.mode, row.background.color], ['color', color], `${color} is the row's background`);
    assert.deepEqual([row.paddingTop, row.paddingBottom], ['54', '54'], `${color} keeps its padding`);
    assert.equal(row.cellBackgrounds, undefined, `${color} is not a cell fill`);
  }
});

test('plain white sections with nothing coloured inside still keep their spacing', () => {
  // Divi pads each white section by 54px inside an unpainted wrapper. Skipping
  // them as bands must not lose that room when no coloured band sits inside
  // (eight Dane of Earth pages lost it in a first cut of round 3).
  const white = { 'background-color': 'rgb(255, 255, 255)', 'padding-top': '54px', 'padding-bottom': '54px' };
  const styles = {
    0: {}, 1: white, 2: { color: 'rgb(0, 0, 0)' }, 3: white, 4: { color: 'rgb(0, 0, 0)' },
    5: {}, 6: { color: 'rgb(0, 0, 0)' },
  };
  const rects = {
    0: [0, 0, 1200, 400], 1: [0, 0, 1200, 200], 2: [100, 80, 1000, 40],
    3: [0, 200, 1200, 200], 4: [100, 280, 1000, 40], 5: [0, -60, 1200, 60], 6: [100, -40, 200, 20],
  };
  const desktop = {
    ...capture(),
    html: '<html><body><header data-scim="5"><p data-scim="6">Site</p></header>' +
      '<div data-scim="0"><div data-scim="1"><p data-scim="2">First plain</p></div>' +
      '<div data-scim="3"><p data-scim="4">Second plain</p></div></div></body></html>',
    styles, rects,
  };
  const { sections } = importIt(desktop);
  for (const text of [/First plain/, /Second plain/]) {
    const row = holding(sections, text);
    assert.equal(row.background.mode, 'none', 'white on white shows nothing');
    assert.deepEqual([row.paddingTop, row.paddingBottom], ['54', '54'], `${text} keeps its room`);
  }
});

function whiteWrapperPage(first, second) {
  // The standard Divi shape: #main-content painted white with no padding,
  // each .et_pb_section inside it full width and padded 54px top and bottom.
  const pad = { 'padding-top': '54px', 'padding-bottom': '54px' };
  const styles = {
    0: { 'background-color': 'rgb(255, 255, 255)' },
    1: { 'background-color': first, ...pad }, 2: { color: 'rgb(0, 0, 0)' },
    3: { 'background-color': second, ...pad }, 4: { color: 'rgb(0, 0, 0)' },
    5: {}, 6: { color: 'rgb(0, 0, 0)' },
  };
  const rects = {
    0: [0, 0, 1200, 400], 1: [0, 0, 1200, 200], 2: [100, 80, 1000, 40],
    3: [0, 200, 1200, 200], 4: [100, 280, 1000, 40], 5: [0, -60, 1200, 60], 6: [100, -40, 200, 20],
  };
  return importIt({
    ...capture(),
    html: '<html><body><header data-scim="5"><p data-scim="6">Site</p></header>' +
      '<div data-scim="0"><div data-scim="1"><p data-scim="2">First section</p></div>' +
      '<div data-scim="3"><p data-scim="4">Second section</p></div></div></body></html>',
    styles, rects,
  }).sections;
}

test('a white page wrapper does not take the spacing of the white sections inside it', () => {
  // Round 3 of 86bce9wx3: with nothing coloured anywhere, the fallback took the
  // OUTERMOST plain box — Divi's unpadded white wrapper — and every white 54px
  // section arrived with no room at all.
  const sections = whiteWrapperPage('rgb(255, 255, 255)', 'rgb(255, 255, 255)');
  for (const text of [/First section/, /Second section/]) {
    const row = holding(sections, text);
    assert.equal(row.background.mode, 'none', 'white on white shows nothing');
    assert.deepEqual([row.paddingTop, row.paddingBottom], ['54', '54'], `${text} keeps its room`);
    assert.equal(row.cellBackgrounds, undefined, `${text} has no cell fill`);
  }
});

test('under a white wrapper, a coloured band and a plain white section each keep their spacing', () => {
  const sections = whiteWrapperPage('rgb(6, 75, 109)', 'rgb(255, 255, 255)');
  const teal = holding(sections, /First section/);
  const plain = holding(sections, /Second section/);
  assert.notEqual(teal, plain);
  assert.deepEqual([teal.background.mode, teal.background.color], ['color', '#064b6d'], 'teal is the row background');
  assert.deepEqual([teal.paddingTop, teal.paddingBottom], ['54', '54'], 'teal keeps its padding');
  assert.equal(teal.cellBackgrounds, undefined, 'teal is not a cell fill');
  assert.equal(plain.background.mode, 'none', 'white on white shows nothing');
  assert.deepEqual([plain.paddingTop, plain.paddingBottom], ['54', '54'], 'the white section keeps its padding');
});

test('a heading placed straight in a painted <body> takes no colour from above its section', () => {
  // The element IS its section root, so the walk from its parent never met the
  // root and climbed to <body> and <html> (round 2 of 86bce9wx3).
  const desktop = {
    ...capture(),
    html: '<html data-scim="0"><body data-scim="1"><h1 data-scim="2">Alone</h1></body></html>',
    styles: {
      0: { 'background-color': 'rgb(20, 20, 20)' },
      1: { 'background-color': 'rgb(240, 230, 200)' },
      2: { color: 'rgb(0, 0, 0)', 'font-size': '32px' },
    },
    rects: { 0: [0, 0, 1200, 800], 1: [0, 0, 1200, 800], 2: [100, 100, 1000, 40] },
  };
  const { ir, sections } = importIt(desktop);
  const el = ir.pages[0].sections.flatMap((s) => s.elements).find((e) => e.textContent === 'Alone');
  assert.equal(el.containers, undefined, 'no box above the section is recorded');
  const row = holding(sections, /Alone/);
  assert.equal(row.background.mode, 'none');
  assert.equal(row.cellBackgrounds, undefined);
});

/* ---------- the real thing: daneofearth.org's home page ---------- */

// A trimmed real capture (fixtures/daneofearth-home.json, its _source says
// what was cut). Its whole main area is ONE imported section holding six
// coloured bands one after another — the shape round 1 of this ticket missed,
// because it looked only for the one box every element shared, and there is
// none on a Divi/WordPress page.
function importDaneOfEarth() {
  const { desktop } = require('./fixtures/daneofearth-home.json');
  const { ir } = normalizeSite({
    jobId: 'j', sourceUrl: 'https://daneofearth.org/', capturedAt: '', assets: [], pages: [{ desktop }],
  });
  const out = mapSite(ir, { existingSlugs: [] });
  return { out, sections: out.pages[0].sections };
}


test('Dane of Earth: the hero band is a ROW background with the Oregon-from-space picture, across its rows', () => {
  const { sections } = importDaneOfEarth();
  const hero = holding(sections, /Tales from the Road Less Traveled/);
  assert.equal(hero.background.mode, 'image');
  assert.match(hero.background.imageUrl, /oregon_from_space/);
  assert.equal(hero.cellBackgrounds, undefined, 'not a single column\'s picture');
  assert.equal(hero.paddingTop, '99');
  const run = sections.filter((s) => /oregon_from_space/.test(s.background.imageUrl));
  assert.ok(run.length >= 2, 'the blog-post panel inside the hero is part of the same band');
  assert.ok(run.slice(1).every((s) => s.joinWithPrevious === true));
  assert.ok(sections.every((s) => !Object.values(s.cellBackgrounds || {}).some((b) => /oregon_from_space/.test(b.imageUrl))));
});

test('Dane of Earth: the 2x2 grid band is dark teal on every row it became', () => {
  const { sections } = importDaneOfEarth();
  const teal = sections.filter((s) => s.background.mode === 'color' && s.background.color === '#064b6d');
  assert.ok(teal.length >= 1, 'the grid band survives');
  const links = teal.flatMap((s) => s.sourceElementIds);
  assert.equal(links.length, 4, 'all four tiles of the grid sit on the teal band');
  assert.equal(teal[0].paddingTop, '54');
  assert.equal(teal[teal.length - 1].paddingBottom, '54');
});

test('Dane of Earth: the starfield band and the #222 footer are row backgrounds too', () => {
  const { sections } = importDaneOfEarth();
  const star = holding(sections, /Join me on the Adventure/);
  assert.equal(star.background.mode, 'image');
  assert.match(star.background.imageUrl, /background_starfield/);
  // Its credits line is dropped with the Footer Menu (task 86bchydp6); the
  // band itself, holding the social links, stays. Searched from the bottom:
  // the "Follow and Share" band links the same profile higher up.
  const footer = holding([...sections].reverse(), /facebook\.com\/daneofearth/);
  assert.deepEqual([footer.background.mode, footer.background.color], ['color', '#222222']);
  assert.equal(footer.cellBackgrounds, undefined, 'the footer is a band, not a column');
});

test('Dane of Earth: the two gradient bands import as gradients, see-through stops flattened onto white', () => {
  const { sections } = importDaneOfEarth();
  const follow = holding(sections, /Follow and Share Dane of Earth/);
  assert.deepEqual(
    [follow.background.mode, follow.background.color, follow.background.color2, follow.background.gradientAngle],
    ['gradient', '#9ad2f9', '#ffffff', 180]
  );
  const support = holding(sections, /Support Dane of Earth/);
  assert.deepEqual(
    [support.background.mode, support.background.color, support.background.color2],
    ['gradient', '#ffffff', '#9ea2d3']
  );
});

test('Dane of Earth: no two bands share a Builder row, and every band is joined only to itself', () => {
  const { sections, out } = importDaneOfEarth();
  const look = (s) => JSON.stringify(s.background);
  sections.forEach((s, i) => {
    if (s.joinWithPrevious) assert.equal(look(s), look(sections[i - 1]), `${s.title} joins a different band`);
  });
  const distinct = new Set(sections.filter((s) => s.background.mode !== 'none').map(look));
  assert.equal(distinct.size, 7, 'header, hero, follow, grid, support, starfield, footer');
  assert.ok(reportReconciles(out.report));
});

test('Builder keeps an imported gradient (read back through the server template)', () => {
  const { sections } = importDaneOfEarth();
  const saved = template.normalizeLayoutSections(sections.map(({ sourceElementIds, dispositions, ...s }) => s));
  const support = saved.find((s) => s.background.mode === 'gradient' && s.background.color2 === '#9ea2d3');
  assert.ok(support, 'the gradient survives normalization');
  assert.equal(support.background.color, '#ffffff');
  assert.equal(support.background.gradientAngle, 180);
});

/* ---------- captures without surfaces ---------- */

test('a capture with no positions and no painted boxes maps with no surface settings', () => {
  const desktop = capture();
  delete desktop.rects;
  delete desktop.pageBackground;
  for (const st of Object.values(desktop.styles)) {
    for (const prop of Object.keys(st)) if (prop !== 'color' && prop !== 'font-size') delete st[prop];
  }
  const { sections } = importIt(desktop);
  for (const s of sections) {
    assert.equal(s.background.mode, 'none');
    for (const key of Object.keys(s)) {
      assert.ok(!/^(cell|row|padding|joinWith)/.test(key), `${s.title} gained ${key}`);
    }
  }
});

test('without positions the cards cannot be told apart, so no column wears one — but the band still shows', () => {
  const desktop = capture();
  delete desktop.rects; // every capture made before 2026-10-06
  // Only cards in the band, so nothing but cards shares the one column.
  desktop.html = desktop.html.replace(/<h2 data-scim="\d+">Our work<\/h2>/, '');
  const { sections } = importIt(desktop);
  const band = sections.find((s) => s.modules.some((m) => /Card A/.test(m.text)));
  assert.equal(band.layout, 'single');
  assert.equal(band.background.color, '#eeeeee');
  assert.ok(!band.modules.some((m) => /Our work/.test(m.text)), 'the heading really is gone');
  assert.equal(band.cellBorderWidth, undefined, 'four cards share one column');
  assert.equal(band.cellBackgrounds, undefined);
});

/* ---------- the translators ---------- */

test('shadows read as light / medium / heavy by how far they spread', () => {
  assert.equal(shadowPreset('none'), '');
  assert.equal(shadowPreset('rgba(0, 0, 0, 0.08) 0px 2px 8px 0px'), 'light');
  assert.equal(shadowPreset('rgba(0, 0, 0, 0.14) 0px 6px 18px 0px'), 'medium');
  assert.equal(shadowPreset('rgba(3, 29, 62, 0.12) 0px 12px 30px 0px'), 'heavy');
  assert.equal(shadowPreset('rgba(0, 0, 0, 0) 0px 12px 30px 0px'), '', 'see-through');
  assert.equal(shadowPreset('rgb(0, 0, 0) 0px 1px 2px 0px inset'), '', 'inset');
  assert.equal(shadowPreset('rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgba(0, 0, 0, 0.2) 0px 20px 40px 0px'), 'heavy', 'the strongest of several');
});

test('a border is a frame only when all four sides draw one', () => {
  const ctx = { surface: '#ffffff', resolveImage: (u) => u, maxPadding: 50 };
  const divider = readSurface({
    'border-bottom-width': '6px', 'border-bottom-style': 'solid', 'border-bottom-color': 'rgb(59, 110, 161)',
  }, ctx);
  assert.equal(divider.border, undefined);
  const framed = readSurface(CARD, ctx);
  assert.deepEqual(framed.border, { width: '1', color: '#dddddd', style: 'solid' });
  assert.equal(framed.background, undefined, 'white on a white-surfaced theme stays unset');
  assert.equal(readSurface({ 'padding-top': '400px' }, ctx).padding.top, '50');
});

test('gradients read their first and last stops and their direction', () => {
  assert.deepEqual(readGradient('linear-gradient(rgb(154, 210, 249) 0%, rgb(255, 255, 255) 100%)', '#ffffff'),
    { color: '#9ad2f9', color2: '#ffffff', gradientAngle: 180 });
  assert.deepEqual(readGradient('linear-gradient(90deg, rgb(0, 0, 0), rgb(10, 20, 30) 50%, rgb(255, 0, 0))', '#ffffff'),
    { color: '#000000', color2: '#ff0000', gradientAngle: 90 });
  assert.equal(readGradient('linear-gradient(to left, rgb(0, 0, 0), rgb(255, 255, 255))', '#ffffff').gradientAngle, 270);
  assert.equal(readGradient('linear-gradient(rgb(255, 255, 255), rgba(0, 0, 0, 0.5))', '#000000').color2, '#000000',
    'a see-through stop shows the fill under it');
  assert.equal(readGradient('radial-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', '#ffffff'), null);
  assert.equal(readGradient('none', '#ffffff'), null);
});

/* ---------- layered gradients (task 86bctde1m) ---------- */

// Alphire's hero, as Chrome reported its computed background-image on 2026-10-27.
const ALPHIRE_HERO =
  'radial-gradient(circle at 80% 18%, rgba(0, 229, 255, 0.16) 0%, rgba(0, 0, 0, 0) 42%), ' +
  'radial-gradient(60% 50% at 50% 100%, rgba(124, 77, 255, 0.12), rgba(0, 0, 0, 0) 60%), ' +
  'linear-gradient(110deg, rgb(2, 3, 7) 0%, rgb(3, 10, 19) 46%, rgb(3, 17, 30) 100%)';

test('every gradient layer is kept, top first, with its stops and see-through colours', () => {
  const layers = readGradientLayers(ALPHIRE_HERO, '#ffffff');
  assert.equal(layers.length, 3);
  assert.deepEqual(layers.map((l) => l.kind), ['radial', 'radial', 'linear']);
  assert.deepEqual([layers[0].shape, layers[0].x, layers[0].y], ['circle', 80, 18]);
  assert.deepEqual(layers[0].stops, [
    { color: '#00e5ff', alpha: 16, position: 0 },
    { color: '#000000', alpha: 0, position: 42 },
  ]);
  assert.deepEqual([layers[1].shape, layers[1].size, layers[1].x, layers[1].y], ['ellipse', '60% 50%', 50, 100]);
  assert.equal(layers[1].stops[1].position, 60, 'a stop with no position is placed the way CSS places it');
  assert.equal(layers[2].angle, 110);
  assert.deepEqual(layers[2].stops.map((s) => [s.color, s.position]), [['#020307', 0], ['#030a13', 46], ['#03111e', 100]]);
});

test('only the BOTTOM layer is flattened onto the fill; the glows above keep their transparency', () => {
  const layers = readGradientLayers(
    'radial-gradient(rgba(255, 255, 255, 0.5), rgba(0, 0, 0, 0)), linear-gradient(rgba(0, 0, 0, 0.5), rgb(0, 0, 0))',
    '#ffffff'
  );
  assert.deepEqual(layers[0].stops.map((s) => s.alpha), [50, 0]);
  assert.deepEqual(layers[1].stops[0], { color: '#808080', alpha: 100, position: 0 });
});

test('layers the Builder cannot paint are left out, and the rest kept', () => {
  const layers = readGradientLayers('repeating-linear-gradient(rgb(255, 0, 0) 0%, rgb(0, 0, 255) 10%), url("x.png"), radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))', '#ffffff');
  assert.deepEqual(layers.map((l) => l.kind), ['radial']);
  assert.equal(readGradientLayers('none', '#ffffff'), null);
  assert.equal(readGradientLayers('repeating-radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))', '#ffffff'), null);
});

// Colours are rgb() throughout: a computed style never reports a colour by name.
test('positions and sizes in words read as the same box', () => {
  const [layer] = readGradientLayers('radial-gradient(closest-side at right top, rgb(255, 0, 0), rgb(0, 0, 255))', '#ffffff');
  assert.deepEqual([layer.size, layer.x, layer.y], ['closest-side', 100, 0]);
  const [circle] = readGradientLayers('radial-gradient(300px at 20% 30%, rgb(255, 0, 0), rgb(0, 0, 255))', '#ffffff');
  assert.deepEqual([circle.shape, circle.size], ['circle', '300px']);
});

test('a plain two-colour gradient imports exactly as it always did, with no layers', () => {
  const value = 'linear-gradient(rgb(154, 210, 249) 0%, rgb(255, 255, 255) 100%)';
  assert.deepEqual(readGradientBackground(value, '#ffffff'), readGradient(value, '#ffffff'));
  const seeThrough = 'linear-gradient(rgb(255, 255, 255), rgba(0, 0, 0, 0.5))';
  assert.deepEqual(readGradientBackground(seeThrough, '#000000'), readGradient(seeThrough, '#000000'));
});

test('a richer gradient carries its layers, with the two colours mirroring the bottom one', () => {
  const bg = readGradientBackground(ALPHIRE_HERO, '#020307');
  assert.deepEqual([bg.color, bg.color2, bg.gradientAngle], ['#020307', '#03111e', 110]);
  assert.equal(bg.gradientLayers.length, 3);
  const radialOnly = readGradientBackground('radial-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', '#ffffff');
  assert.deepEqual([radialOnly.color, radialOnly.color2, radialOnly.gradientLayers.length], ['#000000', '#ffffff', 1]);
});

test("Alphire's hero band imports with all three layers, and Builder keeps them on save", () => {
  const desktop = capture();
  const bandKey = Object.keys(desktop.styles).find((k) => desktop.styles[k]['background-color'] === 'rgb(238, 238, 238)');
  desktop.styles[bandKey] = { ...desktop.styles[bandKey], 'background-color': 'rgb(2, 3, 7)', 'background-image': ALPHIRE_HERO };
  const { sections } = importIt(desktop);
  const [hero] = byTitle(sections, 'Our work');
  assert.equal(hero.background.mode, 'gradient');
  assert.equal(hero.background.gradientLayers.length, 3);
  const saved = template.normalizeLayoutSections(sections.map(({ sourceElementIds, dispositions, ...s }) => s));
  const kept = saved.find((s) => s.id === hero.id);
  assert.deepEqual(kept.background.gradientLayers, hero.background.gradientLayers);
  const css = template.getBuilderBackgroundStyle(kept.background).backgroundImage;
  assert.equal((css.match(/radial-gradient\(/g) || []).length, 2);
  assert.match(css, /linear-gradient\(110deg, rgba\(2, 3, 7, 1\) 0%, rgba\(3, 10, 19, 1\) 46%/);
});

/* ---------- columns ---------- */

test('rows whose columns hold different cards do not merge; the same rows without cards still do', () => {
  const b = (x, y) => ({ x, y, w: 480, h: 200 });
  const plain = planSectionGrid([
    { id: 'a', box: b(0, 0) }, { id: 'b', box: b(520, 0) }, { id: 'c', box: b(0, 240) }, { id: 'd', box: b(520, 240) },
  ]);
  assert.equal(plain.bands.length, 1);
  const carded = planSectionGrid([
    { id: 'a', box: b(0, 0), group: 'A' }, { id: 'b', box: b(520, 0), group: 'B' },
    { id: 'c', box: b(0, 240), group: 'C' }, { id: 'd', box: b(520, 240), group: 'D' },
  ]);
  assert.equal(carded.bands.length, 2);
  assert.deepEqual([carded.cells.get('c').band, carded.cells.get('c').col], [1, 0]);
});

/* ---------- glows (task 86bctde3a) ---------- */

const { readGlow, buttonGlowSettings, imageGlowSettings } = require('../../lib/site-import/dist/surfaces.js');

// Alphire's buttons, verbatim from job simp_1791930973248_9arcy2's capture.
const ALPHIRE_BUTTON_GLOW = 'rgba(0, 217, 255, 0.18) 0px 0px 22px 0px, rgba(0, 217, 255, 0.04) 0px 0px 18px 0px inset';

test('a zero-offset coloured shadow reads as a glow — colour, reach and strength kept', () => {
  assert.deepEqual(readGlow(ALPHIRE_BUTTON_GLOW), { color: '#00d9ff', size: 22, strength: 18 });
  assert.deepEqual(readGlow('rgb(255, 41, 215) 0px 0px 24px 0px'), { color: '#ff29d7', size: 24, strength: 100 });
});

test('grey, offset, inner-only and absent shadows are not glows — they stay with the presets', () => {
  assert.equal(readGlow('rgba(0, 0, 0, 0.3) 0px 0px 18px 0px'), null); // grey
  assert.equal(readGlow('rgba(0, 217, 255, 0.5) 6px 6px 18px 0px'), null); // offset: a drop shadow
  assert.equal(readGlow('rgba(0, 217, 255, 0.5) 0px 0px 18px 0px inset'), null); // inner only
  assert.equal(readGlow('none'), null);
  assert.equal(readGlow(undefined), null);
  // The existing preset path is untouched by any of this.
  assert.equal(shadowPreset('rgba(0, 0, 0, 0.1) 0px 4px 16px 0px'), 'medium');
});

test('of several glows the furthest-reaching wins', () => {
  const two = 'rgba(0, 217, 255, 0.5) 0px 0px 8px 0px, rgba(255, 41, 215, 0.3) 0px 0px 40px 0px';
  assert.deepEqual(readGlow(two), { color: '#ff29d7', size: 40, strength: 30 });
});

test('a glow becomes Button Glow settings, and a picture\'s centred coloured shadow', () => {
  assert.deepEqual(buttonGlowSettings({ 'box-shadow': ALPHIRE_BUTTON_GLOW }), {
    buttonGlow: 'true', buttonGlowColor: '#00d9ff', buttonGlowSize: '22', buttonGlowStrength: '18',
  });
  // Alphire's hero haze is 100px; the picture's blur control stops at 80.
  assert.deepEqual(imageGlowSettings({ 'box-shadow': 'rgba(0, 217, 255, 0.15) 0px 0px 100px 0px' }), {
    imageShadow: 'true', imageShadowColor: '#00d9ff', imageShadowX: '0', imageShadowY: '0',
    imageShadowBlur: '80', imageShadowSpread: '0', imageShadowOpacity: '15',
  });
  assert.deepEqual(buttonGlowSettings({ 'box-shadow': 'rgba(0, 0, 0, 0.2) 0px 2px 4px 0px' }), {});
  assert.deepEqual(imageGlowSettings(undefined), {});
});
