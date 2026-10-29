'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Task 86bcu6ubh — importing a page template another project shares with this
 * one, together with the saved sections its frame (header, menu, footer)
 * points at. The tests are about where the writes land: the template and its
 * sections all in the receiving project, every frame reference rewritten to a
 * section the receiving project owns, the source byte-for-byte unchanged, and
 * a refusal once the share is gone.
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
  require.resolve('../../lib/builderSharedThemeImport'),
  require.resolve('../../lib/builderSharedTemplateImport'),
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

const clone = (v) => JSON.parse(JSON.stringify(v));

function load(initial = {}, { failTemplateInsert = false } = {}) {
  for (const p of freshModules) delete require.cache[p];
  const supabase = require(supabasePath);
  const db = {};
  for (const name of Object.values(TABLES)) db[name] = (initial[name] || []).map(clone);
  const writes = [];
  let nextTemplateId = 900;

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({ ...TABLES });
  supabase.sbQuery = async ({ method = 'GET', table, query = '', body }) => {
    const rows = db[table];
    if (!rows) return { ok: false, status: 404, error: `relation "${table}" does not exist` };
    const filters = eqFilters(query);
    if (method === 'GET') return { ok: true, status: 200, data: rows.filter((r) => matches(r, filters)).map(clone) };
    writes.push({ method, table, query, body: clone(body ?? null) });
    if (method === 'POST') {
      if (failTemplateInsert && table === TABLES.builderPageTemplates) {
        return { ok: false, status: 400, error: 'null value in column "template_id" violates not-null constraint' };
      }
      const added = (Array.isArray(body) ? body : [body]).map(clone);
      // builder_page_templates.id is an identity column: the database assigns it.
      if (table === TABLES.builderPageTemplates) added.forEach((r) => { r.id = nextTemplateId++; });
      rows.push(...added);
      return { ok: true, status: 201, data: added.map(clone) };
    }
    if (method === 'DELETE') {
      const removed = rows.filter((r) => matches(r, filters));
      db[table] = rows.filter((r) => !matches(r, filters));
      return { ok: true, status: 200, data: removed };
    }
    return { ok: false, status: 405, error: `unexpected ${method}` };
  };

  const helper = require('../../lib/builderSharedTemplateImport');
  const routes = require('../../routes/projectShares');
  return { db, writes, helper, routes };
}

function share(source, target, objectType = 'page_templates') {
  return { id: `share-${source}-${target}-${objectType}`, project_id: source, owner_user_id: 'dana', target_project_id: target, object_type: objectType };
}

function savedSection(id, projectId, name, extra = {}) {
  return {
    id,
    name,
    is_private: false,
    section: {
      id: `s-${id}`,
      title: name,
      savedSectionId: id,
      canonical: true,
      modules: [
        { id: `${id}-m1`, type: 'image', savedModuleId: 'cell-a-1', settings: { imageUrl: 'https://cdn.example.com/a/logo.png' } },
        { id: `${id}-m2`, type: 'text', settings: { html: `<p>${name}</p>` } },
      ],
    },
    project_id: projectId,
    owner_user_id: 'dana',
    ...extra,
  };
}

/** A template as stage 4 stores it: frame references around one body section. */
function template(id, projectId, name, sections, extra = {}) {
  return {
    id,
    name,
    template_id: 'modular',
    template_kind: 'modular',
    summary: 'Header, body, footer',
    form_id: 'form-a-1',
    headline_id: 'headline-a-1',
    layout_sections: {
      sections,
      pageBackground: { mode: 'color', color: '#101820' },
      theme: { typography: { headingFont: 'Inter' } },
    },
    project_id: projectId,
    owner_user_id: 'dana',
    ...extra,
  };
}

const ref = (sectionId, title, id = `ref-${sectionId}`) => ({ id, title, canonical: true, savedSectionId: sectionId, modules: [] });
const bodySection = {
  id: 'body-1',
  title: 'Body',
  modules: [{ id: 'bm1', type: 'text', savedModuleId: 'cell-a-9', settings: { html: '<p>Body</p>' } }],
};

function standardDb(extra = {}) {
  return {
    builder_project_shares: [share('proj-a', 'proj-b')],
    builder_saved_sections: [
      savedSection('sec-head', 'proj-a', 'Header'),
      savedSection('sec-foot', 'proj-a', 'Footer'),
      savedSection('sec-b-own', 'proj-b', 'Header'),
    ],
    builder_page_templates: [
      template(41, 'proj-a', 'Landing', [ref('sec-head', 'Header'), bodySection, ref('sec-foot', 'Footer'), ref('sec-head', 'Header', 'ref-head-2')]),
      template(77, 'proj-b', 'Landing', []),
    ],
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

const importPath = (id) => `/api/builder/shared/page_templates/${id}/import`;

function frameIds(row) {
  return (row.layout_sections.sections || []).filter((s) => s.canonical === true).map((s) => s.savedSectionId);
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

test('import copies the template AND the sections its frame uses, and every frame id belongs to the receiving project', async () => {
  const { db, routes } = load(standardDb());
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const imported = db.builder_page_templates.find((r) => r.project_id === 'proj-b' && r.id !== 77);
  assert.ok(imported, 'a new template row in proj-b');
  assert.equal(imported.owner_user_id, 'dana');

  const ids = frameIds(imported);
  assert.equal(ids.length, 3, 'all three frame references survive');
  const bOwned = new Set(db.builder_saved_sections.filter((r) => r.project_id === 'proj-b').map((r) => r.id));
  for (const id of ids) assert.ok(bOwned.has(id), `frame section ${id} must belong to proj-b`);
  assert.ok(!ids.includes('sec-head') && !ids.includes('sec-foot'), 'no reference left pointing at proj-a');

  // The same master referenced twice is copied once, and both references follow it.
  assert.equal(ids[0], ids[2]);
  assert.equal(new Set(ids).size, 2);
  assert.equal(res.body.data.savedSections.length, 2);
});

test('the copied sections carry the master content, no lineage, and a suffixed name where B already had one', async () => {
  const { db, routes } = load(standardDb());
  await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  const copies = db.builder_saved_sections.filter((r) => r.project_id === 'proj-b' && r.id !== 'sec-b-own');
  assert.deepEqual(copies.map((r) => r.name).sort(), ['Footer', 'Header (2)']);
  for (const copy of copies) {
    assert.equal(copy.owner_user_id, 'dana');
    assert.equal(copy.section.savedSectionId, undefined);
    assert.equal(copy.section.canonical, undefined);
    assert.equal(copy.section.title, copy.name);
    assert.equal(copy.section.modules.length, 2);
    assert.equal(copy.section.modules[0].savedModuleId, undefined);
    assert.equal(copy.section.modules[0].settings.imageUrl, 'https://cdn.example.com/a/logo.png');
  }
});

test('the template copy keeps its body, background and theme, takes a suffixed name, and drops the source project\'s form and copy ids', async () => {
  const { db, routes } = load(standardDb());
  await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  const imported = db.builder_page_templates.find((r) => r.project_id === 'proj-b' && r.id !== 77);
  assert.equal(imported.name, 'Landing (2)');
  assert.equal(imported.template_kind, 'modular');
  assert.equal(imported.summary, 'Header, body, footer');
  assert.equal(imported.form_id, null);
  assert.equal(imported.headline_id, null);
  assert.equal(imported.layout_sections.pageBackground.color, '#101820');
  // Background and theme go through the same normaliser on both sides, so the
  // copy must read back exactly as the source does.
  const { readLayoutSectionsFromRow } = require('../../lib/builder');
  const source = readLayoutSectionsFromRow(db.builder_page_templates.find((r) => r.id === 41));
  const copy = readLayoutSectionsFromRow(imported);
  assert.deepEqual(copy.theme, source.theme);
  assert.deepEqual(copy.pageBackground, source.pageBackground);
  const body = imported.layout_sections.sections.find((s) => s.id === 'body-1');
  assert.ok(body, 'body section kept');
  assert.equal(body.modules[0].savedModuleId, undefined, 'body lineage stripped');
  assert.equal(body.modules[0].settings.html, '<p>Body</p>');
});

test('sections are written before the template', async () => {
  const { writes, routes } = load(standardDb());
  await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  const posts = writes.filter((w) => w.method === 'POST').map((w) => w.table);
  assert.deepEqual(posts, ['builder_saved_sections', 'builder_saved_sections', 'builder_page_templates']);
});

test('the source project is unchanged: same rows, same ids, nothing written to it', async () => {
  const initial = standardDb();
  const { db, writes, routes } = load(initial);
  await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  for (const table of ['builder_saved_sections', 'builder_page_templates']) {
    const before = initial[table].filter((r) => r.project_id === 'proj-a');
    const after = db[table].filter((r) => r.project_id === 'proj-a');
    assert.deepEqual(after, before, `${table} rows in proj-a`);
  }
  for (const w of writes) {
    for (const row of Array.isArray(w.body) ? w.body : [w.body]) {
      if (row) assert.notEqual(row.project_id, 'proj-a');
    }
  }
});

test('works when the source shares page templates but NOT its saved sections', async () => {
  const dbInit = standardDb();
  assert.ok(!dbInit.builder_project_shares.some((s) => s.object_type === 'saved_sections'));
  const { routes } = load(dbInit);
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
});

test('a master another project owns under the same id is never read: lookups stay in the source project', async () => {
  const dbInit = standardDb({
    builder_saved_sections: [savedSection('sec-head', 'proj-c', 'Somebody else'), savedSection('sec-foot', 'proj-a', 'Footer')],
  });
  const { db, routes } = load(dbInit);
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  assert.ok(!db.builder_saved_sections.some((r) => r.project_id === 'proj-b' && r.name === 'Somebody else'));
  // Both header references (the template carries two) point at nothing it may read.
  assert.equal(res.body.data.droppedReferences, 2, 'the unreachable header references are dropped and counted');
});

test('an old-style frame copy whose master is gone becomes a saved section of its own; a bare reference to nothing is dropped', async () => {
  const oldStyle = { id: 'old-1', title: 'Old banner', canonical: true, savedSectionId: 'sec-gone', modules: [{ id: 'o1', type: 'text', settings: { html: '<p>Old</p>' } }] };
  const dbInit = standardDb({
    builder_page_templates: [template(41, 'proj-a', 'Landing', [oldStyle, bodySection, ref('sec-missing', 'Lost footer')])],
  });
  const { db, routes } = load(dbInit);
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  const imported = db.builder_page_templates.find((r) => r.project_id === 'proj-b');
  const ids = frameIds(imported);
  assert.equal(ids.length, 1);
  const made = db.builder_saved_sections.find((r) => r.id === ids[0]);
  assert.equal(made.project_id, 'proj-b');
  assert.equal(made.name, 'Old banner');
  assert.equal(made.section.modules[0].settings.html, '<p>Old</p>');
  assert.equal(res.body.data.droppedReferences, 1);
});

test('if the template cannot be saved, the sections this import made are removed again', async () => {
  const { db, routes } = load(standardDb(), { failTemplateInsert: true });
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /nothing was imported/);
  assert.deepEqual(db.builder_saved_sections.filter((r) => r.project_id === 'proj-b').map((r) => r.id), ['sec-b-own']);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test('not shared with this project: 404, nothing written', async () => {
  const { writes, routes } = load(standardDb());
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-c' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_SHARED');
  assert.equal(writes.length, 0);
});

test('sharing only saved sections does not make templates importable', async () => {
  const { writes, routes } = load(standardDb({ builder_project_shares: [share('proj-a', 'proj-b', 'saved_sections')] }));
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('an email template is never imported through this door', async () => {
  const dbInit = standardDb({
    builder_page_templates: [template(41, 'proj-a', 'Welcome email', [], { template_kind: 'email' })],
  });
  const { writes, routes } = load(dbInit);
  const res = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('after the source unshares, import is refused and the copy already made stays', async () => {
  const { db, routes } = load(standardDb());
  const first = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(first.status, 201);
  db.builder_project_shares.length = 0;
  const second = await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b' });
  assert.equal(second.status, 404);
  assert.equal(db.builder_page_templates.filter((r) => r.project_id === 'proj-b').length, 2);
});

test('no session or no active project is refused before anything is read', async () => {
  const { routes } = load(standardDb());
  assert.equal((await call(routes.createHandler(), { path: importPath('41'), activeProjectId: 'proj-b', userId: '' })).status, 401);
  assert.equal((await call(routes.createHandler(), { path: importPath('41') })).status, 400);
});

// ---------------------------------------------------------------------------
// The rewrite on its own
// ---------------------------------------------------------------------------

test('rewriteFrameReferences points frame sections at the new ids and drops ones with no copy', () => {
  const { helper } = load();
  const out = helper.rewriteFrameReferences(
    [ref('a', 'A'), bodySection, ref('b', 'B')],
    { a: 'new-a' }
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].savedSectionId, 'new-a');
  assert.equal(out[0].canonical, true);
  assert.equal(out[1].id, 'body-1');
});
