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
 * force-push guard), while `isTaskOpen`'s three-way reading — the one
 * property where getting it wrong means silently deleting someone's
 * unshipped work — is driven for real against a scripted fake `npm` that,
 * like the real ticket door, answers ONLY `get` (SC-875: the old check asked
 * a door command that no longer exists, and every ticket read as closed).
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

test('the ticket is confirmed open BEFORE any worktree is created', () => {
  const taskCheckIndex = newThreadCode.indexOf('readTicketOpenState(taskId)');
  const worktreeAddIndex = newThreadCode.indexOf("'worktree', 'add'");
  assert.ok(taskCheckIndex > -1, 'must read the ticket through the shared reading');
  assert.ok(worktreeAddIndex > -1, 'must create the worktree');
  assert.ok(taskCheckIndex < worktreeAddIndex, 'the ticket check must run before git worktree add, not after');
});

test('anything but a confirmed open ticket stops the script before the worktree', () => {
  const checkBlock = newThreadCode.slice(
    newThreadCode.indexOf('readTicketOpenState(taskId)'),
    newThreadCode.indexOf("'worktree', 'add'")
  );
  assert.match(checkBlock, /state === 'closed'[\s\S]*process\.exit\(1\)/, 'a closed ticket must stop the script');
  assert.match(checkBlock, /state !== 'open'[\s\S]*process\.exit\(2\)/, 'a could-not-tell must stop it too, with its own code');
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

/** A fake `npm` on PATH that behaves like the real ticket door: it answers
 *  `get --task <id>` with `stdout` and `code`, and refuses every other
 *  command with usage text and exit 1. So a caller that asks a command the
 *  door does not have reads as unknown here, exactly as it would for real. */
function withFakeDoor({ code = 0, stdout = '', stderr = '' }, fn) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fake-npm-'));
  const fakeNpm = path.join(dir, 'npm');
  fs.writeFileSync(path.join(dir, 'out'), stdout);
  fs.writeFileSync(path.join(dir, 'err'), stderr);
  fs.writeFileSync(fakeNpm, [
    '#!/bin/sh',
    'for a in "$@"; do if [ "$a" = "get" ]; then',
    `  cat '${dir}/out'`,
    `  cat '${dir}/err' >&2`,
    `  exit ${code}`,
    'fi; done',
    "echo 'usage: clickup.mjs <command> ...' >&2",
    'exit 1',
    '',
  ].join('\n'), { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ticket = (id, status, ended) =>
  `> starcaster@1.0.0 clickup\n\nid:       ${id}\nname:     A ticket\nstatus:   ${status}\nended:    ${ended}\nurl:      http://127.0.0.1:4180/tickets/${id}\n---\n`;

function freshIsTaskOpen() {
  delete require.cache[REPO_STATE];
  return require(REPO_STATE).isTaskOpen;
}

test('isTaskOpen: an open ticket reads as open', () => {
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ stdout: ticket('SC-1', 'building', '(still open)') }, () => {
    assert.equal(isTaskOpen('SC-1'), 'open');
  });
});

test('isTaskOpen: a Live ticket reads as closed — the ONLY thing (with an ended ticket) that authorizes a delete', () => {
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ stdout: ticket('SC-1', 'live', '(none)') }, () => {
    assert.equal(isTaskOpen('SC-1'), 'closed');
  });
});

test('isTaskOpen: a ticket with an outcome on its ended: line reads as closed', () => {
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ stdout: ticket('SC-1', 'queued', 'wont-do') }, () => {
    assert.equal(isTaskOpen('SC-1'), 'closed');
  });
});

test('BLOCKER: a ticket the tracker does not know (404) is UNKNOWN, never closed', () => {
  // A typo'd id, or an old ClickUp-era stamp: deleting unshipped work on that
  // would be the worst possible reading of "I have never heard of it".
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ code: 1, stderr: 'read the task FAILED — HTTP 404\nno ticket SC-99999.\n' }, () => {
    assert.equal(isTaskOpen('SC-99999'), 'unknown');
  });
});

test('BLOCKER: a bare exit 1 (npm/doppler own failure, offline) reads as UNKNOWN, never closed', () => {
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ code: 1 }, () => {
    assert.equal(isTaskOpen('SC-1'), 'unknown');
  });
});

test('isTaskOpen: an unexpected exit code fails toward unknown, never toward closed', () => {
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ code: 17, stdout: ticket('SC-1', 'live', '(none)') }, () => {
    assert.equal(isTaskOpen('SC-1'), 'unknown');
  });
});

test('isTaskOpen: an answer about a DIFFERENT ticket is unknown, even when that one is Live', () => {
  const isTaskOpen = freshIsTaskOpen();
  withFakeDoor({ stdout: ticket('SC-33', 'live', '(none)') }, () => {
    assert.equal(isTaskOpen('86bbggvud'), 'unknown');
  });
});

test('isTaskOpen: no stamp at all is unknown, and never even asks the tracker', () => {
  const isTaskOpen = freshIsTaskOpen();
  // No fake npm on PATH at all — if this called out, it would reach the real
  // door; an empty id must return before that.
  assert.equal(isTaskOpen(''), 'unknown');
  assert.equal(isTaskOpen(null), 'unknown');
});

// ── new_thread.cjs, run for real: it stops BEFORE git is touched, so a closed
//    or unreadable ticket can be driven end to end without making anything ─

function runNewThread(door) {
  return withFakeDoor(door, () => {
    const { spawnSync } = require('node:child_process');
    return spawnSync(process.execPath, [NEW_THREAD, `tct-never-made-${process.pid}`, 'SC-1'], {
      encoding: 'utf8',
      env: process.env,
    });
  });
}

test('npm run thread on a Live ticket refuses with "not open" and exit 1', () => {
  const res = runNewThread({ stdout: ticket('SC-1', 'live', '(none)') });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /Ticket SC-1 is not open/);
  assert.match(res.stderr, /nothing was created/);
});

test('npm run thread on a ticket it cannot read says COULD NOT READ, names the reason, exit 2 — never "not open"', () => {
  const res = runNewThread({ code: 1, stderr: 'read the task FAILED — HTTP 404\nno ticket SC-1.\n' });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /Could not read ticket SC-1 from the tracker/);
  assert.match(res.stderr, /HTTP 404/, 'the reason is named');
  assert.doesNotMatch(res.stderr, /is not open/);
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
