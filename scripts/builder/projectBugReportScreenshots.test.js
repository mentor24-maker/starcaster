'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// A server secret must exist BEFORE the lib is required-through-the-route so
// the token HMAC is stable across the test (uploads and submits agree).
process.env.BUG_REPORT_UPLOAD_SECRET = 'test-upload-secret';

/**
 * Bug Report 2/5 — screenshots. Uploads are bound to the uploader by an
 * unguessable token; submit attaches by (id, token). These tests drive the
 * real store + route against recorders for lib/supabase and lib/assetStorage
 * — no network, no storage backend.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const assetStoragePath = require.resolve('../../lib/assetStorage.js');
const adminStorePath = require.resolve('../../lib/projectAdminStore.js');
const rebuildPaths = [
  '../../lib/projectScope.js',
  '../../lib/assetsStore.js',
  '../../lib/projectsStore.js',
  '../../lib/projectBugReportsStore.js',
  '../../lib/projectBugReportScreenshots.js',
  '../../routes/publicSite.js',
].map((p) => require.resolve(p));

const realSupabase = require(supabasePath);
const KNOWN_PROJECT_ID = 'proj_1';
const OTHER_PROJECT_ID = 'proj_2';

const PNG_1x1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const EXE_B64 = Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(30)]).toString('base64');
const FOUR_MB_B64 = 'A'.repeat(Math.ceil((4 * 1024 * 1024) / 3) * 4);

function withMocks({ storageConfigured = true, assets = [], failInsert = false } = {}) {
  const calls = [];
  const uploads = [];
  const deletedBlobs = [];
  const db = { assets: assets.map((a) => ({ ...a })), bugReports: [] };
  let nextAssetId = 1500 + db.assets.length;
  let nextReportId = 1;

  const matchParam = (q, name) => {
    const m = new RegExp(`(?:^|&)${name}=eq\\.([^&]*)`).exec(q || '');
    return m ? decodeURIComponent(m[1]) : null;
  };

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ ...realSupabase.tableConfig(), projectBugReports: 'project_bug_reports', assets: 'assets' }),
    sbQuery: async (options) => {
      calls.push(options);
      const { table, method = 'GET', query = '' } = options;
      if (table === 'assets') {
        if (/select=project_id,owner_user_id/.test(query)) return { ok: true, status: 200, data: [] };
        if (method === 'POST') {
          if (failInsert) return { ok: false, status: 500, error: 'insert failed' };
          const row = { id: nextAssetId++, created_at: '2026-08-21T00:00:00Z', ...options.body[0] };
          db.assets.push(row);
          return { ok: true, status: 201, data: [row] };
        }
        const id = Number(matchParam(query, 'id'));
        const scopeMatch = /project_id\.eq\.([^,)&]*)/.exec(query || '');
        const scoped = scopeMatch ? decodeURIComponent(scopeMatch[1]) : null;
        const rows = db.assets.filter((a) => (!id || a.id === id) && (scoped === null || a.project_id === scoped));
        if (method === 'PATCH') { for (const r of rows) Object.assign(r, options.body); }
        return { ok: true, status: 200, data: rows };
      }
      if (table === 'project_bug_reports') {
        if (/select=project_id,owner_user_id/.test(query)) return { ok: true, status: 200, data: [] };
        if (method === 'POST') {
          const row = { id: `bug_${nextReportId++}`, created_at: '2026-08-21T00:00:00Z', ...options.body[0] };
          db.bugReports.push(row);
          return { ok: true, status: 201, data: [row] };
        }
        const id = matchParam(query, 'id');
        return { ok: true, status: 200, data: db.bugReports.filter((r) => !id || r.id === id) };
      }
      const id = matchParam(query, 'id');
      if (id !== null) return { ok: true, status: 200, data: [KNOWN_PROJECT_ID, OTHER_PROJECT_ID].includes(id) ? [{ id }] : [] };
      return { ok: true, status: 200, data: [] };
    },
  };
  const fakeAssetStorage = {
    isConfigured: () => storageConfigured,
    getProvider: () => 'fake',
    uploadAssetFile: async (input) => {
      uploads.push(input);
      return { ok: true, status: 201, data: { location: `https://blob.test/${input.category}/${input.fileName}`, name: input.fileName, sizeBytes: 0 } };
    },
    deleteUploadedAsset: async (location) => { deletedBlobs.push(location); return { ok: true, status: 200 }; },
  };
  const fakeAdminStore = { getAdminSession: async () => null };

  const saved = [supabasePath, assetStoragePath, adminStorePath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[assetStoragePath] = { id: assetStoragePath, filename: assetStoragePath, loaded: true, exports: fakeAssetStorage };
  require.cache[adminStorePath] = { id: adminStorePath, filename: adminStorePath, loaded: true, exports: fakeAdminStore };
  for (const p of rebuildPaths) delete require.cache[p];

  const screenshots = require('../../lib/projectBugReportScreenshots.js');
  const reportsStore = require('../../lib/projectBugReportsStore.js');
  const assetsStore = require('../../lib/assetsStore.js');
  const publicSite = require('../../routes/publicSite.js');
  function restore() {
    for (const [p, entry] of saved) { if (entry) require.cache[p] = entry; else delete require.cache[p]; }
    for (const p of rebuildPaths) delete require.cache[p];
  }
  return { screenshots, reportsStore, assetsStore, publicSite, calls, uploads, deletedBlobs, db, restore };
}

let nextIp = 1;
async function post(publicSite, path, { body = {}, ip = `203.0.113.${nextIp++}`, headers = {} } = {}) {
  const req = { method: 'POST', url: path, headers: { host: 'localhost', 'user-agent': 't', ...headers }, socket: { remoteAddress: ip }, body };
  const res = { statusCode: 0, body: '', headers: {}, setHeader() {}, end(c) { this.body = c || ''; } };
  const handled = await publicSite.handle(req, res, path, 'POST');
  let payload = null; try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}
const UPLOAD = '/api/public/bug-report/screenshot';
const SUBMIT = '/api/public/bug-report';
const upload = (ps, b64 = PNG_1x1_B64, fileName = 'shot.png', extra = {}) =>
  post(ps, UPLOAD, { body: { projectId: KNOWN_PROJECT_ID, fileName, fileBase64: b64 }, ...extra });

// ── validate (pure) ────────────────────────────────────────────────────────

test('the refusals stand: renamed .exe → 400, oversize → 413, data-URL with params is accepted', () => {
  const { screenshots, restore } = withMocks();
  try {
    assert.equal(screenshots.validateScreenshot({ fileName: 'x.png', fileBase64: EXE_B64 }).code, 'UNSUPPORTED_FILE_TYPE');
    assert.equal(screenshots.validateScreenshot({ fileName: 'x.png', fileBase64: FOUR_MB_B64 }).status, 413);
    // data: URL carrying an extra ;name= param must be stripped, not refused (finding 11).
    assert.equal(screenshots.validateScreenshot({ fileName: 'x', fileBase64: `data:image/png;name=a.png;base64,${PNG_1x1_B64}` }).ok, true);
  } finally { restore(); }
});

// ── upload returns a token; round-trip needs it ─────────────────────────────

test('a valid upload returns an assetId AND an unguessable token; the row is project-scoped pending', async () => {
  const { publicSite, db, restore } = withMocks();
  try {
    const { status, payload } = await upload(publicSite, PNG_1x1_B64, 'Menu.png');
    assert.equal(status, 201);
    assert.ok(payload.data.assetId > 0);
    assert.match(String(payload.data.token), /^[A-Za-z0-9_-]{32}$/, 'a real token is returned');
    const row = db.assets.find((a) => a.id === payload.data.assetId);
    assert.equal(row.project_id, KNOWN_PROJECT_ID);
    assert.equal(row.category, 'bug-report-pending');
  } finally { restore(); }
});

test('round-trip: upload two, submit with their (id, token) pairs, read the report + rows back', async () => {
  const { publicSite, reportsStore, db, restore } = withMocks();
  try {
    const a = (await upload(publicSite, PNG_1x1_B64, 'one.png')).payload.data;
    const b = (await upload(publicSite, PNG_1x1_B64, 'two.png')).payload.data;
    const submit = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'Menu overlaps logo', screenshots: [{ id: a.assetId, token: a.token }, { id: b.assetId, token: b.token }] },
    });
    assert.equal(submit.status, 201, JSON.stringify(submit.payload));
    assert.deepEqual(submit.payload.data.screenshotAssetIds, [a.assetId, b.assetId]);
    const readBack = await reportsStore.getBugReportById(submit.payload.data.id, { projectId: KNOWN_PROJECT_ID });
    assert.deepEqual(readBack.data.screenshotAssetIds, [a.assetId, b.assetId]);
    for (const id of [a.assetId, b.assetId]) assert.equal(db.assets.find((x) => x.id === id).category, 'bug-report', 'flipped to attached');
  } finally { restore(); }
});

// ── BLOCKER #1: guessed ids without a token cannot harvest screenshots ───────

test('a guessed asset id with NO token is refused — no URL leaks, no report written', async () => {
  const { publicSite, db, restore } = withMocks();
  try {
    const victim = (await upload(publicSite, PNG_1x1_B64, 'victim.png')).payload.data; // a real pending asset
    const attack = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'harvest attempt', screenshotAssetIds: [victim.assetId] }, // legacy shape, no token
    });
    assert.equal(attack.status, 400);
    assert.equal(attack.payload.error.code, 'SCREENSHOT_REJECTED');
    assert.equal(attack.payload.data, undefined, 'no screenshots array, no URL leaked');
    assert.equal(db.bugReports.length, 0, 'nothing written');
  } finally { restore(); }
});

test('the rejection is the SAME for a wrong token and a nonexistent id — no existence/ownership oracle', async () => {
  const { publicSite, restore } = withMocks();
  try {
    const real = (await upload(publicSite, PNG_1x1_B64)).payload.data;
    const wrongToken = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'x', screenshots: [{ id: real.assetId, token: 'wrong' }] } });
    const noSuchId = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'x', screenshots: [{ id: 999999, token: 'wrong' }] } });
    assert.equal(wrongToken.payload.error.message, noSuchId.payload.error.message, 'identical message — no oracle');
    assert.equal(wrongToken.payload.error.code, noSuchId.payload.error.code);
  } finally { restore(); }
});

test("another tenant's asset id, even with any token, is refused", async () => {
  const { publicSite, db, restore } = withMocks({
    assets: [{ id: 7, project_id: OTHER_PROJECT_ID, category: 'bug-report-pending', asset_type: 'image', location: 'https://blob.test/other.png' }],
  });
  try {
    const r = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'cross-tenant', screenshots: [{ id: 7, token: 'anything' }] } });
    assert.equal(r.status, 400);
    assert.equal(r.payload.error.code, 'SCREENSHOT_REJECTED');
    assert.equal(db.bugReports.length, 0);
  } finally { restore(); }
});

test('one-shot: an already-attached screenshot cannot be re-attached (replay refused)', async () => {
  const { publicSite, restore } = withMocks();
  try {
    const a = (await upload(publicSite, PNG_1x1_B64)).payload.data;
    const first = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'first', screenshots: [{ id: a.assetId, token: a.token }] } });
    assert.equal(first.status, 201);
    const replay = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'replay', screenshots: [{ id: a.assetId, token: a.token }] } });
    assert.equal(replay.status, 400, 'the same screenshot cannot be attached twice');
    assert.equal(replay.payload.error.code, 'SCREENSHOT_REJECTED');
  } finally { restore(); }
});

test('a sixth screenshot is refused and no report is written', async () => {
  const { publicSite, db, restore } = withMocks();
  try {
    const refs = [];
    for (let i = 0; i < 6; i++) { const u = (await upload(publicSite, PNG_1x1_B64, `s${i}.png`)).payload.data; refs.push({ id: u.assetId, token: u.token }); }
    const r = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'six', screenshots: refs } });
    assert.equal(r.payload.error.code, 'TOO_MANY_SCREENSHOTS');
    assert.equal(db.bugReports.length, 0);
  } finally { restore(); }
});

// ── the other findings ──────────────────────────────────────────────────────

test('finding 3: bug-report categories are excluded from the tenant Images library', async () => {
  const { assetsStore, calls, restore } = withMocks();
  try {
    await assetsStore.listAssets({ projectId: KNOWN_PROJECT_ID });
    const listQuery = calls.find((c) => c.table === 'assets' && c.method !== 'POST' && /order=asset_name/.test(c.query || ''));
    assert.ok(listQuery, 'listAssets issued a GET');
    assert.match(listQuery.query, /category=not\.in\.\(bug-report-pending,bug-report\)/);
  } finally { restore(); }
});

test('finding 4: the pending→attached flip uses a projectId-only scope (no owner_user_id rewrite)', async () => {
  const { publicSite, calls, restore } = withMocks();
  try {
    const a = (await upload(publicSite, PNG_1x1_B64)).payload.data;
    calls.length = 0;
    await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'x', screenshots: [{ id: a.assetId, token: a.token }] } });
    const patch = calls.find((c) => c.table === 'assets' && c.method === 'PATCH');
    assert.ok(patch, 'the flip issued a PATCH');
    assert.equal('owner_user_id' in patch.body, false, 'the flip must not stamp owner_user_id');
    assert.equal(patch.body.category, 'bug-report');
  } finally { restore(); }
});

test('finding 7: a null JSON body is a plain 400, not a 500', async () => {
  const { publicSite, restore } = withMocks();
  try {
    assert.equal((await post(publicSite, SUBMIT, { body: null })).status, 400);
    assert.equal((await post(publicSite, UPLOAD, { body: null })).status, 400);
  } finally { restore(); }
});

test('findings 8/9: an insert failure after upload deletes the orphaned blob and answers 502, no row', async () => {
  const { publicSite, deletedBlobs, db, restore } = withMocks({ failInsert: true });
  try {
    const r = await upload(publicSite, PNG_1x1_B64, 'doomed.png');
    // A DB insert failure is 500-class; the point is the blob is not orphaned.
    assert.ok(r.status >= 500, `expected a 5xx, got ${r.status}`);
    assert.equal(r.payload.error.code, 'SCREENSHOT_RECORD_FAILED');
    assert.equal(deletedBlobs.length, 1, 'the uploaded blob is deleted, not left orphaned');
    assert.equal(db.assets.length, 0);
  } finally { restore(); }
});

test('no storage backend or no secret → honest 503, never a silent pass', async () => {
  const { publicSite, restore } = withMocks({ storageConfigured: false });
  try {
    assert.equal((await upload(publicSite, PNG_1x1_B64)).status, 503);
  } finally { restore(); }
});

test('a report with no screenshots still submits (1/5 behaviour intact)', async () => {
  const { publicSite, db, restore } = withMocks();
  try {
    const r = await post(publicSite, SUBMIT, { body: { projectId: KNOWN_PROJECT_ID, description: 'no picture' } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.payload.data.screenshotAssetIds, []);
    assert.equal(db.bugReports.length, 1);
  } finally { restore(); }
});

test('hammering the upload endpoint returns 429s, from a pinned reserved IP (DOCTRINE 5.5)', async () => {
  const { publicSite, restore } = withMocks();
  try {
    const ip = '198.51.100.7'; // pinned, not random — reserved TEST-NET-2
    const results = [];
    for (let i = 0; i < 25; i++) results.push(await upload(publicSite, PNG_1x1_B64, `s${i}.png`, { ip }));
    assert.ok(results.some((r) => r.status === 429), 'the 20/10min limit is hit');
    assert.ok(results.some((r) => r.status === 201), 'requests within budget still succeed');
  } finally { restore(); }
});
