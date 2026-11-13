'use strict';

/**
 * SC-793: the pipeline pulse reads the tracker's tickets through the door's
 * `tickets --json`, and keeps its report as a ticket in the bus project.
 * These pin the shared reader (scripts/lib/trackerTickets.cjs) and the two
 * call sites, without a network: every door call takes an injected `run`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tt = require('../lib/trackerTickets.cjs');

const ROOT = path.join(__dirname, '..', '..');
const codeOf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** A fake execFileSync that records its call and answers `stdout`, or throws `err`. */
function fakeRun({ stdout = '[]', err } = {}) {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (err) throw err;
    return stdout;
  };
  return { run, calls };
}

test('readTickets runs the door\'s tickets --json and nothing else', () => {
  const { run, calls } = fakeRun({ stdout: '[{"id":"SC-1"}]' });
  const rows = tt.readTickets({ includeClosed: true, comments: true, run, node: 'mac-mini' });
  assert.deepEqual(rows, [{ id: 'SC-1' }]);
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  assert.match(args[0], /loop\/scripts\/with_doppler\.mjs$/, 'under Doppler, so the door has its token');
  assert.match(args[2], /loop\/scripts\/clickup\.mjs$/, 'the tracker\'s ticket door');
  assert.deepEqual(args.slice(3), ['tickets', '--json', '--include-closed', '--comments']);
  assert.ok(calls[0].opts.timeout > 0, 'every door call has a deadline');
});

test('readTickets names the project when one is asked for', () => {
  const { run, calls } = fakeRun();
  tt.readTickets({ project: 'starcaster-bus', includeClosed: true, run, node: 'mac-mini' });
  assert.deepEqual(calls[0].args.slice(3), ['tickets', '--json', '--include-closed', '--project', 'starcaster-bus']);
});

test('BREAK-TEST: a failed read throws with the door\'s reason, never an empty list', () => {
  const err = Object.assign(new Error('exit 1'), { stderr: 'tickets FAILED: 2 read(s) did not come back' });
  const { run } = fakeRun({ err });
  assert.throws(() => tt.readTickets({ run, node: 'mac-mini' }), /tickets FAILED: 2 read\(s\) did not come back/);
  // and output that is not a list is a failed read too
  assert.throws(() => tt.parseTicketsOutput(''), /printed no JSON list/);
  assert.throws(() => tt.parseTicketsOutput('[{"id":'), /could not be parsed/);
});

test('a hung door is killed and says so', () => {
  const err = Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGTERM' });
  const { run } = fakeRun({ err });
  assert.throws(() => tt.readTickets({ run, node: 'mac-mini', timeoutMs: 5000 }), /did not finish within 5s and was killed/);
});

test('BREAK-TEST: off the Mini the door is pointed at the tracker\'s network address', () => {
  // An address the real spirality.project.json does NOT hold, so this passes
  // only if the config given actually reaches the address decision. The old
  // test passed the real address and so passed whether or not it arrived.
  const { run, calls } = fakeRun();
  const config = { trackerApiUrl: 'http://127.0.0.1:4999', trackerUrl: 'http://tracker.example:4999' };
  tt.readTickets({ run, node: 'macbook-pro', env: {}, config });
  assert.equal(calls[0].opts.env.TRACKER_API_URL, 'http://tracker.example:4999');
  assert.ok(!calls[0].args.includes('--project'), 'a config is not a project slug');
  const mini = fakeRun();
  tt.readTickets({ run: mini.run, node: 'mac-mini', env: {}, config });
  assert.equal(mini.calls[0].opts.env.TRACKER_API_URL, undefined, 'on the Mini the config\'s own address stands');
});

test('a project slug and a config travel separately', () => {
  const { run, calls } = fakeRun();
  tt.readTickets({ project: 'starcaster-bus', config: { trackerUrl: 'http://tracker.example:4999' }, run, node: 'macbook-pro', env: {} });
  assert.deepEqual(calls[0].args.slice(3), ['tickets', '--json', '--project', 'starcaster-bus']);
  assert.equal(calls[0].opts.env.TRACKER_API_URL, 'http://tracker.example:4999');
});

test('asLoopTasks gives the pure checks the shape they were written against', () => {
  const rows = [{
    id: 'SC-7',
    name: 'A ticket',
    status: 'In Review',
    updated: '2026-11-12T10:00:00.000Z',
    comments: [
      { id: '1', author: { id: 1, name: 'Dane' }, by: 'operator', at: '2026-11-12T09:00:00.000Z', text: 'merge' },
      { id: '2', author: { id: 31, name: 'loop' }, by: 'machine', at: '2026-11-12T09:30:00.000Z', text: 'PR opened: x' },
    ],
  }, { id: 'SC-8', name: 'No comments read', status: 'live', updated: 'not a date' }];
  const { tasks, commentsById } = tt.asLoopTasks(rows, { config: { trackerUrl: 'http://mac-mini.local:4180/' } });
  assert.deepEqual(tasks[0], {
    id: 'SC-7',
    name: 'A ticket',
    status: { status: 'in review' },
    date_updated: Date.parse('2026-11-12T10:00:00.000Z'),
    url: 'http://mac-mini.local:4180/t/SC-7',
  });
  assert.equal(tasks[1].date_updated, null, 'an unreadable time is unknowable, never zero');
  assert.deepEqual(commentsById.get('SC-7')[0], {
    id: '1', comment_text: 'merge', user: { id: 1, username: 'Dane' }, date: Date.parse('2026-11-12T09:00:00.000Z'),
  });
  assert.equal(commentsById.has('SC-8'), false, 'comments not read are absent, not an empty list');
});

test('the comments asLoopTasks makes are the ones the merge and PR readers understand', () => {
  const { findPullRequest, mergeDecision } = require('./mergeOnComment.js');
  const { commentsById } = tt.asLoopTasks([{
    id: 'SC-9', name: 'x', status: 'ready to launch', updated: '2026-11-12T10:00:00.000Z',
    comments: [
      { id: '1', author: { id: 31 }, at: '2026-11-12T08:00:00.000Z', text: 'PR opened: https://github.com/o/r/pull/12' },
      { id: '2', author: { id: 1 }, at: '2026-11-12T09:00:00.000Z', text: 'merge' },
    ],
  }], { config: {} });
  const comments = commentsById.get('SC-9');
  assert.equal(findPullRequest(comments).number, 12);
  const d = mergeDecision({ status: 'ready to launch', comments, operatorId: 1 });
  assert.notEqual(d.act, 'none', 'Dane\'s merge word on the tracker reads as his (operator seat 1)');
});

test('descriptionFromGet reads the stored description, and null when there is none', () => {
  const printed = 'id:       SCBUS-2\nname:     Pipeline pulse\nurl:      x\n---\nThe report.\n\nLine two.\n';
  assert.equal(tt.descriptionFromGet(printed), 'The report.\n\nLine two.');
  assert.equal(tt.descriptionFromGet('id: x\nno separator'), null);
});

test('BREAK-TEST: the door\'s "(no body)" placeholder reads as an EMPTY description, not as text', () => {
  // A wiped report must read back as empty; read as text, it was reported as
  // TRUNCATED, which names the wrong failure.
  const printed = `id:       SCBUS-2\nname:     Pipeline pulse\n---\n${tt.NO_BODY_PLACEHOLDER}\n\n  tracker: 2 request(s) this run\n`;
  assert.equal(tt.NO_BODY_PLACEHOLDER, '(no body)', 'the exact text loop/scripts/clickup.mjs prints');
  assert.equal(tt.descriptionFromGet(printed), '');
  assert.equal(tt.descriptionFromGet('id: x\n---\nSee (no body) above.\n'), 'See (no body) above.', 'only the whole placeholder');
});

// SC-793. Read the code, not the comments: a comment may still say where
// things used to live.
test('the pulse reaches the tracker, never ClickUp', () => {
  const reader = codeOf('scripts/pulse.cjs');
  assert.ok(!/901418546619|CLICKUP_LOOP_QUEUE_LIST|api\.clickup\.com|clickupFetch|CLICKUP_OPERATOR_ID|48012725/.test(reader),
    'the reader has no ClickUp list, call or operator id');
  assert.match(reader, /operatorIdFrom\(PROJECT\)/, 'Dane is the tracker\'s operator seat, from the project config');

  const publisher = codeOf('scripts/pulse_publish.mjs');
  assert.ok(!/901418546619|2kydhxeu-474|CLICKUP_LOOP_QUEUE_LIST|CLICKUP_BUS_CHANNEL|CLICKUP_PULSE_DIGEST|api\/v2|clickup\.call\(|clickup\.listTasks\(/.test(publisher),
    'the publisher has no ClickUp list, channel, task id or API call');
  assert.match(publisher, /readTickets\(\{ project: BUS_PROJECT, includeClosed: true/, 'the record is looked for in the bus project');
  assert.match(publisher, /\['task', '--list', BUS_PROJECT, '--name', digest\.DIGEST_TASK_NAME/, 'and filed there the first time');
  assert.match(publisher, /\['describe', '--task', found\.task\.id, '--body-file', '-'\]/, 'and rewritten in place after that');
  assert.match(publisher, /\['get', '--task', String\(taskId\)\]/, 'and read back after every write');
  assert.match(publisher, /projectConfig\(\)\.busProject/, 'the bus project name comes from the project config');
  assert.match(publisher, /clickup\.postBusMessage\(null, text\)/, 'alarms go to the tracker\'s bus');
});

test('A1 reads the build lane\'s log under the name Spirality\'s runner writes', () => {
  // `loop-build.log` stopped growing on 2026-11-12, when the lanes moved to
  // Spirality's runner, so reading it made A1 call a running lane stopped.
  const reader = codeOf('scripts/pulse.cjs');
  assert.match(reader, /path\.join\(LOOP_LOG_DIR, loopLogName\(job\)\)/);
  assert.match(reader, /slug \? `\$\{slug\}-\$\{job\}\.log` : `\$\{job\}\.log`/);
});

test('BREAK-TEST: a pass that worked a tracker ticket reads as a claim', () => {
  // Every pass names its ticket as SC-<n> since the move; the classifier only
  // knew ClickUp's 86bb… ids, so a building lane read as 28 claimless passes.
  const { classifyPass } = require('./pulse.js');
  const worked = classifyPass({ body: ['claiming SC-793 out of "queued"', 'PR opened'], exitCode: 0 });
  assert.equal(worked.outcome, 'claimed');
  const old = classifyPass({ body: ['claimed 86bbqz7rg'], exitCode: 0 });
  assert.equal(old.outcome, 'claimed', 'the passes logged on ClickUp still read as they did');
  const blank = classifyPass({ body: ['nothing to see'], exitCode: 0 });
  assert.equal(blank.outcome, 'unknown', 'and a pass naming no ticket is still unreadable, never a claim');
});
