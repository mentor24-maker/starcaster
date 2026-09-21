'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Studio Phase 1 · 8 of 8 (86bbjv68z) — the Footage screen's server half.
 *
 * Two layers. lib/studioFootage.js is pure, so its grouping, ordering and
 * filter rules are tested directly. routes/studio.js is then driven end to end
 * against the SQL-backed fake database the catalog tests use, so the tenant
 * boundary is tested through the real stores rather than asserted about them.
 */

const { buildFootage, readFilters, effectiveDate, NO_SESSION_TITLE, UNREAD_SESSION_TITLE, UNKNOWN_LANE } = require('../../lib/studioFootage');

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'video_studio_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const sessionsStorePath = require.resolve('../../lib/videoSessionsStore.js');
const sourcesStorePath = require.resolve('../../lib/videoSourcesStore.js');
const googleDrivePath = require.resolve('../../lib/googleDrive.js');
const routePath = require.resolve('../../routes/studio.js');

// ── the pure view ───────────────────────────────────────────────────────────

const S1 = { id: 's1', title: 'Monday shoot', recordedAt: '2026-09-01T15:00:00Z', state: 'new' };
const S2 = { id: 's2', title: 'Friday talk', recordedAt: '2026-09-05T15:00:00Z', state: 'new' };

function src(id, extra = {}) {
  return { id, sessionId: 's1', layerRole: 'subject', state: 'probed', createdAt: '2026-09-10T00:00:00Z', ...extra };
}

test('sessions come newest first; files inside a session in recording order', () => {
  const view = buildFootage({
    sessions: [S1, S2],
    sources: [
      src('late', { recordedAt: '2026-09-01T15:30:00Z' }),
      src('early', { recordedAt: '2026-09-01T15:05:00Z' }),
      src('fri', { sessionId: 's2', recordedAt: '2026-09-05T15:01:00Z' }),
    ],
  });
  assert.deepEqual(view.sessions.map((s) => s.id), ['s2', 's1']);
  assert.deepEqual(view.sessions[1].sources.map((s) => s.id), ['early', 'late']);
  assert.equal(view.totalSources, 3);
  assert.equal(view.shownSources, 3);
});

test('a file with no session, or whose session was not read, is still shown — last, and named apart', () => {
  const view = buildFootage({
    sessions: [S1],
    sources: [src('a'), src('orphan', { sessionId: '' }), src('lost', { sessionId: 'missing' })],
  });
  assert.equal(view.shownSources, 3);
  assert.deepEqual(view.sessions.map((s) => s.id).slice(0, 1), ['s1']);
  const unread = view.sessions[view.sessions.length - 2];
  const none = view.sessions[view.sessions.length - 1];
  // A session id that matches nothing read is a session PAST THE READ (the
  // foreign key cascades on delete), never a file with no session — saying
  // "Not in a session yet" for it was a false claim (review round 1).
  assert.equal(unread.title, UNREAD_SESSION_TITLE);
  assert.deepEqual(unread.sources.map((s) => s.id), ['lost']);
  assert.equal(none.title, NO_SESSION_TITLE);
  assert.deepEqual(none.sources.map((s) => s.id), ['orphan']);
});

test('the date a file is filed under says which clock it came from', () => {
  assert.equal(effectiveDate({ recordedAt: '2026-09-01T00:00:00Z' }, S2).dateSource, 'recorded');
  assert.equal(effectiveDate({ createdAt: '2026-09-10T00:00:00Z' }, S2).dateSource, 'session');
  assert.equal(effectiveDate({ createdAt: '2026-09-10T00:00:00Z' }, null).dateSource, 'added');
  assert.equal(effectiveDate({}, null).dateSource, 'none');
});

test('lane filter keeps only that lane; a file with no lane is the "unknown" lane', () => {
  const sources = [src('a', { deviceLane: 'iPhone' }), src('b', { deviceLane: 'ipad' }), src('c')];
  const view = buildFootage({ sessions: [S1], sources, filters: { lane: 'iphone' } });
  assert.deepEqual(view.sessions.flatMap((s) => s.sources.map((f) => f.id)), ['a']);
  // The lane list is read from EVERY file, not the filtered ones, so picking a
  // lane never makes the other lanes vanish from the dropdown.
  assert.deepEqual(view.lanes.map((l) => l.lane), ['ipad', 'iphone', UNKNOWN_LANE]);
  const unknown = buildFootage({ sessions: [S1], sources, filters: { lane: UNKNOWN_LANE } });
  assert.deepEqual(unknown.sessions.flatMap((s) => s.sources.map((f) => f.id)), ['c']);
});

test('date range is inclusive, and an undated file is left out but counted', () => {
  const sources = [
    src('in', { recordedAt: '2026-09-03T12:00:00Z' }),
    src('edge', { recordedAt: '2026-09-04T00:00:00Z' }),
    src('out', { recordedAt: '2026-09-09T12:00:00Z' }),
    { id: 'undated', sessionId: '', state: 'new' },
  ];
  const view = buildFootage({
    sessions: [],
    sources,
    filters: { fromMs: Date.parse('2026-09-03T00:00:00Z'), toMs: Date.parse('2026-09-04T00:00:00Z') },
  });
  assert.deepEqual(view.sessions.flatMap((s) => s.sources.map((f) => f.id)).sort(), ['edge', 'in']);
  assert.equal(view.undated, 1);
  assert.equal(view.totalSources, 4);
});

test('a session with nothing left after filtering is dropped, not shown empty', () => {
  const view = buildFootage({
    sessions: [S1, S2],
    sources: [src('a', { deviceLane: 'iphone' }), src('b', { sessionId: 's2', deviceLane: 'ipad' })],
    filters: { lane: 'ipad' },
  });
  assert.deepEqual(view.sessions.map((s) => s.id), ['s2']);
});

test('readFilters refuses a date it cannot read, rather than dropping the filter', () => {
  assert.equal(readFilters({ from: 'yesterday-ish' }).ok, false);
  assert.equal(readFilters({ from: '2026-09-05T00:00:00Z', to: '2026-09-01T00:00:00Z' }).ok, false);
  const ok = readFilters({ lane: ' iPhone ', from: '2026-09-01T00:00:00Z' });
  assert.equal(ok.ok, true);
  assert.equal(ok.filters.lane, 'iphone');
  assert.equal(ok.filters.toMs, null);
});

test('hasDriveFile tells the screen whether a preview is even possible', () => {
  const view = buildFootage({ sessions: [S1], sources: [src('a', { driveFileId: 'drv1' }), src('b')] });
  const byId = Object.fromEntries(view.sessions[0].sources.map((s) => [s.id, s]));
  assert.equal(byId.a.hasDriveFile, true);
  assert.equal(byId.b.hasDriveFile, false);
});

// ── the route, against the fake database ────────────────────────────────────

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withRoute({ drive } = {}) {
  const db = createFakeDb(parseSchemaFile(SQL_PATH));
  const saved = {};
  const swap = (p, exports) => {
    saved[p] = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  swap(supabasePath, {
    isConfigured: () => true,
    tableConfig: () => ({ videoSessions: 'video_sessions', videoSources: 'video_sources' }),
    sbQuery: db.sbQuery,
  });
  if (drive) swap(googleDrivePath, drive);
  for (const p of [projectScopePath, sessionsStorePath, sourcesStorePath, routePath]) delete require.cache[p];
  const route = require(routePath);
  const sessions = require(sessionsStorePath);
  const sources = require(sourcesStorePath);
  const restore = () => {
    for (const [p, entry] of Object.entries(saved)) {
      if (entry) require.cache[p] = entry; else delete require.cache[p];
    }
    for (const p of [projectScopePath, sessionsStorePath, sourcesStorePath, routePath]) delete require.cache[p];
  };
  return { route, sessions, sources, restore };
}

function call(route, url, scope) {
  const req = {
    url,
    method: 'GET',
    headers: { host: 'localhost' },
    projectContext: { project: { id: scope.projectId } },
    authUser: { id: scope.userId },
  };
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers || {})) this.headers[k.toLowerCase()] = v;
    },
    end(chunk) { this.body = chunk; },
  };
  const pathname = new URL(url, 'http://localhost').pathname;
  return route.handle(req, res, pathname, 'GET').then((handled) => ({ handled, res }));
}

/** A source needs a session to belong to; make one and read the id back. */
async function sourceIn(stores, scope, input = {}) {
  const session = await stores.sessions.createSession({ title: 'Holding' }, scope);
  assert.equal(session.ok, true, session.error);
  const made = await stores.sources.createSource({ sessionId: session.data.id, ...input }, scope);
  assert.equal(made.ok, true, made.error);
  return made.data;
}

function json(res) {
  return JSON.parse(String(res.body));
}

test('GET /api/studio/footage lists this project only, grouped by session', async () => {
  const { route, sessions, sources, restore } = withRoute();
  try {
    const a = await sessions.createSession({ title: 'A shoot', recordedAt: '2026-09-01T10:00:00Z' }, SCOPE_A);
    assert.equal(a.ok, true, a.error);
    const b = await sessions.createSession({ title: 'B shoot' }, SCOPE_B);
    assert.equal(b.ok, true, b.error);
    for (const [scope, sessionId, lane] of [[SCOPE_A, a.data.id, 'iphone'], [SCOPE_A, a.data.id, 'ipad'], [SCOPE_B, b.data.id, 'iphone']]) {
      const made = await sources.createSource({ sessionId, deviceLane: lane }, scope);
      assert.equal(made.ok, true, made.error);
    }

    const { handled, res } = await call(route, '/api/studio/footage', SCOPE_A);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.ok, true);
    assert.equal(body.data.totalSources, 2, 'project B\'s file must not appear under project A');
    assert.deepEqual(body.data.sessions.map((s) => s.title), ['A shoot']);
    assert.equal(body.data.truncated, false);

    const filtered = json((await call(route, '/api/studio/footage?lane=ipad', SCOPE_A)).res);
    assert.equal(filtered.data.shownSources, 1);
    assert.equal(filtered.data.sessions[0].sources[0].lane, 'ipad');
  } finally {
    restore();
  }
});

test('GET /api/studio/footage answers 400 for an unreadable date', async () => {
  const { route, restore } = withRoute();
  try {
    const { res } = await call(route, '/api/studio/footage?from=not-a-date', SCOPE_A);
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).ok, false);
  } finally {
    restore();
  }
});

test('thumbnail: a file with no Drive id is a 404 the screen turns into a placeholder', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    const made = { data: await sourceIn(stores, SCOPE_A) };
    const { res } = await call(route, `/api/studio/sources/${made.data.id}/thumbnail`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NO_THUMBNAIL');
  } finally {
    restore();
  }
});

test('thumbnail: another project\'s file is not found, and Drive is never asked', async () => {
  let asked = 0;
  const drive = { getAccessToken: async () => { asked += 1; return { ok: true, data: { accessToken: 't' } }; } };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  try {
    const made = { data: await sourceIn(stores, SCOPE_B, { driveFileId: 'drv-b' }) };
    const { res } = await call(route, `/api/studio/sources/${made.data.id}/thumbnail`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(asked, 0);
  } finally {
    restore();
  }
});

test('thumbnail: Drive\'s preview is passed through as an image; no preview yet is a 404', async () => {
  const drive = { getAccessToken: async () => ({ ok: true, data: { accessToken: 'tok' } }) };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  const realFetch = global.fetch;
  const seen = [];
  let hasThumbnail = true;
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts?.headers?.Authorization });
    if (String(url).startsWith('https://www.googleapis.com/drive/v3/files/')) {
      return new Response(JSON.stringify(hasThumbnail
        ? { hasThumbnail: true, thumbnailLink: 'https://lh3.example/thumb=s220' }
        : { hasThumbnail: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const made = { data: await sourceIn(stores, SCOPE_A, { driveFileId: 'drv-a' }) };
    const url = `/api/studio/sources/${made.data.id}/thumbnail`;
    const { res } = await call(route, url, SCOPE_A);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.match(String(res.headers['cache-control']), /max-age=\d+/);
    assert.equal(Buffer.from(res.body).length, 3);
    assert.ok(seen.every((s) => s.auth === 'Bearer tok'), 'every Drive call carries the server\'s token');
    assert.ok(seen[0].url.includes('/files/drv-a?'));

    hasThumbnail = false;
    const none = (await call(route, url, SCOPE_A)).res;
    assert.equal(none.statusCode, 404);
    assert.equal(json(none).error.code, 'NO_THUMBNAIL');
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test('thumbnail: previews arriving together share ONE token refresh', async () => {
  let minted = 0;
  const drive = { getAccessToken: async () => {
    minted += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, data: { accessToken: `tok-${minted}` } };
  } };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  const realFetch = global.fetch;
  global.fetch = async (url) => (String(url).includes('/drive/v3/files/')
    ? new Response(JSON.stringify({ hasThumbnail: true, thumbnailLink: 'https://lh3.example/t' }), { status: 200 })
    : new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } }));
  try {
    const ids = [];
    for (let i = 0; i < 4; i += 1) ids.push((await sourceIn(stores, SCOPE_A, { driveFileId: `drv-${i}` })).id);
    const results = await Promise.all(ids.map((id) => call(route, `/api/studio/sources/${id}/thumbnail`, SCOPE_A)));
    assert.deepEqual(results.map((r) => r.res.statusCode), [200, 200, 200, 200]);
    assert.equal(minted, 1, 'four previews at once must not mint four tokens');
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test('thumbnail: an expired token is replaced and the SAME request succeeds', async () => {
  let minted = 0;
  const drive = { getAccessToken: async () => { minted += 1; return { ok: true, data: { accessToken: `tok-${minted}` } }; } };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const auth = opts?.headers?.Authorization;
    if (auth === 'Bearer tok-1') return new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 });
    if (String(url).includes('/drive/v3/files/')) {
      return new Response(JSON.stringify({ hasThumbnail: true, thumbnailLink: 'https://lh3.example/t' }), { status: 200 });
    }
    return new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const made = await sourceIn(stores, SCOPE_A, { driveFileId: 'drv-x' });
    const { res } = await call(route, `/api/studio/sources/${made.id}/thumbnail`, SCOPE_A);
    assert.equal(res.statusCode, 200, 'the request that discovers the expiry must not be the one that fails');
    assert.equal(minted, 2);
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test('the route ignores paths and methods it does not own', async () => {
  const { route, restore } = withRoute();
  try {
    const { handled } = await call(route, '/api/studio/elsewhere', SCOPE_A);
    assert.equal(handled, false);
  } finally {
    restore();
  }
});
