'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'require_sql_handoff.cjs');
const {
  renderBlock,
  messageHandsOff,
  newSqlFiles,
  blockUrl,
} = require('../lib/sql_handoff.cjs');

/**
 * The Stop hook that enforces DOCTRINE.md §6.5.
 *
 * The point of this file is the FAILING case. A guard that only proves it
 * stays quiet has proved nothing -- §6.5 itself was "enforced" by being
 * written down, and on 2026-08-14 an agent that had read it still shipped a
 * repo-relative path. So every test here that matters drives the real hook
 * with real JSON and asserts it actually refuses.
 */

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlhandoff-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  git('add', '-A');
  git('commit', '-m', 'init');
  // A local "origin/main" so merge-base works without a network.
  git('branch', 'origin/main');
  git('remote', 'add', 'origin', 'https://github.com/mentor24-maker/starcaster.git');
  return dir;
}

function addSql(dir, name = 'add_thing.sql') {
  fs.mkdirSync(path.join(dir, 'docs', 'SQL'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'SQL', name), 'create table if not exists thing();\n');
  return `docs/SQL/${name}`;
}

function onBranch(dir, branch) {
  execFileSync('git', ['checkout', '-b', branch], { cwd: dir, stdio: 'ignore' });
}

function runHook(dir, { message = '', sessionId = 's1' } = {}) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: sessionId,
      cwd: dir,
      last_assistant_message: message,
    }),
    encoding: 'utf8',
    env: { ...process.env, SKIP_SQL_HANDOFF: '' },
  });
  return { code: result.status, stderr: result.stderr || '' };
}

test('REFUSES the turn when the branch adds SQL and the reply omits the block', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  addSql(dir);

  const { code, stderr } = runHook(dir, {
    message: 'All done. Run docs/SQL/add_thing.sql in Supabase when you get a chance.',
  });

  assert.equal(code, 2, 'must block the stop');
  assert.match(stderr, /did not hand it off/i);
  assert.match(stderr, /docs\/SQL\/add_thing\.sql/);
  // It must hand back the ready-made block, not just complain.
  assert.match(stderr, /RUN SQL IN SUPABASE/);
  assert.match(stderr, /blob\/add-revisions\/docs\/SQL\/add_thing\.sql/);
});

test('REFUSES a repo-relative path — the exact 2026-08-14 miss', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  addSql(dir);

  const { code } = runHook(dir, {
    message: 'The table has to be created. It is one file:\n\ndocs/SQL/add_thing.sql\n',
  });
  assert.equal(code, 2, 'a bare repo-relative path is not a handoff');
});

test('REFUSES a block whose URL points at main instead of the branch', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  const file = addSql(dir);

  const { code } = runHook(dir, {
    message: renderBlock('main', file), // right shape, wrong branch
  });
  assert.equal(code, 2, 'main-qualified URL is the broken-link trap §6.5 documents');
});

test('REFUSES the banner alone with no URL', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  addSql(dir);

  const { code } = runHook(dir, {
    message: '#################### RUN SQL IN SUPABASE ####################\n\nrun it\n',
  });
  assert.equal(code, 2);
});

test('ALLOWS the turn once the reply carries a correct, branch-qualified block', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  const file = addSql(dir);

  const { code } = runHook(dir, { message: `Here you go.\n\n${renderBlock('add-revisions', file)}\n` });
  assert.equal(code, 0, 'a correct handoff must not block');
});

test('does not fire when the branch adds no SQL', () => {
  const dir = makeRepo();
  onBranch(dir, 'some-ui-work');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hi');
  assert.equal(runHook(dir, { message: 'done' }).code, 0);
});

test('does not fire on main — there is no branch URL to give', () => {
  const dir = makeRepo();
  addSql(dir);
  assert.equal(runHook(dir, { message: 'done' }).code, 0);
});

test('once handed off, later turns in the same session are not held hostage', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  const file = addSql(dir);

  assert.equal(runHook(dir, { message: renderBlock('add-revisions', file), sessionId: 'sticky' }).code, 0);
  // A follow-up reply that says nothing about SQL must still be allowed.
  assert.equal(runHook(dir, { message: 'Anything else?', sessionId: 'sticky' }).code, 0);
});

test('gives up after three refusals rather than wedging the conversation', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  addSql(dir);

  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(runHook(dir, { message: 'nope', sessionId: 'loopy' }).code);
  assert.deepEqual(codes.slice(0, 3), [2, 2, 2], 'first three refuse');
  assert.deepEqual(codes.slice(3), [0, 0], 'then it steps aside');
});

test('SKIP_SQL_HANDOFF=1 is a real escape hatch', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  addSql(dir);

  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: dir, session_id: 'esc', last_assistant_message: 'nope' }),
    encoding: 'utf8',
    env: { ...process.env, SKIP_SQL_HANDOFF: '1' },
  });
  assert.equal(result.status, 0);
});

test('unparseable input never wedges the session', () => {
  const result = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('newSqlFiles sees an untracked file — the block is written before any commit', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  const file = addSql(dir);
  assert.deepEqual(newSqlFiles(dir), [file]);
});

test('newSqlFiles sees a committed file too', () => {
  const dir = makeRepo();
  onBranch(dir, 'add-revisions');
  const file = addSql(dir);
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add sql'], { cwd: dir, stdio: 'ignore' });
  assert.deepEqual(newSqlFiles(dir), [file]);
});

test('the rendered block matches §6.5 exactly, including the unfenced banners', () => {
  const block = renderBlock('my-branch', 'docs/SQL/x.sql');
  const lines = block.split('\n');
  assert.equal(lines[0], '#################### RUN SQL IN SUPABASE ####################');
  assert.equal(lines[1], '');
  assert.equal(lines[2], 'https://github.com/mentor24-maker/starcaster/blob/my-branch/docs/SQL/x.sql');
  assert.equal(lines[3], '');
  assert.equal(lines[4], '##########################################################');
  // §6.5: more than six #, or it renders as a markdown heading instead of text.
  assert.ok(lines[0].startsWith('#######'), 'must not shorten to a heading');
});

test('messageHandsOff needs both the banner and that file\'s own URL', () => {
  const url = blockUrl('b', 'docs/SQL/a.sql');
  assert.equal(messageHandsOff(`x ${url} y`, 'b', 'docs/SQL/a.sql'), false, 'URL alone is not the block');
  assert.equal(messageHandsOff(renderBlock('b', 'docs/SQL/a.sql'), 'b', 'docs/SQL/b.sql'), false, 'wrong file');
  assert.equal(messageHandsOff(renderBlock('b', 'docs/SQL/a.sql'), 'b', 'docs/SQL/a.sql'), true);
});
