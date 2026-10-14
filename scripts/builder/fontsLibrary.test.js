'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Readable } = require('stream');

/**
 * Font Library 1/7 (86bchyd3n): the storage and the rules.
 *
 * The store runs against a fake database whose schema is read from
 * docs/SQL/fonts_library_setup.sql, so deleting a tenant column or a licence
 * from the SQL fails these tests rather than passing a hand-copied schema.
 * Blob storage is a counter, so "a refused font stores nothing" is proved by
 * the number of files written, not by a log line.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'fonts_library_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');
const { checkFontLicence, checkFontFamilyName, LICENCE_REFUSED_MESSAGE } = require('../../lib/fontLicence.js');
const { detectFontFormat, inferFontStyle } = require('../../lib/fontFiles.js');
const { readFontUploadBody, MAX_FILE_BYTES } = require('../../lib/fontUploadBody.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const scopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/fontsStore.js');
const uploadPath = require.resolve('../../lib/fontUpload.js');
const routePath = require.resolve('../../routes/fonts.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

// The first four bytes are what makes a file a font; the rest is padding.
const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), Buffer.alloc(60, 1)]);
const TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(60, 2)]);

function withStore() {
  const db = createFakeDb(parseSchemaFile(SQL_PATH));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({}),
    sbQuery: async (args) => db.sbQuery(args),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  // projectScope caches its column probe per table name; each test gets a
  // fresh one so it asks THIS database.
  for (const p of [scopePath, storePath, uploadPath, routePath]) delete require.cache[p];
  const store = require(storePath);
  const upload = require(uploadPath);
  const route = require(routePath);

  const blobs = { puts: [], deletes: [] };
  const deps = {
    uploadBufferToBlobAtPath: async ({ pathname }) => {
      blobs.puts.push(pathname);
      return { ok: true, status: 201, data: { location: `https://blob.test/${pathname}`, pathname } };
    },
    deleteBlob: async (url) => {
      blobs.deletes.push(url);
      return { ok: true, status: 200 };
    },
  };

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [scopePath, storePath, uploadPath, routePath]) delete require.cache[p];
  }
  return { db, store, upload, route, blobs, deps, restore };
}

async function rawRows(db) {
  const res = await db.sbQuery({ method: 'GET', table: 'fonts', query: 'select=*' });
  return res.data;
}

function form(fields, files) {
  return { ok: true, fields, files };
}

const OFL_FIELDS = { family: 'Space Grotesk', category: 'sans', licence: 'OFL-1.1' };

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

// ── The licence gate ────────────────────────────────────────────────────────

test('the licence gate accepts exactly the three commercial-use licences', () => {
  for (const licence of ['OFL-1.1', 'Apache-2.0', 'public-domain']) {
    assert.deepEqual(checkFontLicence(licence), { ok: true, licence });
  }
});

test('the licence gate refuses personal-use and anything it does not recognise, in plain words', () => {
  for (const licence of ['personal-use', 'free for personal use', 'OFL', 'ofl-1.1', 'MIT', '', null, undefined]) {
    const res = checkFontLicence(licence);
    assert.equal(res.ok, false, `"${licence}" should be refused`);
    assert.equal(res.message, LICENCE_REFUSED_MESSAGE);
  }
  assert.match(LICENCE_REFUSED_MESSAGE, /does not allow use on a business website/);
});

test('a family name is letters, digits, single spaces and hyphens — nothing that could break CSS', () => {
  for (const ok of ['Space Grotesk', 'Inter', 'Press Start 2P', 'Fira-Code']) {
    assert.equal(checkFontFamilyName(ok).ok, true, ok);
  }
  for (const bad of ['', 'Evil"; } body { x', 'Two  Spaces', 'Trailing-', 'Font/Path', 'Ünïcödé', 'a'.repeat(81)]) {
    assert.equal(checkFontFamilyName(bad).ok, false, `"${bad}" should be refused`);
  }
});

// ── Files ───────────────────────────────────────────────────────────────────

test('a font file must be what its extension says it is', () => {
  assert.equal(detectFontFormat('x.woff2', WOFF2).format, 'woff2');
  assert.equal(detectFontFormat('x.ttf', TTF).mime, 'font/ttf');
  assert.equal(detectFontFormat('x.woff2', TTF).ok, false, 'a TrueType file named .woff2');
  assert.equal(detectFontFormat('x.exe', WOFF2).ok, false, 'an extension that is not a font');
  assert.equal(detectFontFormat('x.woff2', Buffer.from('<html>')).ok, false, 'a web page named .woff2');
});

test('weight and style are read from the usual file names', () => {
  assert.deepEqual(inferFontStyle('Inter-SemiBoldItalic.woff2'), { weight: 600, style: 'italic' });
  assert.deepEqual(inferFontStyle('Inter-ExtraBold.ttf'), { weight: 800, style: 'normal' });
  assert.deepEqual(inferFontStyle('inter-latin-700-normal.woff2'), { weight: 700, style: 'normal' });
  assert.deepEqual(inferFontStyle('Inter-Regular.otf'), { weight: 400, style: 'normal' });
  assert.deepEqual(inferFontStyle('MyFont.woff2'), { weight: 400, style: 'normal' });
});

test('a JSON upload is read back into its fields and files, bytes intact', () => {
  const parsed = readFontUploadBody({
    family: 'Space Grotesk',
    tags: ['sci-fi', 'display'],
    styles: [{ weight: 700, style: 'normal' }],
    files: [{ name: 'SG-Bold.woff2', data: `data:font/woff2;base64,${WOFF2.toString('base64')}` }],
  });
  assert.equal(parsed.ok, true, parsed.message);
  assert.equal(parsed.fields.family, 'Space Grotesk');
  assert.deepEqual(JSON.parse(parsed.fields.tags), ['sci-fi', 'display']);
  assert.deepEqual(JSON.parse(parsed.fields.styles), [{ weight: 700, style: 'normal' }]);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].fileName, 'SG-Bold.woff2');
  assert.ok(parsed.files[0].buffer.equals(WOFF2), 'the file bytes changed on the way through');
});

test('a JSON upload refuses bad base64, a nameless file, and files over the size cap — in words', () => {
  const bad = readFontUploadBody({ files: [{ name: 'A.woff2', data: 'not base64!' }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.match(bad.message, /base64/);
  assert.equal(readFontUploadBody({ files: [{ data: WOFF2.toString('base64') }] }).ok, false);
  assert.equal(readFontUploadBody({ files: 'A.woff2' }).ok, false);
  assert.equal(readFontUploadBody(null).ok, false);
  const big = Buffer.alloc(MAX_FILE_BYTES + 3).toString('base64');
  const tooBig = readFontUploadBody({ files: [{ name: 'Big.woff2', data: big }] });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.message, /Upload fewer files/);
});

// ── Store: tenancy and the platform/project split ───────────────────────────

test('a project font is stamped with its project and user — read from the row, not the insert', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const res = await store.createFont({
    ...OFL_FIELDS,
    styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/a.woff2' }],
  }, SCOPE_A);
  assert.equal(res.ok, true, res.error);
  const [row] = await rawRows(db);
  assert.equal(row.project_id, 'proj_a');
  assert.equal(row.owner_user_id, 'user_1');
  assert.equal(row.visibility, 'project');
});

test('the list is the shared library plus this project, and never another project', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  await platformFont(store, 'Orbitron');
  for (const [scope, family] of [[SCOPE_A, 'Alpha Sans'], [SCOPE_B, 'Bravo Sans']]) {
    const res = await store.createFont({ ...OFL_FIELDS, family, styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/x.woff2' }] }, scope);
    assert.equal(res.ok, true, res.error);
  }
  const listA = await store.listFonts(100, SCOPE_A);
  assert.deepEqual(listA.data.map((f) => f.family), ['Alpha Sans', 'Orbitron']);
  const listB = await store.listFonts(100, SCOPE_B);
  assert.deepEqual(listB.data.map((f) => f.family), ['Bravo Sans', 'Orbitron']);
});

test('the list refuses a scope passed where the limit goes, and a missing project', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);
  assert.equal((await store.listFonts(SCOPE_A)).ok, false);
  assert.equal((await store.listFonts(100, {})).ok, false);
});

test('a project cannot retag or delete a shared-library font: 403, and the row is unchanged', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const shared = await platformFont(store, 'Orbitron');
  const retag = await store.updateFontTags(shared.id, { tags: ['mine'] }, SCOPE_A);
  assert.equal(retag.status, 403);
  assert.match(retag.error, /shared font library/);
  const del = await store.deleteFont(shared.id, SCOPE_A);
  assert.equal(del.status, 403);
  const rows = await rawRows(db);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].tags, []);
});

test("a project cannot see, retag or delete another project's font", async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const own = await store.createFont({ ...OFL_FIELDS, styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/x.woff2' }] }, SCOPE_A);
  assert.equal((await store.getFont(own.data.id, SCOPE_B)).status, 404);
  assert.equal((await store.updateFontTags(own.data.id, { tags: ['x'] }, SCOPE_B)).status, 404);
  assert.equal((await store.deleteFont(own.data.id, SCOPE_B)).status, 404);
  assert.equal((await rawRows(db)).length, 1);
});

test('a project retags and deletes its own font', async (t) => {
  const { db, store, restore } = withStore();
  t.after(restore);
  const own = await store.createFont({ ...OFL_FIELDS, styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/x.woff2' }] }, SCOPE_A);
  const retag = await store.updateFontTags(own.data.id, { tags: ['Sci-Fi', 'sci-fi', ' Retro '], previewText: 'Hello' }, SCOPE_A);
  assert.equal(retag.ok, true, retag.error);
  assert.deepEqual(retag.data.tags, ['sci-fi', 'retro']);
  assert.equal(retag.data.previewText, 'Hello');
  const del = await store.deleteFont(own.data.id, SCOPE_A);
  assert.equal(del.ok, true, del.error);
  assert.equal((await rawRows(db)).length, 0);
});

// ── Upload: the licence gate stores nothing ─────────────────────────────────

test('an OFL font is stored: files to blob storage, then a row pointing at them', async (t) => {
  const { db, upload, blobs, deps, restore } = withStore();
  t.after(restore);
  const res = await upload.uploadProjectFont(form(OFL_FIELDS, [
    { fileName: 'SpaceGrotesk-Regular.woff2', buffer: WOFF2 },
    { fileName: 'SpaceGrotesk-Bold.woff2', buffer: WOFF2 },
  ]), SCOPE_A, deps);
  assert.equal(res.ok, true, res.error);
  assert.equal(blobs.puts.length, 2);
  assert.deepEqual(res.data.styles.map((s) => `${s.weight}-${s.style}`), ['400-normal', '700-normal']);
  const [row] = await rawRows(db);
  assert.equal(row.project_id, 'proj_a');
  assert.equal(row.source_name, 'Upload');
  assert.ok(row.styles.every((s) => s.url.startsWith('https://blob.test/Fonts/proj_a/space-grotesk-')));
});

test('a personal-use font is refused with the plain message and NOTHING is stored', async (t) => {
  const { db, upload, blobs, deps, restore } = withStore();
  t.after(restore);
  const res = await upload.uploadProjectFont(form({ ...OFL_FIELDS, licence: 'personal-use' }, [
    { fileName: 'SpaceGrotesk-Regular.woff2', buffer: WOFF2 },
  ]), SCOPE_A, deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.error, LICENCE_REFUSED_MESSAGE);
  assert.equal(blobs.puts.length, 0, 'a refused font wrote a file to blob storage');
  assert.equal((await rawRows(db)).length, 0);
});

test('a file that is not a font, or a family already here, stores nothing', async (t) => {
  const { db, upload, blobs, deps, restore } = withStore();
  t.after(restore);
  const bad = await upload.uploadProjectFont(form(OFL_FIELDS, [
    { fileName: 'SpaceGrotesk-Regular.woff2', buffer: WOFF2 },
    { fileName: 'virus.woff2', buffer: Buffer.from('MZ not a font at all') },
  ]), SCOPE_A, deps);
  assert.equal(bad.status, 400);
  assert.equal(blobs.puts.length, 0);

  const first = await upload.uploadProjectFont(form(OFL_FIELDS, [{ fileName: 'a.woff2', buffer: WOFF2 }]), SCOPE_A, deps);
  assert.equal(first.ok, true, first.error);
  const again = await upload.uploadProjectFont(form(OFL_FIELDS, [{ fileName: 'a.woff2', buffer: WOFF2 }]), SCOPE_A, deps);
  assert.equal(again.status, 409);
  assert.equal(blobs.puts.length, 1, 'the duplicate wrote files before being refused');
  assert.equal((await rawRows(db)).length, 1);
});

test('two files claiming the same weight and style are refused before anything is stored', async (t) => {
  const { upload, blobs, deps, restore } = withStore();
  t.after(restore);
  const res = await upload.uploadProjectFont(form(OFL_FIELDS, [
    { fileName: 'one.woff2', buffer: WOFF2 },
    { fileName: 'two.woff2', buffer: WOFF2 },
  ]), SCOPE_A, deps);
  assert.equal(res.status, 400);
  assert.match(res.error, /both weight 400 normal/);
  assert.equal(blobs.puts.length, 0);
});

test('if the row is refused after the files are stored, the files are removed again', async (t) => {
  const { upload, blobs, deps, restore } = withStore();
  t.after(restore);
  const realStore = require(storePath);
  const store = { ...realStore, createFont: async () => ({ ok: false, status: 500, error: 'database said no' }) };
  const res = await upload.uploadProjectFont(form(OFL_FIELDS, [
    { fileName: 'a-Regular.woff2', buffer: WOFF2 },
    { fileName: 'a-Bold.woff2', buffer: WOFF2 },
  ]), SCOPE_A, { ...deps, store });
  assert.equal(res.ok, false);
  assert.equal(blobs.puts.length, 2);
  assert.equal(blobs.deletes.length, 2, 'orphaned font files were left on blob storage');
});

// ── The route ───────────────────────────────────────────────────────────────

function fakeReq({ method, body, contentType, projectId = 'proj_a' }) {
  const req = Readable.from(body ? [body] : []);
  req.method = method;
  req.headers = { 'content-type': contentType || 'application/json' };
  req.projectContext = { project: { id: projectId }, projects: [{ id: projectId }] };
  req.authUser = { id: 'user_1' };
  return req;
}

/**
 * A request the way Vercel's Node runtime hands it over: the stream has
 * already been read to the end, and `req.body` is the parsed JSON — or
 * undefined for any type it does not parse, multipart among them. A handler
 * that listens on this stream waits forever.
 */
async function vercelReq({ method, json, contentType = 'application/json', projectId = 'proj_a' }) {
  const req = fakeReq({ method, contentType, projectId });
  req.resume();
  await new Promise((resolve) => req.once('end', resolve));
  if (json !== undefined) req.body = json;
  return req;
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (text) => { res.body = text || ''; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function uploadJson(fields, files) {
  return { ...fields, files: files.map((f) => ({ name: f.fileName, data: f.buffer.toString('base64') })) };
}

// A hang is the failure being guarded against, so it must fail the test, not stall it.
function withinOneSecond(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HANG: the handler never answered')), 1000); }),
  ]).finally(() => clearTimeout(timer));
}

test('POST /api/fonts: OFL stores and returns the font; personal-use answers 400 with the message', async (t) => {
  const { db, route, blobs, deps, restore } = withStore();
  t.after(restore);

  // The Vercel shape: stream already drained, body parsed onto req.body.
  const good = uploadJson(OFL_FIELDS, [{ fileName: 'SG-Regular.woff2', buffer: WOFF2 }]);
  const res1 = fakeRes();
  const req1 = await vercelReq({ method: 'POST', json: good });
  assert.equal(await withinOneSecond(route.handle(req1, res1, '/api/fonts', 'POST', deps)), true);
  assert.equal(res1.statusCode, 201, res1.body);
  assert.equal(res1.json().data.font.family, 'Space Grotesk');

  // The local shape: server.js never pre-reads, so the JSON is on the stream.
  const refused = uploadJson({ ...OFL_FIELDS, family: 'Other Font', licence: 'personal-use' }, [{ fileName: 'O.woff2', buffer: WOFF2 }]);
  const res2 = fakeRes();
  await withinOneSecond(route.handle(fakeReq({ method: 'POST', body: JSON.stringify(refused) }), res2, '/api/fonts', 'POST', deps));
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.json().error.message, LICENCE_REFUSED_MESSAGE);
  assert.equal(blobs.puts.length, 1, 'the refused upload stored a file');
  assert.equal((await rawRows(db)).length, 1);
});

test('POST /api/fonts as a multipart form answers 415 at once on Vercel, instead of hanging until timeout', async (t) => {
  const { db, route, blobs, deps, restore } = withStore();
  t.after(restore);
  for (const contentType of ['multipart/form-data; boundary=----x', '']) {
    const res = fakeRes();
    // On Vercel a multipart body is read and discarded: drained stream, no req.body.
    const req = await vercelReq({ method: 'POST', contentType });
    if (!contentType) req.headers = {};
    await withinOneSecond(route.handle(req, res, '/api/fonts', 'POST', deps));
    assert.equal(res.statusCode, 415, res.body);
    assert.match(res.json().error.message, /JSON/);
  }
  assert.equal(blobs.puts.length, 0);
  assert.equal((await rawRows(db)).length, 0);
});

test('GET /api/fonts lists the shared library and this project; DELETE of a shared font is 403', async (t) => {
  const { store, route, deps, restore } = withStore();
  t.after(restore);
  const shared = await platformFont(store, 'Orbitron');
  await store.createFont({ ...OFL_FIELDS, family: 'Bravo Sans', styles: [{ weight: 400, style: 'normal', url: 'https://blob.test/b.woff2' }] }, SCOPE_B);

  const list = fakeRes();
  await route.handle(fakeReq({ method: 'GET' }), list, '/api/fonts', 'GET', deps);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().data.fonts.map((f) => f.family), ['Orbitron']);

  const del = fakeRes();
  await route.handle(fakeReq({ method: 'DELETE' }), del, `/api/fonts/${shared.id}`, 'DELETE', deps);
  assert.equal(del.statusCode, 403);
  assert.match(del.json().error.message, /shared font library/);
});

test('the route does not claim paths that are not its own', async (t) => {
  const { route, restore } = withStore();
  t.after(restore);
  assert.equal(await route.handle(fakeReq({ method: 'GET' }), fakeRes(), '/api/fontsx', 'GET'), false);
  assert.equal(await route.handle(fakeReq({ method: 'GET' }), fakeRes(), '/api/fonts/a/b', 'GET'), false);
});
