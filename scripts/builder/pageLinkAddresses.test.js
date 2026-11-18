'use strict';

// The server half of "page links by reference" (task 86bcxmrw2): when a page
// is served, the pages it links to by id are looked up at their CURRENT
// address. Supabase is stubbed so this needs no credentials.

const test = require('node:test');
const assert = require('node:assert/strict');

const supabasePath = require.resolve('../../lib/supabase');
const queries = [];
let answer = async () => ({ ok: true, data: [] });
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, children: [], paths: [],
  exports: {
    sbQuery: async (args) => { queries.push(args); return answer(args); },
    tableConfig: () => ({ builderPages: 'builder_landing_page' }),
  },
};

const { pageAddressesFor } = require('../../lib/pageLinkAddresses');
const { pageLinkHref } = require('../../lib/builder-client/page-link');

function reset(fn) {
  queries.length = 0;
  answer = fn;
}

const page = {
  layoutSections: [{
    modules: [
      { type: 'button', settings: { href: 'page:12|/about' } },
      { type: 'table', settings: { tableData: JSON.stringify({ cells: { '0-0': [{ settings: { linkUrl: 'page:40|/menu' } }] } }) } },
      { type: 'button', settings: { href: '/plain-old-link' } },
    ],
  }],
};

test('a renamed page is served at its NEW address', async () => {
  reset(async () => ({ ok: true, data: [{ id: 12, slug: 'about-v2' }, { id: 40, slug: 'menu' }] }));
  const map = await pageAddressesFor('proj_1', page);
  assert.deepEqual(map, { 12: 'about-v2', 40: 'menu' });
  assert.equal(pageLinkHref('page:12|/about', map), '/about-v2');
  assert.equal(queries.length, 1);
  assert.match(queries[0].query, /project_id=eq\.proj_1/);
  assert.match(queries[0].query, /id=in\.\(12,40\)/);
});

test('a page that links by reference to nothing asks the database nothing', async () => {
  reset(async () => { throw new Error('must not be called'); });
  assert.deepEqual(await pageAddressesFor('proj_1', { layoutSections: [{ modules: [{ settings: { href: '/x' } }] }] }), {});
  assert.equal(queries.length, 0);
});

test('a deleted page is simply absent, so its saved address is used', async () => {
  reset(async () => ({ ok: true, data: [{ id: 40, slug: 'menu' }] }));
  const map = await pageAddressesFor('proj_1', page);
  assert.equal(pageLinkHref('page:12|/about', map), '/about');
});

test('a failed lookup answers null — "could not look", never "the page is gone"', async () => {
  reset(async () => ({ ok: false, status: 500, data: null }));
  assert.equal(await pageAddressesFor('proj_1', page), null);
  reset(async () => { throw new Error('network'); });
  assert.equal(await pageAddressesFor('proj_1', page), null);
});

test('a link picked inside a text block is looked up too, so the live page gets its address (86bcxthq5)', async () => {
  reset(async () => ({ ok: true, data: [{ id: 55, slug: 'menu-v2' }] }));
  const withText = {
    layoutSections: [{ modules: [{ type: 'text', text: '<p><a href="/old-menu" data-page-link="page:55|/old-menu">Menu</a></p>', settings: {} }] }],
  };
  const map = await pageAddressesFor('proj_1', withText);
  assert.deepEqual(map, { 55: 'menu-v2' });
  assert.match(queries[0].query, /id=in\.\(55\)/);
});

// Links to a SECTION of a page (task SC-852): `page:<id>#<sectionId>|…`.
test('a section link is served with the section\'s CURRENT anchor name', async () => {
  reset(async () => ({
    ok: true,
    data: [{ id: 12, slug: 'about', layout_sections: JSON.stringify({ sections: [{ id: 'sec-team', anchorName: 'our-team' }, { id: 'sec-plain' }] }) }],
  }));
  const served = { id: 99, layoutSections: [{ modules: [{ type: 'button', settings: { href: 'page:12#sec-team|/about#team' } }] }] };
  const map = await pageAddressesFor('proj_1', served);
  assert.match(queries[0].query, /select=id,slug,layout_sections/);
  assert.equal(map['12#sec-team'], 'our-team');
  assert.equal('12#sec-plain' in map, false);
  assert.equal(pageLinkHref('page:12#sec-team|/about#team', map), '/about#our-team');
});

test('page links that name no section do not read any page\'s sections', async () => {
  reset(async () => ({ ok: true, data: [{ id: 12, slug: 'about' }, { id: 40, slug: 'menu' }] }));
  await pageAddressesFor('proj_1', page);
  assert.match(queries[0].query, /select=id,slug&/);
});

test('a page linking to its own section uses the names it is being SERVED with', async () => {
  // The draft renamed the section; the published copy being served has not.
  reset(async () => ({
    ok: true,
    data: [{ id: 7, slug: '', layout_sections: { sections: [{ id: 's1', anchorName: 'renamed-in-draft' }] } }],
  }));
  const served = {
    id: 7,
    layoutSections: [
      { id: 's1', anchorName: 'contact-us', modules: [] },
      { id: 'nav', modules: [{ type: 'navigation', settings: { navItems: JSON.stringify([{ href: 'page:7#s1|/#contact-us' }]) } }] },
    ],
  };
  const map = await pageAddressesFor('proj_1', served);
  assert.equal(map['7#s1'], 'contact-us');
});
