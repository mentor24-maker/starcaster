'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Outreach wizard 4/19 · sign-in window slice 2 (86bcrmbc9) — the pass and
 * the window log.
 *
 * The fake database reads its schema FROM docs/SQL/browser_view_sessions_setup.sql
 * (scripts/builder/sqlSchemaFake.js), so a column dropped from the SQL fails
 * here rather than quietly disagreeing with the store.
 *
 * The door keeper in these tests is NOT a stub that says yes. It is the real
 * workers/browser-door/door.js — its signature check and its PassBook — fed
 * exactly the bytes the route sends, so "single-use" and "dies after 60
 * seconds" are proved against the code that will enforce them on the Mini.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'browser_view_sessions_setup.sql');
const { parseSchemaFile, parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
const door = require('../../workers/browser-door/door.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/browserViewStore.js');
const clientPath = require.resolve('../../lib/browserDoorClient.js');
const rateLimiterPath = require.resolve('../../lib/rateLimiter.js');
const routePath = require.resolve('../../routes/browserView.js');

const TABLE = 'browser_view_sessions';
const SECRET = 'test-secret-shared-by-the-mini-and-vercel';
const DOOR_URL = 'https://mini.example.ts.net/live';

const ADMIN_A = { projectId: 'proj_a', userId: 'user_1', role: 'owner' };
const ADMIN_B = { projectId: 'proj_b', userId: 'user_2', role: 'admin' };
const EDITOR_A = { projectId: 'proj_a', userId: 'user_3', role: 'editor' };
const MEMBER_A = { projectId: 'proj_a', userId: 'user_4', role: 'member' };

function withRoute() {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ browserViewSessions: TABLE }),
    sbQuery: db.sbQuery,
  };
  const saved = {
    supabase: require.cache[supabasePath],
    rateLimiter: require.cache[rateLimiterPath],
    fetch: globalThis.fetch,
    url: process.env.BROWSER_DOOR_URL,
    secret: process.env.BROWSER_DOOR_SECRET,
  };
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  // The real limiter is per-process and these tests open many windows a minute.
  require.cache[rateLimiterPath] = {
    id: rateLimiterPath, filename: rateLimiterPath, loaded: true, exports: { checkEndpointLimit: () => false },
  };
  for (const p of [projectScopePath, storePath, clientPath, routePath]) delete require.cache[p];

  // The Mini, with its clock under the test's control.
  const clock = { now: Date.now() };
  const passes = new door.PassBook({ now: () => clock.now });
  const doorState = { mode: 'real', calls: [] };
  globalThis.fetch = async (url, init) => {
    doorState.calls.push({ url, init });
    if (doorState.mode === 'down') throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' });
    const check = door.verifyOpen({
      secret: doorState.mode === 'wrong-secret' ? 'some-other-secret' : SECRET,
      timestamp: init.headers['x-door-timestamp'],
      signature: init.headers['x-door-signature'],
      body: init.body,
      now: Number(init.headers['x-door-timestamp']),
    });
    if (!check.ok) return { ok: false, status: 401, json: async () => ({}) };
    const parsed = JSON.parse(init.body);
    const issued = passes.issue({ pass: parsed.pass, projectId: parsed.project_id, site: parsed.site });
    return issued.ok
      ? { ok: true, status: 200, json: async () => ({ ok: true }) }
      : { ok: false, status: 400, json: async () => ({ ok: false, error: { message: issued.error } }) };
  };
  process.env.BROWSER_DOOR_URL = DOOR_URL;
  process.env.BROWSER_DOOR_SECRET = SECRET;

  const route = require(routePath);
  const store = require(storePath);

  function restore() {
    if (saved.supabase) require.cache[supabasePath] = saved.supabase;
    else delete require.cache[supabasePath];
    if (saved.rateLimiter) require.cache[rateLimiterPath] = saved.rateLimiter;
    else delete require.cache[rateLimiterPath];
    for (const p of [projectScopePath, storePath, clientPath, routePath]) delete require.cache[p];
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.BROWSER_DOOR_URL; else process.env.BROWSER_DOOR_URL = saved.url;
    if (saved.secret === undefined) delete process.env.BROWSER_DOOR_SECRET; else process.env.BROWSER_DOOR_SECRET = saved.secret;
  }
  return { db, route, store, passes, clock, doorState, restore };
}

async function call(route, who, { method = 'POST', path: urlPath = '/api/browser-view/open', body = null } = {}) {
  const req = {
    method,
    url: urlPath,
    headers: { host: 'localhost:3001' },
    body: body === null ? undefined : body,
    projectContext: who.projectId
      ? { project: { id: who.projectId }, membership: who.role ? { projectId: who.projectId, userId: who.userId, role: who.role } : null }
      : null,
    authUser: who.userId ? { id: who.userId, email: `${who.userId}@example.com` } : null,
  };
  const written = { status: 0, payload: null, headers: {} };
  const res = {
    set statusCode(value) { written.status = value; },
    get statusCode() { return written.status; },
    setHeader(name, value) { written.headers[String(name).toLowerCase()] = value; },
    end(text) { written.payload = text ? JSON.parse(text) : null; },
  };
  const handled = await route.handle(req, res, urlPath, method);
  return { handled, ...written };
}

async function readRows(db, projectId) {
  const res = await db.sbQuery({ method: 'GET', table: TABLE, query: `project_id=eq.${projectId}&select=*` });
  assert.equal(res.ok, true, res.error);
  return res.data;
}

// ── The schema ──────────────────────────────────────────────────────────────

test('the table carries BOTH tenant columns, project_id is text, RLS is on, and no pass column exists', () => {
  const table = parseSchemaFile(SQL_PATH).tables.get(TABLE);
  assert.ok(table, `${TABLE} is missing from the SQL`);
  assert.ok(table.columns.get('owner_user_id'), 'project_id without owner_user_id makes scopedInsertRow stamp NEITHER');
  assert.equal(table.columns.get('project_id').type, 'text');
  assert.equal(table.columns.get('project_id').notNull, true);
  assert.ok(parseSchemaFile(SQL_PATH).rlsEnabled.has(TABLE), 'row level security is not enabled');
  assert.ok(table.columns.get('pass_hash'));
  assert.equal(table.columns.has('pass'), false, 'the pass itself must never be a column');
});

test('the SQL is idempotent and destroys nothing', () => {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const once = parseSchemaText(sql);
  const twice = parseSchemaText(`${sql}\n${sql}`);
  assert.deepEqual([...twice.tables.keys()], [...once.tables.keys()]);
  for (const statement of once.statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('create')) assert.ok(normalized.includes('if not exists'), normalized.slice(0, 70));
    assert.ok(!/^(drop|truncate|delete)\b/.test(normalized), normalized.slice(0, 70));
  }
});

test("the store's lists match the SQL's check constraints and the door keeper's sites and pass life", () => {
  const { store, restore } = withRoute();
  try {
    const columns = parseSchemaFile(SQL_PATH).tables.get(TABLE).columns;
    assert.deepEqual([...columns.get('site').allowed].sort(), [...store.SITES].sort());
    assert.deepEqual([...columns.get('close_reason').allowed].filter(Boolean).sort(), [...store.CLOSE_REASONS].sort());
    assert.deepEqual([...store.SITES].sort(), Object.keys(door.SITES).sort(), 'Starcaster and the door keeper know different sites');
    assert.equal(store.PASS_TTL_MS, door.PASS_TTL_MS);
  } finally {
    restore();
  }
});

test("Starcaster's signature is byte-equal to the door keeper's", () => {
  const client = require(clientPath);
  const body = JSON.stringify({ pass: 'x'.repeat(43), project_id: 'proj_a', site: 'youtube' });
  assert.equal(client.signOpen(SECRET, '1700000000000', body), door.signOpen(SECRET, '1700000000000', body));
});

// ── Who may open it ─────────────────────────────────────────────────────────

test('a non-admin gets 403, and nothing is written or sent to the Mini', async () => {
  const { route, db, doorState, restore } = withRoute();
  try {
    for (const who of [EDITOR_A, MEMBER_A, { projectId: 'proj_a', userId: 'user_5', role: '' }]) {
      const opened = await call(route, who, { body: { site: 'youtube' } });
      assert.equal(opened.handled, true);
      assert.equal(opened.status, 403, `role "${who.role}" was let in`);
      const closed = await call(route, who, { path: '/api/browser-view/anything/close', body: { reason: 'finished' } });
      assert.equal(closed.status, 403);
      const listed = await call(route, who, { method: 'GET', path: '/api/browser-view/sessions' });
      assert.equal(listed.status, 403);
    }
    assert.equal((await readRows(db, 'proj_a')).length, 0);
    assert.equal(doorState.calls.length, 0);
  } finally {
    restore();
  }
});

test("a tenant site's admin login is never accepted on this path", () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth.js');
  assert.equal(acceptsProjectAdminSession('/api/browser-view/open', { method: 'POST' }), false);
  assert.equal(acceptsProjectAdminSession('/api/browser-view/sessions', { method: 'GET' }), false);
});

test('an unknown site is refused before anything is written', async () => {
  const { route, db, doorState, restore } = withRoute();
  try {
    const opened = await call(route, ADMIN_A, { body: { site: 'facebook' } });
    assert.equal(opened.status, 400);
    assert.match(opened.payload.error.message, /youtube/);
    assert.equal((await readRows(db, 'proj_a')).length, 0);
    assert.equal(doorState.calls.length, 0);
  } finally {
    restore();
  }
});

// ── The pass ────────────────────────────────────────────────────────────────

test('an admin gets a pass the Mini accepts, and the row lands with both tenant columns', async () => {
  const { route, db, passes, restore } = withRoute();
  try {
    const opened = await call(route, ADMIN_A, { body: { site: 'youtube' } });
    assert.equal(opened.status, 201, JSON.stringify(opened.payload));
    assert.match(opened.headers['cache-control'], /no-store/, 'the answer carrying the pass must not be cached');
    const { session, pass, viewerUrl } = opened.payload.data;
    assert.equal(viewerUrl, 'wss://mini.example.ts.net/live/live');
    assert.ok(Buffer.from(pass, 'base64url').length === 32, 'a pass is 32 random bytes');

    const rows = await readRows(db, 'proj_a');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');
    assert.equal(rows[0].opened_by, 'user_1');
    assert.equal(rows[0].opened_by_email, 'user_1@example.com');
    assert.equal(rows[0].status, 'open');
    assert.equal(rows[0].id, session.id);
    assert.equal(rows[0].pass_hash, door.hashPass(pass), 'only the hash is kept');
    assert.ok(!JSON.stringify(rows[0]).includes(pass), 'the pass itself reached the database');

    assert.deepEqual(passes.consume(pass), { ok: true, projectId: 'proj_a', site: 'youtube' });
  } finally {
    restore();
  }
});

test('a pass is single-use', async () => {
  const { route, passes, restore } = withRoute();
  try {
    const { pass } = (await call(route, ADMIN_A, { body: { site: 'substack' } })).payload.data;
    assert.equal(passes.consume(pass).ok, true);
    assert.deepEqual(passes.consume(pass), { ok: false, reason: 'unknown' });
  } finally {
    restore();
  }
});

test('a pass dies after 60 seconds', async () => {
  const { route, passes, clock, restore } = withRoute();
  try {
    const opened = (await call(route, ADMIN_A, { body: { site: 'reddit' } })).payload.data;
    assert.equal(Date.parse(opened.passExpiresAt) - Date.parse(opened.session.openedAt), 60 * 1000);
    clock.now += 60 * 1000 + 1;
    assert.deepEqual(passes.consume(opened.pass), { ok: false, reason: 'expired' });
  } finally {
    restore();
  }
});

test('every open makes a fresh pass, so a second window never reuses the first one', async () => {
  const { route, passes, restore } = withRoute();
  try {
    const first = (await call(route, ADMIN_A, { body: { site: 'google' } })).payload.data;
    const second = (await call(route, ADMIN_A, { body: { site: 'google' } })).payload.data;
    assert.notEqual(first.pass, second.pass);
    assert.notEqual(first.session.id, second.session.id);
    assert.equal(passes.size, 2);
  } finally {
    restore();
  }
});

test("a pass names the project it was issued for, so project A's pass cannot open project B", async () => {
  const { route, passes, restore } = withRoute();
  try {
    const a = (await call(route, ADMIN_A, { body: { site: 'youtube' } })).payload.data;
    const b = (await call(route, ADMIN_B, { body: { site: 'youtube' } })).payload.data;
    assert.equal(passes.consume(a.pass).projectId, 'proj_a');
    assert.equal(passes.consume(b.pass).projectId, 'proj_b');
  } finally {
    restore();
  }
});

// ── When the Mini does not open it ──────────────────────────────────────────

test('an unreachable Mini is logged as an open/close pair and the admin is told plainly', async () => {
  const { route, db, doorState, restore } = withRoute();
  try {
    doorState.mode = 'down';
    const opened = await call(route, ADMIN_A, { body: { site: 'youtube' } });
    assert.equal(opened.status, 502);
    assert.match(opened.payload.error.message, /Mac Mini could not be reached/);
    assert.equal(JSON.stringify(opened.payload).includes('"pass"'), false, 'a pass was handed out for a window that never opened');
    const [row] = await readRows(db, 'proj_a');
    assert.equal(row.status, 'closed');
    assert.equal(row.close_reason, 'door-unreachable');
    assert.equal(row.closed_by, '');
  } finally {
    restore();
  }
});

test('a Mini holding a different secret refuses, and the log says so', async () => {
  const { route, db, doorState, restore } = withRoute();
  try {
    doorState.mode = 'wrong-secret';
    const opened = await call(route, ADMIN_A, { body: { site: 'youtube' } });
    assert.equal(opened.status, 502);
    assert.match(opened.payload.error.message, /signature/);
    assert.equal((await readRows(db, 'proj_a'))[0].close_reason, 'door-refused');
  } finally {
    restore();
  }
});

test('a server with no door address set says which setting is missing, and logs the attempt', async () => {
  const { route, db, doorState, restore } = withRoute();
  try {
    delete process.env.BROWSER_DOOR_URL;
    const opened = await call(route, ADMIN_A, { body: { site: 'youtube' } });
    assert.equal(opened.status, 503);
    assert.match(opened.payload.error.message, /BROWSER_DOOR_URL is not set/);
    assert.equal(doorState.calls.length, 0);
    assert.equal((await readRows(db, 'proj_a'))[0].close_reason, 'not-configured');
  } finally {
    restore();
  }
});

// ── The close ───────────────────────────────────────────────────────────────

test('the close records who, why and how long, and only once', async () => {
  const { route, db, restore } = withRoute();
  try {
    const { session } = (await call(route, ADMIN_A, { body: { site: 'youtube' } })).payload.data;
    const closed = await call(route, ADMIN_A, { path: `/api/browser-view/${session.id}/close`, body: { reason: 'idle' } });
    assert.equal(closed.status, 200, JSON.stringify(closed.payload));
    assert.equal(closed.payload.data.closeReason, 'idle');
    assert.equal(closed.payload.data.closedBy, 'user_1');
    assert.equal(typeof closed.payload.data.durationSeconds, 'number');

    const [row] = await readRows(db, 'proj_a');
    assert.equal(row.status, 'closed');
    assert.ok(row.closed_at);
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');

    const again = await call(route, ADMIN_A, { path: `/api/browser-view/${session.id}/close`, body: { reason: 'finished' } });
    assert.equal(again.status, 409);
    assert.equal((await readRows(db, 'proj_a'))[0].close_reason, 'idle', 'a second close overwrote the first');
  } finally {
    restore();
  }
});

test('a viewer cannot claim a server-only close reason, and cannot close another project\'s window', async () => {
  const { route, restore } = withRoute();
  try {
    const { session } = (await call(route, ADMIN_A, { body: { site: 'youtube' } })).payload.data;
    const bogus = await call(route, ADMIN_A, { path: `/api/browser-view/${session.id}/close`, body: { reason: 'door-refused' } });
    assert.equal(bogus.status, 400);
    const crossed = await call(route, ADMIN_B, { path: `/api/browser-view/${session.id}/close`, body: { reason: 'finished' } });
    assert.equal(crossed.status, 404);
  } finally {
    restore();
  }
});

test('a window nobody reported closed is swept as not-reported once it must have ended', async () => {
  const { store, db, restore } = withRoute();
  try {
    const scope = { projectId: 'proj_a', userId: 'user_1' };
    const t0 = Date.now();
    const old = await store.openSession({ site: 'youtube' }, scope, { now: () => t0 });
    assert.equal(old.ok, true, old.error);
    const fresh = await store.openSession({ site: 'youtube' }, scope, { now: () => t0 + store.NOT_REPORTED_AFTER_MS });
    assert.equal(fresh.ok, true, fresh.error);

    const swept = await store.sweepNotReported(scope, { now: () => t0 + store.NOT_REPORTED_AFTER_MS + 1 });
    assert.deepEqual(swept.data, { closed: 1 });
    const rows = await readRows(db, 'proj_a');
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId[old.data.session.id].close_reason, 'not-reported');
    assert.equal(byId[old.data.session.id].duration_seconds, null, 'a not-reported close cannot know how long it lasted');
    assert.equal(byId[fresh.data.session.id].status, 'open');
  } finally {
    restore();
  }
});

test('the log lists only this project', async () => {
  const { route, restore } = withRoute();
  try {
    await call(route, ADMIN_A, { body: { site: 'youtube' } });
    await call(route, ADMIN_B, { body: { site: 'reddit' } });
    const listed = await call(route, ADMIN_B, { method: 'GET', path: '/api/browser-view/sessions' });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.payload.data.map((s) => s.projectId), ['proj_b']);
  } finally {
    restore();
  }
});
