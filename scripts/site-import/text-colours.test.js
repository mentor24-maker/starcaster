'use strict';

/**
 * Imported text keeps its own colours and weights (task SC-861).
 *
 * Bayside Partners went live on 2026-11-17 with its Contact headings in a
 * blue the original never had, its "Joshua Barrow – LinkedIn" link in plain
 * grey, and its H3s heavier than the original. The cause was not the colour
 * rules: every imported page named NO theme, and a page that names none gets
 * none of a theme's type or text colours on the live site — only the shell's
 * colours from the project default. So the headings fell back to the app's
 * own blue. The difference report hid it, because it measured every page as
 * if the default theme's type applied.
 *
 * Covered here: which theme a page the import writes names; the theme's link
 * colour coming from links in the site's text rather than its menu; an
 * element's own colour kept on the plain page surface; a link inside a
 * coloured block taking the block's colour; bare captured words getting a
 * span to carry their weight; and the report reading each element's own
 * markup and the live site's theme rule.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { mapSite, ownColorOnBand, styleProseHtml, proseThemeLook } = require('../../lib/site-import/dist/map.js');
const themeLib = require('../../lib/site-import/dist/theme.js');
const fidelity = require('../../lib/site-import/dist/fidelity.js');
const { importPageThemePatch, followedThemeId } = require('../../lib/siteImportTheme.js');

const IR = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bayside-home.json'), 'utf8'));

/* ---- which theme each page names ---------------------------------------- */

test('a page the import writes names the theme it will be painted with', () => {
  const follow = { followThemeId: 'bayside-1', previousDefaultId: '' };
  assert.deepEqual(importPageThemePatch(null, follow), { themeId: 'bayside-1' }, 'a new page');
  assert.deepEqual(importPageThemePatch({ themeId: '' }, follow), { themeId: 'bayside-1' }, 'an existing page naming none');
  assert.deepEqual(importPageThemePatch({ themeId: 'bayside-1' }, follow), {}, 'already names it');
});

test('a page somebody pointed at another theme keeps it; one following the old default moves on', () => {
  const follow = { followThemeId: 'bayside-2', previousDefaultId: 'bayside-1' };
  assert.deepEqual(importPageThemePatch({ themeId: 'navy' }, follow), {}, 'chosen on purpose');
  assert.deepEqual(importPageThemePatch({ themeId: 'bayside-1' }, follow), { themeId: 'bayside-2' }, 'it followed the default');
  assert.deepEqual(importPageThemePatch({ themeId: '' }, { followThemeId: '' }), {}, 'no theme made (--no-theme): nothing named');
});

test('the theme pages follow is the new default, else the default that stays', () => {
  assert.equal(followedThemeId(null, null), '');
  assert.equal(followedThemeId({}, { id: 'new', madeDefault: true, previousDefaultId: 'old' }), 'new');
  assert.equal(followedThemeId({}, { id: 'new', madeDefault: false, previousDefaultId: 'old' }), 'old', 'a refresh keeps the default');
  assert.equal(followedThemeId({ existingThemes: [{ id: 'first' }] }, { id: 'new', madeDefault: false, previousDefaultId: '' }), 'first');
  assert.equal(followedThemeId({ existingThemes: [] }, { id: 'new', madeDefault: false, previousDefaultId: '' }), 'new');
});

test('the mapper saves the theme BEFORE it writes pages, names it on both writes, and reads it back', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'site_import_map.mjs'), 'utf8');
  const save = src.indexOf('themeCheckpoint = await saveImportTheme(');
  const write = src.indexOf('await writeMappedPages(out.pages');
  assert.ok(save > 0 && write > 0 && save < write, 'saved before the page writes, or there is no id to name');
  assert.match(src, /\.\.\.importPageThemePatch\(null, pageTheme\)/, 'createPage names it');
  assert.match(src, /\.\.\.importPageThemePatch\(current, pageTheme\)/, 'updatePage names it');
  assert.match(src, /name no theme after the write/, 'the names are read back');
});

/* ---- the theme's link colour --------------------------------------------- */

test("the theme's link colour comes from links in the text, preferring a colour over a grey", () => {
  const theme = themeLib.deriveImportTheme(IR, 'bayside 1');
  // Bayside's standalone links are its near-black menu; its in-text links are
  // blue. (This fixture is the home page alone: one LinkedIn blue, one email
  // blue, and the first counted wins the tie. The whole site gives #2ea3f2.)
  assert.equal(theme.typography.colors.link, '#0c71c3');
  const greyByline = { class: 'text', html: '<p>by <a href="x">Dane</a></p>', computedStyles: { color: 'rgb(51, 51, 51)' }, inlineStyles: [{ index: 0, tag: 'a', styles: { color: 'rgb(102, 102, 102)' } }] };
  const blue = { class: 'text', html: '<p><a href="x">LinkedIn</a></p>', computedStyles: { color: 'rgb(46, 163, 242)' } };
  const ir = { pages: [{ sections: [{ elements: [greyByline, greyByline, greyByline, blue] }] }] };
  assert.equal(themeLib.deriveImportTheme(ir, 'x').typography.colors.link, '#2ea3f2', 'three grey bylines do not outvote one blue link');
  const el = (html, color, runs) => ({ class: 'text', html, computedStyles: { color }, ...(runs ? { inlineStyles: runs } : {}) });
  assert.deepEqual(
    themeLib.contentLinkColors([
      el('<p><a href="x">one link</a></p>', 'rgb(12, 113, 195)'),
      el('<p>words <a href="x">a</a></p>', 'rgb(51, 51, 51)', [{ index: 0, tag: 'a', styles: { color: 'rgb(46, 163, 242)' } }]),
      el('<p>words and <a href="x">a</a> link</p>', 'rgb(51, 51, 51)'),
    ]),
    ['rgb(12, 113, 195)', 'rgb(46, 163, 242)'],
    'a block that is one link, and a recorded <a> run; a link that matched its words says nothing'
  );
});

/* ---- an element's own colour on the plain page ---------------------------- */

const LOOK = { headingWeights: { 2: 700 }, linkColor: '#2ea3f2', headingColor: '#333333', textColor: '#333333', surface: '#ffffff' };

test('with no band, an own colour that reads on the page surface is kept', () => {
  const black = { class: 'heading', html: '<h2>Services</h2>', computedStyles: { color: 'rgb(0, 0, 0)' } };
  assert.equal(ownColorOnBand(black, LOOK, null), '#000000');
  const pale = { class: 'text', html: '<p>x</p>', computedStyles: { color: 'rgb(170, 170, 170)' } };
  assert.equal(ownColorOnBand(pale, LOOK, null), '', 'pale grey body text on white is under 4.5:1');
  const white = { class: 'heading', html: '<h2>x</h2>', computedStyles: { color: 'rgb(255, 255, 255)' } };
  assert.equal(ownColorOnBand(white, LOOK, null), '', 'white on the white surface would vanish');
  assert.equal(ownColorOnBand(black, { ...LOOK, surface: '' }, null), '', 'no surface known: left to the theme');
  const link = { class: 'link', html: '<a href="x">x</a>', computedStyles: { color: 'rgb(46, 163, 242)' } };
  assert.equal(ownColorOnBand(link, LOOK, null), '', "a link already in the theme's link colour needs nothing");
});

test('the import theme says what surface the text sits on', () => {
  assert.equal(proseThemeLook(themeLib.deriveImportTheme(IR, 'b')).surface, '#ffffff');
});

test('a link that matched its coloured block takes the block colour, a link with its own keeps it', () => {
  const el = {
    class: 'text',
    html: '<p><a href="a">one</a> and <a href="b">two</a></p>',
    computedStyles: { color: 'rgb(12, 113, 195)' },
    inlineStyles: [{ index: 1, tag: 'a', styles: { color: 'rgb(200, 0, 0)' } }],
  };
  assert.equal(
    styleProseHtml(el, LOOK, null),
    '<p style="color:#0c71c3"><a href="a" style="color:#0c71c3">one</a> and <a href="b" style="color:#c80000">two</a></p>'
  );
});

test('bare captured words get an inline span to carry their weight', () => {
  const el = { class: 'text', html: 'This is the content of the first test...', computedStyles: { 'font-weight': '500' } };
  assert.equal(styleProseHtml(el, LOOK, null), '<span style="font-weight:500">This is the content of the first test...</span>');
  assert.equal(styleProseHtml({ ...el, computedStyles: {} }, LOOK, null), el.html, 'nothing differs: byte-identical');
});

test("Bayside's home keeps its black Services heading, and its Contact headings take the theme's", () => {
  const out = mapSite(JSON.parse(JSON.stringify(IR)), { existingSlugs: [] });
  const html = out.pages[0].sections.flatMap((s) => s.modules).map((m) => m.text || '').join('\n');
  assert.match(html, /<h2 style="color:#000000[^"]*">Services<\/h2>/);
  assert.match(html, /<h3>Office:<\/h3>/, '#333333 is the theme heading colour, so nothing inline');
});

/* ---- the difference report --------------------------------------------- */

test("the report uses the live site's rule: a page naming no theme gets no theme type", () => {
  const themes = [{ id: 'default' }, { id: 'navy' }];
  assert.equal(fidelity.themeForPageType({ themeId: '' }, themes), null);
  assert.equal(fidelity.themeForPageType({}, themes), null);
  assert.equal(fidelity.themeForPageType({ themeId: 'navy' }, themes).id, 'navy');
  assert.equal(fidelity.themeForPageType({ themeId: 'gone' }, themes).id, 'default', 'a deleted theme falls back, as the shell does');
});

test('the report reads each element from its own block of a shared module', () => {
  const module = '<h2 style="font-weight:700">Contact Us</h2><h3>Office:</h3><p style="font-weight:500">25 Burgess Court</p>';
  assert.equal(fidelity.ownBlockHtml(module, 'Office:'), '<h3>Office:</h3>');
  assert.equal(fidelity.ownBlockHtml(module, '25 Burgess Court'), '<p style="font-weight:500">25 Burgess Court</p>');
  assert.equal(fidelity.ownBlockHtml('<a>A</a>on<a>B</a>', 'on'), 'on', 'bare words carry no block styling');
  assert.equal(fidelity.ownBlockHtml(module, 'nowhere'), module, 'no match: the whole module, as before');
});
