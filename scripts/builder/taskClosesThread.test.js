'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Charter Q1 — a thread exists only while its ClickUp task is open.
 *
 * `npm run thread` now requires and stamps a task id (`branch.<name>.clickup-
 * task`, plain git config — survives `git worktree remove`, readable from any
 * worktree since it lives in the shared .git/config). `npm run tidy` reads
 * that stamp back and cleans up a thread whose task has closed, even if its
 * commits never shipped — the one case the existing shipped-branch cleanup
 * could never reach, since `git cherry` correctly calls unshipped work
 * 'active' and protects it forever.
 *
 * `new_thread.cjs`/`repo_tidy.cjs` drive real git worktrees and a real
 * ClickUp API call — exercising them for real needs a throwaway repo AND a
 * throwaway ClickUp task, so the git-plumbing and script-wiring properties
 * are source-level assertions here (same reasoning as shipThread.test.js's
 * force-push guard), while `isTaskOpen`'s exit-code contract — the one
 * property where getting it wrong means silently deleting someone's
 * unshipped work — is driven for real against a scripted fake `npm`.
 */

const NEW_THREAD = path.join(__dirname, '..', 'new_thread.cjs');
const REPO_TIDY = path.join(__dirname, '..', 'repo_tidy.cjs');
const CLICKUP_DIRECT = path.join(__dirname, '..', 'clickup_direct.mjs');
const REPO_STATE = path.join(__dirname, '..', 'lib', 'repo_state.cjs');

function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const newThreadCode = withoutComments(fs.readFileSync(NEW_THREAD, 'utf8'));
const repoTidyCode = withoutComments(fs.readFileSync(REPO_TIDY, 'utf8'));
const clickupDirectCode = withoutComments(fs.readFileSync(CLICKUP_DIRECT, 'utf8'));

// ── new_thread.cjs: task id is required and stamped ─────────────────────────

test('a thread cannot be created without a task id', () => {
  assert.match(newThreadCode, /taskId\s*=\s*process\.argv\[3\]/, 'a second positional arg must be read');
  assert.match(newThreadCode, /if \(!taskId/, 'a missing task id must be rejected');
});

test('the task is confirmed open BEFORE any worktree is created', () => {
  const taskCheckIndex = newThreadCode.indexOf('task-open');
  const worktreeAddIndex = newThreadCode.indexOf("'worktree', 'add'");
  assert.ok(taskCheckIndex > -1, 'must call the task-open command');
  assert.ok(worktreeAddIndex > -1, 'must create the worktree');
  assert.ok(taskCheckIndex < worktreeAddIndex, 'the task check must run before git worktree add, not after');
});

test('a closed/unopenable task refuses to create the thread', () => {
  // The task-open check throws (non-zero exit) on anything but a confirmed
  // "open" — that failure must exit the script, not fall through and build
  // the worktree anyway.
  const checkBlock = newThreadCode.slice(
    newThreadCode.indexOf('task-open'),
    newThreadCode.indexOf("'worktree', 'add'")
  );
  assert.match(checkBlock, /catch/, 'the task-open call must be guarded');
  assert.match(checkBlock, /process\.exit\(1\)/, 'a failed check must stop the script');
});

test('the task id is stamped onto the branch AFTER the worktree exists, before anything else', () => {
  const worktreeAddIndex = newThreadCode.indexOf("'worktree', 'add'");
  const stampIndex = newThreadCode.indexOf("'config',"); // the actual git-config call, not the usage text mentioning the same words
  const npmCiIndex = newThreadCode.indexOf("'ci'");
  assert.ok(stampIndex > worktreeAddIndex, 'git config needs the branch ref to exist first');
  assert.ok(stampIndex < npmCiIndex, 'stamped before the (much slower) install step');
  assert.match(
    newThreadCode,
    /'config',\s*`branch\.\$\{topic\}\.clickup-task`,\s*taskId/,
    'must use the branch.<name>.clickup-task git-config namespace, matching what repo_state.cjs reads back'
  );
});

// ── repo_tidy.cjs: closed-task override exists and is properly gated ────────

test('repo_tidy imports and actually calls isTaskOpen', () => {
  assert.match(repoTidyCode, /isTaskOpen/, 'must import the shared classifier');
  assert.match(repoTidyCode, /taskStates\s*=\s*new Map/, 'must build a per-branch task-state lookup');
});

test('a closed task can override the shipped-only worktree gate, an unknown one cannot', () => {
  // The two decision lines: worktree removal, then branch deletion. Matched on
  // the `!closedTask &&` guard rather than on the whole line, because both
  // gates gained a `skipped.push(...)` on 2026-08-23 (they used to `continue`
  // silently) and the shape will keep moving. What must not move is that a
  // closed task can still get past a not-shipped state.
  assert.match(
    repoTidyCode,
    /if \(!closedTask && \(!state \|\| state\.state !== 'shipped'\)\)/,
    'closedTask must be able to pass the gate even when state is not shipped'
  );
  assert.match(
    repoTidyCode,
    /if \(!closedTask && \(!state \|\| state\.state === 'active'/,
    'closedTask must be able to pass the branch-delete gate even when state is active (unshipped)'
  );
  // 'unknown' must never satisfy `=== 'closed'`, so it can never take either path.
  assert.match(repoTidyCode, /taskStates\.get\([\w.]+\)\s*===\s*'closed'/);
});

test('neither gate skips silently — every branch it passes over is named', () => {
  // DOCTRINE 3.11: a skip that does not report is how a sweep gives a false
  // all-clear. On 2026-08-22 the ecosystem-svg worktree was passed over four
  // times and never once appeared in the output, so "Left alone: <other
  // things>" read as "nothing left to do".
  // A fixed window after each gate, not `[^}]+` — a template literal in the
  // message body carries its own `}` and would cut the window short.
  const starts = [...repoTidyCode.matchAll(/if \(!closedTask && \(!state/g)].map((m) => m.index);
  assert.equal(starts.length, 2, 'the two decision gates should both be found');
  for (const start of starts) {
    const gate = repoTidyCode.slice(start, start + 500);
    assert.match(gate, /skipped\.push/, 'a gate that passes a branch over must say why');
    assert.match(gate, /state\.reason/, 'and the reason comes from the classifier, not a guess');
    assert.doesNotMatch(
      gate.slice(0, gate.indexOf('skipped.push')),
      /continue;/,
      'nothing may `continue` before the report is pushed'
    );
  }
});

test("an 'unknown' branch state can never be deleted", () => {
  // 'unknown' means no signal could answer. Leaving it alone is the only safe
  // reading — 'active' would merely be wrong, 'shipped' would delete work.
  assert.match(
    repoTidyCode,
    /state\.state === 'unknown'/,
    'the branch-delete gate must exclude unknown explicitly'
  );
});

test('a closed-task deletion is logged distinctly from an ordinary shipped one', () => {
  assert.match(repoTidyCode, /ClickUp task \$\{branch\.clickupTaskId\} closed, never shipped/);
  assert.match(repoTidyCode, /deletedForClosedTask/);
});

// ── lib/repo_state.cjs: branchInventory carries the stamp; isTaskOpen is a
//    real three-way classifier, not a boolean ──────────────────────────────

test('branchInventory reads the stamp back via the same git-config key new_thread writes', () => {
  const source = fs.readFileSync(REPO_STATE, 'utf8');
  assert.match(source, /clickupTaskId/);
  assert.match(source, /branch\.\$\{name\}\.clickup-task/);
});

test('isTaskOpen is exported and reads a real git config value end to end', () => {
  // A real integration check, not a source grep — but it must NOT depend on
  // the checked-out branch: GitHub Actions checks a PR out as a DETACHED HEAD,
  // so `git branch --show-current` is empty in CI and an earlier version of
  // this test could never pass there (red on every run, unnoticed for days).
  // Instead, create a scratch branch REF off HEAD (no checkout needed, works
  // detached), stamp it, read it back through the real branchInventory(), and
  // delete it in finally. branchInventory() enumerates refs/heads via
  // for-each-ref, so a ref that is not checked out still appears.
  const { branchInventory } = require(REPO_STATE);
  const repoRoot = path.join(__dirname, '..', '..');
  const scratch = `tct-test-stamp-${process.pid}`;
  const key = `branch.${scratch}.clickup-task`;

  try {
    execFileSync('git', ['branch', '-f', scratch, 'HEAD'], { cwd: repoRoot });
    execFileSync('git', ['config', key, 'TEST_TASK_ID_12345'], { cwd: repoRoot });
    const entry = branchInventory().find((b) => b.name === scratch);
    assert.ok(entry, 'the stamped scratch branch must appear in the inventory');
    assert.equal(entry.clickupTaskId, 'TEST_TASK_ID_12345');
  } finally {
    try { execFileSync('git', ['config', '--unset', key], { cwd: repoRoot }); } catch { /* already gone */ }
    try { execFileSync('git', ['branch', '-D', scratch], { cwd: repoRoot }); } catch { /* already gone */ }
  }
});

/** A fake `npm` on PATH, so isTaskOpen's exit-code handling is driven for
 *  real without touching the network or a real ClickUp task. */
function withFakeNpmExitCode(code, fn, stdout = '') {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fake-npm-'));
  const fakeNpm = path.join(dir, 'npm');
  const emit = stdout ? `printf '%s' ${JSON.stringify(stdout)}\n` : '';
  fs.writeFileSync(fakeNpm, `#!/bin/sh\n${emit}exit ${code}\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('isTaskOpen: exit 0 (confirmed open) reads as open', () => {
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  withFakeNpmExitCode(0, () => {
    assert.equal(isTaskOpen('some-task'), 'open');
  });
});

test('isTaskOpen: exit 1 WITH the "open: false" marker reads as closed — the ONLY thing that authorizes a delete', () => {
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  withFakeNpmExitCode(1, () => {
    assert.equal(isTaskOpen('some-task'), 'closed');
  }, 'task:   x\nstatus: Live\ntype:   closed\nopen:   false\n');
});

test('BLOCKER: exit 1 WITHOUT the marker (npm/doppler own failure, offline) reads as UNKNOWN, never closed', () => {
  // The hazard: `npm run`, `doppler`, or a rejected fetch all exit 1 on their
  // OWN failure before the check confirms anything. Collapsing that into
  // "closed" would let `npm run tidy` on an offline machine delete every
  // stamped unshipped branch. Only the command's positive marker means closed.
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  withFakeNpmExitCode(1, () => {
    assert.equal(isTaskOpen('some-task'), 'unknown');
  }); // no stdout — a bare exit 1
});

test('isTaskOpen: exit 1 with UNRELATED stdout (no marker) is still unknown', () => {
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  withFakeNpmExitCode(1, () => {
    assert.equal(isTaskOpen('some-task'), 'unknown');
  }, 'npm ERR! something unrelated failed\n');
});

test('isTaskOpen: exit 3 (could not tell — network/auth/rate-limit) reads as unknown, NEVER closed', () => {
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  withFakeNpmExitCode(3, () => {
    assert.equal(isTaskOpen('some-task'), 'unknown');
  });
});

test('isTaskOpen: an unexpected exit code (not 0, 1, or 3) fails toward unknown, never toward closed', () => {
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  withFakeNpmExitCode(17, () => {
    assert.equal(isTaskOpen('some-task'), 'unknown');
  });
});

test('isTaskOpen: no stamp at all is unknown, and never even asks the network', () => {
  delete require.cache[REPO_STATE];
  const { isTaskOpen } = require(REPO_STATE);
  // No fake npm on PATH at all — if this called out, it would throw ENOENT
  // (a real crash) rather than quietly returning 'unknown'.
  assert.equal(isTaskOpen(''), 'unknown');
  assert.equal(isTaskOpen(null), 'unknown');
});

// ── clickup_direct.mjs: the three-way exit-code contract itself ─────────────

test('task-open uses three distinct exit codes: 0 open, 1 closed, 3 could-not-tell', () => {
  assert.match(clickupDirectCode, /process\.exit\(isOpen \? 0 : 1\)/);
  assert.match(clickupDirectCode, /process\.exit\(3\)/, 'the indeterminate path must use a THIRD code, never collapse into 1');
});

test('a 404 (task gone) is treated as closed (1), not as could-not-tell (3)', () => {
  const blockStart = clickupDirectCode.indexOf("cmd === 'task-open'");
  const blockEnd = clickupDirectCode.indexOf('const t = out.json;', blockStart);
  const notFoundBlock = clickupDirectCode.slice(blockStart, blockEnd);
  assert.ok(blockStart > -1 && blockEnd > blockStart, 'the task-open block must be found as a contiguous region');
  assert.match(notFoundBlock, /status === 404/);
  assert.match(notFoundBlock, /process\.exit\(1\)/);
});

test('closed detection reads status.type, not a status-NAME allowlist — thread is used against any ClickUp list', () => {
  assert.match(clickupDirectCode, /type\s*!==\s*'closed'\s*&&\s*type\s*!==\s*'done'/);
});

test('BLOCKER: a REJECTED fetch in task-open routes to exit 3, never falls through to exit 1', () => {
  // A network/DNS/TLS failure rejects the fetch; without a catch the script
  // dies on an unhandled rejection and node exits 1 — indistinguishable from
  // "confirmed closed". The task-open block must try/catch call() and exit 3.
  const blockStart = clickupDirectCode.indexOf("cmd === 'task-open'");
  const blockEnd = clickupDirectCode.indexOf('const t = out.json;', blockStart);
  const block = clickupDirectCode.slice(blockStart, blockEnd);
  assert.match(block, /try\s*{[\s\S]*await call\('GET'/, 'the task fetch must be inside a try');
  assert.match(block, /catch[\s\S]*process\.exit\(3\)/, 'a thrown fetch must exit 3 (could-not-tell), never 1');
});
