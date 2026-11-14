'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Readable } = require('stream');

/**
 * Assets › Context, slice 1 (SC-808): the store and the route.
 *
 * Runs against a fake database whose schema is READ FROM
 * docs/SQL/context_entries_setup.sql, so dropping a tenant column from the SQL
 * fails these tests rather than passing a hand-copied schema.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'context_entries_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const scopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/contextStore.js');
const routePath = require.resolve('../../routes/context.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withStore({ sql = SQL_PATH, failWith = null } = {}) {
  const db = sql ? createFakeDb(parseSchemaFile(sql)) : null;
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({}),
    sbQuery: async (args) => (failWith
      ? failWith
      : db
      ? db.sbQuery(args)
      : { ok: false, status: 404, error: 'relation "public.context_entries" does not exist' }),
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

async function rawRows(db) {
  const res = await db.sbQuery({ method: 'GET', table: 'context_entries', query: 'select=*' });
  return res.data;
}

function fakeReq({ method, json, projectId = 'proj_a', userId = 'user_1' }) {
  const req = Readable.from(json === undefined ? [] : [JSON.stringify(json)]);
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  req.projectContext = { project: { id: projectId }, projects: [{ id: projectId }] };
  req.authUser = { id: userId };
  return req;
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (text) => { res.body = text || ''; };
  res.json = () => JSON.parse(res.body);
  return res;
}

async function call(route, method, pathname, opts = {}) {
  const res = fakeRes();
  const handled = await route.handle(fakeReq({ method, ...opts }), res, pathname, method);
  assert.equal(handled, true, `${method} ${pathname} was not handled`);
  return { status: res.statusCode, body: res.json() };
}

const RICH = '<h2>Brand voice</h2><ul><li><strong>Warm</strong></li><li>Plain</li></ul>';

test('a saved entry carries BOTH project_id and owner_user_id, and keeps its formatting', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const saved = await store.createEntry({ title: '  Brand   voice ', bodyHtml: RICH }, SCOPE_A);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.status, 201);
  assert.equal(saved.data.title, 'Brand voice');
  assert.equal(saved.data.kind, 'note');

  const rows = await rawRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_id, 'proj_a');
  assert.equal(rows[0].owner_user_id, 'user_1');
  assert.equal(rows[0].body_html, RICH);
});

test('entries in one project do not appear, change or delete from another', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  const a = await store.createEntry({ title: 'A only', bodyHtml: '<p>a</p>' }, SCOPE_A);
  await store.createEntry({ title: 'B only', bodyHtml: '<p>b</p>' }, SCOPE_B);

  const listA = await store.listEntries(100, SCOPE_A);
  assert.deepEqual(listA.data.map((e) => e.title), ['A only']);
  const listB = await store.listEntries(100, SCOPE_B);
  assert.deepEqual(listB.data.map((e) => e.title), ['B only']);

  const edit = await store.updateEntry(a.data.id, { title: 'hijacked' }, SCOPE_B);
  assert.equal(edit.ok, false);
  assert.equal(edit.status, 404);
  const del = await store.deleteEntry(a.data.id, SCOPE_B);
  assert.equal(del.status, 404);
  assert.equal((await store.getEntry(a.data.id, SCOPE_A)).data.title, 'A only');
});

test('the list takes the limit first: a scope in the limit position is refused, not unscoped', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  await store.createEntry({ title: 'x', bodyHtml: '' }, SCOPE_A);
  const wrong = await store.listEntries(SCOPE_A);
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /limit must be a number/);
});

test('edit changes the entry and delete removes it', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const made = await store.createEntry({ title: 'Draft', bodyHtml: '<p>one</p>' }, SCOPE_A);
  const edited = await store.updateEntry(made.data.id, { title: 'Final', bodyHtml: '<p>two</p>' }, SCOPE_A);
  assert.equal(edited.ok, true, edited.error);
  const read = await store.getEntry(made.data.id, SCOPE_A);
  assert.equal(read.data.title, 'Final');
  assert.equal(read.data.bodyHtml, '<p>two</p>');

  const removed = await store.deleteEntry(made.data.id, SCOPE_A);
  assert.equal(removed.ok, true, removed.error);
  assert.equal((await rawRows(db)).length, 0);
});

test('a title is required, and a non-uuid id reads as not found rather than a server fault', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  const blank = await store.createEntry({ title: '   ', bodyHtml: '<p>x</p>' }, SCOPE_A);
  assert.equal(blank.status, 400);
  assert.match(blank.error, /needs a title/);
  const bad = await store.getEntry('not-a-uuid', SCOPE_A);
  assert.equal(bad.status, 404);
  const nothing = await store.updateEntry('00000000-0000-0000-0000-000000000000', {}, SCOPE_A);
  assert.equal(nothing.status, 400);
});

test('a missing table is reported as missing, naming the SQL file, never as an empty list', async (t) => {
  const { store, restore } = withStore({ sql: null });
  t.after(restore);
  const list = await store.listEntries(100, SCOPE_A);
  assert.equal(list.ok, false);
  assert.equal(list.status, 503);
  assert.match(list.error, /context_entries_setup\.sql/);
});

test('route: POST, GET, PATCH, DELETE answer in the envelope and stay in the active project', async (t) => {
  const { route, restore } = withStore();
  t.after(restore);
  const created = await call(route, 'POST', '/api/context', { json: { title: 'Pricing', bodyHtml: RICH } });
  assert.equal(created.status, 201);
  assert.equal(created.body.ok, true);
  const id = created.body.data.entry.id;

  const listA = await call(route, 'GET', '/api/context');
  assert.equal(listA.body.data.total, 1);
  assert.equal(listA.body.data.entries[0].bodyHtml, RICH);
  const listB = await call(route, 'GET', '/api/context', { projectId: 'proj_b' });
  assert.equal(listB.body.data.total, 0);

  const patched = await call(route, 'PATCH', `/api/context/${id}`, { json: { title: 'Pricing 2026' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.entry.title, 'Pricing 2026');

  const refused = await call(route, 'POST', '/api/context', { json: { title: '' } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.ok, false);

  const deleted = await call(route, 'DELETE', `/api/context/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await call(route, 'GET', '/api/context')).body.data.total, 0);
});

test('route: a path it does not own falls through', async (t) => {
  const { route, restore } = withStore();
  t.after(restore);
  const res = fakeRes();
  assert.equal(await route.handle(fakeReq({ method: 'GET' }), res, '/api/contexts', 'GET'), false);
  assert.equal(await route.handle(fakeReq({ method: 'GET' }), res, '/api/context/a/b', 'GET'), false);
});

test('a tenant admin session (a client\'s own site login) is refused on every /api/context path', () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth');
  assert.equal(acceptsProjectAdminSession('/api/context'), false);
  assert.equal(acceptsProjectAdminSession('/api/context/'), false);
  assert.equal(acceptsProjectAdminSession('/api/context/00000000-0000-0000-0000-000000000000'), false);
  // Control: the deny entry is not so broad it catches a tenant's own media.
  assert.equal(acceptsProjectAdminSession('/api/assets'), true);
});

test('a database that did not answer is not reported as a missing table', async (t) => {
  const { store, restore } = withStore({ failWith: { ok: false, status: 502, error: 'Bad gateway' } });
  t.after(restore);
  const list = await store.listEntries(100, SCOPE_A);
  assert.equal(list.ok, false);
  assert.equal(list.status, 503);
  assert.match(list.error, /Could not reach the database/);
  assert.doesNotMatch(list.error, /context_entries_setup\.sql/);
});

test('bodyHtml: null on an edit leaves the note alone instead of erasing it', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  const made = await store.createEntry({ title: 'Keep', bodyHtml: RICH }, SCOPE_A);
  const edited = await store.updateEntry(made.data.id, { title: 'Kept', bodyHtml: null }, SCOPE_A);
  assert.equal(edited.ok, true, edited.error);
  const read = await store.getEntry(made.data.id, SCOPE_A);
  assert.equal(read.data.title, 'Kept');
  assert.equal(read.data.bodyHtml, RICH);
});
