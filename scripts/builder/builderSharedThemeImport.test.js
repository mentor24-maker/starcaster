'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Task 86bcu6uav — import a theme another project shares with this one.
 *
 * The rule that matters most: the copy is NEVER the receiving project's
 * default theme. The default is what every page without a theme of its own
 * wears, so an import that flagged it would recolour a live site the moment
 * somebody pressed Import. The other tests are about who may copy what (the
 * share is re-checked, nothing is copied from a project that unshared or from
 * a third project) and that the source is never written to.
 *
 * Runs against a fake Supabase that honours the `col=eq.value` filters the
 * code sends and records every write, so "the source was not touched" is a
 * statement about the writes that actually happened.
 */

const supabasePath = require.resolve('../../lib/supabase');
const freshModules = [
  supabasePath,
  require.resolve('../../lib/builderProjectSharesStore'),
  require.resolve('../../lib/builderSavedSectionsStore'),
  require.resolve('../../lib/builderPageTemplatesStore'),
  require.resolve('../../lib/builderThemesStore'),
  require.resolve('../../lib/builderSharedThemeImport'),
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

function load(initial = {}, { onPost } = {}) {
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
    if (method === 'GET') return { ok: true, status: 200, data: rows.filter((r) => matches(r, filters)).map((r) => ({ ...r })) };
    writes.push({ method, table, query, body });
    if (method === 'POST') {
      if (onPost) body = onPost(body);
      const added = (Array.isArray(body) ? body : [body]).map((r) => ({
        created_at: '2026-10-28T00:00:00Z',
        updated_at: '2026-10-28T00:00:00Z',
        ...r,
      }));
      rows.push(...added);
      return { ok: true, status: 201, data: added };
    }
    if (method === 'DELETE') {
      db[table] = rows.filter((r) => !matches(r, filters));
      return { ok: true, status: 204, data: [] };
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => matches(r, filters));
      for (const r of hit) Object.assign(r, body);
      return { ok: true, status: 200, data: hit.map((r) => ({ ...r })) };
    }
    return { ok: false, status: 405, error: `unexpected ${method}` };
  };

  const sharedImport = require('../../lib/builderSharedThemeImport');
  const routes = require('../../routes/projectShares');
  return { db, writes, sharedImport, routes };
}

function share(source, target, objectType = 'themes') {
  return {
    id: `share-${source}-${target}-${objectType}`,
    project_id: source,
    owner_user_id: 'dana',
    target_project_id: target,
    object_type: objectType,
  };
}

function themeRow(id, projectId, extra = {}) {
  return {
    id,
    name: `Theme ${id}`,
    primary_color: '#112233',
    background_color: '#ffffff',
    accent_color: '#ff6600',
    border_thickness: 2,
    border_radius: 8,
    container_blur: 0,
    contrast_level: 10,
    logo_wide_id: 'asset-logo-a',
    logo_square_id: '',
    feature_image_id: '',
    background_image_id: '',
    typography: {
      fonts: { heading: 'Lora', body: 'Inter', mono: '' },
      palette: { surface: '#ffffff', surfaceText: '#111111' },
      pageLayout: { topMargin: 0, bottomMargin: 0, sideMargins: 0, contentWidth: 1200 },
    },
    is_default: false,
    project_id: projectId,
    owner_user_id: 'alex',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
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

// A shares its themes with B. B already has its own default theme, "Bravo
// house", and a theme called "Ocean". C shares nothing with anyone.
function world(extraShares = []) {
  return {
    builder_project_shares: [share('proj-a', 'proj-b'), ...extraShares],
    builder_themes: [
      themeRow('theme-ocean-a', 'proj-a', { name: 'Ocean', is_default: true }),
      themeRow('theme-forest-a', 'proj-a', { name: 'Forest' }),
      themeRow('theme-house-b', 'proj-b', { name: 'Bravo house', is_default: true, owner_user_id: 'dana' }),
      themeRow('theme-ocean-b', 'proj-b', { name: 'Ocean', owner_user_id: 'dana' }),
      themeRow('theme-secret-c', 'proj-c', { name: 'Charlie secret' }),
    ],
  };
}

const IMPORT_PATH = (id) => `/api/builder/shared/themes/${id}/import`;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

test('a free name is kept; a taken one gets the first free suffix, case-insensitively', () => {
  const { sharedImport } = load();
  assert.equal(sharedImport.uniqueThemeName('Forest', ['Ocean']), 'Forest');
  assert.equal(sharedImport.uniqueThemeName('Ocean', ['ocean']), 'Ocean (2)');
  assert.equal(sharedImport.uniqueThemeName('Ocean', ['Ocean', 'Ocean (2)']), 'Ocean (3)');
  assert.equal(sharedImport.uniqueThemeName('', []), 'Imported theme');
});

// ---------------------------------------------------------------------------
// The import itself
// ---------------------------------------------------------------------------

test('import adds a copy to B, stamped with both tenant columns, and NEVER as the default', async () => {
  const { db, writes, routes } = load(world());
  const handle = routes.createHandler();
  const res = await call(handle, { path: IMPORT_PATH('theme-ocean-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  assert.equal(res.body.theme.name, 'Ocean (2)', 'B already has an Ocean, so the copy is renamed, never overwritten');
  assert.equal(res.body.theme.isDefault, false);

  const bThemes = db.builder_themes.filter((r) => r.project_id === 'proj-b');
  assert.equal(bThemes.length, 3);
  const copy = bThemes.find((r) => r.name === 'Ocean (2)');
  assert.ok(copy, 'the copy is in B');
  assert.notEqual(copy.id, 'theme-ocean-a', 'a new row, not the source row');
  assert.equal(copy.owner_user_id, 'dana');
  // The source WAS A's default; the copy must not carry that over.
  assert.equal(copy.is_default, false);

  // B's own default and its existing Ocean are untouched.
  const house = db.builder_themes.find((r) => r.id === 'theme-house-b');
  assert.equal(house.is_default, true);
  assert.equal(db.builder_themes.find((r) => r.id === 'theme-ocean-b').name, 'Ocean');

  // The only write anywhere is one INSERT — no PATCH (setDefaultTheme is a
  // PATCH), and nothing aimed at A.
  assert.deepEqual(writes.map((w) => `${w.method} ${w.table}`), ['POST builder_themes']);
});

test('the copy keeps the theme itself: colours, fonts, palette, page layout and images', async () => {
  const { db, routes } = load(world());
  const handle = routes.createHandler();
  const res = await call(handle, { path: IMPORT_PATH('theme-forest-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 201);
  const copy = db.builder_themes.find((r) => r.project_id === 'proj-b' && r.name === 'Forest');
  const source = db.builder_themes.find((r) => r.id === 'theme-forest-a');
  for (const key of ['primary_color', 'background_color', 'accent_color', 'border_thickness', 'border_radius', 'contrast_level', 'logo_wide_id']) {
    assert.equal(copy[key], source[key], key);
  }
  assert.deepEqual(copy.typography, source.typography);
  assert.notEqual(copy.typography, source.typography, 'deep-copied, not shared');
  assert.equal(res.body.theme.contentWidth, 1200);
});

test('A is unchanged after B imports', async () => {
  const before = world();
  const { db, routes } = load(before);
  await call(routes.createHandler(), { path: IMPORT_PATH('theme-ocean-a'), activeProjectId: 'proj-b' });
  const aNow = db.builder_themes.filter((r) => r.project_id === 'proj-a');
  const aBefore = before.builder_themes.filter((r) => r.project_id === 'proj-a');
  assert.deepEqual(aNow, aBefore);
});

test('the copy row never carries is_default true even when the source does', () => {
  const { sharedImport } = load();
  const row = sharedImport.buildImportedThemeRow(themeRow('x', 'proj-a', { is_default: true }), {
    id: 'new', name: 'X', targetProjectId: 'proj-b', ownerUserId: 'dana',
  });
  assert.equal(row.is_default, false);
  assert.equal(row.project_id, 'proj-b');
  assert.equal(row.owner_user_id, 'dana');
  assert.equal(row.id, 'new');
  assert.equal('created_at' in row, false);
});

// ---------------------------------------------------------------------------
// Who may copy what
// ---------------------------------------------------------------------------

test('after A unshares, import is refused (404) and B keeps the copy it already made', async () => {
  const { db, routes } = load(world());
  const handle = routes.createHandler();
  const first = await call(handle, { path: IMPORT_PATH('theme-forest-a'), activeProjectId: 'proj-b' });
  assert.equal(first.status, 201);

  db.builder_project_shares = [];
  const listed = await call(handle, { method: 'GET', path: '/api/builder/shared/themes', activeProjectId: 'proj-b' });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.items, [], 'the shared group empties');

  const second = await call(handle, { path: IMPORT_PATH('theme-ocean-a'), activeProjectId: 'proj-b' });
  assert.equal(second.status, 404);
  assert.equal(second.body.error.code, 'NOT_SHARED');
  assert.ok(db.builder_themes.some((r) => r.project_id === 'proj-b' && r.name === 'Forest'), 'the earlier copy remains');
});

test('a theme from a project that shares nothing with B cannot be imported', async () => {
  const { db, writes, routes } = load(world());
  const res = await call(routes.createHandler(), { path: IMPORT_PATH('theme-secret-c'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
  assert.equal(db.builder_themes.filter((r) => r.project_id === 'proj-b').length, 2);
});

test('a share of a DIFFERENT type does not let themes through', async () => {
  const { writes, routes } = load({
    ...world(),
    builder_project_shares: [share('proj-a', 'proj-b', 'saved_sections')],
  });
  const res = await call(routes.createHandler(), { path: IMPORT_PATH('theme-ocean-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('importing your own theme is refused rather than duplicated', async () => {
  const { writes, routes } = load(world([share('proj-b', 'proj-a')]));
  const res = await call(routes.createHandler(), { path: IMPORT_PATH('theme-ocean-b'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 404);
  assert.equal(writes.length, 0);
});

test('no signed-in user or no active project is refused before anything is read', async () => {
  const { writes, routes } = load(world());
  const handle = routes.createHandler();
  const anon = await call(handle, { path: IMPORT_PATH('theme-ocean-a'), userId: '', activeProjectId: 'proj-b' });
  assert.equal(anon.status, 401);
  const noProject = await call(handle, { path: IMPORT_PATH('theme-ocean-a') });
  assert.equal(noProject.status, 400);
  assert.equal(writes.length, 0);
});

test('a copy that cannot be read back in B is reported as a failed import', async () => {
  // The insert "succeeds" but lands without the tenant column — the
  // scopedInsertRow failure shape (landmine 12).
  const { routes } = load(world(), { onPost: (body) => body.map((r) => ({ ...r, project_id: null })) });
  const res = await call(routes.createHandler(), { path: IMPORT_PATH('theme-ocean-a'), activeProjectId: 'proj-b' });
  assert.equal(res.status, 500);
  assert.match(res.body.error.message, /could not be found in this project/);
});
