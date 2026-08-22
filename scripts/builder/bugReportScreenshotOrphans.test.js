'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Bug Report 5/5 — the scheduled orphan sweep.
 *
 * These drive the real lib + route against a recorder for lib/supabase and
 * lib/assetStorage: no network, no blob store. Every acceptance criterion on
 * the ticket is a break-it-on-purpose case — an orphan that must go, three
 * kinds of row that must SURVIVE, and two kinds of failure that must be
 * reported rather than swallowed.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const assetStoragePath = require.resolve('../../lib/assetStorage.js');
const rebuildPaths = [
  '../../lib/projectScope.js',
  '../../lib/assetsStore.js',
  '../../lib/projectBugReportsStore.js',
  '../../lib/projectBugReportScreenshots.js',
  '../../lib/bugReportScreenshotOrphans.js',
  '../../routes/bugReportSweep.js',
].map((p) => require.resolve(p));

const realSupabase = require(supabasePath);

const NOW = Date.parse('2026-08-22T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const PROJECT_A = 'proj_a';
const BLOB_DELETE_FAILED = { ok: false, status: 502, error: 'Vercel Blob delete failed: boom' };
/** What lib/assetStorage really returns for a Drive-hosted file. */
const NO_DELETER_WIRED = { ok: false, status: 501, error: 'no deleter for this storage provider — caller must log the orphan' };
const PROJECT_B = 'proj_b';

/** An `assets` row as the pending screenshot path writes one. */
function pendingAsset(id, { project = PROJECT_A, ageHours = 48, category = 'bug-report-pending', location } = {}) {
  return {
    id,
    project_id: project,
    category,
    location: location === undefined ? `https://x.blob.vercel-storage.com/${id}.png` : location,
    asset_name: `${id}.png`,
    created_at: hoursAgo(ageHours),
  };
}

function withMocks({
  assets = [],
  reports = [],
  reportsQueryFails = false,
  scanFails = false,
  ignoreCategoryFilter = false,
  blobDelete = null,
} = {}) {
  const db = { assets: assets.map((a) => ({ ...a })), reports: reports.map((r) => ({ ...r })) };
  const deletedBlobs = [];
  const queries = [];

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ ...realSupabase.tableConfig(), assets: 'assets', projectBugReports: 'project_bug_reports' }),
    sbQuery: async (options) => {
      const { table, method = 'GET', query = '' } = options;
      queries.push({ table, method, query });
      // lib/projectScope's column probe — both columns exist on both tables.
      if (/select=project_id,owner_user_id/.test(query)) return { ok: true, status: 200, data: [] };

      if (table === 'assets') {
        if (scanFails && method === 'GET') return { ok: false, status: 500, error: 'assets unavailable' };
        if (method === 'DELETE') {
          const id = Number((/(?:^|&)id=eq\.(\d+)/.exec(query) || [])[1]);
          const gone = db.assets.filter((a) => a.id === id);
          db.assets = db.assets.filter((a) => a.id !== id);
          return { ok: true, status: 200, data: gone };
        }
        // `ignoreCategoryFilter` simulates the query filter being edited wrong,
        // so the in-code category guard is the only thing left standing.
        const category = ignoreCategoryFilter
          ? ''
          : decodeURIComponent((/(?:^|&)category=eq\.([^&]*)/.exec(query) || [])[1] || '');
        const before = decodeURIComponent((/(?:^|&)created_at=lt\.([^&]*)/.exec(query) || [])[1] || '');
        const limit = Number((/(?:^|&)limit=(\d+)/.exec(query) || [])[1] || 5000);
        const rows = db.assets
          .filter((a) => (!category || a.category === category) && (!before || a.created_at < before))
          .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
          .slice(0, limit);
        return { ok: true, status: 200, data: rows };
      }

      if (table === 'project_bug_reports') {
        if (reportsQueryFails) return { ok: false, status: 503, error: 'reports table unavailable' };
        const project = decodeURIComponent((/(?:^|&)project_id=eq\.([^&]*)/.exec(query) || [])[1] || '');
        const rows = db.reports.filter((r) => !project || r.project_id === project);
        return { ok: true, status: 200, data: rows.map((r) => ({ screenshot_asset_ids: r.screenshot_asset_ids })) };
      }
      return { ok: true, status: 200, data: [] };
    },
  };

  const fakeAssetStorage = {
    isConfigured: () => true,
    getProvider: () => 'fake',
    uploadAssetFile: async () => ({ ok: false, status: 501, error: 'not used here' }),
    deleteUploadedAsset: async (location) => {
      if (blobDelete) return blobDelete;
      deletedBlobs.push(location);
      return { ok: true, status: 200 };
    },
  };

  const saved = [supabasePath, assetStoragePath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[assetStoragePath] = { id: assetStoragePath, filename: assetStoragePath, loaded: true, exports: fakeAssetStorage };
  for (const p of rebuildPaths) delete require.cache[p];

  const sweepLib = require('../../lib/bugReportScreenshotOrphans.js');
  const sweepRoute = require('../../routes/bugReportSweep.js');
  function restore() {
    for (const [p, entry] of saved) { if (entry) require.cache[p] = entry; else delete require.cache[p]; }
    for (const p of rebuildPaths) delete require.cache[p];
  }
  return { sweepLib, sweepRoute, db, deletedBlobs, queries, restore };
}

const run = (sweepLib, opts = {}) =>
  sweepLib.sweepBugReportScreenshotOrphans({ now: NOW, ...opts });

const ids = (list) => list.map((x) => x.assetId).sort((a, b) => a - b);

// ── criterion 1: an abandoned upload is proposed, then collected ───────────

test('an old unreferenced pending screenshot: dry run PROPOSES it and deletes nothing', async () => {
  const { sweepLib, db, deletedBlobs, restore } = withMocks({ assets: [pendingAsset(11)] });
  try {
    const res = await run(sweepLib);
    assert.equal(res.ok, true);
    assert.equal(res.data.dryRun, true);
    assert.deepEqual(ids(res.data.proposed), [11]);
    assert.deepEqual(res.data.deleted, []);
    assert.equal(db.assets.length, 1, 'dry run must not touch the row');
    assert.deepEqual(deletedBlobs, [], 'dry run must not touch the blob');
  } finally { restore(); }
});

test('apply: the blob goes first, then the row', async () => {
  const { sweepLib, db, deletedBlobs, restore } = withMocks({ assets: [pendingAsset(11)] });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.deepEqual(ids(res.data.deleted), [11]);
    assert.deepEqual(deletedBlobs, ['https://x.blob.vercel-storage.com/11.png']);
    assert.equal(db.assets.length, 0);
    assert.equal(res.data.complete, true);
  } finally { restore(); }
});

test('the second run is a different program: run it twice and the second finds nothing left', async () => {
  const { sweepLib, db, deletedBlobs, restore } = withMocks({ assets: [pendingAsset(11), pendingAsset(12)] });
  try {
    const first = await run(sweepLib, { dryRun: false });
    assert.deepEqual(ids(first.data.deleted), [11, 12]);
    const second = await run(sweepLib, { dryRun: false });
    assert.equal(second.data.scanned, 0);
    assert.deepEqual(second.data.deleted, []);
    assert.equal(second.data.complete, true);
    assert.equal(db.assets.length, 0);
    assert.equal(deletedBlobs.length, 2, 'no blob is deleted twice');
  } finally { restore(); }
});

// ── criterion 2: a referenced screenshot is NEVER an orphan ────────────────

test('a pending row a report still points at SURVIVES, even though it is old', async () => {
  const { sweepLib, db, deletedBlobs, restore } = withMocks({
    assets: [pendingAsset(11), pendingAsset(12)],
    reports: [{ project_id: PROJECT_A, screenshot_asset_ids: [12] }],
  });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.deepEqual(ids(res.data.deleted), [11]);
    assert.equal(res.data.referenced, 1);
    assert.deepEqual(db.assets.map((a) => a.id), [12], 'the referenced row is still there');
    assert.deepEqual(deletedBlobs, ['https://x.blob.vercel-storage.com/11.png']);
  } finally { restore(); }
});

test("one project's reports cannot vouch for another project's screenshots", async () => {
  const { sweepLib, restore } = withMocks({
    assets: [pendingAsset(12, { project: PROJECT_B })],
    reports: [{ project_id: PROJECT_A, screenshot_asset_ids: [12] }],
  });
  try {
    const res = await run(sweepLib);
    assert.deepEqual(ids(res.data.proposed), [12], 'a proj_a report must not spare a proj_b asset');
  } finally { restore(); }
});

// ── criterion 3: too new to be abandoned ──────────────────────────────────

test('a pending row newer than the threshold SURVIVES', async () => {
  const { sweepLib, restore } = withMocks({ assets: [pendingAsset(11, { ageHours: 2 })] });
  try {
    const res = await run(sweepLib);
    assert.equal(res.data.scanned, 0);
    assert.deepEqual(res.data.proposed, []);
  } finally { restore(); }
});

test('the threshold is a knob: the same row is collectable at 1h', async () => {
  const { sweepLib, restore } = withMocks({ assets: [pendingAsset(11, { ageHours: 2 })] });
  try {
    const res = await run(sweepLib, { olderThanHours: 1 });
    assert.deepEqual(ids(res.data.proposed), [11]);
  } finally { restore(); }
});

// ── criterion 4: a failed delete is reported, and stops the row ────────────

test('a blob that will not delete is REPORTED and its row is left alone', async () => {
  const { sweepLib, db, restore } = withMocks({ assets: [pendingAsset(11)], blobDelete: BLOB_DELETE_FAILED });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.deepEqual(res.data.deleted, [], 'nothing may be reported as deleted');
    assert.equal(res.data.couldNotDelete.length, 1);
    assert.equal(res.data.couldNotDelete[0].stage, 'blob');
    assert.match(res.data.couldNotDelete[0].reason, /502.*boom/);
    assert.equal(db.assets.length, 1, 'the row must survive a failed blob delete — otherwise the blob is unfindable');
    assert.equal(res.data.complete, false);
    assert.match(res.data.summary, /1 could not be deleted/);
  } finally { restore(); }
});

test('a storage provider with no deleter wired (Drive) is reported, not silently skipped', async () => {
  const { sweepLib, db, restore } = withMocks({
    assets: [pendingAsset(11, { location: 'https://drive.google.com/file/d/abc' })],
    blobDelete: NO_DELETER_WIRED,
  });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.deepEqual(res.data.deleted, []);
    assert.equal(res.data.couldNotDelete.length, 1);
    assert.match(res.data.couldNotDelete[0].reason, /501.*no deleter/);
    assert.equal(db.assets.length, 1, 'a file we cannot delete keeps its row, so it stays findable');
  } finally { restore(); }
});

// ── DOCTRINE §3.11: a question that could not be answered is not a pass ────

test('when the reports table cannot be read, candidates are COULD-NOT-CHECK and nothing is deleted', async () => {
  const { sweepLib, db, deletedBlobs, restore } = withMocks({
    assets: [pendingAsset(11), pendingAsset(12)],
    reportsQueryFails: true,
  });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.deleted, []);
    assert.deepEqual(ids(res.data.couldNotCheck), [11, 12]);
    assert.match(res.data.couldNotCheck[0].reason, /503.*reports table unavailable/);
    assert.equal(db.assets.length, 2);
    assert.deepEqual(deletedBlobs, []);
    assert.equal(res.data.complete, false, '"could not check" must never read as clean');
    assert.match(res.data.summary, /2 could not be checked/);
  } finally { restore(); }
});

test('one unreadable project does not stop a readable one, and each is reported separately', async () => {
  // proj_b's reports read fine only if the failure is per-query; here the
  // recorder fails ALL report reads, so the guarantee under test is that the
  // failure is attributed per project rather than aborting the whole run.
  const { sweepLib, restore } = withMocks({
    assets: [pendingAsset(11, { project: PROJECT_A }), pendingAsset(12, { project: PROJECT_B })],
    reportsQueryFails: true,
  });
  try {
    const res = await run(sweepLib);
    assert.equal(res.data.couldNotCheck.length, 2);
    assert.deepEqual(res.data.couldNotCheck.map((c) => c.projectId).sort(), [PROJECT_A, PROJECT_B]);
  } finally { restore(); }
});

test('a scan that hits the row limit says so instead of reading as finished', async () => {
  const { sweepLib, restore } = withMocks({ assets: [pendingAsset(11), pendingAsset(12)] });
  try {
    const res = await run(sweepLib, { limit: 2 });
    assert.equal(res.data.truncated, true);
    assert.equal(res.data.complete, false);
    assert.match(res.data.summary, /scan limit was reached/);
  } finally { restore(); }
});

test('a failed scan is an error, not an empty all-clear', async () => {
  const { sweepLib, restore } = withMocks({ assets: [pendingAsset(11)], scanFails: true });
  try {
    const res = await run(sweepLib);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SWEEP_SCAN_FAILED');
    assert.match(res.error, /assets unavailable/);
  } finally { restore(); }
});

// ── "never touch non-bug-report categories" ───────────────────────────────

test('an ordinary library image is never a candidate — and is refused twice over', async () => {
  const { sweepLib, db, restore } = withMocks({
    assets: [
      pendingAsset(11),
      pendingAsset(21, { category: 'Feature Image' }),
      pendingAsset(22, { category: 'bug-report' }),
    ],
  });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.deepEqual(ids(res.data.deleted), [11], 'only the pending bug-report row goes');
    assert.deepEqual(db.assets.map((a) => a.id).sort((a, b) => a - b), [21, 22]);
  } finally { restore(); }
});

test('the in-code category guard holds even if the query filter is wrong', async () => {
  // Second line of defence: the recorder ignores the category filter, so the
  // sweep is handed rows it never asked for. It must refuse them anyway.
  const { sweepLib, db, restore } = withMocks({
    assets: [pendingAsset(21, { category: 'Feature Image' })],
    ignoreCategoryFilter: true,
  });
  try {
    const res = await run(sweepLib, { dryRun: false });
    assert.equal(res.data.scanned, 1, 'the broken filter did let the row through');
    assert.equal(res.data.wrongCategory, 1, 'and the code guard caught it');
    assert.deepEqual(res.data.deleted, []);
    assert.equal(db.assets.length, 1);
    assert.match(res.data.summary, /1 skipped for the wrong category/);
  } finally { restore(); }
});

// ── the reference set is read defensively ─────────────────────────────────

test('junk in screenshot_asset_ids does not crash or accidentally spare everything', async () => {
  const { sweepLib, restore } = withMocks({ assets: [pendingAsset(11)] });
  try {
    const set = sweepLib.referencedAssetIds([
      { screenshot_asset_ids: [11, '12', null, 'x', -1, 0] },
      { screenshot_asset_ids: null },
      null,
    ]);
    assert.deepEqual([...set].sort((a, b) => a - b), [11, 12]);
  } finally { restore(); }
});

// ── the route ─────────────────────────────────────────────────────────────

async function call(sweepRoute, url, { method = 'GET', cron = true, authUser = null, body } = {}) {
  const req = { method, url, headers: { host: 'localhost' }, cronPublish: cron, authUser, body };
  const res = { statusCode: 0, body: '', setHeader() {}, end(c) { this.body = c || ''; } };
  const handled = await sweepRoute.handle(req, res, new URL(url, 'http://localhost').pathname, method);
  let payload = null; try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}

const SWEEP = '/api/maintenance/bug-report-screenshots/sweep';

test('the endpoint is a DRY RUN unless apply is asked for', async () => {
  const { sweepRoute, db, restore } = withMocks({ assets: [pendingAsset(11)] });
  try {
    const dry = await call(sweepRoute, SWEEP);
    assert.equal(dry.status, 200);
    assert.equal(dry.payload.data.dryRun, true);
    assert.equal(db.assets.length, 1, 'a bare call must delete nothing');

    const applied = await call(sweepRoute, `${SWEEP}?apply=1`);
    assert.equal(applied.payload.data.dryRun, false);
    assert.equal(db.assets.length, 0);
  } finally { restore(); }
});

test('the threshold can be overridden per call, and a nonsense value falls back to the default', async () => {
  const { sweepRoute, restore } = withMocks({ assets: [pendingAsset(11, { ageHours: 2 })] });
  try {
    assert.equal((await call(sweepRoute, `${SWEEP}?olderThanHours=1`)).payload.data.olderThanHours, 1);
    const bad = await call(sweepRoute, `${SWEEP}?olderThanHours=banana`);
    assert.equal(bad.payload.data.olderThanHours, 24);
    assert.equal(bad.payload.data.scanned, 0, 'the 2h-old row is not collectable at 24h');
  } finally { restore(); }
});

test('a tenant site admin cannot start a sweep that spans every project', async () => {
  const { sweepRoute, db, restore } = withMocks({ assets: [pendingAsset(11)] });
  try {
    const res = await call(sweepRoute, `${SWEEP}?apply=1`, { cron: false, authUser: { id: 'u1', isProjectAdmin: true } });
    assert.equal(res.status, 403);
    assert.equal(db.assets.length, 1);
  } finally { restore(); }
});

test('POST works too, and the flag may travel in the body', async () => {
  const { sweepRoute, db, restore } = withMocks({ assets: [pendingAsset(11)] });
  try {
    const res = await call(sweepRoute, SWEEP, { method: 'POST', body: { apply: true } });
    assert.equal(res.payload.data.dryRun, false);
    assert.equal(db.assets.length, 0);
  } finally { restore(); }
});

test('paths this module does not own fall through', async () => {
  const { sweepRoute, restore } = withMocks();
  try {
    const res = await call(sweepRoute, '/api/maintenance/something-else');
    assert.equal(res.handled, false);
  } finally { restore(); }
});

test('the scheduled path in vercel.json is the path the router is told to allow', () => {
  const vercel = require('../../vercel.json');
  const routes = require('fs').readFileSync(require.resolve('../../routes/index.js'), 'utf8');
  const cron = (vercel.crons || []).find((c) => String(c.path).includes('bug-report-screenshots'));
  assert.ok(cron, 'vercel.json must schedule the sweep');
  const [path, query] = String(cron.path).split('?');
  assert.equal(path, SWEEP);
  assert.match(String(query || ''), /apply=1/, 'the scheduled run must be the one that actually deletes');
  assert.ok(routes.includes(`'${SWEEP}'`), 'routes/index.js CRON_PATHS must list the same path, or the cron gets a 401');
});
