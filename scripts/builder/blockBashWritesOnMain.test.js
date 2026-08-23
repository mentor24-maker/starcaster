'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * The Bash-on-main guard hook must decide from where the command ACTUALLY
 * runs (payload.cwd), not the session-start folder — otherwise it blocks
 * legitimate in-worktree writes, the false positive loop-review proved on
 * 2026-08-22 (a session that cd'd into a worktree once and then ran plain
 * relative-path writes). These drive the real hook as a subprocess.
 */

const HOOK = path.join(__dirname, '..', 'hooks', 'block_bash_writes_on_main.cjs');

function tempRepo(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainguard-'));
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  return dir;
}

/** Run the hook with a payload; return its exit code (0 allow, 2 block). */
function runHook(payload, env = {}) {
  try {
    execFileSync('node', [HOOK], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (err) {
    return err.status;
  }
}

test('cwd on a WORKTREE (topic branch) allows a source write, even when the session started on main', () => {
  const mainDir = tempRepo('main');
  const worktreeDir = tempRepo('topic');
  try {
    const code = runHook(
      { cwd: worktreeDir, tool_input: { command: 'cp /tmp/x scripts/builder/mainGuard.js' } },
      { CLAUDE_PROJECT_DIR: mainDir },
    );
    assert.equal(code, 0, 'an in-worktree source write must NOT be blocked (the 2026-08-22 false positive)');
  } finally {
    fs.rmSync(mainDir, { recursive: true, force: true });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
});

test('cwd on MAIN blocks a source write', () => {
  const mainDir = tempRepo('main');
  try {
    const code = runHook(
      { cwd: mainDir, tool_input: { command: 'cat > routes/x.js <<EOF' } },
      { CLAUDE_PROJECT_DIR: mainDir },
    );
    assert.equal(code, 2, 'a source write on main must be blocked');
  } finally {
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});

test('cwd on main allows a harmless (non-source-write) command', () => {
  const mainDir = tempRepo('main');
  try {
    assert.equal(runHook({ cwd: mainDir, tool_input: { command: 'git status' } }, { CLAUDE_PROJECT_DIR: mainDir }), 0);
  } finally {
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});

test('ALLOW_MAIN_EDITS=1 bypasses even a source write on main', () => {
  const mainDir = tempRepo('main');
  try {
    assert.equal(
      runHook({ cwd: mainDir, tool_input: { command: 'cat > lib/x.js <<EOF' } }, { CLAUDE_PROJECT_DIR: mainDir, ALLOW_MAIN_EDITS: '1' }),
      0,
    );
  } finally {
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});

test('falls back to CLAUDE_PROJECT_DIR when the payload carries no cwd', () => {
  const mainDir = tempRepo('main');
  try {
    // No cwd in payload → uses CLAUDE_PROJECT_DIR (main) → blocks the write.
    assert.equal(runHook({ tool_input: { command: 'cat > lib/x.js <<EOF' } }, { CLAUDE_PROJECT_DIR: mainDir }), 2);
  } finally {
    fs.rmSync(mainDir, { recursive: true, force: true });
  }
});
