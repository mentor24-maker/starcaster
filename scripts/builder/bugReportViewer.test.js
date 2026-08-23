'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Bug Report 4/5 — GET /api/public/bug-report/viewer answers which visibility
 * tier the current browser is, for the module's render-side gating:
 * public (no session), client (signed-in editor), staff (signed-in admin).
 * UX only — the submit endpoint re-verifies any tier claim (1/5).
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const adminStorePath = require.resolve('../../lib/projectAdminStore.js');
const rebuildPaths = ['../../lib/projectScope.js', '../../lib/projectsStore.js', '../../routes/publicSite.js'].map((p) => require.resolve(p));
const realSupabase = require(supabasePath);
const KNOWN_PROJECT_ID = 'proj_1';

function withMocks({ session = null } = {}) {
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => realSupabase.tableConfig(),
    sbQuery: async ({ query = '' }) => {
      const m = /(?:^|&)id=eq\.([^&]*)/.exec(query);
      if (m) { const id = decodeURIComponent(m[1]); return { ok: true, status: 200, data: id === KNOWN_PROJECT_ID ? [{ id }] : [] }; }
      return { ok: true, status: 200, data: [] };
    },
  };
  const fakeAdminStore = { getAdminSession: async (token) => (token === 'tok_1' ? session : null) };
  const saved = [supabasePath, adminStorePath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[adminStorePath] = { id: adminStorePath, filename: adminStorePath, loaded: true, exports: fakeAdminStore };
  for (const p of rebuildPaths) delete require.cache[p];
  const publicSite = require('../../routes/publicSite.js');
  return {
    publicSite,
    restore() {
      for (const [p, entry] of saved) { if (entry) require.cache[p] = entry; else delete require.cache[p]; }
      for (const p of rebuildPaths) delete require.cache[p];
    },
  };
}

async function viewer(publicSite, { projectId = KNOWN_PROJECT_ID, cookie = '' } = {}) {
  const path = `/api/public/bug-report/viewer?projectId=${encodeURIComponent(projectId)}`;
  const req = { method: 'GET', url: path, headers: { host: 'localhost', ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: '203.0.113.9' } };
  const res = { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(chunk) { this.body = chunk || ''; } };
  await publicSite.handle(req, res, '/api/public/bug-report/viewer', 'GET');
  return { status: res.statusCode, payload: JSON.parse(res.body), headers: res.headers };
}

test('no session → public', async () => {
  const { publicSite, restore } = withMocks();
  try {
    const { status, payload, headers } = await viewer(publicSite);
    assert.equal(status, 200);
    assert.deepEqual(payload, { ok: true, data: { tier: 'public' } });
    assert.match(String(headers['Cache-Control']), /no-store/);
  } finally { restore(); }
});

test('a signed-in editor for THIS project → client; an admin → staff', async () => {
  const editor = withMocks({ session: { projectId: KNOWN_PROJECT_ID, adminUserId: 'u1', adminUser: { role: 'editor', isStaff: false } } });
  try {
    assert.equal((await viewer(editor.publicSite, { cookie: 'app_admin_session=tok_1' })).payload.data.tier, 'client');
  } finally { editor.restore(); }
  const admin = withMocks({ session: { projectId: KNOWN_PROJECT_ID, adminUserId: 'u2', adminUser: { role: 'admin', isStaff: true } } });
  try {
    assert.equal((await viewer(admin.publicSite, { cookie: 'app_admin_session=tok_1' })).payload.data.tier, 'staff');
  } finally { admin.restore(); }
});

test("a session for a DIFFERENT project does not lift this project's tier", async () => {
  const { publicSite, restore } = withMocks({ session: { projectId: 'proj_OTHER', adminUserId: 'u3', adminUser: { role: 'admin', isStaff: true } } });
  try {
    assert.equal((await viewer(publicSite, { cookie: 'app_admin_session=tok_1' })).payload.data.tier, 'public');
  } finally { restore(); }
});

test('an unknown project on a system host is refused, same guard as submit', async () => {
  const { publicSite, restore } = withMocks();
  try {
    const { status, payload } = await viewer(publicSite, { projectId: 'proj_nope' });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
  } finally { restore(); }
});

test('the admin user model carries the derived staff flag', () => {
  const store = require('../../lib/projectAdminStore.js');
  // sanitizeAdminUser is internal; the flag surfaces through getAdminSession's
  // adminUser — pin the derivation rule here so a rename does not silently
  // turn every staff tier into client.
  const src = require('node:fs').readFileSync(require.resolve('../../lib/projectAdminStore.js'), 'utf8');
  assert.match(src, /isStaff:\s*\(safeText\(row\?\.role\) \|\| 'editor'\) === 'admin'/);
  assert.equal(typeof store.getAdminSession, 'function');
});
