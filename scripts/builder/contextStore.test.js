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
const blobPath = require.resolve('../../lib/blobStorage.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withStore({ sql = SQL_PATH, failWith = null, blob = {} } = {}) {
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
  const deleted = [];
  const tokens = [];
  const fakeBlob = {
    isConfigured: () => blob.configured !== false,
    deleteBlob: async (url) => {
      deleted.push(url);
      return blob.deleteFails ? { ok: false, status: 502, error: blob.deleteFails } : { ok: true, status: 200 };
    },
    // Runs the route's own onBeforeGenerateToken, the way @vercel/blob does.
    handleClientUpload: async ({ body, onBeforeGenerateToken }) => {
      try {
        const opts = await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, true);
        tokens.push({ pathname: body.payload.pathname, ...opts });
        return { ok: true, status: 200, data: { type: 'blob.generate-client-token', clientToken: 'ct_fake' } };
      } catch (err) {
        return { ok: false, status: 400, error: err.message };
      }
    },
  };
  const realSupabase = require.cache[supabasePath];
  const realBlob = require.cache[blobPath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true, exports: fakeBlob };
  for (const p of [scopePath, storePath, routePath]) delete require.cache[p];
  const store = require(storePath);
  const route = require(routePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    if (realBlob) require.cache[blobPath] = realBlob;
    else delete require.cache[blobPath];
    for (const p of [scopePath, storePath, routePath]) delete require.cache[p];
  }
  return { db, store, route, restore, deleted, tokens };
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

// ── Files (SC-809) ───────────────────────────────────────────────────────────

const FILE_URL_A = 'https://abc123.public.blob.vercel-storage.com/APP/Assets/Context/proj_a/1731700000000_Price_list-Xy12.pdf';
const FILE_URL_B = 'https://abc123.public.blob.vercel-storage.com/APP/Assets/Context/proj_b/1731700000000_secret-Xy12.pdf';
const MB = 1024 * 1024;

test('a file entry is recorded with its name, type and size, titled by its file name, in both tenant columns', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const saved = await store.createEntry({ kind: 'file', file: { url: FILE_URL_A, name: 'Price list.pdf', size: 20 * MB } }, SCOPE_A);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.data.kind, 'file');
  assert.equal(saved.data.title, 'Price list.pdf');
  assert.equal(saved.data.fileUrl, FILE_URL_A);
  assert.equal(saved.data.fileType, 'application/pdf');
  assert.equal(saved.data.fileSize, 20 * MB);
  const [row] = await rawRows(db);
  assert.equal(row.project_id, 'proj_a');
  assert.equal(row.owner_user_id, 'user_1');
  assert.equal(row.file_name, 'Price list.pdf');
});

test('a file entry is refused for a wrong type, an oversize file, or an address outside this project\'s folder', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const exe = await store.createEntry({ kind: 'file', file: { url: FILE_URL_A.replace('.pdf', '.exe'), name: 'setup.exe', size: 100 } }, SCOPE_A);
  assert.equal(exe.status, 400);
  assert.equal(exe.error, 'This file type is not accepted: .exe');
  const big = await store.createEntry({ kind: 'file', file: { url: FILE_URL_A, name: 'big.pdf', size: 51 * MB } }, SCOPE_A);
  assert.equal(big.status, 400);
  assert.match(big.error, /51 MB, and the limit is 50 MB/);
  // Another project's file: recording it would let this project delete it.
  const foreign = await store.createEntry({ kind: 'file', file: { url: FILE_URL_B, name: 'secret.pdf', size: 100 } }, SCOPE_A);
  assert.equal(foreign.status, 400);
  assert.match(foreign.error, /not one of this project's uploaded context files/);
  const elsewhere = await store.createEntry({ kind: 'file', file: { url: 'https://evil.example/APP/Assets/Context/proj_a/x.pdf', name: 'x.pdf', size: 100 } }, SCOPE_A);
  assert.equal(elsewhere.status, 400);
  const sneaky = await store.createEntry({ kind: 'file', file: { url: 'https://abc.public.blob.vercel-storage.com/APP/Assets/Context/proj_a/../proj_b/x.pdf', name: 'x.pdf', size: 100 } }, SCOPE_A);
  assert.equal(sneaky.status, 400);
  const odd = await store.createEntry({ kind: 'folder', title: 'x' }, SCOPE_A);
  assert.equal(odd.status, 400);
  assert.equal((await rawRows(db)).length, 0);
});

test('deleting a file entry also deletes the stored file; a note deletes no file', async (t) => {
  const { store, restore, deleted } = withStore();
  t.after(restore);
  const file = await store.createEntry({ kind: 'file', file: { url: FILE_URL_A, name: 'Price list.pdf', size: 1000 } }, SCOPE_A);
  const note = await store.createEntry({ title: 'n', bodyHtml: '' }, SCOPE_A);
  const goneNote = await store.deleteEntry(note.data.id, SCOPE_A);
  assert.equal(goneNote.data.file, null);
  assert.deepEqual(deleted, []);
  const goneFile = await store.deleteEntry(file.data.id, SCOPE_A);
  assert.equal(goneFile.ok, true);
  assert.deepEqual(goneFile.data.file, { removed: true });
  assert.deepEqual(deleted, [FILE_URL_A]);
});

test('a stored file that could not be deleted still removes the row, and says the file was left behind and where', async (t) => {
  const { db, store, restore } = withStore({ blob: { deleteFails: 'Vercel Blob delete failed: 503 Service Unavailable' } });
  t.after(restore);
  const file = await store.createEntry({ kind: 'file', file: { url: FILE_URL_A, name: 'Price list.pdf', size: 1000 } }, SCOPE_A);
  const gone = await store.deleteEntry(file.data.id, SCOPE_A);
  assert.equal(gone.ok, true);
  assert.equal(gone.data.file.removed, false);
  assert.match(gone.data.file.error, /503 Service Unavailable/);
  assert.ok(gone.data.file.error.includes(FILE_URL_A), 'the message names where the file still is');
  assert.equal((await rawRows(db)).length, 0);
});

test('a file entry in one project cannot be deleted (nor its file) from another', async (t) => {
  const { store, restore, deleted } = withStore();
  t.after(restore);
  const file = await store.createEntry({ kind: 'file', file: { url: FILE_URL_A, name: 'a.pdf', size: 1000 } }, SCOPE_A);
  const other = await store.deleteEntry(file.data.id, SCOPE_B);
  assert.equal(other.status, 404);
  assert.deepEqual(deleted, []);
  assert.equal((await store.listEntries(100, SCOPE_B)).data.length, 0);
});

function tokenRequest(pathname, size = 1000) {
  return { type: 'blob.generate-client-token', payload: { pathname, callbackUrl: 'http://x/api/context/blob-upload', clientPayload: JSON.stringify({ size }), multipart: true } };
}

test('route: an upload token is given only for this project\'s folder and an accepted type, capped at 50MB', async (t) => {
  const { route, restore, tokens } = withStore();
  t.after(restore);
  const ok = await call(route, 'POST', '/api/context/blob-upload', { json: tokenRequest('APP/Assets/Context/proj_a/17_report.pdf') });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.clientToken, 'ct_fake');
  assert.equal(tokens[0].maximumSizeInBytes, 50 * MB);
  assert.ok(tokens[0].allowedContentTypes.includes('application/pdf'));
  assert.ok(!tokens[0].allowedContentTypes.some((type) => /video|zip|octet/.test(type)));

  const foreign = await call(route, 'POST', '/api/context/blob-upload', { json: tokenRequest('APP/Assets/Context/proj_b/17_report.pdf') });
  assert.equal(foreign.status, 400);
  assert.match(foreign.body.error.message, /active project's own folder/);
  const exe = await call(route, 'POST', '/api/context/blob-upload', { json: tokenRequest('APP/Assets/Context/proj_a/17_setup.exe') });
  assert.equal(exe.status, 400);
  assert.equal(exe.body.error.message, 'This file type is not accepted: .exe');
  const big = await call(route, 'POST', '/api/context/blob-upload', { json: tokenRequest('APP/Assets/Context/proj_a/17_big.pdf', 80 * MB) });
  assert.equal(big.status, 400);
  assert.match(big.body.error.message, /80 MB, and the limit is 50 MB/);
  assert.equal(tokens.length, 1);
});

test('route: with no file storage set up, an upload says so rather than failing vaguely', async (t) => {
  const { route, restore } = withStore({ blob: { configured: false } });
  t.after(restore);
  const res = await call(route, 'POST', '/api/context/blob-upload', { json: tokenRequest('APP/Assets/Context/proj_a/1_a.pdf') });
  assert.equal(res.status, 503);
  assert.match(res.body.error.message, /File storage \(Vercel Blob\) is not set up/);
});

test('route: POST records a file and DELETE reports what happened to it', async (t) => {
  const { route, restore, deleted } = withStore();
  t.after(restore);
  const made = await call(route, 'POST', '/api/context', { json: { kind: 'file', file: { url: FILE_URL_A, name: 'Price list.pdf', size: 2048 } } });
  assert.equal(made.status, 201);
  assert.equal(made.body.data.entry.fileName, 'Price list.pdf');
  const gone = await call(route, 'DELETE', `/api/context/${made.body.data.entry.id}`);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.data.file, { removed: true });
  assert.deepEqual(deleted, [FILE_URL_A]);
});

test('the tenant-admin deny list covers the upload endpoint too', () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth');
  assert.equal(acceptsProjectAdminSession('/api/context/blob-upload'), false);
});

test('file rules: size wording, folder, and the accept list', () => {
  const types = require('../../lib/contextFileTypes.js');
  assert.equal(types.formatFileSize(20 * MB), '20 MB');
  assert.equal(types.formatFileSize(1.5 * MB), '1.5 MB');
  assert.equal(types.formatFileSize(340 * 1024), '340 KB');
  assert.equal(types.formatFileSize(1), '1 byte');
  assert.equal(types.checkContextFile({ name: 'a.zip', size: 10 }).message, 'This file type is not accepted: .zip');
  assert.match(types.checkContextFile({ name: 'README', size: 10 }).message, /no extension/);
  assert.equal(types.checkContextFile({ name: 'Notes.MD', size: 10 }).type.label, 'Markdown');
  assert.equal(types.checkContextFile({ name: 'x.pdf', size: 50 * MB }).ok, true);
  assert.equal(types.checkContextFile({ name: 'x.pdf', size: 50 * MB + 1 }).ok, false);
  assert.equal(types.contextStoragePath('proj a', 'My file (1).pdf', 5), 'APP/Assets/Context/proj_a/5_My_file_1_.pdf');
  for (const ext of ['pdf', 'txt', 'md', 'csv', 'json', 'docx', 'xlsx', 'png', 'jpg', 'gif', 'webp']) {
    assert.ok(types.ACCEPT_ATTRIBUTE.split(',').includes(`.${ext}`), ext);
  }
});

