'use strict';

/**
 * The import theme (lib/site-import/theme.ts, task 86bce9wx0): an imported
 * site arrives in its own fonts, colours and button style, as a new theme
 * named after it that becomes the project default.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveImportTheme, nextThemeName, siteNameFromUrl } = require('../../lib/site-import/dist/map.js');
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
          el('p1', 'text', '<p>a</p>', TEXT),
          el('p2', 'text', '<p>b</p>', TEXT),
          el('p3', 'text', '<p>c</p>', { ...TEXT, color: 'rgb(0, 0, 0)' }),
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
    { value: 'rgb(26, 26, 26)', count: 1500 },
    { value: 'rgba(0, 0, 0, 0.1)', count: 900 },
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
    '<div data-scim="5" class="band"><p data-scim="6">Band</p></div>' +
    '</body></html>';
  const desktop = {
    url: 'https://x.test/', finalUrl: 'https://x.test/', viewport: 'desktop', html,
    styles: {
      0: { 'background-color': 'rgb(255, 255, 255)' },
      2: {},
      4: { 'background-color': 'rgb(46, 163, 242)', color: 'rgb(255, 255, 255)', 'border-radius': '3px' },
      5: { 'background-color': 'rgb(26, 26, 26)' },
    },
    rects: { 0: [0, 0, 1440, 80], 1: [100, 20, 60, 20], 2: [180, 100, 1080, 300], 3: [180, 100, 1080, 30], 4: [180, 200, 120, 40], 5: [0, 400, 1440, 400], 6: [180, 450, 1080, 30] },
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
  assert.equal(s.contentWidths[0].value, '1080');

  const { ir: old } = normalizeSite({ jobId: 'j', sourceUrl: 'https://x.test/', capturedAt: '', pages: [{ desktop: { ...desktop, rects: undefined } }], assets: [] });
  assert.equal(old.styleSummary, undefined, 'no positions → no summary, rather than a misleading one');
});
