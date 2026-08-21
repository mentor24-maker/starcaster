'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Bug Report 2/5 — screenshots: POST /api/public/bug-report/screenshot (one
 * file per request, JSON + base64, vetted by magic bytes and hard caps) and
 * the attach step in POST /api/public/bug-report (by asset id, scoped).
 *
 * Everything below runs against recorders swapped in for lib/supabase and
 * lib/assetStorage, so no network and no storage backend — the wire format,
 * the refusals, and the round-trip are all pinned without either.
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

// ── Fixtures: real magic bytes, tiny payloads ──────────────────────────────
const PNG_1x1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]).toString('base64');
const GIF_B64 = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(10)]).toString('base64');
const WEBP_B64 = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'), Buffer.alloc(8)]).toString('base64');
const EXE_B64 = Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(30)]).toString('base64');
/** ~9 MB of base64 — over the 8 MB cap before decoding. */
const NINE_MB_B64 = 'A'.repeat(Math.ceil((9 * 1024 * 1024) / 3) * 4);

/**
 * Swap lib/supabase for an in-memory database of three tables, and
 * lib/assetStorage for a recorder. Everything that destructured sbQuery at
 * load is re-required so it binds to THIS test's recorder.
 */
function withMocks({ storageConfigured = true, assets: seededAssets = [], adminSession = null } = {}) {
  const calls = [];
  const uploads = [];
  const db = {
    assets: seededAssets.map((a) => ({ ...a })),
    bugReports: [],
  };
  let nextAssetId = 100 + db.assets.length;
  let nextReportId = 1;

  function matchParam(query, name) {
    const m = new RegExp(`(?:^|&)${name}=eq\\.([^&]*)`).exec(query || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ ...realSupabase.tableConfig(), projectBugReports: 'project_bug_reports', assets: 'assets' }),
    sbQuery: async (options) => {
      calls.push(options);
      const { table, method = 'GET', query = '' } = options;

      if (table === 'assets') {
        if (/select=project_id,owner_user_id/.test(query)) return { ok: true, status: 200, data: [] };
        if (method === 'POST') {
          const row = { id: nextAssetId++, created_at: new Date().toISOString(), ...options.body[0] };
          db.assets.push(row);
          return { ok: true, status: 201, data: [row] };
        }
        // lib/projectScope appends `or=(project_id.eq.X,project_id.is.null)`
        // (or the strict `(project_id.eq.X)`) — honour it like PostgREST would,
        // so a row owned by another tenant is invisible from this scope.
        const id = Number(matchParam(query, 'id'));
        const scopeMatch = /project_id\.eq\.([^,)&]*)/.exec(query || '');
        const scopedProjectId = scopeMatch ? decodeURIComponent(scopeMatch[1]) : null;
        const nullAllowed = /project_id\.is\.null/.test(query || '');
        const rows = db.assets.filter((a) =>
          (!id || a.id === id) &&
          (scopedProjectId === null || a.project_id === scopedProjectId || (nullAllowed && a.project_id == null))
        );
        if (method === 'PATCH') {
          for (const row of rows) Object.assign(row, options.body);
          return { ok: true, status: 200, data: rows };
        }
        return { ok: true, status: 200, data: rows };
      }

      if (table === 'project_bug_reports') {
        if (/select=project_id,owner_user_id/.test(query)) return { ok: true, status: 200, data: [] };
        if (method === 'POST') {
          const row = { id: `bug_${nextReportId++}`, created_at: new Date().toISOString(), ...options.body[0] };
          db.bugReports.push(row);
          return { ok: true, status: 201, data: [row] };
        }
        const id = matchParam(query, 'id');
        return { ok: true, status: 200, data: db.bugReports.filter((r) => !id || r.id === id) };
      }

      // Projects lookups: the one known project (and one "other" tenant).
      const id = matchParam(query, 'id');
      if (id !== null) {
        return { ok: true, status: 200, data: [KNOWN_PROJECT_ID, OTHER_PROJECT_ID].includes(id) ? [{ id }] : [] };
      }
      return { ok: true, status: 200, data: [] };
    },
  };

  const fakeAssetStorage = {
    isConfigured: () => storageConfigured,
    getProvider: () => 'fake',
    uploadAssetFile: async (input) => {
      uploads.push(input);
      return {
        ok: true,
        status: 201,
        data: { location: `https://blob.test/${input.category}/${input.fileName}`, name: input.fileName, sizeBytes: 0 },
      };
    },
  };
  const fakeAdminStore = { getAdminSession: async () => adminSession };

  const saved = [supabasePath, assetStoragePath, adminStorePath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[assetStoragePath] = { id: assetStoragePath, filename: assetStoragePath, loaded: true, exports: fakeAssetStorage };
  require.cache[adminStorePath] = { id: adminStorePath, filename: adminStorePath, loaded: true, exports: fakeAdminStore };
  for (const p of rebuildPaths) delete require.cache[p];

  const screenshots = require('../../lib/projectBugReportScreenshots.js');
  const reportsStore = require('../../lib/projectBugReportsStore.js');
  const publicSite = require('../../routes/publicSite.js');

  function restore() {
    for (const [p, entry] of saved) {
      if (entry) require.cache[p] = entry; else delete require.cache[p];
    }
    for (const p of rebuildPaths) delete require.cache[p];
  }

  return { screenshots, reportsStore, publicSite, calls, uploads, db, restore };
}

function fakeRes() {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = (chunk) => { res.body = chunk || ''; };
  return res;
}

// Unique IP per request unless a test passes one: the real in-memory rate
// limiter is shared across the file, so reused addresses spend each other's
// budget and unrelated tests start 429ing as the file grows.
let nextTestIp = 1;

async function post(publicSite, path, { body = {}, ip = `203.0.113.${nextTestIp++}`, headers = {} } = {}) {
  const req = {
    method: 'POST',
    url: path,
    headers: { host: 'localhost', 'user-agent': 'test-agent', ...headers },
    socket: { remoteAddress: ip },
    body,
  };
  const res = fakeRes();
  const handled = await publicSite.handle(req, res, path, 'POST');
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}

const UPLOAD = '/api/public/bug-report/screenshot';
const SUBMIT = '/api/public/bug-report';

async function upload(publicSite, fileBase64, fileName = 'shot.png', extra = {}) {
  return post(publicSite, UPLOAD, { body: { projectId: KNOWN_PROJECT_ID, fileName, fileBase64 }, ...extra });
}

// ── validateScreenshot: pure, no I/O ───────────────────────────────────────

test('the four accepted kinds are recognised by their bytes, whatever the name says', () => {
  const { screenshots, restore } = withMocks();
  try {
    const { validateScreenshot } = screenshots;
    assert.equal(validateScreenshot({ fileName: 'a.bin', fileBase64: PNG_1x1_B64 }).data.kind, 'png');
    assert.equal(validateScreenshot({ fileName: 'b', fileBase64: JPEG_B64 }).data.kind, 'jpeg');
    assert.equal(validateScreenshot({ fileName: 'c.txt', fileBase64: GIF_B64 }).data.kind, 'gif');
    assert.equal(validateScreenshot({ fileName: 'd.png', fileBase64: WEBP_B64 }).data.kind, 'webp');
  } finally {
    restore();
  }
});

test('an .exe renamed .png is refused — contents decide, not the name', () => {
  const { screenshots, restore } = withMocks();
  try {
    const result = screenshots.validateScreenshot({ fileName: 'totally-a-screenshot.png', fileBase64: EXE_B64 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.code, 'UNSUPPORTED_FILE_TYPE');
    assert.match(result.error, /PNG, JPEG, WebP or GIF/);
  } finally {
    restore();
  }
});

test('a 9 MB file is refused with a plain-language 413 before it is even decoded', () => {
  const { screenshots, restore } = withMocks();
  try {
    const result = screenshots.validateScreenshot({ fileName: 'huge.png', fileBase64: NINE_MB_B64 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 413);
    assert.match(result.error, /8\.0 MB or smaller/);
    assert.match(result.error, /about 9\.0 MB/);
  } finally {
    restore();
  }
});

test('the stored name is sanitised and takes the SNIFFED extension', () => {
  const { screenshots, restore } = withMocks();
  try {
    const result = screenshots.validateScreenshot({ fileName: '../../evil stuff.exe', fileBase64: PNG_1x1_B64 });
    assert.equal(result.ok, true);
    assert.equal(result.data.fileName, 'evil-stuff.png');
    assert.equal(result.data.mimeType, 'image/png');
    const dataUrl = screenshots.validateScreenshot({ fileName: 'x', fileBase64: `data:image/png;base64,${PNG_1x1_B64}` });
    assert.equal(dataUrl.ok, true, 'a data: URL prefix is tolerated and stripped');
  } finally {
    restore();
  }
});

// ── Upload endpoint ────────────────────────────────────────────────────────

test('a valid PNG upload is stored as a PENDING asset owned by the project and answers its id + URL', async () => {
  const { publicSite, uploads, db, restore } = withMocks();
  try {
    const { handled, status, payload } = await upload(publicSite, PNG_1x1_B64, 'Menu Bug.png');
    assert.equal(handled, true);
    assert.equal(status, 201, 'must write a status — 0 means the rate-limit guard swallowed it (CLAUDE.md #11)');
    assert.equal(payload.ok, true);
    assert.ok(payload.data.assetId > 0);
    assert.match(payload.data.url, /^https:\/\/blob\.test\//);
    assert.equal(payload.data.width, 1);
    assert.equal(payload.data.height, 1);

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].mimeType, 'image/png');
    assert.equal(uploads[0].fileName, 'Menu-Bug.png');

    // READ THE ROW BACK — the insert's success proves nothing about tenancy.
    const row = db.assets.find((a) => a.id === payload.data.assetId);
    assert.equal(row.project_id, KNOWN_PROJECT_ID, 'asset must be stamped with the project');
    assert.equal(row.category, 'bug-report-pending');
    assert.equal(String(row.asset_type).toLowerCase(), 'image');
    assert.equal(row.location, payload.data.url);
  } finally {
    restore();
  }
});

test('an .exe renamed .png is refused at the endpoint and nothing is uploaded or recorded', async () => {
  const { publicSite, uploads, db, restore } = withMocks();
  try {
    const { status, payload } = await upload(publicSite, EXE_B64, 'report.png');
    assert.equal(status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'UNSUPPORTED_FILE_TYPE');
    assert.equal(uploads.length, 0);
    assert.equal(db.assets.length, 0);
  } finally {
    restore();
  }
});

test('a 9 MB upload is refused with 413 and never reaches storage', async () => {
  const { publicSite, uploads, restore } = withMocks();
  try {
    const { status, payload } = await upload(publicSite, NINE_MB_B64, 'huge.png');
    assert.equal(status, 413);
    assert.equal(payload.error.code, 'PAYLOAD_TOO_LARGE');
    assert.match(payload.error.message, /8\.0 MB or smaller/);
    assert.equal(uploads.length, 0);
  } finally {
    restore();
  }
});

test('when no storage backend is configured the endpoint says so honestly (503), not a silent pass', async () => {
  const { publicSite, restore } = withMocks({ storageConfigured: false });
  try {
    const { status, payload } = await upload(publicSite, PNG_1x1_B64);
    assert.equal(status, 503);
    assert.equal(payload.error.code, 'ASSET_STORAGE_NOT_CONFIGURED');
  } finally {
    restore();
  }
});

test('a system-host upload naming a nonexistent project is refused (same guard as the submit endpoint)', async () => {
  const { publicSite, uploads, restore } = withMocks();
  try {
    const { status, payload } = await post(publicSite, UPLOAD, {
      body: { projectId: 'proj_i_made_up', fileName: 'x.png', fileBase64: PNG_1x1_B64 },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(uploads.length, 0);
  } finally {
    restore();
  }
});

test('hammering the upload endpoint from one address returns 429s, deliberately triggered', async () => {
  const { publicSite, restore } = withMocks();
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  try {
    const results = [];
    for (let i = 0; i < 25; i++) results.push(await upload(publicSite, PNG_1x1_B64, `s${i}.png`, { ip }));
    const limited = results.filter((r) => r.status === 429);
    assert.ok(limited.length > 0, 'the 20/10min limit must have been hit');
    for (const r of limited) assert.equal(r.payload.error.code, 'RATE_LIMITED');
    assert.ok(results.filter((r) => r.status === 201).length > 0, 'requests within budget still succeed — the guard is not inverted');
  } finally {
    restore();
  }
});

// ── Attach on submit: the round-trip and the refusals ──────────────────────

test('round-trip: upload two screenshots, submit with both, read the report back, both URLs resolve', async () => {
  const { publicSite, reportsStore, db, restore } = withMocks();
  try {
    const first = await upload(publicSite, PNG_1x1_B64, 'one.png');
    const second = await upload(publicSite, JPEG_B64, 'two.jpg');
    const ids = [first.payload.data.assetId, second.payload.data.assetId];

    const submit = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'The menu overlaps the logo', screenshotAssetIds: ids },
    });
    assert.equal(submit.status, 201);
    assert.equal(submit.payload.ok, true);
    assert.deepEqual(submit.payload.data.screenshotAssetIds, ids);
    assert.deepEqual(
      submit.payload.data.screenshots.map((s) => s.url),
      [first.payload.data.url, second.payload.data.url],
      'the response links each screenshot to its viewable URL'
    );

    // Read the report back through the store, not the response.
    const readBack = await reportsStore.getBugReportById(submit.payload.data.id, { projectId: KNOWN_PROJECT_ID });
    assert.equal(readBack.ok, true);
    assert.deepEqual(readBack.data.screenshotAssetIds, ids);

    // Each id maps to a stored asset whose URL is the uploaded location, now ATTACHED.
    for (const [index, id] of ids.entries()) {
      const row = db.assets.find((a) => a.id === id);
      assert.equal(row.location, [first, second][index].payload.data.url);
      assert.equal(row.category, 'bug-report', 'a submitted screenshot is no longer pending');
      assert.equal(row.project_id, KNOWN_PROJECT_ID);
    }
  } finally {
    restore();
  }
});

test('a sixth screenshot is refused and no report is written', async () => {
  const { publicSite, db, restore } = withMocks();
  try {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await upload(publicSite, PNG_1x1_B64, `s${i}.png`)).payload.data.assetId);
    const submit = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'Six shots', screenshotAssetIds: ids },
    });
    assert.equal(submit.status, 400);
    assert.equal(submit.payload.error.code, 'TOO_MANY_SCREENSHOTS');
    assert.match(submit.payload.error.message, /Up to 5 screenshots/);
    assert.equal(db.bugReports.length, 0);
  } finally {
    restore();
  }
});

test("another tenant's screenshot id cannot be pinned to this project's report", async () => {
  const { publicSite, db, restore } = withMocks({
    assets: [{ id: 7, project_id: OTHER_PROJECT_ID, category: 'bug-report-pending', asset_type: 'image', location: 'https://blob.test/other.png' }],
  });
  try {
    const submit = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'Cross-tenant attach', screenshotAssetIds: [7] },
    });
    assert.equal(submit.status, 400);
    assert.equal(submit.payload.error.code, 'SCREENSHOT_NOT_FOUND');
    assert.equal(db.bugReports.length, 0);
  } finally {
    restore();
  }
});

test("an ordinary asset (a logo, say) is not a bug-report screenshot and cannot be attached", async () => {
  const { publicSite, db, restore } = withMocks({
    assets: [{ id: 9, project_id: KNOWN_PROJECT_ID, category: 'logo', asset_type: 'image', location: 'https://blob.test/logo.png' }],
  });
  try {
    const submit = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'Attach the logo', screenshotAssetIds: [9] },
    });
    assert.equal(submit.status, 400);
    assert.equal(submit.payload.error.code, 'SCREENSHOT_NOT_FOUND');
    assert.equal(db.bugReports.length, 0);
  } finally {
    restore();
  }
});

test('a report with no screenshots still submits exactly as before (1/5 behaviour intact)', async () => {
  const { publicSite, db, restore } = withMocks();
  try {
    const submit = await post(publicSite, SUBMIT, {
      body: { projectId: KNOWN_PROJECT_ID, description: 'No picture needed' },
    });
    assert.equal(submit.status, 201);
    assert.deepEqual(submit.payload.data.screenshotAssetIds, []);
    assert.deepEqual(submit.payload.data.screenshots, []);
    assert.equal(db.bugReports.length, 1);
  } finally {
    restore();
  }
});
