'use strict';

// The one-time conversion of saved page links to page references (task
// 86bcxmrw2). Pure functions plus a store-shaped fake — no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  indexPagesBySlug,
  classifyValue,
  convertSections,
  convertProject,
  emptyReport,
  readBackProblem,
} = require('../convert_page_links_to_references');

const PAGES = [
  { id: '1', slug: '', name: 'Home' },
  { id: '2', slug: 'about', name: 'About' },
  { id: '3', slug: 'blog-post-view', name: 'Post' },
  { id: '4', slug: 'dup', name: 'Dup A' },
  { id: '5', slug: 'dup', name: 'Dup B' },
];
const bySlug = indexPagesBySlug(PAGES);

test('an address matching exactly one page becomes its reference, keeping the address as fallback', () => {
  assert.deepEqual(classifyValue('/about', 'path', bySlug), { action: 'upgrade', to: 'page:2|/about' });
  assert.deepEqual(classifyValue('/About/', 'path', bySlug), { action: 'upgrade', to: 'page:2|/About/' });
  assert.deepEqual(classifyValue('/', 'path', bySlug), { action: 'upgrade', to: 'page:1|/' });
  assert.deepEqual(classifyValue('blog-post-view', 'slug', bySlug), { action: 'upgrade', to: 'page:3|blog-post-view' });
});

test('external links, empty values and existing references are left alone and not listed', () => {
  for (const value of ['', 'https://example.com/about', 'mailto:x@y.z', '#top', '//cdn.example/x', 'page:2|/about', '{{ .ConfirmationURL }}']) {
    assert.deepEqual(classifyValue(value, 'path', bySlug), { action: 'skip' }, value);
  }
});

test('an internal-looking address that matches no page — or two — is listed, never guessed at', () => {
  assert.equal(classifyValue('/nowhere', 'path', bySlug).action, 'unmatched');
  assert.equal(classifyValue('/dup', 'path', bySlug).action, 'unmatched');
  assert.equal(classifyValue('/about?x=1', 'path', bySlug).action, 'unmatched');
});

test('only picker settings change; free-text links and other settings are untouched', () => {
  const sections = [{
    id: 's1', title: 'Hero', modules: [
      { type: 'button', name: 'CTA', settings: { href: '/about', text: '/about' } },
      { type: 'text', settings: { content: '<a href="/about">About</a>' } },
      { type: 'blog-post-list', settings: { postSlug: 'blog-post-view' } },
      { type: 'navigation', settings: { href: '/about' } },
    ],
  }];
  const report = emptyReport();
  const next = convertSections(sections, bySlug, 'page "Home"', report);
  assert.equal(next[0].modules[0].settings.href, 'page:2|/about');
  assert.equal(next[0].modules[0].settings.text, '/about');
  assert.equal(next[0].modules[1], sections[0].modules[1], 'rich-text links are not converted');
  assert.equal(next[0].modules[2].settings.postSlug, 'page:3|blog-post-view');
  assert.equal(next[0].modules[3], sections[0].modules[3]);
  assert.equal(report.upgraded.length, 2);
  assert.equal(sections[0].modules[0].settings.href, '/about', 'the input is not mutated');
});

test('a table cell image link and a button inside a cell are converted inside the JSON', () => {
  const tableData = JSON.stringify({ headers: ['A'], rowCount: 1, cells: { '0-0': [
    { type: 'image', settings: { linkUrl: '/about' } },
    { type: 'button', settings: { href: '/nowhere' } },
  ] } });
  const report = emptyReport();
  const [section] = convertSections([{ id: 's', modules: [{ type: 'table', settings: { tableData } }] }], bySlug, 'p', report);
  const cells = JSON.parse(section.modules[0].settings.tableData).cells['0-0'];
  assert.equal(cells[0].settings.linkUrl, 'page:2|/about');
  assert.equal(cells[1].settings.href, '/nowhere');
  assert.equal(report.unmatched.length, 1);
});

test('nothing to convert returns the very same array', () => {
  const sections = [{ id: 's', modules: [{ type: 'button', settings: { href: 'https://x.y' } }] }];
  assert.equal(convertSections(sections, bySlug, 'p', emptyReport()), sections);
});

test('--apply spreads the page, sends the sections as an array, and reads every row back', async () => {
  const writes = [];
  const store = new Map([['2', { id: '2', slug: 'about', name: 'About', updatedAt: 't1', pageBackground: { mode: 'color' }, theme: { a: 1 },
    layoutSections: [{ id: 's', modules: [{ type: 'button', settings: { href: '/' } }] }] }]]);
  const pagesStore = {
    listPages: async (limit, scope) => {
      assert.equal(typeof limit, 'number', 'the limit comes FIRST (landmine 12)');
      assert.equal(scope.projectId, 'proj');
      return { ok: true, data: [...store.values(), { id: '1', slug: '', name: 'Home', layoutSections: [] }] };
    },
    updatePage: async (id, input) => {
      writes.push(input);
      assert.ok(Array.isArray(input.layoutSections), 'layoutSections goes as the ARRAY (landmine 13)');
      store.set(String(id), { ...input });
      return { ok: true, data: input };
    },
    getPage: async (id) => ({ ok: true, data: store.get(String(id)) }),
  };
  const sectionsStore = { listSavedSections: async () => ({ ok: true, data: [] }) };
  const report = await convertProject('proj', { apply: true, stores: { pagesStore, sectionsStore } });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].pageBackground, { mode: 'color' }, 'the page is spread, so its background survives');
  assert.equal(writes[0].layoutSections[0].modules[0].settings.href, 'page:1|/');
  assert.equal(report.verified, 1);
  assert.deepEqual(report.failures, []);
});

test('a dry run writes nothing', async () => {
  const pagesStore = {
    listPages: async () => ({ ok: true, data: [{ id: '2', slug: 'about', layoutSections: [{ id: 's', modules: [{ type: 'button', settings: { href: '/about' } }] }] }] }),
    updatePage: async () => { throw new Error('a dry run must not write'); },
  };
  const sectionsStore = { listSavedSections: async () => ({ ok: true, data: [] }) };
  const report = await convertProject('proj', { apply: false, stores: { pagesStore, sectionsStore } });
  assert.equal(report.upgraded.length, 1);
  assert.equal(report.written, 0);
});

test('read-back: normalized extras are fine, a dropped module or a missing reference is not', () => {
  const wanted = [{ modules: [{ settings: { href: 'page:2|/about' } }, { settings: {} }] }];
  assert.equal(readBackProblem([{ modules: [{ settings: { href: 'page:2|/about', extra: 'default' } }, { settings: {} }] }], wanted), '');
  assert.match(readBackProblem([{ modules: [{ settings: { href: 'page:2|/about' } }] }], wanted), /1 module/);
  assert.match(readBackProblem([{ modules: [{ settings: { href: '/about' } }, { settings: {} }] }], wanted), /page 2/);
  assert.match(readBackProblem([], wanted), /0 section/);
});

// Task 86bcxmt5x: menus, cards, slides and an image's Link have a picker now.
test('a menu item, a card, a slide and an image link are converted; typed and external ones are not', () => {
  const navItems = JSON.stringify([
    { id: 'a', label: 'About', href: '/about' },
    { id: 'b', label: 'Shop', href: 'https://shop.example.com' },
    { id: 'c', label: 'Lost', href: '/nowhere', parentId: 'a' },
  ]);
  const cards = JSON.stringify([{ id: 'k', title: 'Home', linkUrl: '/' }]);
  const items = JSON.stringify([{ id: 'i', title: 'Slide', linkUrl: '/about', imageUrl: '/about' }]);
  const sections = [{ id: 's', modules: [
    { type: 'navigation', settings: { navItems } },
    { type: 'feature-cards', settings: { cards } },
    { type: 'carousel', settings: { items } },
    { type: 'image', settings: { linkUrl: '/about' } },
  ] }];
  const report = emptyReport();
  const [section] = convertSections(sections, bySlug, 'p', report);
  const nav = JSON.parse(section.modules[0].settings.navItems);
  assert.equal(nav[0].href, 'page:2|/about');
  assert.deepEqual(nav[1], { id: 'b', label: 'Shop', href: 'https://shop.example.com' });
  assert.deepEqual(nav[2], { id: 'c', label: 'Lost', href: '/nowhere', parentId: 'a' });
  assert.equal(JSON.parse(section.modules[1].settings.cards)[0].linkUrl, 'page:1|/');
  const slide = JSON.parse(section.modules[2].settings.items)[0];
  assert.equal(slide.linkUrl, 'page:2|/about');
  assert.equal(slide.imageUrl, '/about', 'only the link field of an item is touched');
  assert.equal(section.modules[3].settings.linkUrl, 'page:2|/about');
  assert.equal(report.upgraded.length, 4);
  assert.equal(report.unmatched.length, 1);
  assert.match(report.unmatched[0].setting, /navItems › Lost › href/);
});

test('a list with nothing to convert is returned as the same object', () => {
  const sections = [{ id: 's', modules: [{ type: 'navigation', settings: { navItems: JSON.stringify([{ href: 'https://x.y' }]) } }] }];
  assert.equal(convertSections(sections, bySlug, 'p', emptyReport()), sections);
});
