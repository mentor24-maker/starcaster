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
 * LOOP SAFETY -- TWO INDEPENDENT BRAKES
 * Three refusals per session, then it steps aside and lets the turn end; and
 * `stop_hook_active`, the harness's own infinite-loop flag, which it honours
 * outright. Two limits, so neither one failing alone can wedge the session. A
 * hook that can wedge a conversation shut is worse than the miss it prevents.
 *
 * The flag stands the REFUSAL down; it does not stand the READING down, and
 * the order is load-bearing. A continuation turn is where the hand-off block
 * arrives, so a hook that exits before reading the reply throws away the very
 * turn that solved it -- see the comment at the check itself for the six turns
 * that measured it. The sibling hook has no such ordering to get wrong,
 * because it keeps no state between turns.
 *
 * The refusal counter depends on the state file actually being written, and
 * that has failed twice for two different reasons:
 *
 *   - WHERE: from 2026-08-19 until 2026-09-03 the path was built from
 *     `--show-toplevel`, and `.git` is a FILE in a linked worktree, so every
 *     write died of ENOTDIR. Fixed by lib/hook_state_dir.cjs.
 *   - WHETHER: the directory can resolve perfectly and still refuse the write
 *     -- a read-only mount, permissions, a full disk. Measured 2026-09-04 with
 *     the git dir chmod 500: the hook refused six turns out of six, and would
 *     have refused six hundred. Same wedge, different cause.
 *
 * So the counter now has somewhere to fall back to, and -- the part that
 * actually closes it -- A REFUSAL IS ONLY ISSUED IF THE COUNT LANDED. A hook
 * that cannot count its own refusals has no brake, and the honest response to
 * that is to let the turn end, not to refuse forever.
 *
 * Escape hatch: SKIP_SQL_HANDOFF=1 (say so and why, per CLAUDE.md).
 */

const fs = require('fs');
const os = require('os');
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

/**
 * Every place this session's state may live, best first.
 *
 * The git dir is the right home: per-worktree, which is the grain sessions
 * actually have, and it is thrown away with the worktree. `os.tmpdir()` is a
 * worse place -- machine-wide, survives the worktree, swept on the OS's
 * schedule rather than ours -- and it is infinitely better than nowhere, which
 * is what "no brake at all" means. It is only ever reached when the git dir
 * refuses the write; the session id keys the filename, so two sessions sharing
 * the fallback still keep separate state.
 */
function stateFiles(root, sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  const files = [];
  for (const dir of [gitStateDir(root), os.tmpdir()]) {
    if (!dir) continue;
    const file = path.join(dir, `sql-handoff-${safe}.json`);
    if (!files.includes(file)) files.push(file);
  }
  return files;
}

/**
 * Read from the first candidate that actually has state. Scanning in the same
 * order it writes is what keeps the two halves together: if the git dir is
 * readable but not writable, the write lands in tmpdir, and the next turn finds
 * nothing in the git dir and picks it up from there.
 *
 * Shapes are coerced rather than trusted -- a truncated or half-written file
 * parses to something with no `refusals`, and `undefined >= 3` is false, which
 * is the counter silently reading zero all over again.
 */
function readState(files) {
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        handedOff: Array.isArray(parsed?.handedOff) ? parsed.handedOff : [],
        refusals: Number.isFinite(parsed?.refusals) ? parsed.refusals : 0,
      };
    } catch {
      // Not here, or unreadable -- try the next place.
    }
  }
  return { handedOff: [], refusals: 0 };
}

/**
 * Returns whether the state landed ANYWHERE. The caller must check it before
 * refusing: this used to swallow the failure and return nothing, and that one
 * missing boolean is the whole of the wedge described in the header. A write
 * that never lands means `refusals` reads 0 next turn, so the stand-down can
 * never fire, and `handedOff` never persists, so a file already handed off is
 * re-demanded for the rest of the session.
 */
function writeState(files, state) {
  for (const file of files) {
    try {
      fs.writeFileSync(file, JSON.stringify(state));
      return true;
    } catch {
      // Unwritable -- try the next place rather than losing the count.
    }
  }
  return false;
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

  const sqlFiles = newSqlFiles(root);
  if (!sqlFiles.length) process.exit(0);

  // Nowhere at all to keep state means no refusal counter, and a hook that
  // refuses with no limit is the wedged conversation this file's header calls
  // worse than the miss it prevents. So stand aside instead.
  //
  // Reaching this needs BOTH the git dir and the temp dir to come back empty,
  // which is close to unreachable -- `repoRoot()` above shells out to the same
  // git binary and has already exited 0 if it was not there. The case that
  // actually bites is a directory that resolves and then refuses the write,
  // and that is handled at the refusal below, not here.
  const files = stateFiles(root, payload?.session_id);
  if (!files.length) process.exit(0);

  const state = readState(files);

  const message = String(payload?.last_assistant_message || '');

  // Anything handed off in this reply is now handed off for good.
  for (const sql of sqlFiles) {
    if (messageHandsOff(message, branch, sql) && !state.handedOff.includes(sql)) {
      state.handedOff.push(sql);
    }
  }

  const outstanding = sqlFiles.filter((sql) => !state.handedOff.includes(sql));
  if (!outstanding.length) {
    writeState(files, state);
    process.exit(0);
  }

  // The harness's OWN infinite-loop guard: it sets this when the turn is
  // continuing because a Stop hook already blocked it once. Honouring it is
  // what makes the refusal counter the SECOND brake rather than the only one,
  // so neither failing alone can wedge the session.
  //
  // IT SUPPRESSES THE REFUSAL, NOT THE LEARNING, AND THAT IS WHY IT IS HERE
  // RATHER THAN AT THE TOP OF main(). A continuation turn is exactly where the
  // hand-off arrives -- this hook refuses, the agent adds the block, and THAT
  // turn carries the flag. Exiting before the loop above reads the reply threw
  // the solving turn away: `handedOff` never persisted, the same file was
  // re-demanded on every ordinary turn after it, and the whole three-refusal
  // brake was spent on SQL the operator already had. Measured over the six-turn
  // dance, 2026-09-05: 2,0,2,0,2,0 with the exit at the top, against 2,0,0,0,0,0
  // with it here. A new SQL file committed afterwards was then missed in
  // silence, which is this hook failing at its actual job.
  //
  // check_operator_handoff.cjs can exit at the top and does, because it keeps
  // no per-file state -- it judges message text and nothing else, so a
  // continuation costs it nothing. This one carries `handedOff` and has
  // something to lose.
  //
  // This ordering also settles the asymmetry recorded at
  // check_operator_handoff.cjs:124. That hook has honoured the flag all along
  // and this one did not, so whenever this one blocked first, the next Stop
  // carried the flag, the sibling exited immediately, and a reply with BOTH
  // problems only ever got the SQL complaint. Both hooks now stand down
  // together on a continuation, which is the safe direction for the same reason
  // it was there: a miss, not a wedge.
  if (payload?.stop_hook_active) {
    writeState(files, state);
    process.exit(0);
  }

  if (state.refusals >= MAX_REFUSALS) {
    // Stepped aside deliberately: a wedged conversation is worse than a miss.
    writeState(files, state);
    process.exit(0);
  }

  // Claim a refusal slot, and only refuse if the claim actually persisted. If
  // it did not land anywhere, this refusal cannot be counted, so the next turn
  // would refuse again, and the one after that, with no limit -- which is the
  // exact wedge the counter exists to prevent, arriving through the counter.
  state.refusals += 1;
  if (!writeState(files, state)) process.exit(0);

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
