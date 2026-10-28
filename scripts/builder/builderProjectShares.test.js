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

function load(initial = {}) {
  for (const p of freshModules) delete require.cache[p];
  const supabase = require(supabasePath);
  const db = {};
  for (const name of Object.values(TABLES)) db[name] = (initial[name] || []).map((r) => ({ ...r }));
  let nextId = 1;

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({ ...TABLES });
  supabase.sbQuery = async ({ method = 'GET', table, query = '', body }) => {
    const rows = db[table];
    if (!rows) return { ok: false, status: 404, error: `relation "${table}" does not exist` };
    const filters = eqFilters(query);
    if (method === 'GET') return { ok: true, status: 200, data: rows.filter((r) => matches(r, filters)).map((r) => ({ ...r })) };
    if (method === 'DELETE') {
      db[table] = rows.filter((r) => !matches(r, filters));
      return { ok: true, status: 204, data: [] };
    }
    if (method === 'POST') {
      const added = (Array.isArray(body) ? body : [body]).map((r) => ({ id: `row-${nextId++}`, ...r }));
      rows.push(...added);
      return { ok: true, status: 201, data: added };
    }
    return { ok: false, status: 405, error: `unexpected ${method}` };
  };

  const store = require('../../lib/builderProjectSharesStore');
  const routes = require('../../routes/projectShares');
  return { db, store, routes };
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

test('an unknown type in a PUT is refused with 400 naming the allowed types', async () => {
  const { db, store, routes } = load();
  const handle = handlerFor(routes, store);
  const res = await call(handle, {
    method: 'PUT', path: '/api/projects/proj-a/shares', body: { types: ['pages'], targetProjectIds: ['proj-b'] },
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
  const res = await call(handle, { method: 'GET', path: '/api/builder/shared/pages', activeProjectId: 'proj-b' });
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
