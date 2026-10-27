'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Font Library 6/7 (86bchyd4p): which published pages use a font.
 *
 * The matcher (lib/fontUsage.js) is pure and tested directly. The store
 * (lib/fontUsageStore.js) runs against a fake database that honours the
 * visibility filters only when the query actually asks for them, so dropping
 * `is_private=eq.false` or the is_published clause from the store lists the
 * private page and the draft here and fails the test.
 */

const {
  findFontUsage,
  namesFont,
  fontUsageKeys,
  pageLiveUrl,
  usageProjectIds,
  USAGE_ACROSS_ALL_SITES,
} = require('../../lib/fontUsage.js');

const ORBITRON = { id: 'font_orb', slug: 'orbitron', family: 'Orbitron', visibility: 'platform', projectId: null };

function heading(fontFamily) {
  return { type: 'text', settings: { fontFamily, html: '<h2>Hi</h2>' } };
}

test('a page naming the font in two modules is ONE page (landmine 17)', () => {
  const usage = findFontUsage({
    font: ORBITRON,
    pages: [{
      id: 'p1', projectId: 'strands', name: 'Home', slug: 'home',
      layoutSections: { sections: [{ modules: [heading('lf:orbitron'), heading('lf:orbitron')] }] },
    }],
    projects: new Map([['strands', { name: 'Strands', domain: 'strands.example' }]]),
  });
  assert.equal(usage.totalPages, 1);
  assert.equal(usage.sites.length, 1);
  assert.deepEqual(usage.sites[0].pages.map((p) => p.id), ['p1']);
});

test('a page using the font only through its theme is listed', () => {
  const usage = findFontUsage({
    font: ORBITRON,
    pages: [
      { id: 'p2', projectId: 'strands', name: 'About', slug: 'about', layoutSections: { sections: [] },
        themeTypography: { fonts: { heading: 'lf:orbitron', body: 'inter' } } },
      { id: 'p3', projectId: 'strands', name: 'Contact', slug: 'contact', layoutSections: { sections: [] },
        themeTypography: { fonts: { heading: 'inter' } } },
    ],
    projects: new Map([['strands', { name: 'Strands', domain: 'https://strands.example/' }]]),
  });
  assert.deepEqual(usage.sites[0].pages.map((p) => p.name), ['About']);
  assert.equal(usage.sites[0].pages[0].url, 'https://strands.example/about');
  assert.equal(usage.sites[0].url, 'https://strands.example');
});

test('a Google-loaded copy of the same family counts too, case aside', () => {
  const keys = fontUsageKeys(ORBITRON);
  assert.equal(namesFont({ a: ['gf:Orbitron'] }, keys), true);
  assert.equal(namesFont({ a: 'gf:orbitron' }, keys), true);
  assert.equal(namesFont({ a: 'gf:Orbitron Sans' }, keys), false);
  assert.equal(namesFont({ a: 'lf:orbitron-x' }, keys), false);
  assert.equal(namesFont({ a: 'some text mentioning lf:orbitron' }, keys), false);
});

test('a published build is searched instead of the draft it was taken from', () => {
  const usage = findFontUsage({
    font: ORBITRON,
    pages: [
      { id: 'built', projectId: 'a', name: 'Built', slug: 'built', layoutSections: { sections: [{ modules: [heading('lf:orbitron')] }] } },
      { id: 'built2', projectId: 'a', name: 'Built 2', slug: 'built-2', layoutSections: { sections: [] } },
    ],
    builds: new Map([
      // Draft names it, live build does not: the visitor does not see it.
      ['built', { layoutSections: [], themeShell: { typography: { fonts: { heading: 'inter' } } } }],
      // Draft does not, the live build's theme shell does.
      ['built2', { layoutSections: [], themeShell: { typography: { fonts: { heading: 'lf:orbitron' } } } }],
    ]),
  });
  assert.deepEqual(usage.sites[0].pages.map((p) => p.id), ['built2']);
});

test('where a project has its own upload with the slug, "lf:" there is not this font', () => {
  const usage = findFontUsage({
    font: ORBITRON,
    pages: [
      { id: 'mine', projectId: 'own', name: 'Mine', slug: 'mine', layoutSections: [heading('lf:orbitron')] },
      { id: 'mine-gf', projectId: 'own', name: 'Google', slug: 'g', layoutSections: [heading('gf:Orbitron')] },
    ],
    libraryShadowedIn: new Set(['own']),
  });
  assert.deepEqual(usage.sites[0].pages.map((p) => p.id), ['mine-gf']);
});

test('live addresses: home is the site root; no domain means no link', () => {
  assert.equal(pageLiveUrl('strands.example', 'home'), 'https://strands.example/');
  assert.equal(pageLiveUrl('strands.example', ''), 'https://strands.example/');
  assert.equal(pageLiveUrl('strands.example', 'blog/post one'), 'https://strands.example/blog/post%20one');
  assert.equal(pageLiveUrl('', 'about'), '');
});

test('scope: shared fonts search every site; a project upload only its own project', () => {
  assert.equal(USAGE_ACROSS_ALL_SITES, true);
  assert.equal(usageProjectIds(ORBITRON, 'p'), null);
  assert.deepEqual(usageProjectIds({ ...ORBITRON, visibility: 'project', projectId: 'own' }, 'p'), ['own']);
});

test('a font used nowhere comes back empty, not as an error', () => {
  const usage = findFontUsage({ font: ORBITRON, pages: [{ id: 'x', projectId: 'a', slug: 'x', layoutSections: [] }] });
  assert.deepEqual(usage, { sites: [], totalPages: 0 });
});

// --- the store, against a fake database --------------------------------------

const supabasePath = require.resolve('../../lib/supabase.js');
const fontsStorePath = require.resolve('../../lib/fontsStore.js');
const storePath = require.resolve('../../lib/fontUsageStore.js');

function loadStoreWith(tables, { fail = '' } = {}) {
  const real = require(supabasePath);
  const queries = [];
  const fake = {
    ...real,
    sbQuery: async ({ table, query }) => {
      queries.push({ table, query });
      if (fail && table === fail) return { ok: false, status: 503, error: `${table} is down` };
      let rows = (tables[table] || []).slice();
      if (table === 'builder_landing_page') {
        if (/is_private=eq\.false/.test(query)) rows = rows.filter((r) => r.is_private === false);
        if (/or=\(is_published\.eq\.true,is_published\.is\.null\)/.test(query)) {
          rows = rows.filter((r) => r.is_published !== false);
        }
        const offset = Number((query.match(/offset=(\d+)/) || [])[1] || 0);
        rows = rows.slice(offset, offset + 200);
      }
      if (table === 'fonts' && /id=eq\./.test(query) && !/slug=eq\./.test(query)) {
        const id = decodeURIComponent(query.match(/id=eq\.([^&]+)/)[1]);
        rows = rows.filter((r) => r.id === id);
      }
      if (table === 'fonts' && /slug=eq\./.test(query)) {
        rows = rows.filter((r) => r.visibility === 'project' && r.slug === 'orbitron');
      }
      return { ok: true, status: 200, data: rows };
    },
  };
  for (const p of [supabasePath, fontsStorePath, storePath]) delete require.cache[p];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake };
  const fontsStore = require(fontsStorePath);
  require.cache[fontsStorePath].exports = { ...fontsStore, getFont: async (id) => {
    const row = (tables.fonts || []).find((r) => r.id === id);
    return row
      ? { ok: true, status: 200, data: { id: row.id, slug: row.slug, family: row.family, visibility: row.visibility, projectId: row.project_id } }
      : { ok: false, status: 404, error: 'Font not found' };
  } };
  const store = require(storePath);
  return { store, queries, restore: () => { for (const p of [supabasePath, fontsStorePath, storePath]) delete require.cache[p]; } };
}

const page = (id, extra) => ({
  id, project_id: 'strands', name: id, slug: id, theme_id: '', is_private: false, is_published: true,
  layout_sections: { sections: [{ modules: [heading('lf:orbitron')] }] }, ...extra,
});

function fixture() {
  return {
    fonts: [{ id: 'font_orb', slug: 'orbitron', family: 'Orbitron', visibility: 'platform', project_id: null }],
    builder_landing_page: [
      page('home', { slug: 'home', name: 'Home' }),
      page('draft-page', { is_published: false }),
      page('private-page', { is_private: true }),
      page('themed', { layout_sections: { sections: [] }, theme_id: '' }),
    ],
    builder_themes: [{ id: 'th1', project_id: 'strands', name: 'T', typography: { fonts: { heading: 'lf:orbitron' } }, is_default: true }],
    builder_published_pages: [],
    app_projects: [{ id: 'strands', name: 'Strands', domain: 'strands.example' }],
  };
}

test('store: drafts and private pages are not listed; theme-only pages are', async () => {
  const { store, restore } = loadStoreWith(fixture());
  try {
    const res = await store.getFontUsage('font_orb', { projectId: 'strands', userId: 'u' });
    assert.equal(res.ok, true);
    const ids = res.data.sites[0].pages.map((p) => p.id).sort();
    assert.deepEqual(ids, ['home', 'themed']);
    assert.equal(res.data.sites[0].name, 'Strands');
    assert.equal(res.data.totalPages, 2);
    assert.equal(res.data.truncated, false);
  } finally {
    restore();
  }
});

test('store: a failed read fails the answer instead of reporting "used nowhere"', async () => {
  for (const table of ['builder_landing_page', 'builder_themes', 'builder_published_pages', 'app_projects']) {
    const { store, restore } = loadStoreWith(fixture(), { fail: table });
    try {
      const res = await store.getFontUsage('font_orb', { projectId: 'strands', userId: 'u' });
      assert.equal(res.ok, false, `${table} failing should fail the answer`);
    } finally {
      restore();
    }
  }
});

test('route: GET /api/fonts/:id/usage answers through the store; other verbs 405', async () => {
  const routePath = require.resolve('../../routes/fonts.js');
  delete require.cache[routePath];
  const route = require(routePath);
  const sent = [];
  const res = {
    statusCode: 0,
    setHeader() {},
    writeHead(code) { this.statusCode = code; },
    end(body) { sent.push({ code: this.statusCode, body: JSON.parse(body) }); },
  };
  const req = { headers: {}, projectContext: { project: { id: 'strands' } }, session: { userId: 'u' } };
  const deps = { getFontUsage: async (id) => ({ ok: true, status: 200, data: { font: { id }, sites: [], totalPages: 0, truncated: false } }) };
  assert.equal(await route.handle(req, res, '/api/fonts/font_orb/usage', 'GET', deps), true);
  assert.equal(sent[0].code, 200);
  assert.equal(sent[0].body.data.font.id, 'font_orb');
  assert.equal(await route.handle(req, res, '/api/fonts/font_orb/usage', 'POST', deps), true);
  assert.equal(sent[1].code, 405);
});
