'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Task 86bcu6t1c — one project shares its saved sections, page templates or
 * themes with another of the same person's projects.
 *
 * This is the first code that reads one tenant's Builder data on behalf of
 * another, so most of these tests are about who may NOT see or do what: a
 * non-owner cannot change shares, nobody can name a project they are not in,
 * an empty list shares nothing, and a third project sees nothing at all.
 *
 * Runs against a fake Supabase: the fake is the whole set of tables, it
 * honours the `col=eq.value` filters the store sends, and the assertions are
 * about the rows that end up in it — so a query that forgot its project
 * filter returns another project's rows here exactly as it would live.
 */

const supabasePath = require.resolve('../../lib/supabase');
const freshModules = [
  supabasePath,
  require.resolve('../../lib/builderProjectSharesStore'),
  require.resolve('../../lib/builderSavedSectionsStore'),
  require.resolve('../../lib/builderPageTemplatesStore'),
  require.resolve('../../lib/builderThemesStore'),
  require.resolve('../../lib/builderSharedPageImport'),
  require.resolve('../../routes/projectShares'),
];

const TABLES = {
  builderProjectShares: 'builder_project_shares',
  builderSavedSections: 'builder_saved_sections',
  builderPageTemplates: 'builder_page_templates',
  builderThemes: 'builder_themes',
  builderPages: 'builder_landing_page',
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

// `missingColumns`: columns this fake database does not have yet, the way
// production lacks object_id until builder_project_shares_pages.sql runs. A
// select or insert naming one fails with Postgres's own code for it.
function load(initial = {}, { missingColumns = [] } = {}) {
  for (const p of freshModules) delete require.cache[p];
  const supabase = require(supabasePath);
  const db = {};
  const inserts = [];
  for (const name of Object.values(TABLES)) db[name] = (initial[name] || []).map((r) => ({ ...r }));
  let nextId = 1;

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({ ...TABLES });
  supabase.sbQuery = async ({ method = 'GET', table, query = '', body }) => {
    const rows = db[table];
    if (!rows) return { ok: false, status: 404, error: `relation "${table}" does not exist` };
    const filters = eqFilters(query);
    const named = `${query} ${JSON.stringify(body || '')}`;
    const missing = missingColumns.find((col) => named.includes(col));
    if (missing) return { ok: false, status: 400, error: `42703: column ${table}.${missing} does not exist` };
    if (method === 'GET') return { ok: true, status: 200, data: rows.filter((r) => matches(r, filters)).map((r) => ({ ...r })) };
    if (method === 'DELETE') {
      db[table] = rows.filter((r) => !matches(r, filters));
      return { ok: true, status: 204, data: [] };
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      inserts.push({ table, rows: list });
      // PostgREST refuses a bulk insert whose objects do not all carry the
      // same keys (PGRST102). The round-1 review found a mixed save hitting
      // exactly that after the delete had run, so the fake enforces it too.
      const keySet = (r) => Object.keys(r).sort().join(',');
      if (list.some((r) => keySet(r) !== keySet(list[0]))) {
        return { ok: false, status: 400, error: 'PGRST102: All object keys must match' };
      }
      const added = list.map((r) => ({ id: `row-${nextId++}`, ...r }));
      rows.push(...added);
      return { ok: true, status: 201, data: added };
    }
    return { ok: false, status: 405, error: `unexpected ${method}` };
  };

  const store = require('../../lib/builderProjectSharesStore');
  const routes = require('../../routes/projectShares');
  return { db, store, routes, inserts };
}

// Dana owns A and B and is a plain member of M. C belongs to somebody else.
const PROJECTS = {
  A: { id: 'proj-a', name: 'Alpha' },
  B: { id: 'proj-b', name: 'Bravo' },
  C: { id: 'proj-c', name: 'Charlie' },
  M: { id: 'proj-m', name: 'Member-only' },
};

function danaProjects() {
  return [
    { ...PROJECTS.A, membership: { role: 'owner' } },
    { ...PROJECTS.B, membership: { role: 'owner' } },
    { ...PROJECTS.M, membership: { role: 'member' } },
  ];
}

function handlerFor(routes, store) {
  return routes.createHandler({
    sharesStore: store,
    listProjectsForUser: async (userId) => ({
      ok: true,
      data: userId === 'dana' ? danaProjects() : [{ ...PROJECTS.C, membership: { role: 'owner' } }],
    }),
    getProjectById: async (id) => {
      const found = Object.values(PROJECTS).find((p) => p.id === id);
      return found ? { ok: true, data: found } : { ok: false, status: 404 };
    },
  });
}

async function call(handle, { method, path, userId = 'dana', body, activeProjectId }) {
  const req = {
    authUser: { id: userId },
    projectContext: activeProjectId ? { project: { id: activeProjectId } } : null,
    body,
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

function savedSection(id, projectId, extra = {}) {
  return {
    id,
    name: `Section ${id}`,
    section: { id: `s-${id}`, columns: [] },
    project_id: projectId,
    owner_user_id: 'dana',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The cross product, and "empty means none"
// ---------------------------------------------------------------------------

test('two ticked types for two ticked projects store four pairs', () => {
  const { store } = load();
  const pairs = store.buildSharePairs('proj-a', ['themes', 'saved_sections'], ['proj-b', 'proj-m']);
  assert.deepEqual(pairs, [
    { targetProjectId: 'proj-b', objectType: 'themes' },
    { targetProjectId: 'proj-b', objectType: 'saved_sections' },
    { targetProjectId: 'proj-m', objectType: 'themes' },
    { targetProjectId: 'proj-m', objectType: 'saved_sections' },
  ]);
});

test('an empty list on either side stores no pairs, never everything', () => {
  const { store } = load();
  assert.deepEqual(store.buildSharePairs('proj-a', [], ['proj-b']), []);
  assert.deepEqual(store.buildSharePairs('proj-a', ['themes'], []), []);
});

test('a project is never stored as sharing with itself', () => {
  const { store } = load();
  assert.deepEqual(store.buildSharePairs('proj-a', ['themes'], ['proj-a']), []);
});

// ---------------------------------------------------------------------------
// The settings API
// ---------------------------------------------------------------------------

test('an owner saves shares, and every row carries BOTH tenant columns', async () => {
  const { db, store, routes } = load();
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: ['saved_sections', 'themes'], targetProjectIds: ['proj-b'] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.types, ['saved_sections', 'themes']);
  assert.deepEqual(res.body.data.targets, ['proj-b']);
  // The picker lists the caller's other projects and nothing else.
  assert.deepEqual(res.body.data.projects.map((p) => p.id), ['proj-b', 'proj-m']);
  assert.equal(res.body.data.canEdit, true);

  const rows = db.builder_project_shares;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    // CLAUDE.md landmine 12: a row missing either column is an untenanted row.
    assert.equal(row.project_id, 'proj-a');
    assert.equal(row.owner_user_id, 'dana');
    assert.equal(row.target_project_id, 'proj-b');
  }
});

test('a member who is not an owner cannot change shares (403, nothing written)', async () => {
  const { db, store, routes } = load();
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-m/shares',
    body: { types: ['themes'], targetProjectIds: ['proj-a'] },
  });
  assert.equal(res.status, 403);
  assert.equal(db.builder_project_shares.length, 0);
  // And the read tells the settings panel to lock itself, by the same rule.
  const read = await call(handle, { method: 'GET', path: '/api/projects/proj-m/shares' });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.canEdit, false);
});

test('naming a project the caller is not in is refused (403), and nothing is written', async () => {
  const { db, store, routes } = load({
    builder_project_shares: [
      { id: 'old', project_id: 'proj-a', owner_user_id: 'dana', target_project_id: 'proj-b', object_type: 'themes' },
    ],
  });
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: ['themes'], targetProjectIds: ['proj-b', 'proj-c'] },
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /proj-c/);
  // Not "saved the allowed half": the existing share is exactly as it was.
  assert.deepEqual(db.builder_project_shares.map((r) => r.id), ['old']);
});

test('a project the caller is not in cannot be read or written at all', async () => {
  const { store, routes } = load();
  const handle = handlerFor(routes, store);
  const read = await call(handle, { method: 'GET', path: '/api/projects/proj-c/shares' });
  assert.equal(read.status, 403);
  const write = await call(handle, {
    method: 'PUT', path: '/api/projects/proj-c/shares', body: { types: [], targetProjectIds: [] },
  });
  assert.equal(write.status, 403);
});

test('saving empty lists clears every share the project had', async () => {
  const { db, store, routes } = load({
    builder_project_shares: [
      { id: 'x1', project_id: 'proj-a', owner_user_id: 'dana', target_project_id: 'proj-b', object_type: 'themes' },
      { id: 'x2', project_id: 'proj-a', owner_user_id: 'dana', target_project_id: 'proj-m', object_type: 'page_templates' },
      // Another project's share is not this save's business.
      { id: 'keep', project_id: 'proj-b', owner_user_id: 'dana', target_project_id: 'proj-a', object_type: 'themes' },
    ],
  });
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT', path: '/api/projects/proj-a/shares', body: { types: ['themes'], targetProjectIds: [] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.types, []);
  assert.deepEqual(db.builder_project_shares.map((r) => r.id), ['keep']);
});

test('a missing shares table is named, not reported as "no projects" (86bcvk7uf)', async () => {
  // 2026-10-30: production had never run builder_project_shares_setup.sql.
  const { db, store, routes } = load();
  delete db.builder_project_shares;
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/projects/proj-a/shares' });
  assert.equal(res.status, 503);
  assert.match(res.body.error.message, /builder_project_shares table does not exist/);
  assert.match(res.body.error.message, /builder_project_shares_setup\.sql/);

  // PostgREST's own wording for the same thing.
  const named = store.sharesReadError({ status: 404, error: "Could not find the table 'public.builder_project_shares' in the schema cache" }, 'x');
  assert.equal(named.code, 'SHARES_TABLE_MISSING');
  // Any other failure keeps its own message.
  const other = store.sharesReadError({ status: 500, error: 'timeout' }, 'x');
  assert.equal(other.error, 'timeout');
  assert.equal(other.status, 500);
});

test('an unknown type in a PUT is refused with 400 naming the allowed types', async () => {
  const { db, store, routes } = load();
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT', path: '/api/projects/proj-a/shares', body: { types: ['forms'], targetProjectIds: ['proj-b'] },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /saved_sections, page_templates, themes/);
  assert.equal(db.builder_project_shares.length, 0);
});

// ---------------------------------------------------------------------------
// The receiving side — and the leak case
// ---------------------------------------------------------------------------

function sharedWorld() {
  return {
    builder_project_shares: [
      { id: 's1', project_id: 'proj-a', owner_user_id: 'dana', target_project_id: 'proj-b', object_type: 'saved_sections' },
    ],
    builder_saved_sections: [
      savedSection('a1', 'proj-a'),
      savedSection('a2', 'proj-a', { is_private: true }),
      savedSection('b1', 'proj-b'),
      savedSection('c1', 'proj-c'),
      // A legacy row with no project at all must never ride along.
      savedSection('legacy', null),
    ],
  };
}

test('B sees A\'s shared sections, tagged with where they came from', async () => {
  const { store, routes } = load(sharedWorld());
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/builder/shared/saved_sections', activeProjectId: 'proj-b' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => i.id), ['a1']);
  assert.equal(res.body.items[0].sourceProjectId, 'proj-a');
  assert.equal(res.body.items[0].sourceProjectName, 'Alpha');
});

test('C, which nothing is shared with, sees nothing', async () => {
  const { store, routes } = load(sharedWorld());
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/builder/shared/saved_sections', activeProjectId: 'proj-c' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
});

test('a share of one type exposes nothing of another type', async () => {
  const world = sharedWorld();
  world.builder_themes = [{ id: 't1', name: 'Alpha theme', project_id: 'proj-a', owner_user_id: 'dana' }];
  const { store, routes } = load(world);
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/builder/shared/themes', activeProjectId: 'proj-b' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
});

test('unticking a share makes the items disappear at once', async () => {
  const { store, routes } = load(sharedWorld());
  const handle = handlerFor(routes, store);
  const before = await call(handle, { method: 'GET', path: '/api/builder/shared/saved_sections', activeProjectId: 'proj-b' });
  assert.equal(before.body.items.length, 1);
  await call(handle, { method: 'PUT', path: '/api/projects/proj-a/shares', body: { types: [], targetProjectIds: [] } });
  const after = await call(handle, { method: 'GET', path: '/api/builder/shared/saved_sections', activeProjectId: 'proj-b' });
  assert.deepEqual(after.body.items, []);
});

test('an unknown shared type is a 400 naming the allowed types', async () => {
  const { store, routes } = load(sharedWorld());
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/builder/shared/forms', activeProjectId: 'proj-b' });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /saved_sections, page_templates, themes/);
});

test('paths this module does not own fall through to the next route', async () => {
  const { store, routes } = load();
  const handle = handlerFor(routes, store);
  for (const [method, path] of [
    ['GET', '/api/projects'],
    ['GET', '/api/projects/proj-a/members'],
    ['DELETE', '/api/projects/proj-a/shares'],
    ['GET', '/api/builder/saved-sections'],
  ]) {
    const res = await call(handle, { method, path });
    assert.equal(res.handled, false, `${method} ${path} should fall through`);
  }
});

// ---------------------------------------------------------------------------
// Specific pages (task 86bcw3m94)
// ---------------------------------------------------------------------------

function page(id, projectId, extra = {}) {
  return { id, name: `Page ${id}`, slug: `page-${id}`, is_published: true, project_id: projectId, owner_user_id: 'dana', ...extra };
}

function pagesWorld(shares = []) {
  return {
    builder_project_shares: shares,
    builder_landing_page: [
      page('a1', 'proj-a'),
      page('a2', 'proj-a'),
      page('b1', 'proj-b'),
      page('c1', 'proj-c'),
    ],
  };
}

const pageShare = (id, objectId, target = 'proj-b', source = 'proj-a') => ({
  id, project_id: source, owner_user_id: 'dana', target_project_id: target, object_type: 'pages', object_id: objectId,
});

test('ticked pages are stored one row per page per project, alongside the types', () => {
  const { store } = load();
  assert.deepEqual(store.buildSharePairs('proj-a', ['themes'], ['proj-b'], ['a1', 'a2', 'a1']), [
    { targetProjectId: 'proj-b', objectType: 'themes' },
    { targetProjectId: 'proj-b', objectType: 'pages', objectId: 'a1' },
    { targetProjectId: 'proj-b', objectType: 'pages', objectId: 'a2' },
  ]);
  // Pages with no project ticked share nothing.
  assert.deepEqual(store.buildSharePairs('proj-a', [], [], ['a1']), []);
});

test('the settings read lists THIS project\'s pages, and only those', async () => {
  const { store, routes } = load(pagesWorld([pageShare('p1', 'a2')]));
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/projects/proj-a/shares' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.pages.map((p) => p.id), ['a1', 'a2']);
  assert.deepEqual(res.body.data.pageIds, ['a2']);
  assert.deepEqual(res.body.data.targets, ['proj-b']);
  // A page is not a library type.
  assert.deepEqual(res.body.data.types, []);
});

test('an owner shares two pages with one project; reading back shows both', async () => {
  const { db, store, routes } = load(pagesWorld());
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: ['themes'], targetProjectIds: ['proj-b'], pageIds: ['a1', 'a2'] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.pageIds, ['a1', 'a2']);
  const pageRows = db.builder_project_shares.filter((r) => r.object_type === 'pages');
  assert.deepEqual(pageRows.map((r) => r.object_id), ['a1', 'a2']);
  for (const row of db.builder_project_shares) {
    assert.equal(row.project_id, 'proj-a');
    assert.equal(row.owner_user_id, 'dana');
  }
  // A mixed save gives every row an object_id ('' for the library type), so
  // one bulk insert carries one key set.
  assert.equal(db.builder_project_shares.find((r) => r.object_type === 'themes').object_id, '');
});

test('a mixed save (a type AND a page) sends one insert whose rows all carry the same keys', async () => {
  const { db, store, routes, inserts } = load(pagesWorld([pageShare('old', 'a1')]));
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: ['themes', 'saved_sections'], targetProjectIds: ['proj-b'], pageIds: ['a1', 'a2'] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const shareInserts = inserts.filter((i) => i.table === 'builder_project_shares');
  assert.equal(shareInserts.length, 1);
  const keySets = new Set(shareInserts[0].rows.map((r) => Object.keys(r).sort().join(',')));
  assert.equal(keySets.size, 1, `rows carried different keys: ${[...keySets].join(' | ')}`);
  assert.deepEqual(res.body.data.types.slice().sort(), ['saved_sections', 'themes']);
  assert.deepEqual(res.body.data.pageIds, ['a1', 'a2']);
  assert.equal(db.builder_project_shares.length, 4);
});

test('a library-only save still leaves object_id out, so it works before the pages SQL runs', async () => {
  const { db, store, routes } = load(pagesWorld(), { missingColumns: ['object_id'] });
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: ['themes'], targetProjectIds: ['proj-b'], pageIds: [] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.builder_project_shares.length, 1);
  assert.equal('object_id' in db.builder_project_shares[0], false);
});

test('a page from another project cannot be named in a PUT (403, nothing written)', async () => {
  const { db, store, routes } = load(pagesWorld([pageShare('old', 'a1')]));
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: [], targetProjectIds: ['proj-b'], pageIds: ['a1', 'c1'] },
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /c1/);
  assert.deepEqual(db.builder_project_shares.map((r) => r.id), ['old']);
});

test('a PUT with no pageIds field clears the page shares, it does not keep them', async () => {
  const { db, store, routes } = load(pagesWorld([pageShare('old', 'a1')]));
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT', path: '/api/projects/proj-a/shares', body: { types: ['themes'], targetProjectIds: ['proj-b'] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.pageIds, []);
  assert.equal(db.builder_project_shares.some((r) => r.object_type === 'pages'), false);
});

test('before the pages SQL runs, ticking a page is refused by name and NOTHING is cleared', async () => {
  const existing = { id: 'old', project_id: 'proj-a', owner_user_id: 'dana', target_project_id: 'proj-b', object_type: 'themes' };
  const { db, store, routes } = load(pagesWorld([existing]), { missingColumns: ['object_id'] });
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT',
    path: '/api/projects/proj-a/shares',
    body: { types: ['themes', 'saved_sections'], targetProjectIds: ['proj-b'], pageIds: ['a1'] },
  });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'PAGE_SHARES_NOT_SET_UP');
  assert.match(res.body.error.message, /builder_project_shares_pages\.sql/);
  assert.deepEqual(db.builder_project_shares.map((r) => r.id), ['old']);

  // And the library types still save on that database.
  const plain = await call(handle, {
    method: 'PUT', path: '/api/projects/proj-a/shares', body: { types: ['saved_sections'], targetProjectIds: ['proj-b'] },
  });
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body.data.types, ['saved_sections']);
  // The receiving side answers "none shared", not an error.
  const shared = await call(handle, { method: 'GET', path: '/api/builder/shared/pages', activeProjectId: 'proj-b' });
  assert.equal(shared.status, 200);
  assert.deepEqual(shared.body.items, []);
});

test('B sees exactly the pages A shared with it; C sees none', async () => {
  const { store, routes } = load(pagesWorld([pageShare('p1', 'a2')]));
  const handle = handlerFor(routes, store);
  const b = await call(handle, { method: 'GET', path: '/api/builder/shared/pages', activeProjectId: 'proj-b' });
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.items.map((i) => i.id), ['a2']);
  assert.equal(b.body.items[0].sourceProjectName, 'Alpha');
  // Summaries only: the body is read at import.
  assert.equal('layoutSections' in b.body.items[0], false);
  const c = await call(handle, { method: 'GET', path: '/api/builder/shared/pages', activeProjectId: 'proj-c' });
  assert.deepEqual(c.body.items, []);
});

test('a page share naming a page of ANOTHER project shows nothing', async () => {
  // A row claiming A shares c1 — a page A does not own — must not leak C's page.
  const { store, routes } = load(pagesWorld([pageShare('bad', 'c1')]));
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'GET', path: '/api/builder/shared/pages', activeProjectId: 'proj-b' });
  assert.deepEqual(res.body.items, []);
});

test('import copies the page BODY into B as an unpublished draft, and touches nothing else', async () => {
  const world = pagesWorld([pageShare('p1', 'a1')]);
  const source = world.builder_landing_page.find((p) => p.id === 'a1');
  Object.assign(source, {
    slug: 'page-b1', // B already has this address
    form_id: 'form-of-alpha',
    page_template_id: 'tpl-alpha',
    theme_id: 'theme-alpha',
    layout_sections: {
      sections: [
        { id: 'hdr', canonical: true, savedSectionId: 'ss-alpha-header', modules: [] },
        { id: 'body', title: 'Body', savedModuleId: 'm-alpha', modules: [{ id: 'm1', type: 'text', settings: { html: '<p>Hi</p>' } }] },
      ],
    },
  });
  const { db, store, routes } = load(world);
  const handle = handlerFor(routes, store);
  const before = JSON.stringify(db.builder_landing_page.filter((p) => p.project_id !== 'proj-b'));

  const res = await call(handle, { method: 'POST', path: '/api/builder/shared/pages/a1/import', activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.frameLeftOut, 1);

  const copies = db.builder_landing_page.filter((p) => p.project_id === 'proj-b' && p.id !== 'b1');
  assert.equal(copies.length, 1);
  const copy = copies[0];
  assert.equal(copy.owner_user_id, 'dana');
  assert.equal(copy.is_published, false);
  assert.equal(copy.slug, 'page-b1-2');
  // Left OFF the copy, never null: the pages table refuses a null form_id
  // (NOT NULL, blank default), which failed every import in the browser.
  assert.equal('form_id' in copy, false);
  assert.equal('page_template_id' in copy, false);
  assert.equal('theme_id' in copy, false);
  const sections = copy.layout_sections.sections;
  assert.deepEqual(sections.map((s) => s.id), ['body']);
  assert.equal('savedModuleId' in sections[0], false);
  assert.equal(sections[0].modules[0].settings.html, '<p>Hi</p>');
  // The source project is read and nothing else.
  assert.equal(JSON.stringify(db.builder_landing_page.filter((p) => p.project_id !== 'proj-b')), before);
});

test('a home page (empty address) is imported under its name, never as B\'s home page', async () => {
  const world = pagesWorld([pageShare('p1', 'a1')]);
  Object.assign(world.builder_landing_page.find((p) => p.id === 'a1'), { slug: '', name: 'Welcome' });
  world.builder_landing_page.push(page('b-home', 'proj-b', { slug: '' }));
  const { db, store, routes } = load(world);
  const handle = handlerFor(routes, store);
  const res = await call(handle, { method: 'POST', path: '/api/builder/shared/pages/a1/import', activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.page.slug, 'welcome');
  assert.equal(db.builder_landing_page.filter((p) => p.project_id === 'proj-b' && p.slug === '').length, 1);
});

test('an unshared page cannot be imported — not by B, not by C', async () => {
  const { db, store, routes } = load(pagesWorld([pageShare('p1', 'a1')]));
  const handle = handlerFor(routes, store);
  const count = db.builder_landing_page.length;
  const notShared = await call(handle, { method: 'POST', path: '/api/builder/shared/pages/a2/import', activeProjectId: 'proj-b' });
  assert.equal(notShared.status, 404);
  assert.equal(notShared.body.error.code, 'NOT_SHARED');
  const other = await call(handle, {
    method: 'POST', path: '/api/builder/shared/pages/a1/import', activeProjectId: 'proj-c', userId: 'cara',
  });
  assert.equal(other.status, 404);
  assert.equal(db.builder_landing_page.length, count);
});
