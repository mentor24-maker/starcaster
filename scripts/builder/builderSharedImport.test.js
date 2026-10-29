'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Task 86bcu6tzk — importing a saved section another project shares with this
 * one. The import is the only step of sharing that WRITES, so these tests are
 * about where the write lands and what it may never touch: one new row in the
 * receiving project, both tenant columns, no lineage back to the source, the
 * source row byte-for-byte unchanged, and a refusal once the share is gone.
 *
 * Runs against a fake Supabase that honours the `col=eq.value` filters the
 * code sends, so a query that forgot its project filter finds another
 * project's rows here exactly as it would live.
 */

const supabasePath = require.resolve('../../lib/supabase');
const freshModules = [
  supabasePath,
  require.resolve('../../lib/builderProjectSharesStore'),
  require.resolve('../../lib/builderSavedSectionsStore'),
  require.resolve('../../lib/builderPageTemplatesStore'),
  require.resolve('../../lib/builderThemesStore'),
  require.resolve('../../lib/builderSharedImport'),
  require.resolve('../../routes/projectShares'),
];

const TABLES = {
  builderProjectShares: 'builder_project_shares',
  builderSavedSections: 'builder_saved_sections',
  builderPageTemplates: 'builder_page_templates',
  builderThemes: 'builder_themes',
};

function eqFilters(query) {
  const filters = [];
  for (const part of String(query || '').split('&')) {
    const m = part.match(/^([a-z_]+)=eq\.(.*)$/);
    if (m) filters.push([m[1], decodeURIComponent(m[2])]);
  }
  return filters;
}

function matches(row, filters) {
  return filters.every(([col, value]) => String(row[col] ?? '') === value);
}

function load(initial = {}, { failInsert = false } = {}) {
  for (const p of freshModules) delete require.cache[p];
  const supabase = require(supabasePath);
  const db = {};
  for (const name of Object.values(TABLES)) db[name] = (initial[name] || []).map((r) => JSON.parse(JSON.stringify(r)));
  const writes = [];

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({ ...TABLES });
  supabase.sbQuery = async ({ method = 'GET', table, query = '', body }) => {
    const rows = db[table];
    if (!rows) return { ok: false, status: 404, error: `relation "${table}" does not exist` };
    const filters = eqFilters(query);
    if (method === 'GET') return { ok: true, status: 200, data: rows.filter((r) => matches(r, filters)).map((r) => JSON.parse(JSON.stringify(r))) };
    writes.push({ method, table, query, body });
    if (method === 'POST') {
      if (failInsert) return { ok: false, status: 409, error: 'duplicate key value violates unique constraint' };
      const added = (Array.isArray(body) ? body : [body]).map((r) => JSON.parse(JSON.stringify(r)));
      rows.push(...added);
      return { ok: true, status: 201, data: added };
    }
    return { ok: false, status: 405, error: `unexpected ${method}` };
  };

  const helper = require('../../lib/builderSharedImport');
  const routes = require('../../routes/projectShares');
  return { db, writes, helper, routes };
}

function share(source, target, objectType = 'saved_sections') {
  return { id: `share-${source}-${target}-${objectType}`, project_id: source, owner_user_id: 'dana', target_project_id: target, object_type: objectType };
}

function savedSection(id, projectId, extra = {}) {
  return {
    id,
    name: `Section ${id}`,
    is_private: false,
    section: {
      id: `s-${id}`,
      title: `Section ${id}`,
      savedSectionId: id,
      canonical: true,
      background: { mode: 'image', image: 'https://cdn.example.com/a/hero.jpg' },
      modules: [
        {
          id: 'm1',
          type: 'image',
          savedModuleId: 'cell-a-1',
          canonical: true,
          settings: { imageUrl: 'https://cdn.example.com/a/logo.png', canonical: 'kept as content' },
        },
        { id: 'm2', type: 'text', canonicalLocked: true, settings: { html: '<p>Hi</p>' } },
      ],
    },
    project_id: projectId,
    owner_user_id: 'dana',
    ...extra,
  };
}

async function call(handle, { method = 'POST', path, userId = 'dana', activeProjectId }) {
  const req = {
    authUser: userId ? { id: userId } : null,
    projectContext: activeProjectId ? { project: { id: activeProjectId } } : null,
  };
  const res = {
    statusCode: 0,
    headers: {},
    payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(text) { this.payload = text ? JSON.parse(text) : null; },
  };
  const handled = await handle(req, res, path, method);
  return { handled, status: res.statusCode, body: res.payload };
}

const importPath = (id) => `/api/builder/shared/saved_sections/${id}/import`;

// ---------------------------------------------------------------------------
// The name rule
// ---------------------------------------------------------------------------

test('a name nobody in this project has is kept as it is', () => {
  const { helper } = load();
  assert.equal(helper.uniqueImportName('Header', ['Footer']), 'Header');
});

test('a clash takes the first free "(n)", case-insensitively, and never overwrites', () => {
  const { helper } = load();
  assert.equal(helper.uniqueImportName('Header', ['header']), 'Header (2)');
  assert.equal(helper.uniqueImportName('Header', ['Header', 'Header (2)', 'Header (3)']), 'Header (4)');
});

test('a name at the length limit still fits once it carries a suffix', () => {
  const { helper } = load();
  const long = 'x'.repeat(255);
  const name = helper.uniqueImportName(long, [long]);
  assert.equal(name.length, 255);
  assert.ok(name.endsWith(' (2)'));
});

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

test('import writes ONE new row in the receiving project, with both tenant columns, and leaves the source alone', async () => {
  const source = savedSection('sec-a', 'proj-a');
  const { db, writes, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [source],
  });
  const handle = routes.createHandler();
  const res = await call(handle, { path: importPath('sec-a'), activeProjectId: 'proj-b', userId: 'bea' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.name, 'Section sec-a');
  assert.equal(res.body.data.projectId, 'proj-b');
  assert.notEqual(res.body.data.id, 'sec-a');

  // Exactly one write, and it is an insert into the receiving project.
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  const rows = db.builder_saved_sections;
  assert.equal(rows.length, 2);
  const copy = rows.find((r) => r.id === res.body.data.id);
  assert.equal(copy.project_id, 'proj-b');
  assert.equal(copy.owner_user_id, 'bea');

  // The source row is exactly what it was.
  assert.deepEqual(rows.find((r) => r.id === 'sec-a'), source);
});

test('the copy carries no link back to the source, and keeps media addresses as they were', async () => {
  const { db, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [savedSection('sec-a', 'proj-a')],
  });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  const copy = db.builder_saved_sections.find((r) => r.id === res.body.data.id).section;

  const text = JSON.stringify(copy);
  for (const key of ['savedSectionId', 'savedModuleId', 'canonicalLocked', '"canonical":true']) {
    assert.ok(!text.includes(key), `copy still carries ${key}: ${text}`);
  }
  assert.equal(copy.background.image, 'https://cdn.example.com/a/hero.jpg');
  assert.equal(copy.modules[0].settings.imageUrl, 'https://cdn.example.com/a/logo.png');
  // A setting is content, not lineage — it is copied verbatim.
  assert.equal(copy.modules[0].settings.canonical, 'kept as content');
});

test('a name the receiving project already uses gets "(2)", and the existing section is untouched', async () => {
  const mine = savedSection('sec-b', 'proj-b', { name: 'Section sec-a' });
  const { db, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [savedSection('sec-a', 'proj-a'), mine],
  });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Section sec-a (2)');
  // One name: the stamped title follows the row name.
  assert.equal(db.builder_saved_sections.find((r) => r.id === res.body.data.id).section.title, 'Section sec-a (2)');
  assert.deepEqual(db.builder_saved_sections.find((r) => r.id === 'sec-b'), mine);
});

test('once the source unshares, a stale Import is refused with a sentence, and nothing is written', async () => {
  const { writes, routes } = load({
    builder_project_shares: [],
    builder_saved_sections: [savedSection('sec-a', 'proj-a')],
  });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_SHARED');
  assert.match(res.body.error.message, /no longer shared with this project/);
  assert.equal(writes.length, 0);
});

test('a project shared with nothing cannot import a section by guessing its id', async () => {
  // A shares with B; C asks for A's section.
  const { writes, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [savedSection('sec-a', 'proj-a')],
  });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-c' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('a share of a DIFFERENT type does not let saved sections through', async () => {
  const { writes, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b', 'themes')],
    builder_saved_sections: [savedSection('sec-a', 'proj-a')],
  });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('a section the source marked Private cannot be imported, even with a share', async () => {
  const { writes, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [savedSection('sec-a', 'proj-a', { is_private: true })],
  });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('a database refusal is reported, never answered from a fallback', async () => {
  const { db, routes } = load({
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [savedSection('sec-a', 'proj-a')],
  }, { failInsert: true });
  const res = await call(routes.createHandler(), { path: importPath('sec-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /could not be saved/);
  assert.equal(db.builder_saved_sections.length, 1);
});

test('no signed-in user or no active project is refused before anything is read', async () => {
  const { writes, routes } = load({ builder_project_shares: [share('proj-a', 'proj-b')] });
  const handle = routes.createHandler();
  assert.equal((await call(handle, { path: importPath('sec-a'), activeProjectId: 'proj-b', userId: '' })).status, 401);
  assert.equal((await call(handle, { path: importPath('sec-a') })).status, 400);
  assert.equal(writes.length, 0);
});
