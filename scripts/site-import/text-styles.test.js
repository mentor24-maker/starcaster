'use strict';

/**
 * Text styling the original applied by hand survives the import (task
 * 86bctde5z). Alphire's home heading is thin (weight 300) with its last two
 * words in cyan; the import theme takes the MOST COMMON heading weight across
 * the site, which was 700, and the cyan lived on a stylesheet class that does
 * not come along — so it arrived heavy and black. The capture had both values
 * all along; normalize kept only the outer element's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');
const { mapSite, styleProseHtml, proseThemeLook } = require('../../lib/site-import/dist/map.js');

const CYAN = 'rgb(0, 217, 255)';
const INK = 'rgb(0, 0, 0)';
/** What the browser reports for plain body text: every property present. */
const BASE = { color: INK, 'font-weight': '400', 'font-style': 'normal', 'letter-spacing': 'normal', 'font-size': '16px' };

/** A desktop capture built the way capture-playwright builds one: every
 *  visible element stamped with data-scim and its computed styles. */
function capture() {
  const styles = {};
  const rects = {};
  let stamp = 0;
  let y = 0;
  const el = (tag, own, inner, attrs = '') => {
    const key = String(stamp++);
    styles[key] = { ...BASE, ...own };
    rects[key] = [0, (y += 100), 1000, 80];
    return `<${tag} data-scim="${key}"${attrs}>${typeof inner === 'function' ? inner() : inner}</${tag}>`;
  };
  const H1 = { 'font-weight': '700', 'font-size': '40px' };
  const parts = [
    el('section', {}, () =>
      el('h1', { 'font-weight': '300', 'font-size': '40px' }, () =>
        'Technology that amplifies ' + el('strong', { color: CYAN, 'font-weight': '400', 'font-size': '40px' }, 'human potential.'))),
    // Two ordinary headings make the site's typical h1 bold, as on Alphire.
    el('section', {}, () => el('h1', H1, 'Our Work')),
    el('section', {}, () => el('h1', H1, 'Our Mission') + el('p', {}, () => 'Plain text, exactly as the theme paints it, with a ' + el('a', { color: 'rgb(0, 102, 153)' }, 'link', ' href="/x"') + '.')),
    // A standalone link is where the theme measures its link colour.
    el('section', {}, () => el('h1', H1, 'Contact') + el('a', { color: 'rgb(0, 102, 153)' }, 'Email us', ' href="/contact"')),
  ];
  return {
    url: 'https://example.org/', finalUrl: 'https://example.org/', viewport: 'desktop',
    html: `<html><body>${parts.join('')}</body></html>`,
    styles, rects, pageBackground: 'rgb(255, 255, 255)',
    fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
    assetUrls: [], fontFamilies: [],
    meta: { title: 'Example', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en' },
  };
}

function importIt() {
  const { ir } = normalizeSite({
    jobId: 'j', sourceUrl: 'https://example.org/', capturedAt: '', assets: [], pages: [{ desktop: capture() }],
  });
  const out = mapSite(ir, { existingSlugs: [] });
  const texts = out.pages[0].sections.flatMap((s) => s.modules).filter((m) => m.type === 'text').map((m) => m.text);
  return { ir, texts };
}

const elements = (ir) => ir.pages[0].sections.flatMap((s) => s.elements);

test('normalize records the cyan word inside the heading, and that a <strong> was NOT bold', () => {
  const { ir } = importIt();
  const h1 = elements(ir).find((e) => /human potential/.test(e.textContent));
  assert.deepEqual(h1.inlineStyles, [{ index: 0, tag: 'strong', styles: { color: CYAN } }],
    'weight 400 inside a 300 heading is what <strong> gives on its own (bolder), so only the colour differs');
});

test('a thin heading with a cyan word imports as weight 300 with the cyan word', () => {
  const { texts } = importIt();
  const hero = texts.find((t) => /human potential/.test(t));
  assert.ok(hero, 'the hero heading reached a text module');
  assert.match(hero, /<h1 style="font-weight:300">/);
  assert.match(hero, /<strong style="color:#00d9ff">human potential\.<\/strong>/);
});

test('text that matches the theme gets no inline style', () => {
  const { texts } = importIt();
  const all = texts.join('\n');
  assert.match(all, /<h1>Our Work<\/h1>/, 'a bold h1 is what the theme paints — written as it was');
  assert.match(all, /<p>Plain text, exactly as the theme paints it, with a <a href="\/x">link<\/a>\.<\/p>/,
    'a paragraph at the theme\'s weight, and a link in the theme\'s own link colour, stay untouched');
});

test('styleProseHtml leaves html byte-identical when nothing differs', () => {
  const look = proseThemeLook({ typography: { scale: { h2Fw: 600 }, colors: {} } });
  const el = { html: '<h2 class="x">Hi &amp; bye</h2>', computedStyles: { 'font-weight': '600' } };
  assert.equal(styleProseHtml(el, look), el.html);
  assert.equal(styleProseHtml({ ...el, computedStyles: {} }, look), '<h2 class="x" style="font-weight:400">Hi &amp; bye</h2>');
});

test('a word the re-parsed html no longer has where the record says is left alone', () => {
  const look = proseThemeLook({ typography: { scale: {}, colors: {} } });
  const el = {
    html: '<p>One <em>two</em></p>',
    computedStyles: {},
    inlineStyles: [{ index: 0, tag: 'strong', styles: { color: CYAN } }],
  };
  assert.equal(styleProseHtml(el, look), el.html);
});
