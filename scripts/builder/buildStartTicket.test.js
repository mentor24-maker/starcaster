'use strict';

/**
 * scripts/builder/buildStartTicket.js — "was this ticket already started?",
 * read through the tracker (SC-877).
 *
 * No tracker, no gh, no disk: `call`, `lookupPr` and `findLocalWork` are all
 * injected, so each test says exactly which reading produced which answer.
 * The one rule every test below circles: a reading that did not happen is
 * never exit 0.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBuildStart, reportLines, exitCode } = require('./buildStartTicket.js');
const door = require('../lib/trackerDoor.cjs');

const PR_LINE = { id: '1', comment_text: 'PR opened: https://github.com/mentor24-maker/starcaster/pull/1069', date: '1' };
const ok = (json) => ({ ok: true, status: 200, res: { ok: true, status: 200 }, json });
const failed = (why) => ({ ok: false, status: 0, res: { ok: false, status: 0 }, json: null, threw: why });

function fakeCall({ comments = ok({ comments: [] }), ticket = ok({ id: 'SC-1', tags: [] }) } = {}) {
  const asked = [];
  const call = async (method, p) => {
    asked.push(`${method} ${p}`);
    if (/\/comment$/.test(p)) return comments;
    return ticket;
  };
  return { call, asked };
}
const nothingOnDisk = () => ({ verdict: 'none', work: [], unseen: [], unlooked: [] });

test('an open pull request is CONTINUE with a pr: line, exit 3, and the disks are not read', async () => {
  const { call, asked } = fakeCall({ comments: ok({ comments: [PR_LINE] }) });
  const d = await readBuildStart({
    taskId: 'SC-1', call,
    lookupPr: () => ({ state: 'OPEN', headRefName: 'ai-provider-groups', url: 'https://github.com/mentor24-maker/starcaster/pull/1069' }),
    findLocalWork: () => { throw new Error('must not be asked'); },
  });
  assert.equal(d.action, 'continue');
  assert.equal(exitCode(d), 3);
  const lines = reportLines(d, { task: 'SC-1' });
  assert.match(lines[0], /^CONTINUE/);
  assert.ok(lines.some((l) => /^pr:\s+#1069/.test(l)), lines.join('\n'));
  assert.deepEqual(asked, ['GET /api/v2/task/SC-1/comment'], 'a PR that settles it costs no ticket read');
});

test('nothing on the ticket and nothing on any disk is FRESH, exit 0 — the only path to 0', async () => {
  const { call } = fakeCall();
  const d = await readBuildStart({ taskId: 'SC-1', call, lookupPr: () => null, findLocalWork: nothingOnDisk, hereId: 'mac-mini' });
  assert.equal(d.action, 'fresh');
  assert.equal(exitCode(d), 0);
});

test('BREAK-TEST: comments that could not be read are CANNOT TELL, exit 1 — never "nothing started"', async () => {
  const { call } = fakeCall({ comments: failed('HTTP 404: no ticket SC-99999.') });
  const d = await readBuildStart({ taskId: 'SC-99999', call, lookupPr: () => null, findLocalWork: nothingOnDisk });
  assert.equal(d.action, 'unknown');
  assert.equal(exitCode(d), 1);
  assert.match(reportLines(d, { task: 'SC-99999' })[0], /CANNOT TELL.*no ticket SC-99999/);
});

test('a door that throws, or answers with no comment list, is CANNOT TELL too', async () => {
  for (const call of [
    async () => { throw new Error('tracker unreachable'); },
    async () => ok({}),
  ]) {
    const d = await readBuildStart({ taskId: 'SC-1', call, lookupPr: () => null, findLocalWork: nothingOnDisk });
    assert.equal(exitCode(d), 1, JSON.stringify(d));
  }
});

test('a ticket that could not be read for its repo tag is CANNOT TELL, and nothing is probed', async () => {
  const { call } = fakeCall({ ticket: failed('timed out') });
  let probed = false;
  const d = await readBuildStart({
    taskId: 'SC-1', call, lookupPr: () => null,
    findLocalWork: () => { probed = true; return nothingOnDisk(); },
  });
  assert.equal(probed, false, 'the wrong checkout must never be probed on a guess');
  assert.equal(exitCode(d), 1);
});

test('the ticket handed to the disk reading is the one the door read, tags and all', async () => {
  const { call } = fakeCall({ ticket: ok({ id: 'SC-1', tags: [{ name: 'repo:pulse' }] }) });
  let seen;
  await readBuildStart({ taskId: 'SC-1', call, lookupPr: () => null, findLocalWork: (t) => { seen = t; return nothingOnDisk(); } });
  assert.deepEqual(seen.tags, [{ name: 'repo:pulse' }]);
});

test("the door's get print carries the ticket's tags; a print without the line carries none at all", () => {
  const print = (tagsLine) => [
    'id:       SC-1', 'name:     n', 'status:   queued', ...(tagsLine ? [tagsLine] : []), '---', 'body', '',
  ].join('\n');
  assert.deepEqual(door.parseGet(print('tags:     repo:pulse, request-form')).tags, [{ name: 'repo:pulse' }, { name: 'request-form' }]);
  assert.deepEqual(door.parseGet(print('tags:     (none)')).tags, []);
  assert.equal('tags' in door.parseGet(print(null)), false,
    'no tags line means the ticket was not fully read — localWorkReading must see that, not an empty list');
});

test('no file outside the old door tells a session to run `npm run clickup -- build-start`', () => {
  const repo = path.join(__dirname, '..', '..');
  const files = ['CLAUDE.md', 'scripts/reconcile_clickup_github.cjs', 'scripts/builder/pipelinePause.js', 'scripts/pipeline.mjs'];
  for (const f of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(repo, f), 'utf8'), /clickup -- build-start/, f);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['build-start'], 'node scripts/build_start.mjs');
});
