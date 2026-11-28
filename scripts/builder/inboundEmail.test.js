'use strict';

/**
 * SC-926 — receive email through Resend and forward it.
 *
 * The fake database reads its schema FROM docs/SQL/inbound_email_setup.sql, so
 * a tenant column dropped from the SQL (landmine 12) fails here. Resend's API
 * and the outgoing send are fakes passed in as deps; nothing reaches the
 * network or the real bus.
 *
 * Also a helper: `node scripts/builder/inboundEmail.test.js --curl` prints a
 * ready-made signed `curl` for a local server started with
 * RESEND_WEBHOOK_SECRET=whsec_dGVzdHNlY3JldA== (see the ticket's How to test).
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.join(__dirname, '..', '..');
const inbound = require('../../lib/resendInbound.js');

const SECRET = 'whsec_dGVzdHNlY3JldA==';
const NOW = Date.parse('2026-11-27T22:00:00Z');
const TS = Math.floor(NOW / 1000);

function sampleEvent(overrides = {}) {
  return {
    type: 'email.received',
    created_at: '2026-11-27T22:00:00.000Z',
    data: {
      email_id: 'em_123',
      created_at: '2026-11-27T22:00:00.000Z',
      from: 'ann@outside.example',
      to: ['Admin@Alphire.agency'],
      cc: [],
      bcc: [],
      received_for: ['admin@alphire.agency'],
      message_id: '<abc@outside.example>',
      subject: 'Question about your privacy policy',
      attachments: [{ id: 'att_1', filename: 'notes.pdf', content_type: 'application/pdf', content_disposition: 'attachment', content_id: null }],
      ...overrides,
    },
  };
}

if (process.argv.includes('--curl')) {
  const body = JSON.stringify(sampleEvent({ to: ['test@example.com'], received_for: ['test@example.com'] }));
  const ts = Math.floor(Date.now() / 1000);
  const h = inbound.signForTest({ secret: SECRET, id: `msg_local_${ts}`, timestamp: ts, body });
  const port = process.env.PORT || 3001;
  console.log([
    `curl -sS -X POST http://localhost:${port}/api/webhooks/resend/inbound \\`,
    "  -H 'Content-Type: application/json' \\",
    ...Object.entries(h).map(([k, v]) => `  -H '${k}: ${v}' \\`),
    `  --data-raw '${body.replace(/'/g, "'\\''")}'`,
  ].join('\n'));
  console.log(`\n# The server must run with RESEND_WEBHOOK_SECRET=${SECRET}; the signature is good for five minutes.`);
  console.log('# Locally the fetch from Resend fails (em_123 is not a real email), so expect a 502 "failed" row — that proves the signature and the route; the forward itself is proven by SC-927 end to end.');
} else {
  registerTests();
}

function registerTests() {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
  const supabasePath = require.resolve('../../lib/supabase.js');
  const storePath = require.resolve('../../lib/inboundEmailStore.js');

  function withWorld({ routes = [], sendFails = 0, resendDown = false } = {}) {
    const sql = fs.readFileSync(path.join(ROOT, 'docs', 'SQL', 'inbound_email_setup.sql'), 'utf8');
    const db = createFakeDb(parseSchemaText(sql));
    require.cache[supabasePath] = {
      id: supabasePath, filename: supabasePath, loaded: true,
      exports: { isConfigured: () => true, tableConfig: () => ({}), sbQuery: db.sbQuery },
    };
    delete require.cache[storePath];
    const store = require('../../lib/inboundEmailStore.js');
    for (const r of routes) {
      db.data.get('inbound_email_routes').push({
        id: `a115c635-8658-4dad-a8b1-${String(Math.random()).slice(2, 14).padEnd(12, '0')}`,
        project_id: 'alphire', owner_user_id: 'user_dane', enabled: true,
        created_at: '2026-11-27T00:00:00Z', updated_at: '2026-11-27T00:00:00Z', ...r,
      });
    }
    const sent = [];
    const bus = [];
    const fetched = [];
    let failuresLeft = sendFails;
    const fetchImpl = async (url, init = {}) => {
      fetched.push({ url, auth: init.headers?.Authorization || '' });
      const json = (status, body) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
      if (resendDown) return json(500, { message: 'Resend is down' });
      if (url.startsWith('https://api.resend.com/emails/receiving/em_123/attachments')) {
        return json(200, { object: 'list', has_more: false, data: [{ id: 'att_1', filename: 'notes.pdf', size: 5, content_type: 'application/pdf', content_disposition: 'attachment', content_id: null, download_url: 'https://cdn.resend.app/att_1?sig=x' }] });
      }
      if (url.startsWith('https://api.resend.com/emails/receiving/em_123')) {
        return json(200, {
          object: 'email', id: 'em_123', from: 'ann@outside.example', to: ['admin@alphire.agency'], cc: [], reply_to: [],
          subject: 'Question about your privacy policy', html: '<p>Hello <b>there</b></p>', text: 'Hello there',
          headers: { from: 'Ann Example <ann@outside.example>' }, created_at: '2026-11-27T22:00:00.000Z',
        });
      }
      if (url.startsWith('https://cdn.resend.app/')) {
        return { ok: true, status: 200, json: async () => null, arrayBuffer: async () => new TextEncoder().encode('%PDF-').buffer };
      }
      return json(404, { message: 'unknown' });
    };
    const deps = {
      secret: SECRET,
      apiKey: 're_test',
      store,
      now: NOW,
      fetchImpl,
      sendEmail: async (msg) => {
        if (failuresLeft > 0) { failuresLeft -= 1; return { ok: false, status: 422, error: 'domain not verified' }; }
        sent.push(msg);
        return { ok: true, status: 200, data: { id: `out_${sent.length}` } };
      },
      postBus: async (text) => { bus.push(text); return { ok: true }; },
    };
    return { db, store, deps, sent, bus, fetched, deliveries: () => db.data.get('inbound_email_deliveries') };
  }

  function call(world, event = sampleEvent(), { id = 'msg_1', ts = TS, secret = SECRET, body, exact = true, deps } = {}) {
    const raw = body ?? JSON.stringify(event);
    return inbound.handleInbound(
      { headers: inbound.signForTest({ secret, id, timestamp: ts, body: raw }), rawBody: raw, rawExact: exact },
      deps || world.deps,
    );
  }

  const ROUTE = { address: 'admin@alphire.agency', forward_to: 'dane.inbox@gmail.example' };

  test('Svix signature: the published test vector verifies, and a changed byte does not', () => {
    const args = {
      secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl', id: 'msg_loFOjxBNrRLzqYUf', timestamp: '1731705121',
      signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=', body: '{"event_type":"ping","data":{"success":true}}', now: 1731705121 * 1000,
    };
    assert.deepEqual(inbound.verifySvixSignature(args), { ok: true });
    assert.equal(inbound.verifySvixSignature({ ...args, body: args.body.replace('true', 'false') }).ok, false);
    assert.equal(inbound.verifySvixSignature({ ...args, signature: `v1,AAAA ${args.signature}` }).ok, true, 'any one matching v1 entry is enough');
  });

  test('a correctly signed email for a routed address is forwarded once, with its attachment and Reply-To, and recorded with its tenant', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const out = await call(w);
    assert.equal(out.status, 200, JSON.stringify(out.payload));
    assert.equal(out.payload.data.outcome, 'forwarded');
    assert.equal(w.sent.length, 1);
    const msg = w.sent[0];
    assert.deepEqual(msg.to, ['dane.inbox@gmail.example']);
    assert.equal(msg.fromEmail, 'admin@alphire.agency');
    assert.deepEqual(msg.replyTo, ['ann@outside.example']);
    assert.equal(msg.subject, 'Question about your privacy policy');
    assert.match(msg.text, /From: Ann Example <ann@outside\.example>/);
    assert.match(msg.html, /From: Ann Example &lt;ann@outside\.example&gt;/);
    assert.match(msg.html, /<p>Hello <b>there<\/b><\/p>/);
    assert.equal(msg.attachments.length, 1);
    assert.equal(msg.attachments[0].filename, 'notes.pdf');
    assert.equal(Buffer.from(msg.attachments[0].content, 'base64').toString(), '%PDF-');
    // The signed CDN link gets no API key.
    assert.equal(w.fetched.find((f) => f.url.startsWith('https://cdn.resend.app/')).auth, '');
    // The rows themselves, not the insert's success (landmine 12).
    const rows = w.deliveries();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'forwarded');
    assert.equal(rows[0].project_id, 'alphire');
    assert.equal(rows[0].owner_user_id, 'user_dane');
    assert.equal(rows[0].svix_id, 'msg_1');
    assert.equal(rows[0].forwarded_email_id, 'out_1');
    assert.equal(w.bus.length, 0);
  });

  test('the same svix-id again answers 200 and sends nothing', async () => {
    const w = withWorld({ routes: [ROUTE] });
    await call(w);
    const again = await call(w);
    assert.equal(again.status, 200);
    assert.equal(again.payload.data.duplicate, true);
    assert.equal(w.sent.length, 1);
    assert.equal(w.deliveries().length, 1);
  });

  test('a wrong signature or a timestamp over five minutes old is refused with 401 and sends nothing', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const wrong = await call(w, sampleEvent(), { secret: 'whsec_b3RoZXJzZWNyZXQ=' });
    assert.equal(wrong.status, 401);
    const stale = await call(w, sampleEvent(), { ts: TS - 301 });
    assert.equal(stale.status, 401);
    assert.match(stale.payload.error.message, /window/);
    const future = await call(w, sampleEvent(), { ts: TS + 301 });
    assert.equal(future.status, 401);
    // A body changed after signing.
    const raw = JSON.stringify(sampleEvent());
    const tampered = await inbound.handleInbound({ headers: inbound.signForTest({ secret: SECRET, id: 'm', timestamp: TS, body: raw }), rawBody: raw.replace('ann@', 'eve@') }, w.deps);
    assert.equal(tampered.status, 401);
    const unsigned = await inbound.handleInbound({ headers: {}, rawBody: raw }, w.deps);
    assert.equal(unsigned.status, 401);
    assert.equal(w.sent.length, 0);
    assert.equal(w.deliveries().length, 0);
  });

  test('a failed check over a re-serialised body says the raw bytes were not available', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const out = await call(w, sampleEvent(), { secret: 'whsec_b3RoZXJzZWNyZXQ=', exact: false });
    assert.equal(out.status, 401);
    assert.match(out.payload.error.message, /re-serialised/);
  });

  test('no RESEND_WEBHOOK_SECRET: 503 saying so, never accepts unsigned mail', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const saved = process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_WEBHOOK_SECRET;
    try {
      const out = await call(w, sampleEvent(), { deps: { ...w.deps, secret: undefined } });
      assert.equal(out.status, 503);
      assert.match(out.payload.error.message, /RESEND_WEBHOOK_SECRET is not set/);
      assert.equal(w.sent.length, 0);
    } finally {
      if (saved !== undefined) process.env.RESEND_WEBHOOK_SECRET = saved;
    }
  });

  test('an address with no enabled route is recorded as no_route and nothing is sent', async () => {
    const w = withWorld({ routes: [{ ...ROUTE, enabled: false }] });
    const out = await call(w);
    assert.equal(out.status, 200);
    assert.equal(out.payload.data.outcome, 'no_route');
    assert.equal(w.sent.length, 0);
    assert.equal(w.deliveries()[0].outcome, 'no_route');
    assert.equal(w.fetched.length, 0, 'nothing is fetched for mail nobody receives');
  });

  test('a failed forward answers non-200, records the error and posts ONE bus line; the retry that works records success', async () => {
    const w = withWorld({ routes: [ROUTE], sendFails: 2 });
    const first = await call(w);
    assert.equal(first.status, 502);
    let row = w.deliveries()[0];
    assert.equal(row.outcome, 'failed');
    assert.match(row.error, /domain not verified/);
    assert.equal(row.project_id, 'alphire');
    assert.equal(row.owner_user_id, 'user_dane');
    assert.equal(w.bus.length, 1);
    assert.match(w.bus[0], /admin@alphire\.agency/);
    assert.match(w.bus[0], /ann@outside\.example/);
    assert.match(w.bus[0], /domain not verified/);

    const second = await call(w);
    assert.equal(second.status, 502);
    assert.equal(w.bus.length, 1, 'a retry that fails the same way does not post again');

    const third = await call(w);
    assert.equal(third.status, 200);
    row = w.deliveries()[0];
    assert.equal(row.outcome, 'forwarded');
    assert.equal(row.attempts, 3);
    assert.equal(w.sent.length, 1);
    assert.equal(w.bus.length, 2);
    assert.match(w.bus[1], /forwarded on attempt 3/);
  });

  test('Resend not answering the fetch is a failure too, not a silent drop', async () => {
    const w = withWorld({ routes: [ROUTE], resendDown: true });
    const out = await call(w);
    assert.equal(out.status, 502);
    assert.equal(w.deliveries()[0].outcome, 'failed');
    assert.equal(w.bus.length, 1);
    assert.equal(w.sent.length, 0);
  });

  test('a delivery another request claimed moments ago answers 409; one left over two minutes is taken over', async () => {
    const w = withWorld({ routes: [ROUTE] });
    w.db.data.get('inbound_email_deliveries').push({
      id: 'a115c635-8658-4dad-a8b1-999999999999', svix_id: 'msg_1', project_id: null, owner_user_id: null,
      resend_email_id: 'em_123', to_address: '', from_address: '', subject: '', received_at: null,
      outcome: 'received', error: '', attempts: 1, forwarded_email_id: '',
      created_at: new Date(NOW - 30_000).toISOString(), updated_at: new Date(NOW - 30_000).toISOString(),
    });
    const busy = await call(w);
    assert.equal(busy.status, 409);
    assert.equal(w.sent.length, 0);
    const later = await call(w, sampleEvent(), { deps: { ...w.deps, now: NOW + 3 * 60_000 }, ts: TS + 180 });
    assert.equal(later.status, 200);
    assert.equal(w.sent.length, 1);
  });

  test('forwarding to an address that is itself received is refused, never looped', async () => {
    const w = withWorld({ routes: [{ address: 'admin@alphire.agency', forward_to: 'info@alphire.agency' }, { address: 'info@alphire.agency', forward_to: 'admin@alphire.agency' }] });
    const out = await call(w, sampleEvent({ to: ['admin@alphire.agency'], received_for: ['admin@alphire.agency'] }));
    assert.equal(out.status, 200);
    assert.equal(out.payload.data.outcome, 'refused');
    assert.equal(w.sent.length, 0);
    assert.equal(w.bus.length, 1);
    assert.match(w.bus[0], /loop/);
  });

  test('addRoute needs a tenant, refuses a looping target, and writes both tenant columns', async () => {
    const w = withWorld({ routes: [{ address: 'info@alphire.agency', forward_to: 'x@gmail.example' }] });
    assert.equal((await w.store.addRoute({ address: 'admin@alphire.agency', forwardTo: 'a@gmail.example' }, { projectId: 'alphire' })).ok, false);
    const loop = await w.store.addRoute({ address: 'admin@alphire.agency', forwardTo: 'Info@Alphire.agency' }, { projectId: 'alphire', userId: 'user_dane' });
    assert.equal(loop.ok, false);
    assert.match(loop.error, /loop/);
    const ok = await w.store.addRoute({ address: 'Admin <ADMIN@alphire.agency>', forwardTo: 'dane.inbox@gmail.example' }, { projectId: 'alphire', userId: 'user_dane' });
    assert.equal(ok.ok, true, ok.error);
    const row = w.db.data.get('inbound_email_routes').find((r) => r.address === 'admin@alphire.agency');
    assert.equal(row.project_id, 'alphire');
    assert.equal(row.owner_user_id, 'user_dane');
    const dup = await w.store.addRoute({ address: 'admin@alphire.agency', forwardTo: 'b@gmail.example' }, { projectId: 'other', userId: 'u2' });
    assert.equal(dup.status, 409);
  });

  test('an event that is not email.received is acknowledged and ignored', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const out = await call(w, { type: 'email.delivered', data: {} });
    assert.equal(out.status, 200);
    assert.equal(out.payload.data.outcome, 'ignored');
    assert.equal(w.sent.length, 0);
  });

  test('attachments too large to send on: the email is still forwarded, without them, and the bus is told', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const big = inbound.MAX_ATTACHMENT_BASE64_BYTES;
    const deps = {
      ...w.deps,
      fetchImpl: async (url, init) => {
        if (url.includes('/attachments')) {
          return { ok: true, status: 200, json: async () => ({ has_more: false, data: [{ id: 'att_big', filename: 'video.mov', size: big, download_url: 'https://cdn.resend.app/big' }] }) };
        }
        return w.deps.fetchImpl(url, init);
      },
    };
    const out = await call(w, sampleEvent(), { deps });
    assert.equal(out.status, 200);
    assert.equal(w.sent.length, 1);
    assert.deepEqual(w.sent[0].attachments, []);
    assert.match(w.sent[0].text, /NOT forwarded \(too large/);
    assert.match(w.sent[0].text, /video\.mov/);
    assert.equal(w.bus.length, 1);
    assert.match(w.deliveries()[0].error, /without 1 attachment/);
  });

  test('the route reads the RAW body from the request stream and answers through the same path', async () => {
    const w = withWorld({ routes: [ROUTE] });
    const route = require('../../routes/inboundEmail.js');
    // Spaced JSON: a parse-and-reserialise would change these bytes and fail the signature.
    const raw = JSON.stringify(sampleEvent(), null, 2);
    const req = Readable.from([Buffer.from(raw)]);
    req.headers = inbound.signForTest({ secret: SECRET, id: 'msg_stream', timestamp: TS, body: raw });
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    const handled = await route.handle(req, res, route.PATH, 'POST', w.deps);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).data.outcome, 'forwarded');
    assert.equal(await route.handle(req, res, '/api/webhooks/resend/inboundx', 'POST', w.deps), false, 'only the exact path');
  });

  test('readRawBody: original bytes when the host left a string or Buffer, a flagged guess when it left only an object', async () => {
    const { readRawBody } = require('../../routes/http.js');
    assert.deepEqual(await readRawBody({ readableEnded: true, body: '{"a": 1}' }), { ok: true, raw: '{"a": 1}', exact: true });
    assert.deepEqual(await readRawBody({ readableEnded: true, body: Buffer.from('{"a": 1}') }), { ok: true, raw: '{"a": 1}', exact: true });
    assert.deepEqual(await readRawBody({ readableEnded: true, body: { a: 1 } }), { ok: true, raw: '{"a":1}', exact: false });
  });

  test('the dispatcher exempts this ONE exact path, POST only, from the login check', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes', 'index.js'), 'utf8');
    assert.match(src, /const isResendInboundRoute = pathname === inboundEmail\.PATH && String\(method \|\| ''\)\.toUpperCase\(\) === 'POST';/);
    assert.match(src, /&& !isResendInboundRoute\n\s+&& !hasPublicTenantReadAccess/);
    assert.equal(require('../../routes/inboundEmail.js').PATH, '/api/webhooks/resend/inbound');
    assert.doesNotMatch(src, /startsWith\('\/api\/webhooks/);
  });
}
