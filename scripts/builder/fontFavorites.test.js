'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

/**
 * Font Library 8 (86bchydpv): each PERSON stars fonts, and the list says which.
 *
 * The fake database reads both setup files, so a missing unique index or a
 * renamed column fails here rather than passing a hand-copied schema. Every
 * assertion about what is starred reads the stored rows or the API answer,
 * never the write's own return value.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const scopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/fontsStore.js');
const routePath = require.resolve('../../routes/fonts.js');

function withStore({ favoritesTable = true } = {}) {
  let sql = fs.readFileSync(path.join(SQL_DIR, 'fonts_library_setup.sql'), 'utf8');
  if (favoritesTable) sql += `\n${fs.readFileSync(path.join(SQL_DIR, 'font_favorites_setup.sql'), 'utf8')}`;
  const db = createFakeDb(parseSchemaText(sql));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({}),
    sbQuery: async (args) => db.sbQuery(args),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [scopePath, storePath, routePath]) delete require.cache[p];
  const store = require(storePath);
  const route = require(routePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [scopePath, storePath, routePath]) delete require.cache[p];
  }
  return { db, store, route, restore };
}

async function platformFont(store, family) {
  const res = await store.createFont({
    family,
    category: 'display',
    licence: 'OFL-1.1',
    styles: [{ weight: 400, style: 'normal', url: `https://blob.test/${family}.woff2` }],
  }, null, { visibility: 'platform' });
  assert.equal(res.ok, true, res.error);
  return res.data;
}

async function favoriteRows(db) {
  const res = await db.sbQuery({ method: 'GET', table: 'font_favorites', query: 'select=*' });
  assert.equal(res.ok, true, res.error);
  return res.data;
}

function fakeReq({ method, userId = 'user_1', projectId = 'proj_a' }) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  req.projectContext = { project: { id: projectId }, projects: [{ id: projectId }] };
  if (userId) req.authUser = { id: userId };
  return req;
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (text) => { res.body = text || ''; };
  res.json = () => JSON.parse(res.body);
  return res;
}

async function call(route, { method, path: p, userId, projectId }) {
  const res = fakeRes();
  const handled = await route.handle(fakeReq({ method, userId, projectId }), res, p, method, {});
  assert.equal(handled, true, `${method} ${p} was not handled`);
  return res;
}

async function starredFamilies(route, userId, projectId) {
  const res = await call(route, { method: 'GET', path: '/api/fonts', userId, projectId });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().data.fonts.filter((f) => f.isFavorite).map((f) => f.family);
}

test('PUT stars a font, GET then marks it isFavorite, DELETE unstars it — read back each time', async (t) => {
  const { db, store, route, restore } = withStore();
  t.after(restore);
  const orbitron = await platformFont(store, 'Orbitron');
  await platformFont(store, 'Bungee');

  assert.deepEqual(await starredFamilies(route, 'user_1'), []);

  const put = await call(route, { method: 'PUT', path: `/api/fonts/${orbitron.id}/favorite` });
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(put.json().data, { fontId: orbitron.id, isFavorite: true });
  assert.deepEqual(await starredFamilies(route, 'user_1'), ['Orbitron']);
  const rows = await favoriteRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'user_1');

  // Starring twice is not an error and does not make a second row (landmine 15).
  const again = await call(route, { method: 'PUT', path: `/api/fonts/${orbitron.id}/favorite` });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal((await favoriteRows(db)).length, 1);

  const del = await call(route, { method: 'DELETE', path: `/api/fonts/${orbitron.id}/favorite` });
  assert.equal(del.statusCode, 200, del.body);
  assert.deepEqual(del.json().data, { fontId: orbitron.id, isFavorite: false });
  assert.deepEqual(await starredFamilies(route, 'user_1'), []);
  assert.equal((await favoriteRows(db)).length, 0);
});

test("another person's stars never appear in mine — even in the same project", async (t) => {
  const { store, route, restore } = withStore();
  t.after(restore);
  const orbitron = await platformFont(store, 'Orbitron');
  const bungee = await platformFont(store, 'Bungee');

  await call(route, { method: 'PUT', path: `/api/fonts/${orbitron.id}/favorite`, userId: 'user_1' });
  await call(route, { method: 'PUT', path: `/api/fonts/${bungee.id}/favorite`, userId: 'user_2' });

  assert.deepEqual(await starredFamilies(route, 'user_1'), ['Orbitron']);
  assert.deepEqual(await starredFamilies(route, 'user_2'), ['Bungee']);

  // Unstarring mine leaves theirs alone.
  await call(route, { method: 'DELETE', path: `/api/fonts/${bungee.id}/favorite`, userId: 'user_1' });
  assert.deepEqual(await starredFamilies(route, 'user_2'), ['Bungee']);
});

test('stars follow the person across projects, for the fonts each project can see', async (t) => {
  const { store, route, restore } = withStore();
  t.after(restore);
  const orbitron = await platformFont(store, 'Orbitron');
  await call(route, { method: 'PUT', path: `/api/fonts/${orbitron.id}/favorite`, projectId: 'proj_a' });
  assert.deepEqual(await starredFamilies(route, 'user_1', 'proj_b'), ['Orbitron']);
});

test("a font this project cannot see cannot be starred: 404, nothing stored", async (t) => {
  const { db, store, route, restore } = withStore();
  t.after(restore);
  const theirs = await store.createFont({
    family: 'Bravo Sans',
    category: 'sans',
    licence: 'OFL-1.1',
    styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/b.woff2' }],
  }, { projectId: 'proj_b', userId: 'user_2' });
  assert.equal(theirs.ok, true, theirs.error);

  const res = await call(route, { method: 'PUT', path: `/api/fonts/${theirs.data.id}/favorite`, projectId: 'proj_a' });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal((await favoriteRows(db)).length, 0);
});

test('starring with nobody signed in is refused in words', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  const orbitron = await platformFont(store, 'Orbitron');
  const res = await store.setFontFavorite(orbitron.id, true, { projectId: 'proj_a' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.match(res.error, /Nobody is signed in/);
});

test('if the favourites table is missing the library still lists, and says why nothing is starred', async (t) => {
  const { store, route, restore } = withStore({ favoritesTable: false });
  t.after(restore);
  await platformFont(store, 'Orbitron');
  const res = await call(route, { method: 'GET', path: '/api/fonts' });
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json().data;
  assert.deepEqual(data.fonts.map((f) => [f.family, f.isFavorite]), [['Orbitron', false]]);
  assert.match(data.favoritesError, /favourite fonts could not be read/);
});

test('the setup SQL keeps one star per person per font, with RLS on', () => {
  const schema = parseSchemaText(fs.readFileSync(path.join(SQL_DIR, 'font_favorites_setup.sql'), 'utf8'));
  const unique = schema.indexes.find((i) => i.table === 'font_favorites' && i.unique && i.name === 'font_favorites_user_font_key');
  assert.ok(unique, 'the (user_id, font_id) unique index is missing');
  assert.ok([...(schema.rlsEnabled || [])].includes('font_favorites'), 'RLS is not enabled on font_favorites');
});

test('GET carries isFavorite ALONGSIDE the tags and sample line 5/7 and 7/7 added — the star does not replace them', async (t) => {
  const { store, route, restore } = withStore();
  t.after(restore);
  const created = await store.createFont({
    family: 'Exo',
    category: 'sans',
    licence: 'OFL-1.1',
    tags: ['sci-fi', 'wide'],
    previewText: 'Launch sequence',
    styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/Exo.woff2' }],
  }, null, { visibility: 'platform' });
  assert.equal(created.ok, true, created.error);

  await call(route, { method: 'PUT', path: `/api/fonts/${created.data.id}/favorite` });
  const res = await call(route, { method: 'GET', path: '/api/fonts' });
  assert.equal(res.statusCode, 200, res.body);
  const exo = res.json().data.fonts.find((f) => f.family === 'Exo');
  assert.equal(exo.isFavorite, true);
  assert.deepEqual(exo.tags, ['sci-fi', 'wide']);
  assert.equal(exo.previewText, 'Launch sequence');
  assert.equal(exo.category, 'sans');
  assert.ok(Array.isArray(exo.styles) && exo.styles.length === 1, 'styles survive');
});
