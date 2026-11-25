'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Booking calendar, slice 5 of 6 (SC-913): connecting a project's Google
 * Calendar. The adapter's refusals (lib/connections/adapters/googleCalendar.js),
 * the Google free/busy client, and the browser's return from Google's sign-in
 * (lib/connections/redirectCallback.js) driven through the REAL
 * routes/connections.js, storing into the REAL connection vault over the fake
 * database. Google is answered by a stubbed `global.fetch`.
 */

const resolve = (p) => require.resolve(`../../${p}`);
const SQL_TEXT = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SQL', 'project_connections_setup.sql'), 'utf8');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: 'cal-client',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'cal-secret',
  META_OAUTH_STATE_SECRET: 'state-secret-for-tests',
  CONNECTIONS_OAUTH_ORIGIN: 'https://starcaster.pro',
  CHANNELS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
};
const FULL_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';

function withEnv(env, fn) {
  const before = {};
  for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const restore = () => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  return Promise.resolve().then(fn).finally(restore);
}

/** Answer each fetch from a queue; record what was asked. */
function withFetch(replies, fn) {
  const queue = [...replies];
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    if (next.throws) throw new Error(next.throws);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, statusText: '', json: async () => next.body };
  };
  return Promise.resolve().then(() => fn(calls)).finally(() => { global.fetch = real; });
}

function freshAdapter() {
  for (const p of ['lib/googleCalendar.js', 'lib/connections/adapters/googleCalendar.js']) delete require.cache[resolve(p)];
  return require(resolve('lib/connections/adapters/googleCalendar.js'));
}

// ── The adapter ─────────────────────────────────────────────────────────────

test('without its Google app configured, Connect refuses in plain words and dials nothing', () => withEnv(
  { ...ENV, GOOGLE_CALENDAR_CLIENT_ID: undefined },
  () => {
    const adapter = freshAdapter();
    const res = adapter.authorizeUrl({ projectId: 'p', userId: 'u' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'GOOGLE_NOT_CONFIGURED');
    assert.match(res.error, /GOOGLE_CALENDAR_CLIENT_ID/);
  }
));

test('the Drive app\'s credentials are not borrowed for a calendar sign-in', () => withEnv(
  { ...ENV, GOOGLE_CALENDAR_CLIENT_ID: undefined, GOOGLE_CALENDAR_CLIENT_SECRET: undefined, GOOGLE_DRIVE_CLIENT_ID: 'drive', GOOGLE_DRIVE_CLIENT_SECRET: 'drive-secret' },
  () => {
    const res = freshAdapter().authorizeUrl({ projectId: 'p', userId: 'u' });
    assert.equal(res.ok, false, 'no platform-wide Google credential stands in');
  }
));

test('a sign-in that grants no lasting permission is refused, not stored to die in an hour', () => withEnv(ENV, () => withFetch(
  [{ status: 200, body: { access_token: 'ya29.a', expires_in: 3599, scope: FULL_SCOPE } }],
  async () => {
    const res = await freshAdapter().exchange({ code: 'c' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'NO_REFRESH_TOKEN');
    assert.match(res.error, /myaccount\.google\.com\/permissions/);
  }
)));

test('a sign-in with a calendar permission unticked is refused and says to leave both ticked', () => withEnv(ENV, () => withFetch(
  [{ status: 200, body: { access_token: 'ya29.a', refresh_token: '1//r', expires_in: 3599, scope: 'openid email https://www.googleapis.com/auth/calendar.events' } }],
  async () => {
    const res = await freshAdapter().exchange({ code: 'c' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'MISSING_SCOPES');
    assert.match(res.error, /both boxes ticked/);
  }
)));

test('a good sign-in becomes one account: Google id, email label, both tokens, an expiry', () => withEnv(ENV, () => withFetch(
  [
    { status: 200, body: { access_token: 'ya29.a', refresh_token: '1//r', expires_in: 3599, scope: FULL_SCOPE } },
    { status: 200, body: { sub: '1098', email: 'owner@gmail.example' } },
  ],
  async (calls) => {
    const res = await freshAdapter().exchange({ code: 'c', nowMs: Date.parse('2026-11-24T12:00:00Z') });
    assert.equal(res.ok, true, res.error);
    const [account] = res.data.accounts;
    assert.equal(account.accountId, '1098');
    assert.equal(account.accountLabel, 'owner@gmail.example');
    assert.equal(account.refreshToken, '1//r');
    assert.equal(account.expiresAt, '2026-11-24T12:59:59.000Z');
    const tokenBody = new URLSearchParams(calls[0].options.body);
    assert.equal(tokenBody.get('redirect_uri'), 'https://starcaster.pro/api/connections/google_calendar/callback');
    assert.equal(tokenBody.get('grant_type'), 'authorization_code');
  }
)));

test('Google already having forgotten the grant counts as a successful revoke', () => withEnv(ENV, () => withFetch(
  [{ status: 400, body: { error: 'invalid_token', error_description: 'Token expired or revoked' } }],
  async () => {
    const res = await freshAdapter().revoke({ accountId: '1', accessToken: 'a', refreshToken: 'r' });
    assert.equal(res.ok, true);
    assert.equal(res.data.revokedAtProvider, true);
  }
)));

test('free/busy over a long range is asked in 30-day pieces, and one refused piece fails the answer', () => withEnv(ENV, async () => {
  delete require.cache[resolve('lib/googleCalendar.js')];
  const google = require(resolve('lib/googleCalendar.js'));
  const from = Date.parse('2026-12-01T00:00:00Z');
  const to = from + 61 * 86400000;
  const busy = (start) => ({ status: 200, body: { calendars: { primary: { busy: [{ start, end: new Date(Date.parse(start) + 3600e3).toISOString() }] } } } });
  await withFetch([busy('2026-12-02T15:00:00Z'), busy('2027-01-02T15:00:00Z'), busy('2027-01-31T15:00:00Z')], async (calls) => {
    const res = await google.freeBusy('tok', from, to);
    assert.equal(res.ok, true, res.error);
    assert.equal(calls.length, 3, '61 days is three questions');
    assert.equal(res.data.busy.length, 3);
    assert.equal(JSON.parse(calls[2].options.body).timeMax, new Date(to).toISOString());
  });
  await withFetch([busy('2026-12-02T15:00:00Z'), { status: 503, body: { error: { message: 'Backend Error' } } }], async () => {
    const res = await google.freeBusy('tok', from, to);
    assert.equal(res.ok, false, 'half a busy list would read as free time that is not free');
    assert.match(res.error, /Backend Error/);
  });
}));

// ── The browser's return from Google ────────────────────────────────────────

function setupRoute() {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const supabase = resolve('lib/supabase.js');
  const previous = require.cache[supabase];
  require.cache[supabase] = {
    id: supabase, filename: supabase, loaded: true,
    exports: { isConfigured: () => true, tableConfig: () => ({ projectConnections: 'project_connections' }), sbQuery: (req) => db.sbQuery(req) },
  };
  const reloaded = [
    'lib/projectScope.js', 'lib/projectConnectionsStore.js', 'lib/googleCalendar.js', 'lib/connections/adapters/googleCalendar.js',
    'lib/connections/registry.js', 'lib/connections/completeConnection.js', 'lib/connections/verifySweep.js',
    'lib/connections/redirectCallback.js', 'routes/connections.js',
  ].map(resolve);
  for (const p of reloaded) delete require.cache[p];
  const route = require(resolve('routes/connections.js'));
  const restore = () => {
    if (previous) require.cache[supabase] = previous; else delete require.cache[supabase];
    for (const p of reloaded) delete require.cache[p];
  };
  return { db, route, restore };
}

async function callback(route, query) {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (s) => { res.statusCode = s; };
  res.end = (chunk) => { res.body = chunk || ''; };
  const url = `/api/connections/google_calendar/callback?${new URLSearchParams(query).toString()}`;
  // No session and no project header: exactly what a browser back from Google carries.
  const req = { method: 'GET', url, headers: { host: 'starcaster.pro' } };
  const handled = await route.handle(req, res, url.split('?')[0], 'GET');
  return { handled, ...res };
}

function stateFor(provider = 'google_calendar', projectId = 'proj_a') {
  delete require.cache[resolve('lib/metaOAuthState.js')];
  return require(resolve('lib/metaOAuthState.js')).buildOAuthState({ projectId, userId: 'owner_1', provider }).data;
}

test('the callback path is exempt from the session check, and only that exact path', () => {
  const { isGenericCallbackPath } = require(resolve('lib/connections/redirectCallback.js'));
  assert.equal(isGenericCallbackPath('/api/connections/google_calendar/callback'), true);
  assert.equal(isGenericCallbackPath('/api/connections/google_calendar/start'), false);
  assert.equal(isGenericCallbackPath('/api/connections/facebook_page/callback'), false, 'only an adapter that registered it');
  assert.equal(isGenericCallbackPath('/api/connections/nope/callback'), false);
});

test('back from Google with a good code: the grant is stored encrypted under the project the STATE names', () => withEnv(ENV, async () => {
  const ctx = setupRoute();
  try {
    await withFetch([
      { status: 200, body: { access_token: 'ya29.SECRET', refresh_token: '1//SECRET', expires_in: 3599, scope: FULL_SCOPE } },
      { status: 200, body: { sub: '1098', email: 'owner@gmail.example' } },
    ], async () => {
      const res = await callback(ctx.route, { code: 'the-code', state: stateFor() });
      assert.equal(res.handled, true);
      assert.equal(res.statusCode, 200, res.body);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.match(res.body, /Connected as owner@gmail\.example/);
      assert.match(res.body, /"type":"starcaster-connection","provider":"google_calendar","ok":true/);
      assert.doesNotMatch(res.body, /SECRET/, 'no token in the page');
    });
    const rows = ctx.db.data.get('project_connections');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].provider, 'google_calendar');
    assert.equal(rows[0].account_label, 'owner@gmail.example');
    assert.doesNotMatch(JSON.stringify(rows[0]), /SECRET/, 'tokens are stored encrypted');
    assert.ok(rows[0].refresh_token_enc, 'the lasting permission is kept');
  } finally {
    ctx.restore();
  }
}));

test('a forged, foreign or refused callback saves nothing and never reaches Google', () => withEnv(ENV, async () => {
  const ctx = setupRoute();
  try {
    await withFetch([], async (calls) => {
      const forged = await callback(ctx.route, { code: 'c', state: `${stateFor().split('.')[0]}.forged` });
      assert.equal(forged.statusCode, 400);
      assert.match(forged.body, /could not be checked/);
      const other = await callback(ctx.route, { code: 'c', state: stateFor('x') });
      assert.equal(other.statusCode, 400);
      assert.match(other.body, /different service/);
      const denied = await callback(ctx.route, { error: 'access_denied', state: stateFor() });
      assert.equal(denied.statusCode, 400);
      assert.match(denied.body, /chose not to allow access/);
      assert.match(denied.body, /"ok":false/);
      assert.equal(calls.length, 0);
    });
    assert.equal((ctx.db.data.get('project_connections') || []).length, 0);
  } finally {
    ctx.restore();
  }
}));

test('the result page cannot be broken out of by what Google or a visitor puts in the message', () => {
  const { resultPage } = require(resolve('lib/connections/redirectCallback.js'));
  const html = resultPage({ provider: 'google_calendar', ok: false, heading: 'x', message: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<\/script><script>alert/);
});

/** Run the result page's script against a pretend window; report what it did. */
function runResultPage(html, { opener = null } = {}) {
  const vm = require('vm');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const did = { replaced: '', posted: null, closed: false };
  const window = {
    opener: opener && {
      closed: false,
      postMessage: (message, targetOrigin) => { did.posted = { message, targetOrigin }; },
    },
    close: () => { did.closed = true; },
    location: { replace: (url) => { did.replaced = url; } },
  };
  vm.runInNewContext(script, { window });
  return did;
}

test('with no pop-up behind it, the result page sends the browser back into the app with the outcome', () => withEnv(ENV, () => {
  const { resultPage } = require(resolve('lib/connections/redirectCallback.js'));
  // Started from the Booking Manager on a client's site: back to that page.
  const page = 'https://client.example.com/admin/bookings#tab=google';
  const back = runResultPage(resultPage({ provider: 'google_calendar', ok: true, heading: 'ok', message: 'Connected as a@b.example', returnTo: page }));
  assert.equal(back.replaced, 'https://client.example.com/admin/bookings#tab=google&connect_provider=google_calendar&connect_notice=Connected%20as%20a%40b.example');
  // Started from the Connections screen (no page recorded): back to that screen.
  const fromConnections = runResultPage(resultPage({ provider: 'google_calendar', ok: false, heading: 'no', message: 'You chose not to allow access' }));
  assert.match(fromConnections.replaced, /\/#page=settingsConnectionsPage&connect_provider=google_calendar&connect_error=You%20chose/);
}));

test('with a pop-up behind it, the result goes only to the site the sign-in started from, never "*"', () => withEnv(ENV, () => {
  const { resultPage } = require(resolve('lib/connections/redirectCallback.js'));
  const html = resultPage({ provider: 'google_calendar', ok: true, heading: 'ok', message: 'Connected as a@b.example', returnTo: 'https://client.example.com/admin/bookings' });
  assert.doesNotMatch(html, /postMessage\(result, '\*'\)/);
  const did = runResultPage(html, { opener: true });
  assert.equal(did.posted.targetOrigin, 'https://client.example.com');
  assert.equal(did.posted.message.provider, 'google_calendar');
  assert.equal(did.closed, true);
  assert.equal(did.replaced, '', 'the pop-up closes rather than navigating');
}));

test('the page a sign-in returns to rides in the signed state, and a callback brings it back', () => withEnv(ENV, async () => {
  const { buildOAuthState, verifyOAuthState } = require(resolve('lib/metaOAuthState.js'));
  const built = buildOAuthState({ projectId: 'proj_a', userId: 'u1', provider: 'google_calendar', returnTo: 'https://client.example.com/admin' });
  assert.equal(verifyOAuthState(built.data).data.returnTo, 'https://client.example.com/admin');
  const plain = buildOAuthState({ projectId: 'proj_a', userId: 'u1', provider: 'google_calendar' });
  assert.equal(verifyOAuthState(plain.data).data.returnTo, '');
  const ctx = setupRoute();
  try {
    await withFetch([], async () => {
      const denied = await callback(ctx.route, { error: 'access_denied', state: built.data });
      assert.match(denied.body, /client\.example\.com\/admin#connect_provider=google_calendar&amp;connect_error=|client\.example\.com\\\/admin#connect_provider/);
    });
  } finally {
    ctx.restore();
  }
}));
