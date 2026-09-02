'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * The claim rule, run for real (task 86bbr1u9v).
 *
 * WHY A SPAWNED PROCESS. `loopStatuses.test.js` proves the ORDERING rule and
 * `loopInterval.test.js` proves the DEPTH reading, both as pure functions. What
 * neither can see is whether the command a build pass actually types is wired
 * to them — and that gap is not hypothetical: the whole reason `Rework` exists
 * is that a rule everybody agreed with ("finish half-built work first") was
 * never expressed anywhere a machine reads. So these run
 * `scripts/clickup_direct.mjs` end to end against a stubbed ClickUp.
 *
 * The two properties, both of which failed before this ticket:
 *
 *   1. `queue --claimable` returns Rework before Queued, oldest first, and its
 *      FIRST LINE is the ticket to claim (the skill reads exactly that line).
 *   2. `claim` guards the write on the status the ticket is ACTUALLY in.
 *      Guarding on `Queued` refuses every send-back; accepting either status
 *      would break the one thing keeping two build sessions off one ticket.
 *
 * BREAK-TESTED. Each case names the edit that makes it fail; every one was
 * made, watched to fail, and reverted before this file was committed.
 */

const REPO_SCRIPT = path.join(__dirname, '../clickup_direct.mjs');
const LIST = '901418546619';

const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.parse('2026-08-31T00:00:00Z');

function task(id, status, { priority = 'normal', created = TODAY, assignees = [] } = {}) {
  return {
    id,
    name: `${id} — ${status}`,
    status: { status, type: 'custom' },
    priority: priority ? { priority } : null,
    date_created: String(created),
    tags: [],
    assignees,
    url: `https://app.clickup.com/t/${id}`,
  };
}

/**
 * Run the real CLI with `fetch` replaced by a router over a fake ClickUp.
 *
 * Every write is recorded to a file the test reads back, because "did it write
 * the right thing" is the question here and an exit code cannot answer it.
 */
function runCli(argv, { tasks = [], taskById = {}, statusWrites = 'allow' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-'));
  try {
    const log = path.join(dir, 'writes.jsonl');
    const preload = path.join(dir, 'preload.cjs');
    fs.writeFileSync(preload, `
const fs = require('fs');
const LOG = ${JSON.stringify(log)};
const TASKS = ${JSON.stringify(tasks)};
const BY_ID = ${JSON.stringify(taskById)};
const STATUS_WRITES = ${JSON.stringify(statusWrites)};

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

globalThis.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  fs.appendFileSync(LOG, JSON.stringify({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null }) + '\\n');

  if (method === 'GET' && /\\/list\\/[0-9]+\\/task/.test(u)) {
    return json({ tasks: TASKS, last_page: true });
  }
  if (method === 'GET' && /\\/task\\/[^/?]+\\/comment/.test(u)) {
    return json({ comments: [] });
  }
  if (method === 'GET' && /\\/task\\/[^/?]+/.test(u)) {
    const id = u.split('/task/')[1].split(/[/?]/)[0];
    const t = BY_ID[id] || TASKS.find((x) => x.id === id);
    return t ? json(t) : json({ err: 'not found' }, 404);
  }
  if (method === 'PUT' && /\\/task\\/[^/?]+/.test(u)) {
    if (STATUS_WRITES === 'refuse') return json({ err: 'nope' }, 500);
    const id = u.split('/task/')[1].split(/[/?]/)[0];
    const body = JSON.parse(opts.body || '{}');
    const t = BY_ID[id] || TASKS.find((x) => x.id === id) || { id };
    // Echo the write back, which is what the command verifies against.
    return json({ ...t, status: { status: body.status, type: 'custom' }, assignees: [] });
  }
  if (method === 'POST') return json({ id: 'c1', comment_text: 'ok' });
  return json({ err: 'unrouted' }, 500);
};
`);

    const res = spawnSync(process.execPath, ['-r', preload, REPO_SCRIPT, ...argv], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLICKUP_API_TOKEN: 'test-token-not-a-real-one',
        CLICKUP_LOOP_QUEUE_LIST: LIST,
      },
    });
    const writes = fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return { ...res, writes };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── queue --claimable ────────────────────────────────────────────────────

const MIXED = [
  task('fresh-urgent', 'Queued', { priority: 'urgent', created: TODAY }),
  task('stale-rework', 'Rework', { priority: 'normal', created: TODAY - 6 * DAY }),
  task('newer-rework', 'Rework', { priority: 'urgent', created: TODAY - 1 * DAY }),
  task('old-normal', 'Queued', { priority: 'normal', created: TODAY - 30 * DAY }),
  task('busy', 'Building'),
  task('checking', 'In review'),
];

test('queue --claimable puts every Rework ticket above every Queued one', () => {
  // BREAK TEST: swap CLAIMABLE_BY_BUILD to [QUEUED, REWORK] and the first line
  // becomes `fresh-urgent`. Watched fail.
  const out = runCli(['queue', '--list', LIST, '--claimable'], { tasks: MIXED });
  assert.equal(out.status, 0, out.stderr);
  const ids = out.stdout.trim().split('\n').map((l) => l.split('\t')[0]);
  assert.deepEqual(ids, ['stale-rework', 'newer-rework', 'fresh-urgent', 'old-normal']);
  assert.equal(ids[0], 'stale-rework',
    'the FIRST LINE is what the skill claims — an urgent fresh ticket must not outrank a send-back');
});

test('queue --claimable prints the exact claim command for its first line', () => {
  // The skill reads this. A `--if-status` the caller has to remember is the
  // step that gets typed wrong, so the command carries no status at all.
  const out = runCli(['queue', '--list', LIST, '--claimable'], { tasks: MIXED });
  assert.match(out.stderr, /claim it: npm run clickup -- claim --task stale-rework/);
});

test('queue --claimable and --status are refused together, not quietly resolved', () => {
  // They are different questions, and silently picking one is how a build pass
  // ends up claiming from a list that hides every send-back.
  const out = runCli(['queue', '--list', LIST, '--claimable', '--status', 'Queued'], { tasks: MIXED });
  assert.equal(out.status, 2, out.stderr);
  assert.match(out.stderr, /two different questions/);
});

test('queue --status Queued still answers the old question exactly as before', () => {
  // Nothing about fresh work changed: priority, then oldest, within one status.
  const out = runCli(['queue', '--list', LIST, '--status', 'Queued'], { tasks: MIXED });
  const ids = out.stdout.trim().split('\n').map((l) => l.split('\t')[0]);
  assert.deepEqual(ids, ['fresh-urgent', 'old-normal']);
});

// ── claim ────────────────────────────────────────────────────────────────

function claimOf(writes) {
  return writes.find((w) => w.method === 'PUT');
}

test('claim moves a Rework ticket to Building, guarded on Rework', () => {
  // BREAK TEST: hard-code `--if-status Queued` in the claim rewrite and this
  // refuses with exit 3 — every send-back unclaimable, which is the failure
  // dressed as the fix. Watched fail.
  const t = task('r1', 'Rework');
  const out = runCli(['claim', '--task', 'r1'], { tasks: [t], taskById: { r1: t } });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  assert.equal(claimOf(out.writes).body.status, 'Building');
  assert.match(out.stderr, /guarded on that exact status/);
});

test('claim moves a Queued ticket to Building, guarded on Queued', () => {
  const t = task('q1', 'Queued');
  const out = runCli(['claim', '--task', 'q1'], { tasks: [t], taskById: { q1: t } });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  assert.equal(claimOf(out.writes).body.status, 'Building');
});

test('claim refuses, and writes NOTHING, on a status loop-build may not take', () => {
  // Exit 3 is this script's "someone got there first" code — the same one the
  // skill already reads as "take the next task".
  for (const status of ['Building', 'In review', 'Ready to launch', 'Needs your input', 'Live']) {
    const t = task('x1', status);
    const out = runCli(['claim', '--task', 'x1'], { tasks: [t], taskById: { x1: t } });
    assert.equal(out.status, 3, `${status} must be refused.\n${out.stderr}`);
    assert.equal(claimOf(out.writes), undefined, `${status}: nothing may be written`);
    assert.match(out.stderr, /may not claim/);
  }
});

test('claim clears assignees, so a claimed ticket leaves Dane\'s list', () => {
  // "Assignment is the handoff signal" — a machine status with him still
  // assigned puts noise in the one view he trusts.
  const t = task('r2', 'Rework', { assignees: [{ id: 48012725 }] });
  const out = runCli(['claim', '--task', 'r2'], { tasks: [t], taskById: { r2: t } });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  assert.deepEqual(claimOf(out.writes).body.assignees.rem, [48012725]);
});

test('claim will not let a caller name the statuses itself', () => {
  // `--status`/`--if-status` are what it fills in; accepting them would put
  // the remembered step back and let a guard be pointed at the wrong status.
  const t = task('r3', 'Rework');
  const out = runCli(['claim', '--task', 'r3', '--if-status', 'Queued'], { tasks: [t], taskById: { r3: t } });
  assert.equal(out.status, 2, out.stderr);
  assert.equal(claimOf(out.writes), undefined);
});

test('claim without --task refuses rather than guessing a ticket', () => {
  const out = runCli(['claim'], { tasks: [] });
  assert.equal(out.status, 2, out.stderr);
  assert.match(out.stderr, /needs --task/);
});

// ── the skill is actually wired to all of this ───────────────────────────

test('the build skill asks for --claimable and claims with `claim`', () => {
  // A rule nothing calls is a rule that does not run — the whole reason this
  // ticket exists. `--status Queued` in the claim step is the specific
  // regression: it hides every send-back.
  const skill = fs.readFileSync(path.join(__dirname, '../../.claude/skills/loop-build/SKILL.md'), 'utf8');
  assert.match(skill, /queue --list 901418546619 --claimable/,
    'the build skill must ask for the claimable list, not for one status');
  assert.match(skill, /npm run clickup -- claim --task/,
    'and must claim through `claim`, which fills the status guard in for it');
  assert.doesNotMatch(skill, /queue --list 901418546619 --status Queued/,
    'asking for Queued alone hides every send-back — the bug this ticket closes');
});

test('the review skill sends work back to Rework, not to Queued', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../../.claude/skills/loop-review/SKILL.md'), 'utf8');
  assert.match(skill, /--status Rework --if-status "In review"/,
    'a send-back must land in Rework');
  assert.doesNotMatch(skill, /--status Queued --if-status "In review"/,
    'the old destination must be gone, or send-backs keep hiding in the queue');
});

// ── migrate-rework ───────────────────────────────────────────────────────

/**
 * Run `migrate-rework` with a fake `gh` as well as a fake ClickUp: the
 * migration's whole definition of "this ticket is a send-back" is "Queued
 * with an open pull request against it", which needs both.
 */
function runMigrate(argv, { tasks, prsJson, ghFails = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
  try {
    const log = path.join(dir, 'writes.jsonl');
    const ghPath = path.join(dir, 'gh');
    fs.writeFileSync(ghPath, ghFails
      ? '#!/bin/sh\necho "gh: not logged in" >&2\nexit 1\n'
      : `#!/bin/sh\ncase "$*" in\n  *"pr list"*) cat <<'JSON'\n${prsJson}\nJSON\n    ;;\n`
        + '  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;\nesac\n');
    fs.chmodSync(ghPath, 0o755);

    const preload = path.join(dir, 'preload.cjs');
    fs.writeFileSync(preload, `
const fs = require('fs');
const LOG = ${JSON.stringify(log)};
const TASKS = ${JSON.stringify(tasks)};
function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) };
}
globalThis.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  fs.appendFileSync(LOG, JSON.stringify({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null }) + '\\n');
  if (method === 'GET' && /\\/list\\/[0-9]+\\/task/.test(u)) return json({ tasks: TASKS, last_page: true });
  if (method === 'GET' && /\\/list\\/[0-9]+$/.test(u)) return json({ id: '1', content: 'Statuses: Queued -> Building -> In review -> Live (closed).' });
  if (method === 'PUT' && /\\/list\\/[0-9]+$/.test(u)) {
    const body = JSON.parse(opts.body || '{}');
    return json({ id: '1', content: body.content });
  }
  if (method === 'PUT' && /\\/task\\/[^/?]+/.test(u)) {
    const id = u.split('/task/')[1].split(/[/?]/)[0];
    const body = JSON.parse(opts.body || '{}');
    const t = TASKS.find((x) => x.id === id) || { id };
    return json({ ...t, status: { status: body.status, type: 'custom' }, assignees: [] });
  }
  return json({ err: 'unrouted' }, 500);
};
`);
    const res = spawnSync(process.execPath, ['-r', preload, REPO_SCRIPT, ...argv], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CLICKUP_API_TOKEN: 'test-token-not-a-real-one',
        CLICKUP_LOOP_QUEUE_LIST: LIST,
      },
    });
    const writes = fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return { ...res, writes };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MIGRATE_TASKS = [
  task('halfbuilt', 'Queued'),
  task('untouched', 'Queued'),
  task('inflight', 'Building'),
];
// One PR against the half-built ticket, one against a ticket that is Building.
const MIGRATE_PRS = JSON.stringify([
  { number: 419, state: 'OPEN', body: 'Ticket: https://app.clickup.com/t/halfbuilt\n' },
  { number: 500, state: 'OPEN', body: 'Ticket: https://app.clickup.com/t/inflight\n' },
]);

test('migrate-rework is a dry run unless --apply, and writes nothing', () => {
  const out = runMigrate(['migrate-rework'], { tasks: MIGRATE_TASKS, prsJson: MIGRATE_PRS });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  assert.match(out.stdout, /halfbuilt/);
  assert.match(out.stdout, /DRY RUN/);
  assert.equal(out.writes.filter((w) => w.method === 'PUT').length, 0,
    'a dry run must write nothing at all — not the tickets, not the list description');
});

test('migrate-rework moves only the Queued tickets that have an open PR', () => {
  const out = runMigrate(['migrate-rework', '--apply'], { tasks: MIGRATE_TASKS, prsJson: MIGRATE_PRS });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  const puts = out.writes.filter((w) => w.method === 'PUT' && /\/task\//.test(w.url));
  assert.equal(puts.length, 1, 'exactly one ticket qualifies');
  assert.match(puts[0].url, /halfbuilt/, 'the Queued ticket with an open PR');
  assert.equal(puts[0].body.status, 'Rework');
  assert.doesNotMatch(out.stdout, /untouched -> Rework/,
    'a Queued ticket with no PR is fresh work and must be left alone');

  // And the list's own description moves with the tickets. A description that
  // documents the old six-status flow is worse than none: a reader has no way
  // to tell it is wrong.
  const listWrite = out.writes.find((w) => w.method === 'PUT' && /\/list\/\d+$/.test(w.url));
  assert.ok(listWrite, 'the list description must be rewritten in the same step');
  assert.match(listWrite.body.content, /Rework -> Queued -> Building/);
  assert.match(listWrite.body.content, /before any Queued one, oldest first/);
});

test('migrate-rework refuses rather than reporting a false all-clear when gh fails', () => {
  // DOCTRINE 3.11. An empty PR list and an unreadable one look identical, and
  // they mean opposite things — "nothing to migrate" versus "no idea".
  const out = runMigrate(['migrate-rework', '--apply'], { tasks: MIGRATE_TASKS, prsJson: '[]', ghFails: true });
  assert.notEqual(out.status, 0, 'it must not exit 0 having checked nothing');
  assert.equal(out.writes.filter((w) => w.method === 'PUT').length, 0);
  assert.doesNotMatch(out.stdout, /Nothing to migrate/,
    'a failed read must never be reported as an all-clear');
});

test('migrate-rework says so plainly when there is genuinely nothing to move', () => {
  // The control for the test above: with gh working and no matching PR, the
  // all-clear is real and must still be reachable.
  const out = runMigrate(['migrate-rework'], { tasks: MIGRATE_TASKS, prsJson: '[]' });
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`);
  assert.match(out.stdout, /Nothing to migrate/);
});
