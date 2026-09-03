#!/usr/bin/env node
'use strict';

/**
 * Claude Code Stop hook — enforces DOCTRINE.md §6.5.
 *
 * If this branch introduces a docs/SQL/*.sql file and the reply that is about
 * to be delivered does not hand it off in the SQL handoff block, refuse the
 * stop and say so. Exit 2 blocks the stop and shows stderr to the agent.
 *
 * WHY A STOP HOOK AND NOT A PRE-COMMIT CHECK
 * The failure is "the turn ended without the block". Pre-commit cannot see the
 * message; CI cannot see it either. `last_assistant_message` on the Stop event
 * is the only place that fact exists, so this is the only layer that can catch
 * it. §6.5 was binding for two days and still got missed by an agent that had
 * read it -- attention is not a control.
 *
 * ONCE PER FILE PER SESSION
 * State lives in sql-handoff-<session>.json inside the git dir -- see
 * lib/hook_state_dir.cjs for why that is NOT `<toplevel>/.git/`. A file that
 * has been handed off stays handed off for the rest of the session, so
 * follow-up turns are not held hostage to repeating a block the operator
 * already has.
 *
 * LOOP SAFETY
 * Three refusals per session, then it steps aside and lets the turn end. A
 * hook that can wedge a conversation shut is worse than the miss it prevents.
 * Both halves of that depend on the state file actually being written: from
 * 2026-08-19 until 2026-09-03 it never was, in any worktree, because the path
 * was built from `--show-toplevel` and `.git` is a FILE there. Measured in five
 * real sessions -- every one of them in a worktree.
 *
 * Escape hatch: SKIP_SQL_HANDOFF=1 (say so and why, per CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');
const {
  newSqlFiles,
  currentBranch,
  repoRoot,
  isPushed,
  renderBlock,
  messageHandsOff,
} = require('../lib/sql_handoff.cjs');
const { gitStateDir } = require('../lib/hook_state_dir.cjs');

const MAX_REFUSALS = 3;

function stateFile(gitDir, sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  return path.join(gitDir, `sql-handoff-${safe}.json`);
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { handedOff: [], refusals: 0 };
  }
}

function writeState(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Swallowed on purpose -- but do NOT read this as harmless. The comment
    // here used to say "at worst one extra prompt", and that sentence is what
    // let the ENOTDIR bug above live for two weeks: a write that never lands
    // means `refusals` reads 0 forever, so the stand-down cannot fire, and
    // `handedOff` never persists, so a file already handed off is re-demanded
    // every turn. The state file is the ONLY thing standing between this hook
    // and a wedged conversation. Losing it costs the brake, not a prompt.
  }
}

function main(input) {
  if (process.env.SKIP_SQL_HANDOFF === '1') process.exit(0);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable — never wedge the session
  }

  const cwd = String(payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const root = repoRoot(cwd);
  if (!root) process.exit(0);

  const branch = currentBranch(root);
  // On main there is no branch-qualified URL to give, and §6.5's whole point
  // is the branch. Nothing to enforce here.
  if (!branch || branch === 'main' || branch === 'HEAD') process.exit(0);

  const files = newSqlFiles(root);
  if (!files.length) process.exit(0);

  // No git dir means no state, which means no refusal counter -- and a hook
  // that refuses with no limit is the wedged conversation this file's header
  // calls worse than the miss it prevents. So stand aside instead. In practice
  // this is unreachable: `repoRoot()` above shells out to the same git binary
  // and already exited 0 if it was not there.
  const gitDir = gitStateDir(root);
  if (!gitDir) process.exit(0);

  const file = stateFile(gitDir, payload?.session_id);
  const state = readState(file);

  const message = String(payload?.last_assistant_message || '');

  // Anything handed off in this reply is now handed off for good.
  for (const sql of files) {
    if (messageHandsOff(message, branch, sql) && !state.handedOff.includes(sql)) {
      state.handedOff.push(sql);
    }
  }

  const outstanding = files.filter((sql) => !state.handedOff.includes(sql));
  if (!outstanding.length) {
    writeState(file, state);
    process.exit(0);
  }

  if (state.refusals >= MAX_REFUSALS) {
    // Stepped aside deliberately: a wedged conversation is worse than a miss.
    writeState(file, state);
    process.exit(0);
  }

  state.refusals += 1;
  writeState(file, state);

  const pushed = isPushed(root);
  const lines = [
    `BLOCKED: this branch adds SQL the operator has to run, and your reply did not hand it off.`,
    ``,
    `DOCTRINE.md §6.5: SQL goes to him as the SQL handoff block with a`,
    `branch-qualified GitHub URL — never a repo-relative path (his editor is on`,
    `main, where the file does not exist yet) and never pasted statements.`,
    ``,
    `Outstanding: ${outstanding.join(', ')}`,
    ``,
  ];

  if (!pushed) {
    lines.push(
      `First push the branch, or the URL is a 404:`,
      `  git push -u origin ${branch}`,
      ``,
      `Then add to your reply, as PLAIN TEXT (never inside a code fence — a fence`,
      `makes the link unclickable, which defeats the whole handoff), with two`,
      `blank lines above and below:`,
      ``
    );
  } else {
    lines.push(
      `Add to your reply, as PLAIN TEXT (never inside a code fence — a fence makes`,
      `the link unclickable, which defeats the whole handoff), with two blank`,
      `lines above and below:`,
      ``
    );
  }

  for (const sql of outstanding) {
    lines.push(renderBlock(branch, sql), ``);
  }

  lines.push(
    `Also say in one line, outside the block, what it changes and whether it`,
    `touches anything that already exists — that is what tells him it is safe.`,
    `One block per file, in run order.`,
    ``,
    `(Deliberate one-off override: SKIP_SQL_HANDOFF=1.)`
  );

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
