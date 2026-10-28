'use strict';

/**
 * The import theme (lib/site-import/theme.ts, task 86bce9wx0): an imported
 * site arrives in its own fonts, colours and button style, as a new theme
 * named after it that becomes the project default.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveImportTheme, nextThemeName, siteNameFromUrl, guardPaletteReadability, uncoveredPaletteRoles } = require('../../lib/site-import/dist/map.js');

/** WCAG contrast, written out here rather than imported, so the test does
 *  not grade the guard with the guard's own arithmetic. */
function contrastRatio(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');
const { normalizeTheme } = require('../../lib/builder/template.js');

function el(id, cls, html, styles) {
  return {
    sourceId: id, class: cls, html, textContent: 'x', textLength: 1,
    computedStyles: { ...styles }, documentPosition: 0, depth: 2, assetRefs: [],
  };
}

const TEXT = { 'font-family': '"Open Sans", Arial, sans-serif', 'font-size': '16px', 'line-height': '27.2px', color: 'rgb(102, 102, 102)' };
const H1 = { 'font-family': '"Open Sans", Arial, sans-serif', 'font-size': '30px', 'font-weight': '700', 'line-height': '36px', color: 'rgb(51, 51, 51)' };
const H2 = { 'font-family': '"Open Sans", Arial, sans-serif', 'font-size': '26px', 'font-weight': '600', color: 'rgb(51, 51, 51)' };
const LINK = { color: 'rgb(46, 163, 242)' };

function siteIr(styleSummary) {
  return {
    irVersion: '1.0', jobId: 'j', sourceUrl: 'https://www.daneofearth.org/', capturedAt: '',
    assets: [], taxonomy: { navs: [], pageOrder: ['/'] },
    rawTokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
    ...(styleSummary ? { styleSummary } : {}),
    pages: [{
      url: 'https://daneofearth.org/', path: '/', title: 't', metaDescription: '', ogTags: {},
      canonicalUrl: '', lang: 'en', screenshots: { desktop: '', tablet: '', mobile: '' },
      sections: [{
        sourceId: 's', type: 'unknown', screenshot: '',
        elements: [
          el('h1', 'heading', '<h1>Dane</h1>', H1),
          el('h2a', 'heading', '<h2>One</h2>', H2),
          el('h2b', 'heading', '<h2>Two</h2>', H2),
          // The odd one out comes FIRST, so "most common" and "first seen"
          // give different answers (a break test caught the version that
          // could not tell them apart).
          el('p3', 'text', '<p>c</p>', { ...TEXT, color: 'rgb(0, 0, 0)' }),
          el('p1', 'text', '<p>a</p>', TEXT),
          el('p2', 'text', '<p>b</p>', TEXT),
          el('a1', 'link', '<a href="/x">x</a>', LINK),
        ],
      }],
    }],
  };
}

const SUMMARY = {
  pageBackgrounds: [{ value: 'rgb(255, 255, 255)', count: 24 }],
  backgroundsByArea: [
    { value: 'rgb(255, 255, 255)', count: 9000 },
    { value: 'rgb(244, 244, 244)', count: 3000 },
    // A faint overlay that covers MORE screen than the real dark band — it
    // must still not become the inverse colour.
    { value: 'rgba(0, 0, 0, 0.1)', count: 2000 },
    { value: 'rgb(26, 26, 26)', count: 1500 },
  ],
  headerBackgrounds: [{ value: 'rgb(255, 255, 255)', count: 24 }],
  buttons: [{ value: 'rgb(46, 163, 242)|rgb(255, 255, 255)|3', count: 12 }],
  contentWidths: [{ value: '1080', count: 40 }, { value: '1280', count: 3 }],
};

test('the theme is named after the site and numbered, never reusing a name', () => {
  assert.equal(siteNameFromUrl('https://www.daneofearth.org/'), 'daneofearth');
  assert.equal(siteNameFromUrl('https://alphire.agency'), 'alphire');
  assert.equal(nextThemeName('daneofearth', ['Default', 'Other 3']), 'daneofearth 1');
  assert.equal(nextThemeName('daneofearth', ['daneofearth 1', 'DaneOfEarth 4', 'daneofearth x']), 'daneofearth 5');
});

test('fonts, sizes and colours come from the most common value of each role', () => {
  const t = deriveImportTheme(siteIr(SUMMARY), 'daneofearth 1');
  assert.deepEqual(t.typography.fonts, { heading: 'gf:Open Sans', body: 'gf:Open Sans', mono: '' });
  assert.equal(t.typography.scale.baseSize, 16);
  assert.equal(t.typography.scale.baseLineHeight, 1.7);
  assert.equal(t.typography.scale.h1, 30);
  assert.equal(t.typography.scale.h1Fw, 700);
  assert.equal(t.typography.scale.h1Lh, 1.2);
  assert.equal(t.typography.scale.h2, 26);
  assert.equal(t.typography.scale.h2Fw, 600);
  assert.equal(t.typography.colors.text, '#666666', 'the majority text colour, not the one black paragraph');
  assert.equal(t.typography.colors.heading, '#333333');
  assert.equal(t.typography.colors.link, '#2ea3f2');
});

test('the palette reads backgrounds by role; see-through colours are ignored', () => {
  const t = deriveImportTheme(siteIr(SUMMARY), 'daneofearth 1');
  assert.equal(t.palette.surface, '#ffffff');
  assert.equal(t.palette.band, '#f4f4f4');
  assert.equal(t.palette.inverse, '#1a1a1a');
  assert.equal(t.palette.inverseText, '#ffffff');
  assert.equal(t.palette.header, '#ffffff');
  assert.equal(t.palette.button, '#2ea3f2');
  assert.equal(t.palette.buttonText, '#ffffff');
  assert.equal(t.borderRadius, 3);
  assert.equal(t.contentWidth, 1080);
  assert.equal(t.primaryColor, '#2ea3f2');
  assert.equal(t.backgroundColor, '#ffffff');
});

test('system fonts and built-ins are not requested from Google', () => {
  const ir = siteIr(SUMMARY);
  for (const e of ir.pages[0].sections[0].elements) {
    if (e.class === 'text') e.computedStyles['font-family'] = 'Arial, sans-serif';
    if (e.class === 'heading') e.computedStyles['font-family'] = '"Playfair Display", serif';
  }
  const t = deriveImportTheme(ir, 'x 1');
  assert.equal(t.typography.fonts.body, '');
  assert.equal(t.typography.fonts.heading, 'playfair');
});

test('an outlined button becomes a filled one in its colour, and says so', () => {
  const t = deriveImportTheme(siteIr({ ...SUMMARY, buttons: [{ value: '|rgb(46, 163, 242)|3', count: 7 }] }), 'x 1');
  assert.equal(t.palette.button, '#2ea3f2');
  assert.equal(t.palette.buttonText, '#111111');
  assert.equal(t.borderRadius, 3);
  assert.ok(t.notes.some((n) => n.includes('outlined')));
});

/** Every text element in the fixture painted one colour. */
function withTextColor(ir, color) {
  for (const e of ir.pages[0].sections[0].elements) e.computedStyles.color = color;
  return ir;
}

/** The page paints body text from typography.colors.text and headings from
 *  colors.heading, on backgroundColor — palette.surfaceText reaches nothing
 *  on screen (review round 1, task 86bch6geu). So "readable" is judged on
 *  what is painted, not on the palette. */
function assertPaintedReadable(t) {
  const { text, heading } = t.typography.colors;
  assert.ok(contrastRatio(t.backgroundColor, text) >= 4.5, `body text ${text} on ${t.backgroundColor}`);
  assert.ok(contrastRatio(t.backgroundColor, heading) >= 4.5, `headings ${heading} on ${t.backgroundColor}`);
  // Links in body text paint from colors.link (--bx-link) and the <a>
  // element override (review round 2, task 86bch6geu).
  const { link, linkHover } = t.typography.colors;
  const a = (t.typography.elements.a || {}).color;
  for (const [what, hex] of [['links', link], ['link hover', linkHover], ['<a> override', a]]) {
    if (hex) assert.ok(contrastRatio(t.backgroundColor, hex) >= 4.5, `${what} ${hex} on ${t.backgroundColor}`);
  }
}

// Strands Movie, 2026-10-12 (task 86bch6geu): a black <body> behind a white
// content column, black text. The dry run printed "surface #000000,
// surfaceText #000000" — every imported page would have looked blank.
const BLACK_BODY = {
  ...SUMMARY,
  pageBackgrounds: [{ value: 'rgb(0, 0, 0)', count: 12 }],
  backgroundsByArea: [
    { value: 'rgb(0, 0, 0)', count: 9000 },
    { value: 'rgb(250, 250, 250)', count: 6000 },
  ],
  headerBackgrounds: [{ value: 'rgb(0, 0, 0)', count: 12 }],
};

test('black text on a black page is never shipped: the surface becomes the area the text reads on, and the notes say why', () => {
  const t = deriveImportTheme(withTextColor(siteIr(BLACK_BODY), 'rgb(0, 0, 0)'), 'strands 1');
  assert.equal(t.palette.surface, '#fafafa', 'the content column, not the body');
  assert.equal(t.palette.surfaceText, '#000000', 'the measured text is kept — it reads on the new surface');
  assert.equal(t.backgroundColor, '#fafafa');
  assert.ok(contrastRatio(t.palette.surface, t.palette.surfaceText) >= 4.5);
  const note = t.notes.find((n) => n.startsWith('surface:'));
  assert.ok(note, `a note names the rejection: ${t.notes.join(' / ')}`);
  assert.match(note, /rejected the page background #000000/);
  assert.match(note, /#000000 on it is 1\.0:1/);
  assert.equal(t.palette.inverse, '#000000', 'the black bands stay black, as their own colour');
  assertPaintedReadable(t);
});

test('headings measured in a colour that does not read on the moved surface are replaced too, and the notes say so', () => {
  // Black body text, WHITE headings (they sat on the black bands). Once the
  // surface moves to the light content column, white headings would vanish.
  const ir = withTextColor(siteIr(BLACK_BODY), 'rgb(0, 0, 0)');
  for (const e of ir.pages[0].sections[0].elements) if (e.class === 'heading') e.computedStyles.color = 'rgb(255, 255, 255)';
  const t = deriveImportTheme(ir, 'strands 1');
  assert.equal(t.backgroundColor, '#fafafa');
  assert.equal(t.typography.colors.heading, '#000000', 'the readable body text colour');
  assertPaintedReadable(t);
  assert.ok(t.notes.some((n) => n.startsWith('heading colour: rejected #ffffff on #fafafa')), t.notes.join(' / '));
});

test('links that do not read on the moved surface take the button colour, and the notes say so', () => {
  // The real Strands shape (review round 2): black body, black text, WHITE
  // links (they sat on the black bands), a navy button. On main the links
  // were white on black; once the surface moved to the white content column
  // they were white on white, 1.0:1.
  const ir = withTextColor(siteIr({ ...BLACK_BODY, buttons: [{ value: 'rgb(8, 26, 142)|rgb(255, 255, 255)|0', count: 4 }] }), 'rgb(0, 0, 0)');
  for (const e of ir.pages[0].sections[0].elements) if (e.class === 'link') e.computedStyles.color = 'rgb(255, 255, 255)';
  const t = deriveImportTheme(ir, 'strands 1');
  assert.equal(t.backgroundColor, '#fafafa');
  assert.equal(t.typography.colors.link, '#081a8e', 'the button colour, which reads on the surface');
  assert.equal(t.typography.colors.linkHover, '#081a8e');
  assert.equal(t.typography.elements.a.color, '#081a8e', 'the <a> override paints the readable colour too');
  assert.equal(t.accentColor, '#081a8e');
  assertPaintedReadable(t);
  assert.ok(t.notes.some((n) => n.startsWith('link colour: rejected #ffffff on #fafafa (1.0:1) — using #081a8e')), t.notes.join(' / '));
});

test('links that do not read, with a button that does not read either, take the readable fallback', () => {
  const ir = withTextColor(siteIr({ ...BLACK_BODY, buttons: [{ value: 'rgb(255, 255, 255)|rgb(0, 0, 0)|0', count: 4 }] }), 'rgb(0, 0, 0)');
  for (const e of ir.pages[0].sections[0].elements) if (e.class === 'link') e.computedStyles.color = 'rgb(255, 255, 255)';
  const t = deriveImportTheme(ir, 'strands 1');
  assert.notEqual(t.typography.colors.link, '#ffffff');
  assertPaintedReadable(t);
  assert.ok(t.notes.some((n) => n.startsWith('link colour: rejected #ffffff')), t.notes.join(' / '));
});

test('with no readable area measured, the surface falls back to white and keeps the measured text', () => {
  const ir = withTextColor(siteIr({ ...BLACK_BODY, backgroundsByArea: [{ value: 'rgb(0, 0, 0)', count: 9000 }] }), 'rgb(0, 0, 0)');
  const t = deriveImportTheme(ir, 'strands 1');
  assert.equal(t.palette.surface, '#ffffff');
  assert.equal(t.palette.surfaceText, '#000000');
  assert.ok(t.notes.some((n) => n.startsWith('surface:') && n.includes('using #ffffff')));
  assertPaintedReadable(t);
});

test('text that reads on no light surface keeps the page colour and gets text that reads', () => {
  // Pale grey text. The dark #1a1a1a band WOULD read with it, but the surface
  // never moves onto a dark band: the mapper unsets bands painted the surface
  // colour, and that band would lose its colour in the import.
  const ir = withTextColor(siteIr({ ...SUMMARY, pageBackgrounds: [{ value: 'rgb(240, 240, 240)', count: 4 }] }), 'rgb(238, 238, 238)');
  const t = deriveImportTheme(ir, 'pale 1');
  assert.equal(t.palette.surface, '#f0f0f0');
  assert.equal(t.palette.inverse, '#1a1a1a', 'the dark band keeps its own colour');
  assert.equal(t.palette.surfaceText, '#111111');
  assert.ok(contrastRatio(t.palette.surface, t.palette.surfaceText) >= 4.5);
  assert.ok(t.notes.some((n) => n.startsWith('surface text: rejected #eeeeee')));
  assert.equal(t.typography.colors.text, '#111111', 'what the note says is what the page paints');
  assert.equal(t.typography.colors.heading, '#111111');
  assertPaintedReadable(t);
});

test('on a mid grey, where near-black and white both fall short, the replacement text is pure black', () => {
  const ir = withTextColor(siteIr({ ...SUMMARY, pageBackgrounds: [{ value: 'rgb(120, 120, 120)', count: 4 }], backgroundsByArea: [] }), 'rgb(125, 125, 125)');
  const t = deriveImportTheme(ir, 'grey 1');
  assert.equal(t.palette.surface, '#787878');
  assert.ok(contrastRatio(t.palette.surface, t.palette.surfaceText) >= 4.5, `${t.palette.surfaceText} on #787878`);
  assert.equal(t.typography.colors.text, t.palette.surfaceText);
  assertPaintedReadable(t);
});

test('a readable page background is left alone and adds no note', () => {
  const t = deriveImportTheme(siteIr(SUMMARY), 'daneofearth 1');
  assert.equal(t.palette.surface, '#ffffff');
  assert.equal(t.palette.surfaceText, '#666666');
  assert.ok(!t.notes.some((n) => n.startsWith('surface') || n.startsWith('heading')));
  assert.equal(t.typography.colors.heading, '#333333', 'readable headings keep their measured colour');
});

test('a capture without style evidence still gets fonts and colours, and invents no palette', () => {
  const t = deriveImportTheme(siteIr(null), 'daneofearth 1');
  assert.equal(t.typography.fonts.body, 'gf:Open Sans');
  assert.deepEqual(t.palette, {});
  assert.equal(t.borderRadius, undefined);
  assert.equal(t.contentWidth, undefined);
});

test('Builder keeps every derived value when the theme is saved', () => {
  const t = deriveImportTheme(siteIr(SUMMARY), 'daneofearth 1');
  const saved = normalizeTheme({ typography: t.typography }).typography;
  assert.equal(saved.fonts.heading, 'gf:Open Sans');
  assert.equal(saved.fonts.body, 'gf:Open Sans');
  for (const key of ['baseSize', 'baseLineHeight', 'h1', 'h1Fw', 'h1Lh', 'h2', 'h2Fw']) {
    assert.equal(saved.scale[key], t.typography.scale[key], `scale.${key}`);
  }
  assert.equal(saved.colors.text, '#666666');
  assert.equal(saved.colors.link, '#2ea3f2');
});

test('normalize records the style evidence by role from the capture', () => {
  const html = '<html><body>' +
    '<header data-scim="0" id="main-header"><a data-scim="1" href="/">Home</a></header>' +
    '<div data-scim="2" class="et_pb_row"><p data-scim="3">Hello</p>' +
    '<a data-scim="4" class="et_pb_button" href="/go">Go</a></div>' +
    '<form data-scim="7"><button data-scim="8">Search</button></form>' +
    '<form data-scim="9"><button data-scim="10">Search</button></form>' +
    '<div data-scim="5" class="band"><p data-scim="6">Band</p></div>' +
    '</body></html>';
  const desktop = {
    url: 'https://x.test/', finalUrl: 'https://x.test/', viewport: 'desktop', html,
    styles: {
      0: { 'background-color': 'rgb(255, 255, 255)' },
      2: {},
      4: { 'background-color': 'rgb(46, 163, 242)', color: 'rgb(255, 255, 255)', 'border-radius': '3px' },
      5: { 'background-color': 'rgb(26, 26, 26)' },
      // Two grey search buttons outnumber the one real button — and must not count.
      8: { 'background-color': 'rgb(221, 221, 221)', color: 'rgb(102, 102, 102)' },
      10: { 'background-color': 'rgb(221, 221, 221)', color: 'rgb(102, 102, 102)' },
    },
    rects: { 0: [0, 0, 1440, 80], 1: [100, 20, 60, 20], 2: [180, 100, 1080, 300], 3: [180, 100, 1080, 30], 4: [180, 200, 120, 40], 5: [0, 400, 1440, 400], 6: [180, 450, 1080, 30], 7: [0, 900, 300, 40], 8: [0, 900, 80, 40], 9: [0, 950, 300, 40], 10: [0, 950, 80, 40] },
    pageBackground: 'rgb(255, 255, 255)',
    fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {}, assetUrls: [], fontFamilies: [],
    meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
  };
  const { ir } = normalizeSite({ jobId: 'j', sourceUrl: 'https://x.test/', capturedAt: '', pages: [{ desktop }], assets: [] });
  const s = ir.styleSummary;
  assert.ok(s, 'a capture with positions produces a style summary');
  assert.equal(s.pageBackgrounds[0].value, 'rgb(255, 255, 255)');
  assert.equal(s.backgroundsByArea[0].value, 'rgb(26, 26, 26)', 'the biggest band wins by area');
  assert.equal(s.headerBackgrounds[0].value, 'rgb(255, 255, 255)');
  assert.equal(s.buttons[0].value, 'rgb(46, 163, 242)|rgb(255, 255, 255)|3');
  assert.equal(s.buttons.length, 1, 'search/form buttons are not the site button style');
  assert.equal(s.contentWidths[0].value, '1080');

  const { ir: old } = normalizeSite({ jobId: 'j', sourceUrl: 'https://x.test/', capturedAt: '', pages: [{ desktop: { ...desktop, rects: undefined } }], assets: [] });
  assert.equal(old.styleSummary, undefined, 'no positions → no summary, rather than a misleading one');
});

/* ---------- the readability guard (task 86bctakh4) ---------- */


test('every palette role is covered by a declared readability pair', () => {
  assert.deepEqual(uncoveredPaletteRoles(), [],
    'a palette role with no declared pair would ship unchecked — add it to PALETTE_PAIRS in lib/site-import/theme.ts');
});

test('Alphire: white outline buttons on a white page become visible, and every pair reads', () => {
  // alphire.agency 2026-10-27, job simp_1791930973248_9arcy2: white OUTLINE
  // buttons on dark bands, a white page — the import shipped them invisible.
  const t = deriveImportTheme(siteIr({
    ...SUMMARY,
    pageBackgrounds: [{ value: 'rgb(255, 255, 255)', count: 40 }],
    backgroundsByArea: [{ value: 'rgb(229, 228, 226)', count: 9 }, { value: 'rgb(3, 5, 10)', count: 8 }],
    headerBackgrounds: [{ value: 'rgb(0, 0, 0)', count: 17 }],
    buttons: [{ value: '|rgb(255, 255, 255)|60', count: 17 }],
  }), 'alphire 1');
  const p = t.palette;
  assert.equal(p.surface, '#ffffff');
  assert.notEqual(p.button, '#ffffff', 'the button must not be white on a white page');
  assert.ok(contrastRatio(p.button, p.surface) >= 2, `button ${p.button} on ${p.surface}`);
  assert.ok(contrastRatio(p.buttonText, p.button) >= 4.5, `label ${p.buttonText} on ${p.button}`);
  assert.ok(contrastRatio(p.inverseText, p.inverse) >= 4.5);
  assert.ok(contrastRatio(p.headerText, p.header) >= 4.5);
  assert.ok(contrastRatio(p.bandText, p.band) >= 4.5);
  assert.ok(t.notes.some((n) => n.includes('a button against the page') && n.includes('#ffffff')), 'the repair is named');
  assert.equal(t.primaryColor, p.button, 'the theme colour follows the repaired button');
});

test('the guard repairs a composed pair to the AA line, but leaves a site-painted brand pair alone', () => {
  const notes = [];
  const composed = { surface: '#ffffff', band: '#e5e4e2', bandText: '#cccccc' };
  guardPaletteReadability(composed, notes);
  assert.ok(contrastRatio(composed.bandText, composed.band) >= 4.5);
  assert.equal(notes.length, 1);

  const brand = { button: '#2ea3f2', buttonText: '#ffffff' }; // 2.6:1 — Divi's own button
  guardPaletteReadability(brand, [], [], new Set(['buttonText/button']));
  assert.equal(brand.buttonText, '#ffffff', 'the site painted this pair itself');

  const invisible = { button: '#ffffff', buttonText: '#fefefe' };
  guardPaletteReadability(invisible, [], [], new Set(['buttonText/button']));
  assert.notEqual(invisible.buttonText, '#fefefe', 'even a site-painted pair is fixed when it is invisible');
});

test('a button the guard recoloured no longer counts as site-painted, so its label is held to the AA line', () => {
  // Round-1 review of 86bctakh4: a white filled button with a dark grey label
  // on a white page. The button is turned near-black, and the label the site
  // put on a WHITE button (#333333) is 1.6:1 on the new one.
  const notes = [];
  const p = { surface: '#ffffff', inverse: '#03050a', button: '#ffffff', buttonText: '#333333' };
  guardPaletteReadability(p, notes, [], new Set(['buttonText/button']));
  assert.equal(p.button, '#03050a', 'the button takes the site\'s dark colour');
  assert.ok(contrastRatio(p.buttonText, p.button) >= 4.5, `label ${p.buttonText} on ${p.button} must read`);
  assert.ok(notes.some((n) => n.includes("a button's label") && n.includes('#333333')), 'the label repair is named');
});
