'use strict';

/**
 * A picture that is also a link imports as a picture carrying its link
 * (task 86bcebrwp). Before this, normalize classified the <a> as a "link",
 * map poured it into a text module, and the text module rendered nothing —
 * daneofearth.org's four project tiles and its Substack/Medium/Patreon logos
 * all arrived as empty blocks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');
const { mapSite } = require('../../lib/site-import/dist/map.js');

function importHtml(body) {
  const { ir } = normalizeSite({
    jobId: 'j',
    sourceUrl: 'https://site.test/',
    capturedAt: '',
    assets: [],
    pages: [{ desktop: { url: 'https://site.test/', html: `<html><body>${body}</body></html>` } }],
  });
  const out = mapSite(ir, { existingSlugs: [] });
  return out.pages[0].sections.flatMap((s) => s.modules || []);
}

test('a link holding only a picture becomes an image module with that link', () => {
  const modules = importHtml(
    '<main><a href="https://elsewhere.test/shop" target="_blank"><span class="wrap">' +
      '<img src="https://site.test/tile.png" alt="Shop"></span></a></main>'
  );
  const images = modules.filter((m) => m.type === 'image');
  assert.equal(images.length, 1, JSON.stringify(modules));
  assert.equal(images[0].settings.url, 'https://site.test/tile.png');
  assert.equal(images[0].settings.alt, 'Shop');
  assert.equal(images[0].settings.linkUrl, 'https://elsewhere.test/shop');
  assert.equal(images[0].settings.newTab, 'true', 'target=_blank is kept');
  assert.ok(!modules.some((m) => m.type === 'text'), 'no empty text block is left behind');
});

test('a linked picture without target=_blank opens in the same tab', () => {
  const [img] = importHtml('<main><a href="https://elsewhere.test/"><img src="https://site.test/a.png"></a></main>')
    .filter((m) => m.type === 'image');
  assert.equal(img.settings.linkUrl, 'https://elsewhere.test/');
  assert.equal(img.settings.newTab, undefined);
});

test('a text link with words stays a text link', () => {
  const modules = importHtml('<main><a href="https://elsewhere.test/about">About us</a></main>');
  assert.ok(!modules.some((m) => m.type === 'image'));
  const text = modules.find((m) => m.type === 'text');
  assert.ok(text, JSON.stringify(modules));
  assert.match(text.text, /<a href="https:\/\/elsewhere.test\/about">About us<\/a>/);
});

test('a picture with a caption inside the same link stays a link', () => {
  const modules = importHtml(
    '<main><a href="https://elsewhere.test/"><img src="https://site.test/a.png"> Read more</a></main>'
  );
  assert.ok(!modules.some((m) => m.type === 'image'), 'the words would be lost as a bare image');
});

/* ---------- the real thing: daneofearth.org's home page ---------- */

test('Dane of Earth: the teal grid imports its four tiles, each linking to its page', () => {
  const { desktop } = require('./fixtures/daneofearth-home.json');
  const { ir } = normalizeSite({
    jobId: 'j', sourceUrl: 'https://daneofearth.org/', capturedAt: '', assets: [], pages: [{ desktop }],
  });
  const modules = mapSite(ir, { existingSlugs: [] }).pages[0].sections.flatMap((s) => s.modules || []);
  const tiles = [
    [/WaveCenter_1200x800/, '/wavecenter'],
    [/Strands_Cover/, '/strands-movie'],
    [/alphire_ai_agency/, '/alphire-ai-agency'],
    [/tile_normie_rainbow/, '/project-x-3'],
  ];
  for (const [picture, page] of tiles) {
    const tile = modules.find((m) => m.type === 'image' && picture.test(m.settings.url));
    assert.ok(tile, `the ${picture} tile is an image module`);
    assert.equal(tile.settings.linkUrl, page, `the ${picture} tile links to ${page}`);
  }
  for (const m of modules.filter((x) => x.type === 'text')) {
    assert.doesNotMatch(m.text, /<img/, 'no picture is left inside a text module');
  }
});
