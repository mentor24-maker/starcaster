'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Bug-report screenshot orphan sweep (ClickUp 86bbjk5wj).
 *
 * The sweep deletes tenant data, so the tests are written around what must
 * NEVER happen — a referenced screenshot removed, a file deleted whose row
 * survives, a delete that proceeds when the reference list could not be read —
 * rather than around the happy path.
 *
 * Drives the real module against recorders for lib/supabase and
 * lib/assetStorage: no network, no storage backend, no database.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const assetStoragePath = require.resolve('../../lib/assetStorage.js');
const rebuildPaths = [
  '../../lib/projectScope.js',
  '../../lib/assetsStore.js',
  '../../lib/projectBugReportsStore.js',
  '../../lib/projectBugReportScreenshots.js',
  '../../lib/bugReportOrphanSweep.js',
].map((p) => require.resolve(p));

const realSupabase = require(supabasePath);

const NOW = Date.parse('2026-08-23T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const PENDING = 'bug-report-pending';

/**
 * @param assets       rows already in the `assets` table
 * @param reports      rows already in `project_bug_reports`
 * @param blobDelete   what lib/assetStorage's deleter returns, per location
 * @param reportsRead  override the reports read (to simulate a failed read)
 */
function withMocks({
  assets = [],
  reports = [],
  blobDelete = () => ({ ok: true, status: 200 }),
  reportsReadFails = false,
  assetsReadFails = false,
  onPendingRead = null,
} = {}) {
  const db = { assets: assets.map((a) => ({ ...a })), reports: reports.map((r) => ({ ...r })) };
  const deletedBlobs = [];
  const queries = [];

  const matchId = (q) => {
    const m = /(?:^|&)id=eq\.(\d+)/.exec(q || '');
    return m ? Number(m[1]) : null;
  };

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ ...realSupabase.tableConfig(), assets: 'assets', projectBugReports: 'project_bug_reports' }),
    sbQuery: async (options) => {
      const { table, method = 'GET', query = '' } = options;
      queries.push({ table, method, query });

      if (table === 'project_bug_reports') {
        if (reportsReadFails) return { ok: false, status: 502, error: 'supabase unreachable' };
        return { ok: true, status: 200, data: db.reports.map((r) => ({ screenshot_asset_ids: r.screenshot_asset_ids })) };
      }

      if (table === 'assets') {
        if (method === 'DELETE') {
          const id = matchId(query);
          // The route's delete is conditioned on the category; honour that, so
          // a row that flipped underneath is genuinely not matched.
          const wantsPending = query.includes(`category=eq.${PENDING}`);
          const before = db.assets.length;
          const removed = db.assets.filter((a) => a.id === id && (!wantsPending || a.category === PENDING));
          db.assets = db.assets.filter((a) => !removed.includes(a));
          assert.ok(db.assets.length === before - removed.length);
          return { ok: true, status: 200, data: removed.map((a) => ({ id: a.id })) };
        }
        if (assetsReadFails) return { ok: false, status: 502, error: 'supabase unreachable' };
        const id = matchId(query);
        if (id) {
          // the pre-delete re-check
          return { ok: true, status: 200, data: db.assets.filter((a) => a.id === id) };
        }
        const snapshot = db.assets.filter((a) => a.category === PENDING).map((a) => ({ ...a }));
        // Fires AFTER the rows are captured, so a change made here lands in
        // the same window a real submit would: after the scan, before the
        // delete. Mutating before the snapshot would test nothing.
        if (onPendingRead) onPendingRead(db);
        return { ok: true, status: 200, data: snapshot };
      }

      return { ok: true, status: 200, data: [] };
    },
  };

  const fakeAssetStorage = {
    isConfigured: () => true,
    getProvider: () => 'fake',
    uploadAssetFile: async () => ({ ok: false, status: 500, error: 'not used here' }),
    deleteUploadedAsset: async (location) => {
      const result = blobDelete(location);
      if (result.ok) deletedBlobs.push(location);
      return result;
    },
  };

  const saved = [supabasePath, assetStoragePath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[assetStoragePath] = { id: assetStoragePath, filename: assetStoragePath, loaded: true, exports: fakeAssetStorage };
  for (const p of rebuildPaths) delete require.cache[p];

  const sweep = require('../../lib/bugReportOrphanSweep.js');
  function restore() {
    for (const [p, entry] of saved) { if (entry) require.cache[p] = entry; else delete require.cache[p]; }
    for (const p of rebuildPaths) delete require.cache[p];
  }
  return { sweep, db, deletedBlobs, queries, restore };
}

function pendingAsset(id, { hoursAgo = 48, projectId = 'proj_1', category = PENDING } = {}) {
  return {
    id,
    project_id: projectId,
    category,
    location: `https://blob.test/${PENDING}/shot-${id}.png`,
    created_at: iso(hoursAgo * HOUR),
  };
}

// ---------------------------------------------------------------------------
// The pure planner — every keep/delete decision, no I/O
// ---------------------------------------------------------------------------

test('AC1 — an old, unreferenced pending screenshot is an orphan', () => {
  const { sweep, restore } = withMocks();
  try {
    const { orphans, kept } = sweep.planOrphanSweep({
      pendingAssets: [pendingAsset(1, { hoursAgo: 48 })],
      referencedAssetIds: new Set(),
      now: NOW,
    });
    assert.deepEqual(orphans.map((o) => o.id), [1]);
    assert.equal(kept.length, 0);
  } finally { restore(); }
});

test('AC2 — a referenced screenshot is never an orphan, however old', () => {
  const { sweep, restore } = withMocks();
  try {
    const { orphans, kept } = sweep.planOrphanSweep({
      pendingAssets: [pendingAsset(1, { hoursAgo: 24 * 365 })],
      referencedAssetIds: new Set([1]),
      now: NOW,
    });
    assert.deepEqual(orphans, []);
    assert.deepEqual(kept, [{ id: 1, projectId: 'proj_1', reason: 'REFERENCED_BY_A_REPORT' }]);
  } finally { restore(); }
});

test('AC3 — a screenshot newer than the threshold survives', () => {
  const { sweep, restore } = withMocks();
  try {
    const { orphans, kept } = sweep.planOrphanSweep({
      pendingAssets: [pendingAsset(1, { hoursAgo: 2 })],
      referencedAssetIds: new Set(),
      now: NOW,
      olderThanHours: 24,
    });
    assert.deepEqual(orphans, []);
    assert.equal(kept[0].reason, 'NEWER_THAN_THRESHOLD');
  } finally { restore(); }
});

test('a row whose upload date cannot be read is kept, not guessed at', () => {
  const { sweep, restore } = withMocks();
  try {
    const row = { ...pendingAsset(1), created_at: 'not a date' };
    const { orphans, kept } = sweep.planOrphanSweep({ pendingAssets: [row], referencedAssetIds: new Set(), now: NOW });
    assert.deepEqual(orphans, []);
    assert.equal(kept[0].reason, 'UNREADABLE_CREATED_AT');
  } finally { restore(); }
});

test('a non-pending category is refused even if the query hands one over', () => {
  const { sweep, restore } = withMocks();
  try {
    const row = pendingAsset(1, { category: 'bug-report' });
    const { orphans, kept } = sweep.planOrphanSweep({ pendingAssets: [row], referencedAssetIds: new Set(), now: NOW });
    assert.deepEqual(orphans, []);
    assert.equal(kept[0].reason, 'NOT_A_PENDING_BUG_REPORT_ASSET');
  } finally { restore(); }
});

test('the threshold is a boundary, not a vibe — exactly N hours old is swept', () => {
  const { sweep, restore } = withMocks();
  try {
    const older = sweep.planOrphanSweep({ pendingAssets: [pendingAsset(1, { hoursAgo: 24.001 })], now: NOW, olderThanHours: 24 });
    const newer = sweep.planOrphanSweep({ pendingAssets: [pendingAsset(2, { hoursAgo: 23.999 })], now: NOW, olderThanHours: 24 });
    assert.deepEqual(older.orphans.map((o) => o.id), [1]);
    assert.deepEqual(newer.orphans, []);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// The whole sweep, against the fake database
// ---------------------------------------------------------------------------

test('AC1 — dry run proposes and deletes nothing at all', async () => {
  const { sweep, db, deletedBlobs, restore } = withMocks({ assets: [pendingAsset(1)] });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW });
    assert.equal(res.ok, true);
    assert.equal(res.data.dryRun, true);
    assert.deepEqual(res.data.proposed.map((o) => o.id), [1]);
    assert.deepEqual(res.data.deleted, []);
    assert.deepEqual(deletedBlobs, []);
    assert.equal(db.assets.length, 1, 'a dry run must leave the row where it found it');
  } finally { restore(); }
});

test('AC1 — apply deletes the file first and then the row', async () => {
  const { sweep, db, deletedBlobs, queries, restore } = withMocks({ assets: [pendingAsset(1)] });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.deleted.map((o) => o.id), [1]);
    assert.deepEqual(deletedBlobs, ['https://blob.test/bug-report-pending/shot-1.png']);
    assert.deepEqual(db.assets, []);
    assert.deepEqual(res.data.byProject.deleted, { proj_1: 1 });

    const deleteQuery = queries.find((q) => q.method === 'DELETE');
    assert.match(deleteQuery.query, /category=eq\.bug-report-pending/,
      'the row delete must be conditioned on the category, or a form submitted mid-sweep loses its screenshot');
  } finally { restore(); }
});

test('AC2 — a referenced screenshot survives a real apply run', async () => {
  const { sweep, db, deletedBlobs, restore } = withMocks({
    assets: [pendingAsset(1), pendingAsset(2)],
    reports: [{ screenshot_asset_ids: [2] }],
  });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.deepEqual(res.data.deleted.map((o) => o.id), [1]);
    assert.deepEqual(db.assets.map((a) => a.id), [2]);
    assert.deepEqual(deletedBlobs, ['https://blob.test/bug-report-pending/shot-1.png']);
    assert.equal(res.data.kept.find((k) => k.id === 2).reason, 'REFERENCED_BY_A_REPORT');
  } finally { restore(); }
});

test('AC2 — a report in ANOTHER project still protects the screenshot', async () => {
  const { sweep, db, restore } = withMocks({
    assets: [pendingAsset(1, { projectId: 'proj_1' })],
    reports: [{ screenshot_asset_ids: [1] }],
  });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.deepEqual(res.data.deleted, []);
    assert.equal(db.assets.length, 1);
  } finally { restore(); }
});

test('AC4 — a failed file delete is reported and the row is left alone', async () => {
  const { sweep, db, restore } = withMocks({
    assets: [pendingAsset(1)],
    blobDelete: () => ({ ok: false, status: 502, error: 'Vercel Blob delete failed: boom' }),
  });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.equal(res.ok, false, 'a sweep that could not finish must not report success');
    assert.deepEqual(res.data.deleted, []);
    assert.equal(res.data.notDeleted.length, 1);
    assert.equal(res.data.notDeleted[0].code, 'BLOB_DELETE_FAILED');
    assert.match(res.data.notDeleted[0].error, /boom/);
    assert.equal(db.assets.length, 1, 'deleting the row here would leave a public file nobody can find');
  } finally { restore(); }
});

test('AC4 — a Drive-hosted upload has no deleter, so it is reported, not silently dropped', async () => {
  const { sweep, db, restore } = withMocks({
    assets: [pendingAsset(1)],
    blobDelete: () => ({ ok: false, status: 501, error: 'no deleter for this storage provider — caller must log the orphan' }),
  });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.equal(res.ok, false);
    assert.equal(res.data.notDeleted[0].code, 'NO_DELETER');
    assert.equal(db.assets.length, 1);
  } finally { restore(); }
});

test('a report read that fails aborts the whole sweep — nothing looks unreferenced', async () => {
  const { sweep, db, deletedBlobs, restore } = withMocks({
    assets: [pendingAsset(1), pendingAsset(2)],
    reportsReadFails: true,
  });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'REFERENCE_READ_FAILED');
    assert.match(res.error, /refusing to sweep/);
    assert.deepEqual(deletedBlobs, []);
    assert.equal(db.assets.length, 2);
  } finally { restore(); }
});

test('a truncated report read aborts too — an incomplete reference list is not a reference list', async () => {
  const reports = Array.from({ length: 20000 }, () => ({ screenshot_asset_ids: [] }));
  const { sweep, db, restore } = withMocks({ assets: [pendingAsset(1)], reports });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'REFERENCE_SCAN_TRUNCATED');
    assert.equal(db.assets.length, 1);
  } finally { restore(); }
});

test('an assets read that fails stops the run before anything is planned', async () => {
  const { sweep, restore } = withMocks({ assets: [pendingAsset(1)], assetsReadFails: true });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PENDING_READ_FAILED');
  } finally { restore(); }
});

test('a form submitted between the scan and the delete keeps its screenshot', async () => {
  // The scan sees a pending, unreferenced, 48-hour-old row and plans to
  // delete it. THEN the visitor finally submits, and the attach flips the
  // category. Without the re-check, this sweep destroys the image of a report
  // filed seconds ago — so the row must reach `proposed` and still survive.
  const { sweep, db, deletedBlobs, restore } = withMocks({
    assets: [pendingAsset(1)],
    onPendingRead: (live) => { live.assets[0].category = 'bug-report'; },
  });
  try {
    const res = await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    assert.deepEqual(res.data.proposed.map((o) => o.id), [1], 'the scan must have proposed it, or this proves nothing');
    assert.deepEqual(res.data.deleted, []);
    assert.equal(res.data.notDeleted[0].code, 'CHANGED_UNDERNEATH');
    assert.equal(res.ok, false);
    assert.deepEqual(deletedBlobs, [], 'the file belongs to a real report now');
    assert.equal(db.assets.length, 1);
  } finally { restore(); }
});

test('the sweep never asks the database for anything but pending bug-report rows', async () => {
  const { sweep, queries, restore } = withMocks({ assets: [pendingAsset(1)] });
  try {
    await sweep.sweepBugReportOrphans({ now: NOW, dryRun: false });
    const listQuery = queries.find((q) => q.table === 'assets' && q.method === 'GET' && !/id=eq\./.test(q.query));
    assert.match(listQuery.query, /category=eq\.bug-report-pending/);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// The scheduled endpoint. The interesting case is the one curl cannot reach:
// a LOGGED-IN caller. routes/index.js lets any session past its own gate, so
// the only thing standing between an ordinary admin and "delete across every
// project at once" is the cron check inside the handler.
// ---------------------------------------------------------------------------

const projectSupportPath = require.resolve('../../routes/projectSupport.js');

async function callSweepEndpoint(req) {
  const sweepPath = require.resolve('../../lib/bugReportOrphanSweep.js');
  const savedSweep = require.cache[sweepPath];
  let sweepRan = false;
  require.cache[sweepPath] = {
    id: sweepPath,
    filename: sweepPath,
    loaded: true,
    exports: {
      sweepBugReportOrphans: async () => {
        sweepRan = true;
        return { ok: true, status: 200, data: { scanned: 0, kept: [], deleted: [], notDeleted: [] } };
      },
    },
  };
  const savedRoute = require.cache[projectSupportPath];
  delete require.cache[projectSupportPath];
  const projectSupport = require(projectSupportPath);

  const res = { statusCode: 0, body: '', setHeader() {}, end(c) { this.body = c || ''; } };
  const handled = await projectSupport.handle(
    { method: 'GET', headers: {}, ...req },
    res,
    '/api/support/bug-reports/sweep-orphans',
    'GET',
  );

  if (savedSweep) require.cache[sweepPath] = savedSweep; else delete require.cache[sweepPath];
  if (savedRoute) require.cache[projectSupportPath] = savedRoute; else delete require.cache[projectSupportPath];
  return { handled, status: res.statusCode, body: res.body, sweepRan };
}

test('a logged-in user cannot trigger the sweep — only the scheduler can', async () => {
  const asUser = await callSweepEndpoint({ authUser: { id: 'u1', email: 'someone@example.com' }, cronPublish: false });
  assert.equal(asUser.handled, true);
  assert.equal(asUser.status, 403);
  assert.match(asUser.body, /CRON_ONLY/);
  assert.equal(asUser.sweepRan, false, 'the sweep must not have run at all');
});

test('the scheduler does trigger the sweep', async () => {
  const asCron = await callSweepEndpoint({ cronPublish: true });
  assert.equal(asCron.status, 200);
  assert.equal(asCron.sweepRan, true);
});
