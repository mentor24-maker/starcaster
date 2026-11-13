'use strict';

/**
 * The live app's bus post goes to the tracker, not ClickUp (SC-796).
 *
 * lib/trackerForward.js postBusMessage is what the AI spending alarm
 * (routes/aiQuota.js) and the Mini's AI brake (lib/miniAiLimit.js) call. It
 * must land as one comment on the bus project's "Team chat" ticket, read
 * back, exactly as the door's `bus-post` writes it — and it keeps its own
 * small copy of three things the door owns, because loop/lib cannot be
 * required safely inside a Vercel function. The last block pins those copies
 * to loop/lib, so a rename there fails here instead of sending the app's
 * alarms to a ticket nobody reads.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const forward = require('../../lib/trackerForward');
const PROJECT_CONFIG = require('../../spirality.project.json');

const BASE = 'https://tracker.test:8443';
const BUS = PROJECT_CONFIG.busProject;

function fakeBus({ tickets, postStatus = 201, readsBack = true } = {}) {
  const requests = [];
  const posted = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace(BASE, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body, url: String(url), auth: init.headers?.Authorization });
    const json = (status, payload) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) });
    if (method === 'GET' && path === `/projects/${BUS}/tickets`) return json(200, { project: BUS, tickets });
    const m = /^\/tickets\/([^/]+)(\/comments)?$/.exec(path);
    if (m && method === 'POST' && m[2]) {
      if (postStatus !== 201) return json(postStatus, { error: 'forbidden', message: 'not a member of this project' });
      const row = { id: 77, ticket: m[1], body: body.body };
      posted.push(row);
      return json(201, row);
    }
    if (m && method === 'GET' && !m[2]) return json(200, { id: m[1], comments: readsBack ? posted : [] });
    return json(404, { error: 'unexpected path' });
  };
  return { fetchImpl, requests, posted };
}

const TICKETS = [
  { id: 'BUS-9', name: 'Team chat', createdAt: '2026-11-12T10:00:00Z' },
  { id: 'BUS-2', name: 'Team chat', createdAt: '2026-11-10T10:00:00Z' },
  { id: 'BUS-3', name: 'Something else', createdAt: '2026-11-01T10:00:00Z' },
];

test('an alarm lands as one comment on the OLDEST Team chat ticket of the bus project, read back', async () => {
  const { fetchImpl, requests, posted } = fakeBus({ tickets: TICKETS });
  const out = await forward.postBusMessage('ALARM: AI spend is over the line', {
    token: 'app-token', baseUrl: BASE, fetchImpl, now: Date.parse('2026-11-12T22:00:00Z'),
  });
  assert.equal(out.ok, true, out.why);
  assert.equal(out.ticket, 'BUS-2', 'two machines that both made one agree on the older');
  assert.equal(posted.length, 1);
  const lines = posted[0].body.split('\n');
  assert.equal(lines[0], '**From the StarCaster app (Vercel)** · 11/12/2026, 3:00 PM MT', 'Mountain time, never UTC');
  assert.equal(lines[2], 'ALARM: AI spend is over the line', 'the message itself, verbatim — ALARM: at the start is what gets texted');
  assert.match(lines.at(-1), /^\[machine\] /, 'marked as a machine\'s, so no reader takes it for Dane\'s word');
  assert.ok(requests.every((r) => r.auth === 'Bearer app-token'));
  assert.ok(requests.every((r) => !/clickup\.com/.test(r.url)), 'nothing goes to ClickUp');
});

test('a post that does not read back is a failure, so the alarm is not stamped as sent', async () => {
  const { fetchImpl } = fakeBus({ tickets: TICKETS, readsBack: false });
  const out = await forward.postBusMessage('ALARM: x', { token: 't', baseUrl: BASE, fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.why, /did not read back/);
});

test('a refused post says the tracker\'s own reason', async () => {
  const { fetchImpl } = fakeBus({ tickets: TICKETS, postStatus: 403 });
  const out = await forward.postBusMessage('ALARM: x', { token: 't', baseUrl: BASE, fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.why, /HTTP 403: not a member of this project/);
});

test('no Team chat ticket is a failure that says so — the app never makes one', async () => {
  const { fetchImpl, requests } = fakeBus({ tickets: [TICKETS[2]] });
  const out = await forward.postBusMessage('ALARM: x', { token: 't', baseUrl: BASE, fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.why, /no "Team chat" ticket in/);
  assert.ok(!requests.some((r) => r.method === 'POST'), 'nothing was filed or posted');
});

test('no token: nothing is sent, and the reason names the Vercel setting', async () => {
  const { fetchImpl, requests } = fakeBus({ tickets: TICKETS });
  const out = await forward.postBusMessage('ALARM: x', { token: '', baseUrl: BASE, fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.why, /TRACKER_TOKEN_APP/);
  assert.equal(requests.length, 0);
});

test('the alarm callers on the website reach the tracker, not ClickUp', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  for (const f of ['routes/aiQuota.js', 'lib/miniAiLimit.js']) {
    assert.match(read(f), /require\('[./]+(?:lib\/)?trackerForward'\)\.postBusMessage/, `${f} posts through trackerForward`);
    assert.doesNotMatch(read(f), /clickupForward/, `${f} no longer reaches the ClickUp door`);
  }
  assert.match(read('lib/bugReportForward.js'), /require\('\.\/trackerForward'\)/);
  assert.doesNotMatch(read('lib/clickupForward.js'), /fetch|clickup\.cjs|api\.clickup\.com/, 'the old door writes nothing');
});

// ── The copies of the door's own vocabulary, pinned to it ─────────────────

test('the Team chat names, the post header and the machine marker match the door\'s', () => {
  const busFallback = require('../../loop/lib/busFallback.js');
  const trackerBus = require('../../loop/lib/trackerBus.js');
  const machineComment = require('../../loop/lib/machineComment.js');

  assert.deepEqual(forward.TEAM_CHAT_NAMES, [busFallback.FALLBACK_TASK_NAME, ...busFallback.LEGACY_TASK_NAMES]);
  assert.equal(forward.MACHINE_MARKER, machineComment.MACHINE_MARKER);
  assert.equal(machineComment.isMachineComment(forward.renderBusPost('hello', Date.now())), true,
    'the door\'s own reader must see the app\'s post as a machine\'s');

  const at = Date.parse('2026-11-12T22:00:00Z');
  const ours = forward.renderBusPost('hello', at).split('\n');
  const theirs = trackerBus.renderBusPost({ text: 'hello', node: 'the StarCaster app (Vercel)', at: trackerBus.mountainTime(at) }).split('\n');
  assert.deepEqual(ours.slice(0, theirs.length), theirs, 'same header, same layout, then the marker');

  // pickTeamChat: the same choice on the same tickets (the door reads them ClickUp-shaped).
  const shaped = TICKETS.map((t) => ({ ...t, date_created: String(Date.parse(t.createdAt)) }));
  assert.equal(forward.pickTeamChat(TICKETS).id, trackerBus.pickTeamChat(shaped).id);
});
