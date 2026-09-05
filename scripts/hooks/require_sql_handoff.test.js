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

/**
 * Every scratch directory this suite creates, swept in test.after().
 *
 * `fs.mkdtempSync` makes a real directory in a MACHINE-WIDE temp dir and
 * nothing removes it, so each run left four behind and they accumulated: 1,997
 * `sqlhandoff-*` repos on the mini as of 2026-09-05, plus 41 each of the
 * others. The state FILES were already cleaned up (see FALLBACK_STATE_FILES);
 * the directories holding them were not, which is the same oversight one level
 * up.
 */
const SCRATCH_DIRS = [];
function scratchDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  SCRATCH_DIRS.push(dir);
  return dir;
}

function makeRepo() {
  const dir = scratchDir('sqlhandoff-');
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

function runHook(dir, { message = '', sessionId = 's1', stopHookActive, env } = {}) {
  const payload = {
    hook_event_name: 'Stop',
    session_id: sessionId,
    cwd: dir,
    last_assistant_message: message,
  };
  // Absent unless asked for -- the CONTROL half of the stop_hook_active tests
  // is the identical payload with the key simply not there.
  if (stopHookActive !== undefined) payload.stop_hook_active = stopHookActive;

  // process.execPath, not 'node': the git-off-PATH tests below hand this a PATH
  // with no git on it, and resolving the runner through that same PATH would
  // fail to launch the hook at all and read as a pass.
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: env || { ...process.env, SKIP_SQL_HANDOFF: '' },
  });
  return { code: result.status, stderr: result.stderr || '' };
}

/**
 * A session id nothing else will collide with, and that a LATER RUN cannot
 * inherit.
 *
 * The tests below deliberately drive state into `os.tmpdir()`, which -- unlike
 * the per-worktree git dir every other test uses -- is machine-wide and
 * outlives the run. With a fixed id the second `npm run test:hooks` read back
 * the FIRST run's counter, already at three, and the stand-down tests failed
 * for a reason that had nothing to do with the hook. Measured: run one green,
 * run two red, no code changed in between.
 *
 * Registered for cleanup so the suite does not litter the machine either.
 *
 * Any test that can reach the fallback at all needs one of these. Since the
 * read merges every candidate rather than stopping at the first that parses
 * (see openState), a fixed id shared with a leftover tmpdir file would be read
 * back on every turn, not only when the git dir refuses the write.
 */
const FALLBACK_STATE_FILES = [];
let sidCounter = 0;
function fallbackSid(label) {
  const id = `${label}-${process.pid}-${++sidCounter}`;
  FALLBACK_STATE_FILES.push(path.join(os.tmpdir(), `sql-handoff-${id}.json`));
  return id;
}

test.after(() => {
  for (const file of FALLBACK_STATE_FILES) {
    try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
  }
  for (const dir of SCRATCH_DIRS) {
    // A test that chmods a git dir restores it in its own `finally`; this is
    // only the sweep, so a directory it still cannot enter is left alone
    // rather than failing the run at the very end.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A PATH carrying node but no git — the mini's bare-PATH condition. */
function pathWithoutGit() {
  const bin = scratchDir('nogit-bin-');
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  return { ...process.env, SKIP_SQL_HANDOFF: '', PATH: bin };
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

/**
 * Build a real linked worktree off a real repo. `makeRepo()` above uses
 * `git init`, where `.git` is a DIRECTORY -- so every test that leans on it
 * passes with the state-path bug present and could never have caught it. Only
 * an actual `git worktree add` produces the `.git` FILE that broke the write.
 */
function makeWorktree() {
  const dir = makeRepo();
  const wt = path.join(dir, 'wt');
  execFileSync('git', ['worktree', 'add', wt, '-b', 'add-revisions'], { cwd: dir, stdio: 'ignore' });
  return wt;
}

test('the stand-down engages from inside a REAL worktree', () => {
  // The regression: state was written to `<toplevel>/.git/<file>`, and in a
  // linked worktree `.git` is a one-line FILE, so the write failed with
  // ENOTDIR -- silently, inside writeState's try/catch. `refusals` then read 0
  // forever and the three-refusal valve could never fire. Every thread in this
  // repo runs in a worktree, and all five refusals ever recorded in the
  // transcripts happened in one, so this was the only case that mattered.
  // Without the --absolute-git-dir fix this refuses five times, not three.
  const wt = makeWorktree();
  assert.ok(
    fs.statSync(path.join(wt, '.git')).isFile(),
    'precondition: .git must be a FILE here, or this test is just makeRepo() again'
  );
  addSql(wt);

  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(runHook(wt, { message: 'nope', sessionId: 'wt-loopy' }).code);
  assert.deepEqual(
    codes,
    [2, 2, 2, 0, 0],
    'the counter never persisted in a worktree, so it could never stand down'
  );
});

test('a worktree writes its state file where it can actually be read back', () => {
  // The stand-down above is the behaviour; this is the mechanism, asserted
  // directly so a future refactor that reintroduces a swallowed write fails
  // here with a clear reason rather than as a mysterious off-by-one in the
  // codes array.
  const wt = makeWorktree();
  addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();

  assert.equal(runHook(wt, { message: 'nope', sessionId: 'wt-state' }).code, 2);

  const written = path.join(gitDir, 'sql-handoff-wt-state.json');
  assert.ok(fs.existsSync(written), `expected the counter at ${written}`);
  assert.equal(JSON.parse(fs.readFileSync(written, 'utf8')).refusals, 1);
});

test('a file handed off in a worktree is not re-demanded on the next turn', () => {
  // The second half of the same bug, and the more annoying one in practice:
  // `handedOff` is persisted by the same write, so with the state lost a file
  // already handed off correctly was demanded again every single turn for the
  // rest of the session. The equivalent test above ('once handed off...') runs
  // in a `git init` repo, where the write succeeds, so it never saw this.
  const wt = makeWorktree();
  const file = addSql(wt);

  assert.equal(
    runHook(wt, { message: renderBlock('add-revisions', file), sessionId: 'wt-sticky' }).code,
    0,
    'a correct handoff must not block'
  );
  assert.equal(
    runHook(wt, { message: 'Anything else?', sessionId: 'wt-sticky' }).code,
    0,
    're-demanding a file the operator already has is the other half of the lost-state bug'
  );
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


/* ------------------------------------------------------------------------- *
 * The brake, in the conditions that actually break it (task 86bbt7mxe).
 *
 * The three worktree tests above cover WHERE the state lives. These cover
 * WHETHER it can be written at all, and the harness's own loop flag. The
 * ticket's headline -- the `<toplevel>/.git` path bug -- was already fixed
 * before this ran; measured on main at 03340bba, a worktree answered
 * 2,2,2,0,0 correctly. What it could not survive was a state directory that
 * resolves fine and then refuses the write: six refusals out of six, and it
 * would have been six hundred.
 * ------------------------------------------------------------------------- */

test('stands down when the state directory refuses the write — the wedge', () => {
  // THE REGRESSION. `writeState` swallowed the failure and returned nothing, so
  // `refusals` read 0 on every turn and the three-refusal valve could never
  // fire. Chmod 500 is a real read-only mount / permissions / full disk, which
  // is the case the old code called harmless.
  const wt = makeWorktree();
  addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  fs.chmodSync(gitDir, 0o500);
  try {
    const sessionId = fallbackSid('unwritable');
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push(runHook(wt, { message: 'nope', sessionId }).code);
    assert.deepEqual(
      codes,
      [2, 2, 2, 0, 0, 0],
      'an unwritable git dir must fall back, not refuse forever'
    );
  } finally {
    fs.chmodSync(gitDir, 0o700); // or the temp dir cannot be cleaned up
  }
});

test('the fallback state file is real, and is read back on the next turn', () => {
  // The mechanism behind the test above, asserted directly: the count has to
  // land somewhere a later turn can find it, or the codes array is passing for
  // the wrong reason.
  const wt = makeWorktree();
  addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  fs.chmodSync(gitDir, 0o500);
  try {
    const sessionId = fallbackSid('fallbackstate');
    assert.equal(runHook(wt, { message: 'nope', sessionId }).code, 2);
    assert.equal(runHook(wt, { message: 'nope', sessionId }).code, 2);

    assert.ok(
      !fs.existsSync(path.join(gitDir, `sql-handoff-${sessionId}.json`)),
      'precondition: the git dir must NOT have taken the write, or this proves nothing'
    );
    const fallback = path.join(os.tmpdir(), `sql-handoff-${sessionId}.json`);
    assert.ok(fs.existsSync(fallback), `expected the counter at ${fallback}`);
    assert.equal(
      JSON.parse(fs.readFileSync(fallback, 'utf8')).refusals,
      2,
      'the second turn must have READ the first turn back, not started over'
    );
  } finally {
    fs.chmodSync(gitDir, 0o700);
  }
});

test('refuses NOTHING when nowhere is writable — no count, no refusal', () => {
  // The end of the line: if the count cannot land anywhere at all, there is no
  // brake to be had, and the honest answer is to let the turn end rather than
  // refuse without a limit. TMPDIR is pointed at a path that cannot be written.
  const wt = makeWorktree();
  addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  fs.chmodSync(gitDir, 0o500);
  const sealed = scratchDir('sealed-');
  fs.chmodSync(sealed, 0o500);
  try {
    const env = { ...process.env, SKIP_SQL_HANDOFF: '', TMPDIR: sealed };
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push(runHook(wt, { message: 'nope', sessionId: 'sealed', env }).code);
    // 'sealed' needs no unique id: TMPDIR is redirected at a sealed directory,
    // so by construction this test writes nowhere that outlives it.
    assert.deepEqual(codes, [0, 0, 0], 'a hook that cannot count its refusals must not issue any');
  } finally {
    fs.chmodSync(gitDir, 0o700);
    fs.chmodSync(sealed, 0o700);
  }
});

test('a state file that goes read-only MID-SESSION still stands down', () => {
  // THE FREEZE. The read returned the first candidate that PARSED and the
  // write returned the first that ACCEPTED A WRITE, so once a state file
  // existed in the git dir and then lost write permission -- readable still,
  // and the directory itself still writable -- it shadowed the fallback for
  // good. Every write landed in tmpdir; every read came back from the stale
  // git-dir copy at 2; `refusals` never reached 3.
  //
  // Measured 2026-09-05 on 9351ae64, twelve turns: 2,2,2,2,2,2,2,2,2,2,2,2.
  //
  // Note the chmod is on the FILE, not the directory. Chmod 500 on the git dir
  // does NOT reproduce this -- directory write permission is needed to create
  // or unlink a file, not to rewrite one that already exists, so the git-dir
  // write keeps succeeding and the fallback is never reached at all. A first
  // reproduction attempt did exactly that and came back clean.
  const wt = makeWorktree();
  addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  const sessionId = fallbackSid('frozen');
  const stateFile = path.join(gitDir, `sql-handoff-${sessionId}.json`);

  const codes = [runHook(wt, { message: 'nope', sessionId }).code];
  codes.push(runHook(wt, { message: 'nope', sessionId }).code);

  assert.equal(
    JSON.parse(fs.readFileSync(stateFile, 'utf8')).refusals,
    2,
    'precondition: the git dir must have taken two writes, or there is nothing to freeze'
  );
  fs.chmodSync(stateFile, 0o400);

  try {
    for (let i = 0; i < 3; i++) codes.push(runHook(wt, { message: 'nope', sessionId }).code);
    assert.deepEqual(
      codes,
      [2, 2, 2, 0, 0],
      'a stale readable copy must not shadow the count the fallback is now carrying'
    );
    assert.equal(
      JSON.parse(fs.readFileSync(stateFile, 'utf8')).refusals,
      2,
      'and the frozen copy must genuinely still say 2 — otherwise the write got in and this proves nothing'
    );
  } finally {
    fs.chmodSync(stateFile, 0o600); // or the scratch dir cannot be cleaned up
  }
});

test('a hand-off arriving after the state file froze is recorded, not re-demanded', () => {
  // The other half of the same read. `handedOff` lives in the same file, so a
  // file the operator has already been given was demanded again on every turn
  // for the rest of the session: the turn carrying the block wrote it to the
  // fallback and the next read went straight back to the stale git-dir copy.
  //
  // Measured on 9351ae64 across the three turns below: 0,2,2.
  const wt = makeWorktree();
  const file = addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  const sessionId = fallbackSid('frozenhandoff');
  const stateFile = path.join(gitDir, `sql-handoff-${sessionId}.json`);

  assert.equal(runHook(wt, { message: 'nope', sessionId }).code, 2);
  fs.chmodSync(stateFile, 0o400);

  try {
    const codes = [
      runHook(wt, { message: renderBlock('add-revisions', file), sessionId }).code,
      runHook(wt, { message: 'Anything else?', sessionId }).code,
      runHook(wt, { message: 'Nor here.', sessionId }).code,
    ];
    assert.deepEqual(
      codes,
      [0, 0, 0],
      're-demanding a file the operator already has is the other half of the frozen read'
    );
  } finally {
    fs.chmodSync(stateFile, 0o600);
  }
});

test('stop_hook_active exits 0 — with the CONTROL that still refuses', () => {
  // The harness's own infinite-loop flag. The control is the point: an
  // identical reply with the key absent must still refuse, or this test would
  // pass just as well against a hook that had stopped working entirely.
  const wt = makeWorktree();
  addSql(wt);

  assert.equal(
    runHook(wt, { message: 'nope', sessionId: 'flagon', stopHookActive: true }).code,
    0,
    'the harness says this turn is already a continuation — stand down'
  );
  assert.equal(
    runHook(wt, { message: 'nope', sessionId: 'flagoff' }).code,
    2,
    'CONTROL: the identical reply without the flag must still refuse'
  );
});

test('stop_hook_active does not spend a refusal', () => {
  // It exits before the counter, so a continuation must not eat one of the
  // three. Otherwise the two brakes interfere and three real refusals become
  // fewer, silently.
  const wt = makeWorktree();
  addSql(wt);

  runHook(wt, { message: 'nope', sessionId: 'nospend', stopHookActive: true });
  runHook(wt, { message: 'nope', sessionId: 'nospend', stopHookActive: true });

  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(runHook(wt, { message: 'nope', sessionId: 'nospend' }).code);
  assert.deepEqual(codes, [2, 2, 2, 0, 0], 'all three refusals must survive the continuations');
});

test('with git off PATH it stands ASIDE — 0,0,0, not 2,2,2', () => {
  // The ticket asked for 2,2,2,0,0 here, inherited from check_operator_handoff,
  // and that is the wrong target for THIS hook. That one judges the message
  // text, so it can still tell there is something to refuse without git. This
  // one's judgement is entirely git-derived -- currentBranch() and
  // newSqlFiles() both shell out -- so with no git it cannot know the branch
  // adds any SQL at all, and refusing would be refusing on no evidence.
  const wt = makeWorktree();
  addSql(wt);
  const env = pathWithoutGit();

  assert.ok(
    spawnSync('git', ['--version'], { env }).error,
    'precondition: git must actually be unreachable on this PATH'
  );

  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(runHook(wt, { message: 'nope', sessionId: 'nogit', env }).code);
  assert.deepEqual(codes, [0, 0, 0, 0, 0], 'no evidence means no refusal');
});

test('with the cwd outside any git repo it stands aside', () => {
  const outside = scratchDir('norepo-');
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(runHook(outside, { message: 'nope', sessionId: 'norepo' }).code);
  assert.deepEqual(codes, [0, 0, 0, 0, 0]);
});

test('a half-written state file does not silently reset the counter', () => {
  // `undefined >= MAX_REFUSALS` is false, so a truncated file used to read as
  // "zero refusals so far" and hand back a fresh set of three, every turn. The
  // shapes are coerced now; this asserts the coercion, not the happy path.
  const wt = makeWorktree();
  addSql(wt);
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(gitDir, 'sql-handoff-junk.json'), '{"refusals":"three","handedOff":"nope"}');

  const codes = [];
  for (let i = 0; i < 5; i++) codes.push(runHook(wt, { message: 'nope', sessionId: 'junk' }).code);
  assert.deepEqual(codes, [2, 2, 2, 0, 0], 'a junk file must not become an unbounded refusal loop');
});

test('a hand-off arriving on a CONTINUATION turn is still recorded', () => {
  // The regression that sent PR #609 back to Rework on 2026-09-05.
  //
  // The stop_hook_active exit was placed at the very top of main(), before the
  // block that reads the reply and records what it handed off. But a
  // continuation turn is exactly where the hand-off arrives: the hook refuses,
  // the agent adds the block, and THAT turn carries the flag. So the reply that
  // solved the problem was never read, `handedOff` never persisted, and the
  // hook re-demanded the same file on every ordinary turn afterwards --
  // spending its whole three-refusal brake on SQL the operator already had.
  //
  // Measured on the branch with the exit at the top: 2,0,2,0,2,0.
  // Measured on main at 03340bba, which had no exit at all:  2,0,0,0,0,0.
  //
  // The flag must suppress the REFUSAL, not the LEARNING.
  const wt = makeWorktree();
  const file = addSql(wt);
  const block = renderBlock('add-revisions', file);

  const codes = [
    runHook(wt, { message: 'nope', sessionId: 'contlearn' }).code,
    runHook(wt, { message: block, sessionId: 'contlearn', stopHookActive: true }).code,
    runHook(wt, { message: 'Anything else?', sessionId: 'contlearn' }).code,
    runHook(wt, { message: block, sessionId: 'contlearn', stopHookActive: true }).code,
    runHook(wt, { message: 'Still nothing to hand off.', sessionId: 'contlearn' }).code,
    runHook(wt, { message: 'Nor here.', sessionId: 'contlearn' }).code,
  ];

  assert.deepEqual(
    codes,
    [2, 0, 0, 0, 0, 0],
    'the block arrived on t2 — re-demanding it on t3 means the continuation threw the reply away'
  );
});

test('the brake survives an ordinary hand-off, so a LATER new file is still caught', () => {
  // The consequence of the test above, and the reason it is a defect rather
  // than a nuisance: with the hand-off never recorded, three ordinary turns
  // exhaust the brake, and a brand new SQL file committed afterwards -- never
  // handed off, precisely what this hook exists for -- is missed in silence.
  //
  // Measured on the branch: 0 (MISSED). On main: 2 (caught).
  const wt = makeWorktree();
  const first = addSql(wt, 'add_first.sql');
  const block = renderBlock('add-revisions', first);

  runHook(wt, { message: 'nope', sessionId: 'brakeleft' });
  runHook(wt, { message: block, sessionId: 'brakeleft', stopHookActive: true });
  runHook(wt, { message: 'next turn', sessionId: 'brakeleft' });
  runHook(wt, { message: 'and another', sessionId: 'brakeleft' });

  addSql(wt, 'add_second.sql');
  const result = runHook(wt, { message: 'here you go', sessionId: 'brakeleft' });

  assert.equal(result.code, 2, 'a new, never-handed-off SQL file must still be caught');
  assert.match(result.stderr, /add_second\.sql/, 'and it must name the file that is outstanding');
});
