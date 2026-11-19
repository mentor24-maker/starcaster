'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTicketRead, readTicketOpenState } = require('./ticketOpenState.js');

// What `npm run clickup -- get --task <id>` really prints (trimmed), so the
// parser is held to the door's actual shape rather than to a guess.
const answer = (id, status, ended) => [
  '> starcaster@1.0.0 clickup',
  '> node loop/scripts/with_doppler.mjs node loop/scripts/clickup.mjs get --task ' + id,
  '',
  `id:       ${id}`,
  'name:     Some ticket',
  `status:   ${status}`,
  'priority: none',
  `ended:    ${ended}`,
  `url:      http://127.0.0.1:4180/tickets/${id}`,
  '---',
  '## Goal',
  'status: this body line must not be read as the header',
  '',
].join('\n');

test('open: answered, same id, not Live, ended (still open)', () => {
  const r = classifyTicketRead({ taskId: 'SC-875', exitCode: 0, stdout: answer('SC-875', 'building', '(still open)') });
  assert.equal(r.state, 'open');
  assert.equal(r.status, 'building');
});

test('closed: Live', () => {
  assert.equal(classifyTicketRead({ taskId: 'SC-843', exitCode: 0, stdout: answer('SC-843', 'live', '(none)') }).state, 'closed');
});

test('closed: an outcome on the ended: line', () => {
  const r = classifyTicketRead({ taskId: 'SC-1', exitCode: 0, stdout: answer('SC-1', 'queued', 'duplicate') });
  assert.equal(r.state, 'closed');
  assert.match(r.reason, /duplicate/);
});

test('the id match ignores case, and nothing else', () => {
  assert.equal(classifyTicketRead({ taskId: 'sc-1', exitCode: 0, stdout: answer('SC-1', 'queued', '(still open)') }).state, 'open');
  assert.equal(classifyTicketRead({ taskId: 'SC-12', exitCode: 0, stdout: answer('SC-1', 'live', '(none)') }).state, 'unknown');
});

test('unknown: any non-zero exit, with the door\'s own words as the reason', () => {
  const r = classifyTicketRead({ taskId: 'SC-99999', exitCode: 1, stdout: '', stderr: 'read the task FAILED — HTTP 404\nno ticket SC-99999.\n' });
  assert.equal(r.state, 'unknown');
  assert.match(r.reason, /exited 1: read the task FAILED — HTTP 404 \/ no ticket SC-99999\./);
  // Even a non-zero exit whose stdout LOOKS like a Live ticket is no verdict.
  assert.equal(classifyTicketRead({ taskId: 'SC-1', exitCode: 3, stdout: answer('SC-1', 'live', '(none)') }).state, 'unknown');
});

test('unknown: an answer missing any line it needs', () => {
  assert.equal(classifyTicketRead({ taskId: 'SC-1', exitCode: 0, stdout: 'usage: clickup.mjs <command>\n' }).state, 'unknown');
  assert.equal(classifyTicketRead({ taskId: 'SC-1', exitCode: 0, stdout: 'id: SC-1\nended: (none)\n' }).state, 'unknown');
  assert.equal(classifyTicketRead({ taskId: 'SC-1', exitCode: 0, stdout: 'id: SC-1\nstatus: queued\n' }).state, 'unknown');
});

test('unknown: no id given never asks the tracker', () => {
  let asked = false;
  const r = readTicketOpenState('', { run: () => { asked = true; return { status: 0, stdout: '' }; } });
  assert.equal(r.state, 'unknown');
  assert.equal(asked, false);
});

test('readTicketOpenState asks the door for `get --task <id>` — the command it actually has', () => {
  let args;
  const r = readTicketOpenState('SC-5', {
    run: (a) => { args = a; return { status: 0, stdout: answer('SC-5', 'queued', '(still open)'), stderr: '' }; },
  });
  assert.equal(r.state, 'open');
  assert.deepEqual(args.slice(args.indexOf('--')), ['--', 'get', '--task', 'SC-5']);
});

test('readTicketOpenState never throws: a door that cannot start is unknown', () => {
  assert.equal(readTicketOpenState('SC-5', { run: () => { throw new Error('spawn npm ENOENT'); } }).state, 'unknown');
  assert.equal(readTicketOpenState('SC-5', { run: () => ({ error: new Error('ENOENT'), status: null }) }).state, 'unknown');
});
