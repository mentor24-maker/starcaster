'use strict';

/*
 * The review gate's tracker calls (SC-795). No test here reaches a network:
 * every call passes its own `fetchImpl`, and the one that checks what the gate
 * does with no address or token never calls fetch at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tracker = require('./reviewGateTracker.js');
const gate = require('./reviewGate.js');

const BASE = 'https://tracker.example.test:8443';

/** A fake fetch that answers from a table keyed by "METHOD path", and records calls. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const key = `${method} ${new URL(url).pathname}${new URL(url).search}`;
    calls.push({ key, init });
    const route = routes[key];
    if (!route) throw new Error(`no route for ${key}`);
    if (route.throw) throw route.throw;
    const body = typeof route.body === 'function' ? route.body(init) : route.body;
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
  };
  impl.calls = calls;
  return impl;
}

const ticket = (comments) => ({ id: 'SC-12', name: 'x', comments });
const row = (id, body, createdAt, parent = null) => ({ id, ticket: 'SC-12', body, author: 31, createdAt, parent });

test('reads the ticket\'s comments from the tracker, newest first, in the shape the gate reads', async () => {
  const fetchImpl = fakeFetch({
    'GET /tickets/SC-12': { status: 200, body: ticket([
      row(1, 'PR opened: https://github.com/o/r/pull/7', '2026-11-12T10:00:00Z'),
      row(2, 'REVIEW: PASSED — fine', '2026-11-12T11:00:00Z'),
      row(3, 'a reply, not a top-level comment', '2026-11-12T12:00:00Z', 2),
    ]) },
  });
  const out = await tracker.readTicketComments('sc-12', { token: 't', baseUrl: `${BASE}/`, fetchImpl });
  assert.equal(out.why, '');
  assert.deepEqual(out.comments.map((c) => c.comment_text), ['REVIEW: PASSED — fine', 'PR opened: https://github.com/o/r/pull/7']);
  assert.equal(out.comments[0].date, String(Date.parse('2026-11-12T11:00:00Z')));
  // The id is upper-cased (a PR body may write it any case) and signed in with Bearer.
  assert.equal(fetchImpl.calls[0].key, 'GET /tickets/SC-12');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer t');
});

test('no address and no token are both "could not look", by name, and never call out', async () => {
  const fetchImpl = fakeFetch({});
  const noUrl = await tracker.readTicketComments('SC-12', { token: 't', baseUrl: '', fetchImpl });
  assert.equal(noUrl.comments, null);
  assert.match(noUrl.why, /trackerPublicUrl/);
  const noToken = await tracker.readTicketComments('SC-12', { token: '', baseUrl: BASE, fetchImpl });
  assert.equal(noToken.comments, null);
  assert.match(noToken.why, /TRACKER_REVIEW_GATE_TOKEN is not set/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a refused, unreachable or malformed answer is null comments with the reason, never []', async () => {
  const cases = [
    [{ status: 401, body: { error: 'unauthorized', message: 'sign in, or send a valid token.' } }, /HTTP 401.*TRACKER_REVIEW_GATE_TOKEN/],
    [{ status: 503, body: undefined }, /HTTP 503/],
    [{ throw: new Error('getaddrinfo ENOTFOUND') }, /unreachable.*ENOTFOUND/],
    [{ status: 200, body: { id: 'SC-12' } }, /no comment list/],
  ];
  for (const [route, why] of cases) {
    const out = await tracker.readTicketComments('SC-12', { token: 't', baseUrl: BASE, fetchImpl: fakeFetch({ 'GET /tickets/SC-12': route }) });
    assert.equal(out.comments, null, `${why}`);
    assert.match(out.why, why);
  }
});

test('the gate turns each of those into CANNOT TELL, and a tracker PASS into PASSED', async () => {
  const body = 'Ticket: http://mac-mini.local:4180/t/SC-12\n';
  const refused = await tracker.readTicketComments('SC-12', { token: '', baseUrl: BASE });
  const told = gate.reviewGateDecision({ prBody: body, prNumber: 7, headCommittedAt: '2026-11-12T09:00:00Z', comments: refused.comments, trackerError: refused.why });
  assert.equal(told.verdict, gate.CANNOT_TELL);
  assert.equal(told.cause, 'tracker-unreachable');
  assert.match(told.reason, /from the tracker: TRACKER_REVIEW_GATE_TOKEN is not set/);

  const read = await tracker.readTicketComments('SC-12', { token: 't', baseUrl: BASE, fetchImpl: fakeFetch({
    'GET /tickets/SC-12': { status: 200, body: ticket([
      row(1, 'PR opened: https://github.com/o/r/pull/7', '2026-11-12T10:00:00Z'),
      row(2, 'REVIEW: PASSED — fine', '2026-11-12T11:00:00Z'),
    ]) },
  }) });
  const passed = gate.reviewGateDecision({ prBody: body, prNumber: 7, headCommittedAt: '2026-11-12T09:00:00Z', comments: read.comments, trackerError: read.why });
  assert.equal(passed.ticketId, 'SC-12');
  assert.equal(passed.verdict, gate.PASS, passed.reason);
  // The line it prints is the tracker's page, which a person can open.
  assert.match(gate.gateMessage(passed, { prNumber: 7 }), /Ticket: http:\/\/mac-mini\.local:4180\/t\/SC-12/);
});

test('a waiver is posted on the bus project\'s Team chat ticket and read back', async () => {
  const fetchImpl = fakeFetch({
    'GET /projects/bus/tickets?open=true': { status: 200, body: { tickets: [
      { id: 'BUS-9', name: 'Team chat', createdAt: '2026-11-10T00:00:00Z' },
      { id: 'BUS-2', name: 'Team chat', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'BUS-1', name: 'Something else', createdAt: '2026-10-01T00:00:00Z' },
    ] } },
    'POST /tickets/BUS-2/comments': { status: 201, body: (init) => ({ id: 5, ...JSON.parse(init.body) }) },
  });
  const out = await tracker.announceWaiver('PR #7 waived — hotfix', { token: 't', baseUrl: BASE, busProject: 'bus', fetchImpl, now: Date.parse('2026-11-12T18:00:00Z') });
  assert.deepEqual(out, { ok: true, why: '', ticket: 'BUS-2' });
  const posted = JSON.parse(fetchImpl.calls[1].init.body).body;
  assert.match(posted, /^\*\*From the review gate on GitHub\*\* · 11\/12\/2026, 11:00 AM MT/);
  assert.match(posted, /PR #7 waived — hotfix/);
});

test('a waiver that cannot be posted says why, and nothing is created', async () => {
  const none = await tracker.announceWaiver('x', { token: 't', baseUrl: BASE, busProject: 'bus', fetchImpl: fakeFetch({
    'GET /projects/bus/tickets?open=true': { status: 200, body: { tickets: [] } },
  }) });
  assert.equal(none.ok, false);
  assert.match(none.why, /no "Team chat" ticket in bus/);
  const lost = await tracker.announceWaiver('x', { token: 't', baseUrl: BASE, busProject: 'bus', fetchImpl: fakeFetch({
    'GET /projects/bus/tickets?open=true': { status: 200, body: { tickets: [{ id: 'BUS-2', name: 'Team chat', createdAt: '2026-11-01T00:00:00Z' }] } },
    'POST /tickets/BUS-2/comments': { status: 201, body: { id: 5, body: 'something else' } },
  }) });
  assert.equal(lost.ok, false);
  assert.match(lost.why, /did not read back/);
  const noBus = await tracker.announceWaiver('x', { token: 't', baseUrl: BASE, busProject: '' });
  assert.match(noBus.why, /no busProject/);
});

test('the gate and its workflow call no ClickUp API', () => {
  const root = path.join(__dirname, '..', '..');
  for (const rel of ['scripts/review_gate.mjs', 'scripts/builder/reviewGateTracker.js', '.github/workflows/review-gate.yml']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(src, /api\.clickup\.com|CLICKUP_API_TOKEN|require\([^)]*clickup\.cjs|reviewGateClickup/, rel);
  }
  // And the address it calls is the one written in the project config.
  const config = JSON.parse(fs.readFileSync(path.join(root, 'spirality.project.json'), 'utf8'));
  assert.match(String(config.trackerPublicUrl), /^https:\/\//);
});

test('the gate script itself runs to an answer, not a crash (it is imported by nothing)', () => {
  // review_gate.mjs runs main() on load, so no test requires it, and a helper
  // deleted from it passes every other gate: SC-795's first draft did exactly
  // that and only a live run caught it. Here `gh` cannot be found (PATH is
  // empty), so the gate must answer CANNOT TELL for the PR read, by name.
  const { spawnSync } = require('node:child_process');
  const out = spawnSync(process.execPath, [path.join(__dirname, '..', 'review_gate.mjs'), '--pr', '1'], {
    encoding: 'utf8',
    env: { PATH: '', HOME: process.env.HOME || '' },
  });
  const said = `${out.stdout}${out.stderr}`;
  assert.doesNotMatch(said, /crashed|is not defined/, said);
  assert.match(said, /CANNOT TELL — could not read PR #1 from GitHub: the `gh` command is not installed/);
  assert.equal(out.status, 0, 'advisory: exits 0');
});
