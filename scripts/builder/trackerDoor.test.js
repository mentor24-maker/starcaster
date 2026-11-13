'use strict';

/**
 * scripts/lib/trackerDoor.cjs — the watchdogs' way to the tracker (SC-794).
 *
 * No tracker, no Doppler, no network: every door command is answered by an
 * injected `run`, which also records the arguments, so each test says exactly
 * which door command a read or a write became.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const door = require('../lib/trackerDoor.cjs');
const clickup = require('../lib/clickup.cjs');
const link = require('./clickupTicketLink.js');

const REPO = path.resolve(__dirname, '..', '..');

/** A fake door: `answer(args, input)` returns stdout or throws. Records every call. */
function fakeDoor(answer) {
  const calls = [];
  const run = (_node, argv, opts) => {
    // Everything after the door's own path is the command it was given.
    const cmd = argv.slice(argv.findIndex((a) => a.endsWith('clickup.mjs')) + 1);
    calls.push({ cmd, input: opts.input, env: opts.env });
    return answer(cmd, opts.input);
  };
  return { run, calls, cmds: () => calls.map((c) => c.cmd[0]) };
}

function getPrint({ id, name, status = 'live', assigned = '(nobody)', body }) {
  return [
    `id:       ${id}`, `name:     ${name}`, `status:   ${status}`, 'priority: none',
    `assigned: ${assigned}`, 'tags:     (none)', 'list:     starcaster-bus (starcaster-bus)',
    'pr:       (none recorded)', 'rounds:   0 send-back(s) so far', 'main:     (no MAIN MOVED note)',
    'attachments: (none)', `url:      http://127.0.0.1:4180/tickets/${id}`, '---', body, '',
  ].join('\n');
}

test.beforeEach(() => door._resetCacheForTests());

// --- shapes -------------------------------------------------------------------

test('a tracker ticket reads as the ClickUp task the counting code expects', () => {
  const live = door.asClickUpTask({
    id: 'SC-9', name: 'Shipped', status: 'live', priority: 'high', tags: ['a'],
    created: '2026-11-01T00:00:00.000Z', updated: '2026-11-03T00:00:00.000Z', statusSince: '2026-11-02T00:00:00.000Z',
  });
  assert.equal(live.status.status, 'live');
  assert.equal(live.status.type, 'closed', 'Live is the closed status, so the reconciler counts it terminal');
  assert.equal(live.date_closed, String(Date.parse('2026-11-02T00:00:00.000Z')),
    'a Live ticket closed when it ENTERED Live — not when it was last edited');
  assert.equal(live.date_created, String(Date.parse('2026-11-01T00:00:00.000Z')));
  assert.deepEqual(live.priority, { priority: 'high' });
  assert.deepEqual(live.tags, [{ name: 'a' }]);
  assert.equal(live.url, `${door.TRACKER_URL}/t/SC-9`);

  const open = door.asClickUpTask({ id: 'SC-10', status: 'queued', statusSince: '2026-11-02T00:00:00.000Z' });
  assert.equal(open.date_closed, null, 'an open ticket has no closure date, or throughput counts it shipped');
  assert.equal(open.status.type, 'custom');
});

test("Dane's seat is the tracker's operator id, never the old ClickUp one", () => {
  const config = JSON.parse(fs.readFileSync(path.join(REPO, 'spirality.project.json'), 'utf8'));
  assert.equal(door.OPERATOR_ID, Number(config.operatorUserId));
  assert.notEqual(door.OPERATOR_ID, 48012725, 'the ClickUp id matches no comment on the tracker');
  assert.equal(door.BUS_PROJECT, config.busProject, 'the standing tickets live in the bus project');
});

test('get is taken apart at the first --- line, and a --- inside the body survives', () => {
  const t = door.parseGet(getPrint({ id: 'SCBUS-3', name: 'Node roll call', assigned: 'Dane (1)', body: 'top\n---\nbottom' }));
  assert.equal(t.id, 'SCBUS-3');
  assert.equal(t.name, 'Node roll call');
  assert.equal(t.status.status, 'live');
  assert.deepEqual(t.assignees, [{ id: 1 }]);
  assert.equal(t.markdown_description, 'top\n---\nbottom');
  assert.equal(door.parseGet(getPrint({ id: 'X-1', name: 'n', body: '(no body)' })).markdown_description, '',
    "the door's placeholder for an empty body is not a body");
  assert.equal(door.parseGet('no header here'), null);
});

test('a remembered ClickUp id is told apart from a tracker one', () => {
  assert.equal(door.isTrackerId('SC-12'), true);
  assert.equal(door.isTrackerId('SCBUS-4'), true);
  assert.equal(door.isTrackerId('86bcwam1k'), false);
  assert.equal(door.isTrackerId(''), false);
});

// --- reads --------------------------------------------------------------------

test('listTasks asks the door for the project, Live included only when asked', async () => {
  const fake = fakeDoor(() => JSON.stringify([{ id: 'SC-1', name: 'a', status: 'queued' }]));
  const tasks = await door.listTasks({ includeClosed: true, run: fake.run });
  assert.deepEqual(fake.calls[0].cmd, ['tickets', '--json', '--project', door.PROJECT, '--include-closed']);
  assert.equal(tasks[0].status.status, 'queued');
  await door.listTasks({ project: 'starcaster-bus', run: fake.run });
  assert.deepEqual(fake.calls[1].cmd, ['tickets', '--json', '--project', 'starcaster-bus']);
});

test('a failed or garbled read throws, never answers an empty queue', async () => {
  const dead = fakeDoor(() => { const e = new Error('exit 1'); e.stderr = 'tickets FAILED: 2 read(s) did not come back'; throw e; });
  await assert.rejects(door.listTasks({ run: dead.run }), /tickets FAILED/);
  const garbled = fakeDoor(() => 'not json');
  await assert.rejects(door.listTasks({ run: garbled.run }), /not a JSON list/);
});

test('comments: open tickets read once, Live only when needed, newest first, unknown is an error', async () => {
  const fake = fakeDoor((cmd) => {
    const all = cmd.includes('--include-closed');
    const open = [{ id: 'SC-2', comments: [
      { id: '1', author: { id: 1, name: 'Dane' }, at: '2026-11-01T00:00:00.000Z', text: 'first' },
      { id: '2', author: { id: 31, name: 'loop' }, at: '2026-11-02T00:00:00.000Z', text: 'second' },
    ] }];
    return JSON.stringify(all ? [...open, { id: 'SC-1', comments: [] }] : open);
  });
  const two = await door.getTaskCommentRecords('SC-2', { run: fake.run });
  assert.deepEqual(two.map((c) => c.comment_text), ['second', 'first'], 'newest first, as ClickUp answered');
  assert.equal(two[1].user.id, 1);
  assert.equal(two[1].date, String(Date.parse('2026-11-01T00:00:00.000Z')));
  await door.getTaskCommentRecords('sc-2', { run: fake.run });
  assert.equal(fake.calls.length, 1, 'a second ticket from the same read costs no second door command');
  assert.deepEqual(await door.getTaskCommentRecords('SC-1', { run: fake.run }), []);
  assert.equal(fake.calls.length, 2, 'a Live ticket costs the one read that includes Live');
  await assert.rejects(door.getTaskCommentRecords('SC-404', { run: fake.run }), /not in the starcaster project/);
  assert.equal(await door.readComments('SC-404', { run: fake.run }), null, 'readComments answers null, "could not read"');
});

// --- writes -------------------------------------------------------------------

test('a guarded move hands the guard to the door', () => {
  const fake = fakeDoor(() => 'Task SC-3: "in review" -> "live"');
  door.moveTaskStatus('SC-3', 'Live', { ifStatus: 'in review', run: fake.run });
  assert.deepEqual(fake.calls[0].cmd, ['status', '--task', 'SC-3', '--status', 'Live', '--if-status', 'in review']);
  const refused = fakeDoor(() => { const e = new Error('exit 3'); e.stderr = 'NOT moved: expected status'; throw e; });
  assert.throws(() => door.moveTaskStatus('SC-3', 'Live', { ifStatus: 'in review', run: refused.run }), /NOT moved/);
});

/** A tracker with one bus project, answering the door commands a standing ticket uses. */
function standingTracker({ tickets = [], listFails = false } = {}) {
  const store = new Map(tickets.map((t) => [t.id, { assignees: [], ...t }]));
  let next = 10;
  const fake = fakeDoor((cmd, input) => {
    const val = (flag) => cmd[cmd.indexOf(flag) + 1];
    if (cmd[0] === 'tickets') {
      if (listFails) { const e = new Error('exit 1'); e.stderr = 'list tasks FAILED — HTTP 500'; throw e; }
      return JSON.stringify([...store.values()].map((t) => ({ id: t.id, name: t.name, status: 'live' })));
    }
    if (cmd[0] === 'get') {
      const t = store.get(val('--task'));
      if (!t) { const e = new Error('exit 1'); e.stderr = 'read the task FAILED — HTTP 404'; throw e; }
      const assigned = t.assignees.map((id) => `Dane (${id})`).join(', ') || '(nobody)';
      return getPrint({ id: t.id, name: t.name, assigned, body: t.body });
    }
    if (cmd[0] === 'task') {
      const id = `SCBUS-${next++}`;
      store.set(id, { id, name: val('--name'), body: input, assignees: [] });
      fs.writeFileSync(val('--id-out'), id);
      return `Created task ${id}`;
    }
    if (cmd[0] === 'describe') { store.get(val('--task')).body = input; return 'replaced'; }
    if (cmd[0] === 'status') {
      const t = store.get(val('--task'));
      t.assignees = cmd.includes('--assign') ? [Number(val('--assign'))] : [];
      return 'moved';
    }
    throw new Error(`unexpected door command ${cmd[0]}`);
  });
  return { ...fake, store };
}

test('a standing ticket that does not exist is filed in the bus project, Live, with Dane on it when asked', async () => {
  const t = standingTracker();
  const out = await door.writeStandingTicket({ name: 'SQL waiting for you', body: '# 2 waiting', assign: true, run: t.run });
  assert.equal(out.ok, true, out.why);
  const filed = t.calls.find((c) => c.cmd[0] === 'task').cmd;
  assert.equal(filed[filed.indexOf('--list') + 1], door.BUS_PROJECT);
  assert.equal(filed[filed.indexOf('--status') + 1], 'Live', 'Live, so no loop ever claims it');
  const assign = t.calls.find((c) => c.cmd[0] === 'status').cmd;
  assert.deepEqual(assign.slice(-2), ['--assign', String(door.OPERATOR_ID)]);
  assert.ok(assign.includes('--no-auto-assign'));
  assert.equal(t.store.get(out.id).body, '# 2 waiting');
});

test('an existing one is found by NAME and rewritten in place, and Dane comes off it when nothing waits', async () => {
  const t = standingTracker({ tickets: [{ id: 'SCBUS-4', name: 'SQL waiting for you', body: 'old', assignees: [door.OPERATOR_ID] }] });
  const out = await door.writeStandingTicket({ name: 'SQL waiting for you', body: '# Nothing waiting', assign: false, remembered: '86bcwam1k', run: t.run });
  assert.equal(out.ok, true, out.why);
  assert.equal(out.id, 'SCBUS-4');
  assert.equal(t.calls.filter((c) => c.cmd[0] === 'task').length, 0, 'never a second copy');
  assert.equal(t.store.get('SCBUS-4').body, '# Nothing waiting');
  assert.deepEqual(t.store.get('SCBUS-4').assignees, []);
  assert.ok(t.calls.find((c) => c.cmd[0] === 'status').cmd.includes('--clear-assignees'));
});

test('BREAK-TEST: a list that could not be read is a failure, never "absent" — nothing is filed', async () => {
  const t = standingTracker({ listFails: true });
  const out = await door.writeStandingTicket({ name: 'Broken links on client sites', body: 'x', assign: true, run: t.run });
  assert.equal(out.ok, false);
  assert.match(out.why, /HTTP 500/);
  assert.equal(t.calls.filter((c) => c.cmd[0] === 'task').length, 0, 'a blind read must not file a duplicate');
});

test('assign: null leaves the assignees alone, and the read-back verdict can refuse', async () => {
  const t = standingTracker({ tickets: [{ id: 'SCBUS-5', name: 'Broken links on client sites', body: 'old', assignees: [door.OPERATOR_ID] }] });
  const ok = await door.writeStandingTicket({ name: 'Broken links on client sites', body: 'new', assign: null, run: t.run });
  assert.equal(ok.ok, true);
  assert.equal(t.calls.filter((c) => c.cmd[0] === 'status').length, 0);
  const refused = await door.writeStandingTicket({
    name: 'Broken links on client sites', body: 'new', run: t.run, verdict: () => ({ ok: false, why: 'TRUNCATED' }),
  });
  assert.deepEqual([refused.ok, refused.why], [false, 'TRUNCATED']);
});

// --- the bus post's one argument -------------------------------------------------

test('postBusMessage takes the message only; the old channel-first call is refused, not posted', () => {
  let ran = false;
  assert.throws(() => clickup.postBusMessage('2kydhxeu-474', 'an alarm'), /channel id first/);
  clickup.postBusMessage('an alarm', { from: 'mac-mini', run: (_n, _a, opts) => { ran = opts.input; return ''; } });
  assert.equal(ran, 'an alarm');
});

// --- the PR's ticket link ----------------------------------------------------------

test("a PR's tracker link names its ticket, and a near-miss id does not", () => {
  const body = 'Ticket: http://mac-mini.local:4180/t/SC-794\n';
  assert.deepEqual(link.findTicketIds(body), ['sc-794']);
  assert.equal(link.findTicketId(body), 'SC-794');
  assert.equal(link.bodyNamesTicket(body, 'SC-794'), true);
  assert.equal(link.bodyNamesTicket(body, 'SC-79'), false);
  assert.equal(link.bodyNamesTicket('see http://mac-mini.local:4180/t/SC-7940', 'SC-794'), false);
  assert.deepEqual(link.findTicketIds('https://app.clickup.com/t/86bbmmv7t then http://h:1/t/SC-1'), ['86bbmmv7t', 'sc-1'],
    'both kinds, in the order they appear');
});

// --- the acceptance criterion, held ------------------------------------------------

const WATCHDOGS = [
  'node_heartbeat.mjs', 'loop_throughput.mjs', 'stale_ready.mjs', 'stale_answer.mjs',
  'checkout_currency.mjs', 'unapplied_sql_watch.mjs', 'broken_links_check.mjs',
  'reconcile_clickup_github.cjs', 'repair.mjs',
];

test('BREAK-TEST: none of the watchdogs reads or writes ClickUp any more', () => {
  const clickupUse = /clickup\.(call|listTasks|pageComments|getTaskComments|getTaskCommentRecords|clickupFetch|runDirect|moveTaskStatus|commentOnTask)\b|api\.clickup\.com|\/api\/v[23]\/|clickupForward|clickup_direct\.mjs['"]|CLICKUP_LOOP_QUEUE_LIST|CLICKUP_BUS_CHANNEL|901418546619|2kydhxeu-474|48012725/;
  for (const file of WATCHDOGS) {
    const code = fs.readFileSync(path.join(REPO, 'scripts', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hit = clickupUse.exec(code);
    assert.equal(hit, null, `${file} still reaches ClickUp: ${hit && hit[0]}`);
  }
  const reconcile = fs.readFileSync(path.join(REPO, 'scripts', 'reconcile_clickup_github.cjs'), 'utf8');
  assert.match(reconcile, /\} = require\('\.\/lib\/trackerDoor\.cjs'\)/, 'the reconciler reads and repairs through the tracker door');
});

test('BREAK-TEST: what a watchdog remembers from ClickUp does not stop it writing on the tracker', () => {
  // Measured on the Mini, 2026-11-12: the first --push-owned after the switch
  // pushed NOTHING, because every role's "last pushed" stamp recorded a push to
  // the ClickUp roll call, so the new one would have sat empty for a day.
  const hb = fs.readFileSync(path.join(REPO, 'scripts', 'node_heartbeat.mjs'), 'utf8');
  assert.match(hb, /function pushStamp\(role\) \{ return `tracker-push-\$\{role\}`; \}/);
  assert.match(hb, /function pushKindStamp\(role\) \{ return `tracker-push-kind-\$\{role\}`; \}/);
  assert.doesNotMatch(hb, /Stamp\(`push-/, 'a push stamp is read or written under its ClickUp-era name again');
  // The same trap on the two standing tickets: a remembered ClickUp id means
  // "never written here", or "the ticket already says this" skips the write.
  for (const file of ['unapplied_sql_watch.mjs', 'broken_links_check.mjs']) {
    const src = fs.readFileSync(path.join(REPO, 'scripts', file), 'utf8');
    assert.match(src, /isTrackerId\(state\.ticket\.id\)/, `${file} trusts a ticket it remembers from ClickUp`);
  }
});
