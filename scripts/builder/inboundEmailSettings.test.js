'use strict';

/**
 * SC-928 — the settings screen's API for received email:
 * routes/inboundEmailSettings.js over lib/inboundEmailStore.js.
 *
 * The fake database reads its schema from docs/SQL/inbound_email_setup.sql
 * (the same fake SC-926's test uses), so every read, write and filter here is
 * checked against the real columns. The headline risk is a tenant leak
 * (landmine 12), so project B trying to list, change and delete project A's
 * route is tested on each verb, and the rows are read back from the fake
 * rather than trusted from the answer.
 */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/inboundEmailStore.js');
const routePath = require.resolve('../../routes/inboundEmailSettings.js');
const inbound = require('../../lib/resendInbound.js');

const SECRET = 'whsec_dGVzdHNlY3JldA==';
const NOW = Date.parse('2026-11-27T22:00:00Z');

const PROJECTS = {
  alphire: { id: 'alphire', name: 'Alphire', domain: 'alphire.agency', website: 'https://www.alphire.agency/' },
  delray: { id: 'delray', name: 'Delray', domain: 'delraytennis.com' },
  bare: { id: 'bare', name: 'No domain' },
};

function memberships(userId) {
  if (userId === 'dane') {
    return [
      { ...PROJECTS.alphire, membership: { role: 'owner' } },
      { ...PROJECTS.bare, membership: { role: 'owner' } },
    ];
  }
  if (userId === 'rich') return [{ ...PROJECTS.delray, membership: { role: 'owner' } }];
  if (userId === 'viewer') return [{ ...PROJECTS.alphire, membership: { role: 'member' } }];
  return [];
}

function world({ routes = [], deliveries = [] } = {}) {
  const sql = fs.readFileSync(path.join(ROOT, 'docs', 'SQL', 'inbound_email_setup.sql'), 'utf8');
  const db = createFakeDb(parseSchemaText(sql));
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { isConfigured: () => true, tableConfig: () => ({}), sbQuery: db.sbQuery },
  };
  delete require.cache[storePath];
  delete require.cache[routePath];
  const store = require('../../lib/inboundEmailStore.js');
  const { createHandler } = require('../../routes/inboundEmailSettings.js');
  let n = 0;
  for (const r of routes) {
    n += 1;
    db.data.get('inbound_email_routes').push({
      id: `a115c635-8658-4dad-a8b1-${String(n).padStart(12, '0')}`,
      project_id: 'alphire', owner_user_id: 'dane', enabled: true,
      created_at: `2026-11-2${n}T00:00:00Z`, updated_at: `2026-11-2${n}T00:00:00Z`, ...r,
    });
  }
  for (const d of deliveries) {
    n += 1;
    db.data.get('inbound_email_deliveries').push({
      id: `b115c635-8658-4dad-a8b1-${String(n).padStart(12, '0')}`,
      svix_id: `msg_${n}`, project_id: 'alphire', owner_user_id: 'dane', resend_email_id: 'em', from_address: 'ann@outside.example',
      subject: 'Hi', received_at: null, outcome: 'forwarded', error: '', attempts: 1, forwarded_email_id: '',
      created_at: '2026-11-27T10:00:00Z', updated_at: '2026-11-27T10:00:00Z', ...d,
    });
  }
  const handle = createHandler({ store, listProjectsForUser: async (userId) => ({ ok: true, data: memberships(userId) }) });
  return { db, store, handle, routes: () => db.data.get('inbound_email_routes'), deliveries: () => db.data.get('inbound_email_deliveries') };
}

async function call(w, { method = 'GET', path: p, userId = 'dane', body }) {
  const req = { authUser: { id: userId }, body };
  const res = {
    statusCode: 0,
    headers: {},
    payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(text) { this.payload = text ? JSON.parse(text) : null; },
  };
  const handled = await w.handle(req, res, p, method);
  return { handled, status: res.statusCode, body: res.payload };
}

const ADMIN = { address: 'admin@alphire.agency', forward_to: 'dane.inbox@gmail.example' };
const BASE = '/api/projects/alphire/inbound-email';

test('the Alphire project lists its admin@alphire.agency route, with its domains and recent deliveries', async () => {
  const w = world({
    routes: [ADMIN],
    deliveries: [
      { to_address: 'admin@alphire.agency', subject: 'older', created_at: '2026-11-26T10:00:00Z' },
      { to_address: 'other@alphire.agency, admin@alphire.agency', subject: 'newest', outcome: 'failed', error: 'domain not verified', created_at: '2026-11-27T12:00:00Z', received_at: '2026-11-27T11:59:00Z' },
      { to_address: 'nobody@alphire.agency', subject: 'unrelated' },
    ],
  });
  const out = await call(w, { path: BASE });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const data = out.body.data;
  assert.equal(data.canEdit, true);
  assert.deepEqual(data.domains, ['alphire.agency']);
  assert.equal(data.routes.length, 1);
  const r = data.routes[0];
  assert.equal(r.address, 'admin@alphire.agency');
  assert.equal(r.forwardTo, 'dane.inbox@gmail.example');
  assert.equal(r.enabled, true);
  assert.deepEqual(r.deliveries.map((d) => d.subject), ['newest', 'older']);
  assert.equal(r.deliveries[0].outcome, 'failed');
  assert.equal(r.deliveries[0].error, 'domain not verified');
  assert.equal(r.lastArrivalAt, '2026-11-27T11:59:00Z');
});

test('an unrelated path or another module\'s /api/projects path falls through', async () => {
  const w = world();
  assert.equal((await call(w, { path: '/api/projects/alphire/shares' })).handled, false);
  assert.equal((await call(w, { path: '/api/projects/alphire' })).handled, false);
});

test('add, edit, switch off and delete each save, and the next read shows the stored value', async () => {
  const w = world();
  const added = await call(w, { method: 'POST', path: `${BASE}/routes`, body: { address: 'Hello@Alphire.Agency', forwardTo: 'me@gmail.example' } });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(w.routes().length, 1);
  const row = w.routes()[0];
  assert.equal(row.address, 'hello@alphire.agency');
  assert.equal(row.project_id, 'alphire');
  assert.equal(row.owner_user_id, 'dane');
  const id = row.id;

  const edited = await call(w, { method: 'PATCH', path: `${BASE}/routes/${id}`, body: { address: 'team@alphire.agency', forwardTo: 'other@gmail.example' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  let read = (await call(w, { path: BASE })).body.data.routes[0];
  assert.equal(read.address, 'team@alphire.agency');
  assert.equal(read.forwardTo, 'other@gmail.example');

  const off = await call(w, { method: 'PATCH', path: `${BASE}/routes/${id}`, body: { enabled: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  read = (await call(w, { path: BASE })).body.data.routes[0];
  assert.equal(read.enabled, false);
  assert.equal(w.routes()[0].enabled, false);

  const gone = await call(w, { method: 'DELETE', path: `${BASE}/routes/${id}` });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.deepEqual(gone.body.data.routes, []);
  assert.equal(w.routes().length, 0);
});

test('an address off the project\'s domain, a bad forward-to and a project with no domain are refused, writing nothing', async () => {
  const w = world();
  const offDomain = await call(w, { method: 'POST', path: `${BASE}/routes`, body: { address: 'x@delraytennis.com', forwardTo: 'me@gmail.example' } });
  assert.equal(offDomain.status, 400);
  assert.match(offDomain.body.error.message, /not on this project's domain \(alphire\.agency\)/);
  const badTo = await call(w, { method: 'POST', path: `${BASE}/routes`, body: { address: 'x@alphire.agency', forwardTo: 'not an email' } });
  assert.equal(badTo.status, 400);
  assert.match(badTo.body.error.message, /not an email address to forward to/);
  const noDomain = await call(w, { method: 'POST', path: '/api/projects/bare/inbound-email/routes', body: { address: 'x@alphire.agency', forwardTo: 'me@gmail.example' } });
  assert.equal(noDomain.status, 400);
  assert.match(noDomain.body.error.message, /no domain set/);
  // A subdomain of the project's domain is the project's.
  const sub = await call(w, { method: 'POST', path: `${BASE}/routes`, body: { address: 'x@mail.alphire.agency', forwardTo: 'me@gmail.example' } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.deepEqual(w.routes().map((r) => r.address), ['x@mail.alphire.agency']);
  // An edit moving it off the domain is refused too.
  const move = await call(w, { method: 'PATCH', path: `${BASE}/routes/${w.routes()[0].id}`, body: { address: 'x@evil.example' } });
  assert.equal(move.status, 400);
  assert.equal(w.routes()[0].address, 'x@mail.alphire.agency');
});

test('project B cannot list, change or delete project A\'s routes', async () => {
  const w = world({ routes: [ADMIN] });
  const id = w.routes()[0].id;
  // Rich belongs only to Delray: Alphire's URL is refused outright.
  const list = await call(w, { userId: 'rich', path: BASE });
  assert.equal(list.status, 403);
  assert.equal(list.body.data, undefined);
  // Through his own project's URL, Alphire's route id is not his: 404, nothing changed.
  const own = '/api/projects/delray/inbound-email';
  const listed = await call(w, { userId: 'rich', path: own });
  assert.deepEqual(listed.body.data.routes, []);
  const patch = await call(w, { userId: 'rich', method: 'PATCH', path: `${own}/routes/${id}`, body: { forwardTo: 'rich@evil.example' } });
  assert.equal(patch.status, 404);
  const del = await call(w, { userId: 'rich', method: 'DELETE', path: `${own}/routes/${id}` });
  assert.equal(del.status, 404);
  assert.equal(w.routes().length, 1);
  assert.equal(w.routes()[0].forward_to, 'dane.inbox@gmail.example');
  // And the store refuses a call with no project rather than widening to all.
  const unscoped = await w.store.listRoutes(200, '');
  assert.equal(unscoped.ok, false);
  const misordered = await w.store.listRoutes('alphire');
  assert.equal(misordered.ok, false, 'listRoutes(projectId) reads the id as a limit and has no project: refused, never every project');
});

test('a plain member can read but not write; a signed-out call is 401', async () => {
  const w = world({ routes: [ADMIN] });
  const read = await call(w, { userId: 'viewer', path: BASE });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.canEdit, false);
  const write = await call(w, { userId: 'viewer', method: 'PATCH', path: `${BASE}/routes/${w.routes()[0].id}`, body: { enabled: false } });
  assert.equal(write.status, 403);
  assert.equal(w.routes()[0].enabled, true);
  const anon = await call(w, { userId: '', path: BASE });
  assert.equal(anon.status, 401);
});

test('mail to a switched-off route is not forwarded, and the log says it was refused because the route is off', async () => {
  const w = world({ routes: [{ ...ADMIN, enabled: false }] });
  const sent = [];
  const bus = [];
  const event = {
    type: 'email.received',
    created_at: '2026-11-27T22:00:00.000Z',
    data: { email_id: 'em_123', from: 'ann@outside.example', to: ['admin@alphire.agency'], received_for: ['admin@alphire.agency'], subject: 'Hello' },
  };
  const raw = JSON.stringify(event);
  const out = await inbound.handleInbound(
    { headers: inbound.signForTest({ secret: SECRET, id: 'msg_off', timestamp: Math.floor(NOW / 1000), body: raw }), rawBody: raw, rawExact: true },
    {
      secret: SECRET, apiKey: 're_test', store: w.store, now: NOW,
      fetchImpl: async () => { throw new Error('nothing should be fetched for a switched-off route'); },
      sendEmail: async (m) => { sent.push(m); return { ok: true, data: { id: 'x' } }; },
      postBus: async (t) => { bus.push(t); return { ok: true }; },
    },
  );
  assert.equal(out.status, 200, JSON.stringify(out.payload));
  assert.equal(out.payload.data.outcome, 'refused');
  assert.equal(sent.length, 0);
  const rows = w.deliveries();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'refused');
  assert.match(rows[0].error, /admin@alphire\.agency is switched off/);
  assert.equal(rows[0].project_id, 'alphire', 'carried under the route\'s project, so its screen shows it');
  // And the screen shows it under that route.
  const screen = (await call(w, { path: BASE })).body.data.routes[0];
  assert.equal(screen.deliveries[0].outcome, 'refused');
  assert.match(screen.deliveries[0].error, /switched off/);
});

test('projectDomains takes the custom domain and site hosts, without www or hosting domains', () => {
  const { projectDomains } = require('../../routes/inboundEmailSettings.js');
  assert.deepEqual(
    projectDomains({ domain: 'Alphire.Agency', website: 'https://www.alphire.agency/x', siteUrl: 'https://alphire.vercel.app', url: 'https://cassidy.example' }),
    ['alphire.agency', 'cassidy.example'],
  );
  assert.deepEqual(projectDomains({}), []);
});
