'use strict';

/**
 * /api/spirality/* (routes/spirality.js, ticket 86bczt5kf): StarCaster's
 * server talking to a Spirality tracker for the Spirality Tasks module.
 *
 * Both ends are real HTTP: a fake tracker that answers in the tracker's own
 * shapes (spirality tracker/server.mjs), and the route mounted on a server of
 * its own, called with fetch the way the page will. The host binding and the
 * rate limiter are handed in, so no database is needed.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { createSpiralityRoutes, cookieName } = require('../../routes/spirality');
const { UNREACHABLE } = require('../../lib/spiralityTracker');

const TOKEN = 'tok-secret-session-1234567890';
const SITE_TOKEN = 'site-token-abc';
const PROJECT_ID = 'proj-1';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const addressOf = (server) => `http://127.0.0.1:${server.address().port}`;

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

/** A tracker in the tracker's own shapes; `seen` records every request it got. */
async function fakeTracker() {
  const seen = [];
  let failures = 0;
  const server = await listen(async (req, res) => {
    const body = await readBody(req);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(json));
    };
    const signedIn = req.headers.cookie === `tracker_session=${TOKEN}`;
    if (req.url === '/signin') {
      if (body.email === 'locked@example.com') return send(429, { error: 'locked', message: 'Too many tries for that email. Wait 15 minutes, then try again.' });
      if (body.password !== 'right') {
        failures += 1;
        return send(401, { error: 'no-match', message: 'That email and password do not match.' });
      }
      return send(200, { id: 7, kind: 'human', name: 'Pat' }, {
        'set-cookie': `tracker_session=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
      });
    }
    if (req.url === '/signout') return send(200, { signedOut: true }, { 'set-cookie': 'tracker_session=; Max-Age=0' });
    if (req.url === '/account/forgot') return send(200, { sent: 'If that email has an account, a link to set a new password is on its way. It works for 1 hour.' });
    if (req.url === '/account/link') {
      if (body.link === 'used') return send(400, { error: 'used-link', message: 'That link has been used.' });
      return send(200, { purpose: body.link === 'invite' ? 'invite' : 'reset', email: 'pat@example.com', expiresAt: '2026-11-07T00:00:00Z' });
    }
    if (req.url === '/account/set-password') {
      return send(200, { purpose: body.link === 'invite' ? 'invite' : 'reset', name: body.name || 'Pat', email: 'pat@example.com' });
    }
    if (!signedIn) return send(401, { error: 'unauthorized', message: 'sign in, or send a valid token.' });
    if (req.url === '/me') return send(200, { id: 7, kind: 'human', name: 'Pat' });
    if (req.url === '/projects') return send(200, { projects: [{ slug: 'spirality', name: 'Spirality', prefix: 'SP', open: 3, owner: { id: 1, name: 'Dane' } }], default: 'spirality' });
    if (req.url === '/projects/spirality/board') {
      return send(200, {
        project: 'spirality',
        projectName: 'Spirality',
        columns: [
          { status: 'Requested', tickets: [{ id: 'SP-9', name: 'A new one', priority: 'normal', updatedAt: 'x', pullRequest: null }] },
          { status: 'In review', tickets: [] },
        ],
      });
    }
    if (req.url === '/projects/nope/board') return send(404, { error: 'unknown-project', message: 'no project "nope".' });
    if (req.url === '/projects/spirality/tickets' && req.method === 'POST') return send(201, { id: 'SP-10', name: body.name, status: 'requested' });
    if (/^\/tickets\/SP-\d+\/thread$/.test(req.url)) {
      return send(200, {
        id: req.url.split('/')[2], name: 'A new one', description: 'Words', project: 'spirality', projectName: 'Spirality',
        operator: { id: 1, name: 'Dane' }, mergePhrase: 'merge',
        comments: [{ id: 1, parent: null, author: { id: 2, kind: 'machine', name: 'loop-build' }, machine: true, body: 'Built it.', createdAt: 't' }],
      });
    }
    if (/^\/tickets\/SP-\d+\/comments$/.test(req.url)) return send(201, { id: 2 });
    return send(404, { error: 'no-such-call', message: `no call ${req.method} ${req.url}.` });
  });
  return { server, seen, url: addressOf(server), failures: () => failures };
}

async function mountRoutes(opts) {
  const { handle } = createSpiralityRoutes({
    resolveProject: async () => ({ ok: true, projectId: PROJECT_ID }),
    limit: () => false,
    ...opts,
  });
  const server = await listen(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const handled = await handle(req, res, pathname, req.method);
    if (!handled) { res.statusCode = 599; res.end(); }
  });
  return { server, url: addressOf(server) };
}

/** A tiny browser: keeps the one cookie our server sets, sends it back. */
function browser(base) {
  let jar = '';
  return {
    get jar() { return jar; },
    async call(method, p, body) {
      const res = await fetch(`${base}${p}`, {
        method,
        headers: { 'content-type': 'application/json', ...(jar ? { cookie: jar } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.getSetCookie();
      for (const line of set) {
        const first = line.split(';')[0];
        jar = /=$/.test(first) ? '' : first;
      }
      const text = await res.text();
      return { status: res.status, setCookie: set, text, json: JSON.parse(text) };
    },
  };
}

async function setup(trackerOpts, routeOpts = {}) {
  const tracker = await fakeTracker(trackerOpts);
  const routes = await mountRoutes({ trackerUrl: () => tracker.url, siteToken: () => SITE_TOKEN, ...routeOpts });
  const b = browser(routes.url);
  const close = () => { tracker.server.close(); routes.server.close(); };
  return { tracker, routes, b, close };
}

test('sign-in keeps the tracker session in an HttpOnly cookie of ours and never in the answer', async (t) => {
  const { b, close } = await setup();
  t.after(close);
  const r = await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, data: { signedIn: true, person: { id: 7, name: 'Pat' } } });
  assert.ok(!r.text.includes(TOKEN), 'the tracker token must never be in an answer body');
  assert.equal(r.setCookie.length, 1);
  const cookie = r.setCookie[0];
  assert.ok(cookie.startsWith(`${cookieName(PROJECT_ID)}=${TOKEN};`), cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/spirality/);
});

test('the cookie is Secure on an https request', async (t) => {
  const tracker = await fakeTracker();
  const { handle } = createSpiralityRoutes({
    trackerUrl: () => tracker.url, siteToken: () => '', resolveProject: async () => ({ ok: true, projectId: PROJECT_ID }), limit: () => false,
  });
  const server = await listen((req, res) => {
    req.headers.host = 'tasks.example.com';
    req.headers['x-forwarded-proto'] = 'https';
    return handle(req, res, '/api/spirality/signin', 'POST');
  });
  t.after(() => { tracker.server.close(); server.close(); });
  const res = await fetch(`${addressOf(server)}/api/spirality/signin`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'right' }),
  });
  assert.match(res.headers.getSetCookie()[0], /; Secure/);
});

test('later calls forward the session as the tracker cookie with a JSON content-type', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  const me = await b.call('GET', '/api/spirality/me');
  assert.deepEqual(me.json.data, { signedIn: true, person: { id: 7, name: 'Pat' } });
  const projects = await b.call('GET', '/api/spirality/projects');
  assert.deepEqual(projects.json.data, { projects: [{ slug: 'spirality', name: 'Spirality', open: 3 }], default: 'spirality' });
  const call = tracker.seen.find((s) => s.url === '/projects');
  assert.equal(call.headers.cookie, `tracker_session=${TOKEN}`);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.equal(call.headers.authorization, undefined, 'the site token rides only on forgot');
});

test('the tasks come from the board: grouped and named in the tracker\'s own order', async (t) => {
  const { b, close } = await setup();
  t.after(close);
  await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  const r = await b.call('GET', '/api/spirality/projects/spirality/tasks');
  assert.deepEqual(r.json.data.columns.map((c) => c.status), ['Requested', 'In review']);
  assert.deepEqual(r.json.data.columns[0].tasks, [{ id: 'SP-9', name: 'A new one', updatedAt: 'x' }]);
});

test('Submit Task files as Requested and answers with the new task\'s thread', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  const r = await b.call('POST', '/api/spirality/projects/spirality/tasks', { name: 'Fix it', description: 'Please' });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.id, 'SP-10');
  const filed = tracker.seen.find((s) => s.url === '/projects/spirality/tickets');
  assert.deepEqual(filed.body, { name: 'Fix it', description: 'Please', status: 'Requested' });
});

test('a task opens its thread with each author named, and a reply posts as the person', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  const thread = await b.call('GET', '/api/spirality/tasks/SP-9');
  assert.deepEqual(thread.json.data.comments, [{ id: 1, parent: null, author: { name: 'loop-build', machine: true }, machine: true, body: 'Built it.', createdAt: 't' }]);
  assert.equal(thread.json.data.mergePhrase, undefined, 'only what the module shows goes to the page');
  const reply = await b.call('POST', '/api/spirality/tasks/SP-9/comments', { body: 'Thanks' });
  assert.equal(reply.status, 201);
  const posted = tracker.seen.find((s) => s.url === '/tickets/SP-9/comments');
  assert.deepEqual(posted.body, { body: 'Thanks' });
  assert.equal(posted.headers.cookie, `tracker_session=${TOKEN}`);
});

test('tracker refusals pass through as their own plain message', async (t) => {
  const { b, close } = await setup();
  t.after(close);
  const wrong = await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json.error, { message: 'That email and password do not match.', code: 'no-match' });
  assert.equal(wrong.setCookie.length, 0);
  const locked = await b.call('POST', '/api/spirality/signin', { email: 'locked@example.com', password: 'right' });
  assert.equal(locked.status, 429);
  assert.equal(locked.json.error.message, 'Too many tries for that email. Wait 15 minutes, then try again.');
  const link = await b.call('POST', '/api/spirality/link', { link: 'used' });
  assert.equal(link.json.error.message, 'That link has been used.');
  await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  const unknown = await b.call('GET', '/api/spirality/projects/nope/tasks');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error.message, 'no project "nope".');
});

test('the tracker unreachable answers "Spirality can\'t be reached right now"', async (t) => {
  const dead = await listen(() => {});
  const deadUrl = addressOf(dead);
  await new Promise((r) => dead.close(r));
  const routes = await mountRoutes({ trackerUrl: () => deadUrl, siteToken: () => '' });
  t.after(() => routes.server.close());
  const r = await browser(routes.url).call('POST', '/api/spirality/signin', { email: 'a@b.c', password: 'right' });
  assert.equal(r.status, 502);
  assert.equal(r.json.error.message, UNREACHABLE);
  assert.match(UNREACHABLE, /^Spirality can't be reached right now/);
});

test('no tracker address set says Spirality is not connected, without a request', async (t) => {
  const routes = await mountRoutes({ trackerUrl: () => '', siteToken: () => '', fetchImpl: () => { throw new Error('must not be called'); } });
  t.after(() => routes.server.close());
  const r = await browser(routes.url).call('POST', '/api/spirality/signin', { email: 'a@b.c', password: 'x' });
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'NOT_CONNECTED');
});

test('a session the tracker no longer knows clears our cookie and reads as signed out', async (t) => {
  const routes = await setup();
  t.after(routes.close);
  const res = await fetch(`${routes.routes.url}/api/spirality/projects`, { headers: { cookie: `${cookieName(PROJECT_ID)}=expired` } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'SIGNED_OUT');
  assert.match(res.headers.getSetCookie()[0], /Max-Age=0/);
  const me = await fetch(`${routes.routes.url}/api/spirality/me`, { headers: { cookie: `${cookieName(PROJECT_ID)}=expired` } });
  assert.deepEqual((await me.json()).data, { signedIn: false });
});

test('signing out ends the tracker session and clears the cookie', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  await b.call('POST', '/api/spirality/signin', { email: 'pat@example.com', password: 'right' });
  const out = await b.call('POST', '/api/spirality/signout', {});
  assert.deepEqual(out.json.data, { signedIn: false });
  assert.match(out.setCookie[0], /Max-Age=0/);
  assert.equal(tracker.seen.find((s) => s.url === '/signout').headers.cookie, `tracker_session=${TOKEN}`);
  const me = await b.call('GET', '/api/spirality/me');
  assert.deepEqual(me.json.data, { signedIn: false });
});

test('forgot carries the site token as a bearer, and there is no register call (invite-only)', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  const forgot = await b.call('POST', '/api/spirality/forgot', { email: 'pat@example.com' });
  assert.match(forgot.json.data.sent, /^If that email has an account/);
  assert.equal(tracker.seen.find((s) => s.url === '/account/forgot').headers.authorization, `Bearer ${SITE_TOKEN}`);
  const reg = await b.call('POST', '/api/spirality/register', { name: 'Pat', email: 'pat@example.com' });
  assert.equal(reg.status, 404);
  assert.equal(tracker.seen.some((s) => s.url === '/account/register'), false, 'nothing is ever asked to register');
});

test('with no site token set, forgot still works and sends no authorization', async (t) => {
  const { b, tracker, close } = await setup({}, { siteToken: () => '' });
  t.after(close);
  await b.call('POST', '/api/spirality/forgot', { email: 'pat@example.com' });
  assert.equal(tracker.seen.find((s) => s.url === '/account/forgot').headers.authorization, undefined);
});

test('an emailed link sets the password and signs the person straight in', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  const what = await b.call('POST', '/api/spirality/link', { link: 'abc' });
  assert.deepEqual(what.json.data, { purpose: 'reset', email: 'pat@example.com', expiresAt: '2026-11-07T00:00:00Z' });
  const set = await b.call('POST', '/api/spirality/set-password', { link: 'abc', password: 'right' });
  assert.deepEqual(set.json.data, { signedIn: true, person: { id: 7, name: 'Pat' } });
  assert.ok(!set.text.includes(TOKEN));
  assert.ok(b.jar.startsWith(cookieName(PROJECT_ID)));
  assert.deepEqual(tracker.seen.find((s) => s.url === '/signin').body, { email: 'pat@example.com', password: 'right' });
});

test('an invite link finishes joining with the name typed, then signs in', async (t) => {
  const { b, tracker, close } = await setup();
  t.after(close);
  const what = await b.call('POST', '/api/spirality/link', { link: 'invite' });
  assert.equal(what.json.data.purpose, 'invite');
  const set = await b.call('POST', '/api/spirality/set-password', { link: 'invite', password: 'right', name: 'Pat Smith' });
  assert.equal(set.json.data.signedIn, true);
  assert.deepEqual(tracker.seen.find((s) => s.url === '/account/set-password').body, { link: 'invite', password: 'right', name: 'Pat Smith' });
});

test('a page on a host bound to another project is refused before the tracker is asked', async (t) => {
  const tracker = await fakeTracker();
  const routes = await mountRoutes({
    trackerUrl: () => tracker.url,
    resolveProject: async () => ({ ok: false, status: 403, error: 'Project not available on this domain', code: 'PROJECT_HOST_MISMATCH' }),
  });
  t.after(() => { tracker.server.close(); routes.server.close(); });
  const r = await browser(routes.url).call('POST', '/api/spirality/signin', { email: 'a@b.c', password: 'right' });
  assert.equal(r.status, 403);
  assert.equal(tracker.seen.length, 0);
});

test('the account calls are rate-limited more tightly than the rest', async (t) => {
  const keys = [];
  const routes = await mountRoutes({ trackerUrl: () => '', limit: (req, res, key) => { keys.push(key); return false; } });
  t.after(() => routes.server.close());
  const b = browser(routes.url);
  await b.call('POST', '/api/spirality/signin', {});
  await b.call('GET', '/api/spirality/me');
  assert.deepEqual(keys, ['spirality.account', 'spirality']);
  const { LIMITS } = require('../../lib/rateLimiter');
  assert.ok(LIMITS['spirality.account'].max < LIMITS.spirality.max);
});

test('the dispatcher registers the routes and exempts them from the StarCaster login', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8')
    .replace(/\/\/.*$/gm, '');
  assert.match(src, /const ROUTE_MODULES = \[[^\]]*\bspirality,/);
  const gate = src.slice(src.indexOf('&& !isAdminAuthRoute'), src.indexOf("sendErr(res, 401, 'Not authenticated'"));
  assert.match(gate, /&& !isSpiralityRoute/);
  const { isProjectContextOptional } = require('../../lib/requireProjectContext');
  assert.equal(isProjectContextOptional('/api/spirality/me', 'GET'), true);
});

test('neither setting is named in anything the browser loads', () => {
  const root = path.join(__dirname, '..', '..');
  const roots = ['components', 'lib/builder-client', 'public/js'].map((d) => path.join(root, d));
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(t|j)sx?$/.test(entry.name) && /SPIRALITY_(TRACKER_URL|SITE_TOKEN)|spirality(TrackerUrl|SiteToken)/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  roots.forEach(walk);
  assert.deepEqual(hits, []);
});
