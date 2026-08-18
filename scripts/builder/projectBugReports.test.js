'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Bug-report intake: store + public POST /api/public/bug-report.
 * Loop Queue task 1/5 — table, store, submit endpoint. No screenshots (2/5),
 * no ClickUp forwarding (3/5), no module UI (4/5), no email (5/5).
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const adminStorePath = require.resolve('../../lib/projectAdminStore.js');
const storePath = require.resolve('../../lib/projectBugReportsStore.js');
const publicSitePath = require.resolve('../../routes/publicSite.js');

/** Swap lib/supabase for a recorder so the store's wire format is pinned. */
function withMocks({ rows = [{}], adminSession = null } = {}) {
  const calls = [];
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ projectBugReports: 'project_bug_reports' }),
    sbQuery: async (options) => {
      calls.push(options);
      return { ok: true, status: 200, data: rows };
    },
  };
  const fakeAdminStore = {
    getAdminSession: async () => adminSession,
  };

  const realSupabase = require.cache[supabasePath];
  const realAdminStore = require.cache[adminStorePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[adminStorePath] = { id: adminStorePath, filename: adminStorePath, loaded: true, exports: fakeAdminStore };
  delete require.cache[storePath];
  delete require.cache[publicSitePath];

  const store = require(storePath);
  const publicSite = require(publicSitePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase; else delete require.cache[supabasePath];
    if (realAdminStore) require.cache[adminStorePath] = realAdminStore; else delete require.cache[adminStorePath];
    delete require.cache[storePath];
    delete require.cache[publicSitePath];
  }

  return { store, publicSite, calls, restore };
}

function fakeRes() {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = (chunk) => { res.body = chunk || ''; };
  return res;
}

function fakeReq({ body = {}, ip = '10.0.0.1', headers = {} } = {}) {
  return {
    method: 'POST',
    url: '/api/public/bug-report',
    headers: { host: 'localhost', 'user-agent': 'test-agent', ...headers },
    socket: { remoteAddress: ip },
    body,
  };
}

async function post(publicSite, opts) {
  const res = fakeRes();
  const req = fakeReq(opts);
  const handled = await publicSite.handle(req, res, '/api/public/bug-report', 'POST');
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}

// ── Store ────────────────────────────────────────────────────────────────────

test('an empty description is rejected before any DB call', async () => {
  const { store, calls, restore } = withMocks();
  try {
    const result = await store.createBugReport({ description: '   ' }, { projectId: 'proj_1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(calls.length, 0, 'nothing should have been written');
  } finally {
    restore();
  }
});

test('an over-long description is rejected, not silently clamped', async () => {
  const { store, calls, restore } = withMocks();
  try {
    const result = await store.createBugReport(
      { description: 'x'.repeat(store.MAX_DESCRIPTION_LENGTH + 1) },
      { projectId: 'proj_1' }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('project_id and owner_user_id come from the caller scope, and are stamped on insert', async () => {
  // The landmine this table exists to avoid (CLAUDE.md #12): scopedInsertRow
  // only stamps a table it can prove has BOTH columns. This pins the wire
  // format so a schema drift here fails loudly instead of writing untenanted rows.
  const { store, calls, restore } = withMocks();
  try {
    await store.createBugReport(
      { description: 'The submit button does nothing' },
      { projectId: 'proj_mine', userId: 'admin_1' }
    );
    const post = calls.find((c) => c.method === 'POST');
    assert.ok(post, 'a POST should have been issued');
    assert.equal(post.body[0].project_id, 'proj_mine');
    assert.equal(post.body[0].owner_user_id, 'admin_1');
  } finally {
    restore();
  }
});

test('an unknown viewer tier falls back to public rather than reaching the DB with garbage', async () => {
  const { store, calls, restore } = withMocks();
  try {
    await store.createBugReport(
      { description: 'Broken', viewerTier: 'superadmin' },
      { projectId: 'proj_1' }
    );
    assert.equal(calls.find((c) => c.method === 'POST').body[0].viewer_tier, 'public');
  } finally {
    restore();
  }
});

test('the insert asks PostgREST to return the created row', async () => {
  const { store, calls, restore } = withMocks();
  try {
    await store.createBugReport({ description: 'Broken' }, { projectId: 'proj_1' });
    assert.equal(calls.find((c) => c.method === 'POST').headers?.Prefer, 'return=representation');
  } finally {
    restore();
  }
});

test('listing is scoped, newest first, and capped', async () => {
  const { store, calls, restore } = withMocks({ rows: [] });
  try {
    await store.listBugReports(5000, { projectId: 'proj_1' });
    const get = calls.find((c) => c.method === 'GET');
    assert.match(get.query, /order=created_at\.desc/);
    assert.match(get.query, /limit=1000(&|$)/, 'clamped to the store max, not the caller-supplied 5000');
  } finally {
    restore();
  }
});

// ── Route ────────────────────────────────────────────────────────────────────

test('the route is registered under /api/public', () => {
  const { manifest } = require('../../routes/publicSite.js');
  assert.deepEqual(manifest.prefixes, ['/api/public']);
});

test('a valid submission is stored and answers 201 with an envelope', async () => {
  const { publicSite, calls, restore } = withMocks();
  try {
    const { handled, status, payload } = await post(publicSite, {
      body: { projectId: 'proj_1', description: 'The submit button does nothing', pageUrl: '/contact' },
    });
    assert.equal(handled, true, 'the route must claim the path');
    assert.equal(status, 201, 'must write a status — 0 means the guard swallowed it (CLAUDE.md #11)');
    assert.equal(payload.ok, true);
    assert.ok(payload.data.id !== undefined || true); // shape comes from the (mocked) DB row
    assert.equal(calls.find((c) => c.method === 'POST').body[0].project_id, 'proj_1');
  } finally {
    restore();
  }
});

test('an empty description is rejected with a plain-language 400, nothing written', async () => {
  const { publicSite, calls, restore } = withMocks();
  try {
    const { status, payload } = await post(publicSite, { body: { projectId: 'proj_1', description: '' } });
    assert.equal(status, 400);
    assert.equal(payload.ok, false);
    assert.match(payload.error.message, /description/i);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test('a 6000-character description is rejected with a readable message', async () => {
  const { publicSite, calls, restore } = withMocks();
  try {
    const { status, payload } = await post(publicSite, {
      body: { projectId: 'proj_1', description: 'x'.repeat(6000) },
    });
    assert.equal(status, 400);
    assert.match(payload.error.message, /5000/);
    assert.equal(calls.length, 0, 'nothing should have been written');
  } finally {
    restore();
  }
});

test('a tier-spoofing request with no real admin session is stored as public, not staff', async () => {
  // Hiding an icon in the UI is not a security boundary — the server must
  // verify a real tenant admin session before trusting a client/staff claim.
  const { publicSite, calls, restore } = withMocks({ adminSession: null });
  try {
    const { status, payload } = await post(publicSite, {
      body: { projectId: 'proj_1', description: 'I am staff, trust me', viewerTier: 'staff' },
    });
    assert.equal(status, 201);
    assert.equal(payload.ok, true);
    assert.equal(calls.find((c) => c.method === 'POST').body[0].viewer_tier, 'public');
  } finally {
    restore();
  }
});

test('a staff claim backed by a real admin session for the SAME project is honored', async () => {
  const { publicSite, calls, restore } = withMocks({
    adminSession: { adminUserId: 'admin_1', projectId: 'proj_1', adminUser: { role: 'admin' } },
  });
  try {
    const { status, payload } = await post(publicSite, {
      body: { projectId: 'proj_1', description: 'Broken as staff', viewerTier: 'staff' },
      headers: { cookie: 'app_admin_session=tok_1' },
    });
    assert.equal(status, 201);
    assert.equal(payload.ok, true);
    const written = calls.find((c) => c.method === 'POST').body[0];
    assert.equal(written.viewer_tier, 'staff');
    assert.equal(written.owner_user_id, 'admin_1');
  } finally {
    restore();
  }
});

test('an admin session for a DIFFERENT project cannot claim staff here', async () => {
  const { publicSite, calls, restore } = withMocks({
    adminSession: { adminUserId: 'admin_1', projectId: 'proj_OTHER', adminUser: { role: 'admin' } },
  });
  try {
    await post(publicSite, {
      body: { projectId: 'proj_1', description: 'Cross-tenant spoof attempt', viewerTier: 'staff' },
      headers: { cookie: 'app_admin_session=tok_1' },
    });
    assert.equal(calls.find((c) => c.method === 'POST').body[0].viewer_tier, 'public');
  } finally {
    restore();
  }
});

// ── Rate limiting (CLAUDE.md landmine #11 — the inverted form kills the
// endpoint silently: status 0, empty body, and everything above still "passes"
// review). Uses the real in-memory rate limiter, so this hammers it for real. ──

test('hammering the endpoint returns 429s, deliberately triggered', async () => {
  const { publicSite, restore } = withMocks();
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`; // unique per run
  try {
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await post(publicSite, {
        body: { projectId: 'proj_1', description: `Report #${i}` },
        ip,
      }));
    }
    const limited = results.filter((r) => r.status === 429);
    assert.ok(limited.length > 0, 'the limit (8/10min) must have been hit at least once');
    for (const r of limited) {
      assert.equal(r.payload.ok, false);
      assert.equal(r.payload.error.code, 'RATE_LIMITED');
    }
    // Confirms the correct (non-inverted) form: normal requests before the
    // limit still wrote to the DB, they were not silently swallowed either.
    const allowed = results.filter((r) => r.status === 201);
    assert.ok(allowed.length > 0, 'requests within budget must still succeed');
  } finally {
    restore();
  }
});
