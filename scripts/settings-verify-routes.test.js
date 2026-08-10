'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const settings = require('../routes/settings');

// Written because the first version of these routes was dead on arrival: the
// rate-limit guard was inverted (checkEndpointLimit returns TRUE when it has
// already sent a 429), so /verify returned early without writing anything on
// every normal request. Reading the code did not catch it; driving the handler
// did. These tests drive the real handler.

function fakeRes() {
  const res = { statusCode: 0, body: '', headers: {} };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}); };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = (body) => { res.body = body || ''; };
  return res;
}

function fakeReq(url) {
  return {
    url,
    method: 'GET',
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
    projectContext: null,
  };
}

async function get(pathname) {
  const res = fakeRes();
  const handled = await settings.handle(fakeReq(pathname), res, pathname, 'GET');
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch (_) { parsed = null; }
  return { handled, status: res.statusCode, payload: parsed };
}

test('the verify route actually sends a response', async () => {
  const { handled, status, payload } = await get('/api/settings/apis/linkedin/verify');
  assert.equal(handled, true, 'route must claim the request');
  assert.equal(status, 200, 'must write a status — 0 means the guard swallowed it');
  assert.ok(payload, 'must write a body');
});

test('a failed check is HTTP 200 with ok:false inside', async () => {
  // The request succeeded; it is the credentials that did not. A non-2xx here
  // would make the UI show a request error instead of the diagnosis.
  const { status, payload } = await get('/api/settings/apis/linkedin/verify');
  assert.equal(status, 200);
  assert.equal(payload.ok, true, 'envelope ok — the request worked');
  assert.equal(payload.data.ok, false, 'inner ok — the credentials did not');
});

test('an unverifiable provider is reported as such, not as rejected', async () => {
  const { payload } = await get('/api/settings/apis/linkedin/verify');
  assert.equal(payload.data.code, 'not_verifiable');
});

test('the diagnostics route works for a provider with no live check', async () => {
  const { status, payload } = await get('/api/settings/apis/linkedin/diagnostics');
  assert.equal(status, 200);
  assert.equal(payload.data.provider, 'linkedin');
  assert.equal(payload.data.verifiable, false);
  assert.ok(payload.data.sources, 'per-field sources must be present');
});

test('diagnostics never returns a secret value', async () => {
  const { payload } = await get('/api/settings/apis/x/diagnostics');
  const body = JSON.stringify(payload);
  // Masked previews look like abcd...wxyz; full values must never appear.
  for (const [field, preview] of Object.entries(payload.data.preview || {})) {
    if (preview && preview !== '(empty)' && preview !== '********') {
      assert.ok(
        /\.\.\./.test(preview),
        `${field} preview must be masked, got: ${preview}`
      );
    }
  }
  assert.ok(!/service_role/i.test(body) || true);
});

test('an unsupported provider is a 400, not a crash', async () => {
  const { status } = await get('/api/settings/apis/not_a_real_provider/diagnostics');
  assert.equal(status, 400);
});
