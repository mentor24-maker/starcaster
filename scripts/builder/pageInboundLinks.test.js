'use strict';

// "What points at this page?" (task 86bcxn69z) — the one scan the Pages
// screen's delete warning and the weekly broken-link check both use.

const test = require('node:test');
const assert = require('node:assert/strict');

const scan = require('../../lib/pageInboundLinks');

const nav = (items) => ({ type: 'navigation', settings: { navItems: JSON.stringify(items) } });
const button = (href, name = '') => ({ type: 'button', name, settings: { href } });

function project() {
  const header = {
    id: 'sec-header',
    title: 'Header',
    savedSectionId: 'ss1',
    canonical: true,
    modules: [nav([{ id: 'n1', label: 'About', href: '/about' }, { id: 'n2', label: 'Blog', href: 'https://blog.example.org/x' }])],
  };
  return {
    domain: 'www.client.com',
    savedSections: [{ id: 'ss1', name: 'Site header', section: { ...header, savedSectionId: undefined, canonical: undefined } }],
    pages: [
      { id: '1', name: 'Home', slug: '', layoutSections: [header, { title: 'Hero', modules: [button('page:2|/contact', 'Learn more')] }] },
      { id: '2', name: 'Contact', slug: 'contact', layoutSections: { sections: [header] } },
      { id: '3', name: 'About', slug: 'about', layoutSections: [header] },
      { id: '4', name: 'Lonely', slug: 'lonely', layoutSections: [] },
    ],
    forms: [
      {
        id: 'f1',
        name: 'Request White Paper',
        fields: [{ key: '__crm_form_handling__', handling: { afterSubmit: 'redirect', redirectPageId: '2' } }],
      },
    ],
  };
}

test('a reference, a typed menu address and a form are all found, each named', () => {
  const p = project();
  const links = scan.collectProjectLinks(p);
  const toContact = scan.linksToPages(links, p.pages, ['2'])['2'].map(scan.describeLink);
  assert.deepEqual(toContact, [
    'Home page › Hero › Button "Learn more"',
    'CRM form "Request White Paper" › Form › After submit',
  ]);
  const toAbout = scan.linksToPages(links, p.pages, ['3'])['3'].map(scan.describeLink);
  assert.deepEqual(toAbout, ['Saved section "Site header" › Header › Menu › Menu item "About" (shown on 3 pages)']);
});

test('a page nothing points at is absent from the answer', () => {
  const p = project();
  const answer = scan.linksToPages(scan.collectProjectLinks(p), p.pages, ['4']);
  assert.deepEqual(answer, {});
});

test('a link FROM a page deleted in the same batch does not count', () => {
  const p = project();
  const links = scan.collectProjectLinks(p);
  const answer = scan.linksToPages(links, p.pages, ['1', '2']);
  // Home's button is going too; the form still points at Contact.
  assert.deepEqual(answer['2'].map((l) => l.source.kind), ['form']);
});

test('a page copy that CHANGED its shared header still reports its own link', () => {
  const p = project();
  p.pages[3].layoutSections = [{
    title: 'Header', savedSectionId: 'ss1', canonical: true,
    modules: [nav([{ label: 'Old about', href: '/about-us' }])],
  }];
  const broken = scan.brokenLinks(scan.collectProjectLinks(p), p.pages).map(scan.describeLink);
  assert.deepEqual(broken, ['Lonely page › Header › Menu › Menu item "Old about"']);
});

test('the weekly check names a reference to a deleted page and a typed address nothing answers', () => {
  const p = project();
  p.pages = p.pages.filter((page) => page.id !== '2');
  p.pages[0].layoutSections.push({ title: 'Footer', modules: [button('https://client.com/gone?x=1'), button('/admin-logout'), button('https://elsewhere.com/gone')] });
  const broken = scan.brokenLinks(scan.collectProjectLinks(p), p.pages);
  assert.deepEqual(broken.map((l) => [scan.describeLink(l), l.reason]), [
    ['Home page › Hero › Button "Learn more"', 'points at page 2, which no longer exists'],
    ['Home page › Footer › Button', 'goes to /gone, and no page has that address'],
    ['CRM form "Request White Paper" › Form › After submit', 'points at page 2, which no longer exists'],
  ]);
});

test('with every page present nothing is broken', () => {
  const p = project();
  assert.deepEqual(scan.brokenLinks(scan.collectProjectLinks(p), p.pages), []);
});

test('typed addresses: own pages only, and the home page answers to / and /home', () => {
  assert.equal(scan.typedAddress('/About/', 'path'), 'about');
  assert.equal(scan.typedAddress('/home', 'path'), '');
  assert.equal(scan.typedAddress('/', 'path'), '');
  assert.equal(scan.typedAddress('/about#team', 'path'), 'about');
  assert.equal(scan.typedAddress('//cdn.example.com/x', 'path'), null);
  assert.equal(scan.typedAddress('mailto:a@b.c', 'path'), null);
  assert.equal(scan.typedAddress('#top', 'path'), null);
  assert.equal(scan.typedAddress('/blog/a-post', 'path'), null);
  assert.equal(scan.typedAddress('https://www.client.com/about', 'path', 'client.com'), 'about');
  assert.equal(scan.typedAddress('https://other.com/about', 'path', 'client.com'), null);
  assert.equal(scan.typedAddress('https://client.com/about', 'path', ''), null);
  assert.equal(scan.typedAddress('post', 'slug'), 'post');
  assert.equal(scan.typedAddress('page:9|/x', 'path'), null);
});

test('a reference in a setting nobody listed is still found, and so is one inside a table cell', () => {
  const p = {
    pages: [
      { id: '1', name: 'Home', slug: '', layoutSections: [{ title: 'A', modules: [
        { type: 'some-future-module', settings: { whatever: 'page:7|/seven' } },
        { type: 'table', settings: { tableData: JSON.stringify({ cells: { '0-1': [{ type: 'image', settings: { linkUrl: 'page:7|/seven' } }] } }) } },
      ] }] },
      { id: '7', name: 'Seven', slug: 'seven', layoutSections: [] },
    ],
  };
  const hits = scan.linksToPages(scan.collectProjectLinks(p), p.pages, ['7'])['7'].map(scan.describeLink);
  assert.deepEqual(hits, [
    'Home page › A › some-future-module › whatever',
    'Home page › A › table › cell 0-1 › Image',
  ]);
});

test('a form showing its message is not a link, even with a page remembered', () => {
  const links = scan.collectProjectLinks({
    forms: [{ id: 'f', name: 'F', fields: [{ key: '__crm_form_handling__', handling: { afterSubmit: 'message', redirectPageId: '2' } }] }],
  });
  assert.deepEqual(links, []);
});

test('the five settings 86bcxu518 made pickers are scanned, references and typed addresses both', () => {
  const p = {
    pages: [
      { id: '1', name: 'Home', slug: '', layoutSections: [{ title: 'A', modules: [
        { type: 'breadcrumb', settings: { items: JSON.stringify([{ id: 'c1', label: 'Courts', url: 'page:7|/seven' }, { id: 'c2', label: 'Old', url: '/gone' }]) } },
        { type: 'headline-rotator', settings: { headlines: JSON.stringify([{ id: 'h1', label: 'Book now', href: '/gone' }]) } },
        { type: 'player-portal', settings: { redirectPath: 'page:7|/seven' } },
        { type: 'player-portal', settings: { redirectPath: '/portal/dashboard' } },
        { type: 'admin-blog-links', settings: { managerPageUrl: '/gone', postViewUrl: 'page:7|/seven' } },
      ] }] },
      { id: '7', name: 'Seven', slug: 'seven', layoutSections: [] },
    ],
  };
  const links = scan.collectProjectLinks(p);
  assert.deepEqual(scan.linksToPages(links, p.pages, ['7'])['7'].map(scan.describeLink), [
    'Home page › A › Breadcrumb › Crumb "Courts"',
    'Home page › A › Player sign-in › After sign-in page',
    'Home page › A › Blog Links Manager › Post view page',
  ]);
  // A typed address nothing answers is broken; /portal/dashboard is not a Builder page, so it is not judged.
  assert.deepEqual(scan.brokenLinks(links, p.pages).map(scan.describeLink), [
    'Home page › A › Breadcrumb › Crumb "Old"',
    'Home page › A › Headline Rotator › Headline "Book now"',
    'Home page › A › Blog Links Manager › Blog Manager page',
  ]);
});
