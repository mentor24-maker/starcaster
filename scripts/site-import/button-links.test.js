'use strict';

/**
 * A link the site styles as a button imports as a Button module (task
 * 86bcuvh9d). Alphire's six calls to action are `<a class="alphire-button">`
 * with a fill, padding and a cyan box-shadow; they classified as "link", were
 * poured into text modules, and the imported home page (1543) had no Button
 * for any of them — so the Button Glow from #913 could not reach them.
 *
 * Links inside running text stay links: "button-shaped" needs a button-ish
 * class, a painted fill or four-sided border, AND no words beside it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite, countCapturedByClass } = require('../../lib/site-import/dist/normalize.js');
const { mapSite } = require('../../lib/site-import/dist/map.js');

const CYAN_BUTTON = {
  'background-color': 'rgb(34, 211, 238)',
  color: 'rgb(5, 10, 20)',
  'padding-top': '14px', 'padding-bottom': '14px', 'padding-left': '28px', 'padding-right': '28px',
  'border-radius': '999px',
  'box-shadow': 'rgba(34, 211, 238, 0.45) 0px 0px 24px 0px',
};

const OUTLINED = {
  color: 'rgb(34, 211, 238)',
  'border-top-width': '2px', 'border-right-width': '2px', 'border-bottom-width': '2px', 'border-left-width': '2px',
  'border-top-style': 'solid', 'border-right-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid',
  'border-top-color': 'rgb(34, 211, 238)', 'border-right-color': 'rgb(34, 211, 238)',
  'border-bottom-color': 'rgb(34, 211, 238)', 'border-left-color': 'rgb(34, 211, 238)',
};

/**
 * One page: a heading, then `inner` inside a <div data-scim="2">. The anchor
 * under test carries data-scim="5" and gets `linkStyles`.
 */
function capture(inner, linkStyles = CYAN_BUTTON) {
  return {
    jobId: 'j', sourceUrl: 'https://site.test/', capturedAt: '', assets: [],
    pages: [{
      desktop: {
        url: 'https://site.test/', finalUrl: 'https://site.test/', viewport: 'desktop',
        html: '<html><body><main data-scim="0"><section data-scim="1"><h1 data-scim="3">Alphire</h1>' +
          `<div class="cta-row" data-scim="2">${inner}</div></section></main></body></html>`,
        styles: { 0: {}, 1: {}, 2: {}, 3: { 'font-size': '48px' }, 4: {}, 5: linkStyles },
        rects: { 0: [0, 0, 1440, 600], 1: [0, 0, 1440, 600], 2: [80, 200, 600, 80], 3: [80, 100, 600, 60], 5: [80, 210, 280, 52] },
        fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
        assetUrls: [], fontFamilies: [],
        meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
      },
    }],
  };
}

const ALPHIRE_CTA =
  '<a class="alphire-button" data-scim="5" href="/contact">Let\'s Build Something Great →</a>';

function elementsOf(ir) {
  return ir.pages[0].sections.flatMap((s) => s.elements);
}
function modulesOf(ir) {
  return mapSite(ir, { existingSlugs: [] }).pages[0].sections.flatMap((s) => s.modules || []);
}
function classOfLink(ir) {
  const el = elementsOf(ir).find((e) => /^<a\b/i.test(e.html));
  return el && el.class;
}

test("Alphire's call to action becomes a Button with its link, label and cyan glow", () => {
  const { ir, coverage } = normalizeSite(capture(ALPHIRE_CTA));
  assert.equal(classOfLink(ir), 'button', JSON.stringify(elementsOf(ir).map((e) => [e.class, e.html])));
  // The report reconciles: both counters saw a button, nothing dropped.
  assert.equal(coverage.captured.button, 1);
  assert.equal(coverage.emitted.button, 1);
  assert.equal(coverage.captured.link, undefined);
  assert.deepEqual(coverage.dropped, {});

  const button = modulesOf(ir).find((m) => m.type === 'button');
  assert.ok(button, 'a Button module exists');
  assert.equal(button.text, "Let's Build Something Great →");
  assert.equal(button.settings.href, '/contact');
  assert.equal(button.settings.buttonGlow, 'true');
  assert.match(button.settings.buttonGlowColor, /22d3ee|34,\s*211,\s*238/i);
  // And it is not ALSO left behind as a text link.
  assert.ok(!modulesOf(ir).some((m) => m.type === 'text' && /Something Great/.test(m.text || '')));
});

test('an outlined button (a border on all four sides, no fill) is a button too', () => {
  const { ir } = normalizeSite(capture(ALPHIRE_CTA, OUTLINED));
  assert.equal(classOfLink(ir), 'button');
});

test('a border on one side only is an underline, not a button', () => {
  const underline = { ...OUTLINED, 'border-top-width': '0px', 'border-right-width': '0px', 'border-left-width': '0px' };
  const { ir } = normalizeSite(capture(ALPHIRE_CTA, underline));
  assert.equal(classOfLink(ir), 'link');
});

test('a button inside a plain wrapper span is still on its own', () => {
  const { ir } = normalizeSite(capture(`<span data-scim="4">${ALPHIRE_CTA}</span>`));
  assert.equal(classOfLink(ir), 'button');
});

test('a button-styled link inside a sentence stays a link', () => {
  const { ir } = normalizeSite(capture(`Read our ${ALPHIRE_CTA} before you call.`));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'button'), JSON.stringify(elementsOf(ir).map((e) => [e.class, e.html])));
  assert.ok(!modulesOf(ir).some((m) => m.type === 'button'));
});

test('…and so does one inside a wrapper span that sits in a sentence', () => {
  const { ir } = normalizeSite(capture(`Read our <span data-scim="4">${ALPHIRE_CTA}</span> today.`));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'button'));
});

test('…and one beside bold running words', () => {
  const { ir } = normalizeSite(capture(`<strong>Ready?</strong> ${ALPHIRE_CTA}`));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'button'));
});

test('a link inside a paragraph stays prose, whatever its class', () => {
  const { ir } = normalizeSite(capture(`<p>Read our ${ALPHIRE_CTA}.</p>`));
  assert.ok(!elementsOf(ir).some((e) => e.class === 'button'));
  assert.ok(!modulesOf(ir).some((m) => m.type === 'button'));
});

test('a painted link with no button-ish class stays a link', () => {
  const plain = '<a class="hero-link" data-scim="5" href="/contact">Contact</a>';
  const { ir } = normalizeSite(capture(plain));
  assert.equal(classOfLink(ir), 'link');
});

test('a button-ish class that paints nothing stays a link', () => {
  const { ir } = normalizeSite(capture(ALPHIRE_CTA, { color: 'rgb(34, 211, 238)' }));
  assert.equal(classOfLink(ir), 'link');
});

test('raw HTML alone (no captured styles) counts a link, as before', () => {
  const html = capture(ALPHIRE_CTA).pages[0].desktop.html;
  assert.deepEqual(countCapturedByClass(html), { heading: 1, link: 1 });
});
