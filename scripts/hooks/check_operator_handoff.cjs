#!/usr/bin/env node
'use strict';

/**
 * Claude Code Stop hook -- the operator hand-off tripwire.
 * Enforces CLAUDE.md "CC runs the operational commands" / DOCTRINE.md §6.9.
 *
 * If the reply about to be delivered hands Dane a fenced command that CC could
 * have run itself, and does not name one of the four exceptions, refuse the
 * stop and say so. Exit 2 blocks the stop and shows stderr to the agent.
 *
 * WHY A STOP HOOK AND NOT A PRE-COMMIT CHECK
 * The failure is "the turn ended with a command block in it". Pre-commit
 * cannot see the message and neither can CI; the reply is the only place that
 * fact exists. Same reasoning as require_sql_handoff.cjs, and the same shape.
 *
 * INTERACTIVE SESSIONS ONLY
 * A hand-off is only a hand-off if somebody is being handed something. The
 * loops run headless (`entrypoint: "sdk-cli"`) and report to a ticket, so
 * there is no operator at the other end and nothing to protect. Only `cli`
 * -- a terminal Dane is sitting in front of -- can trip this.
 *
 * IT FAILS OPEN, ON PURPOSE
 * If the transcript cannot be read, or the entrypoint cannot be determined,
 * this steps aside. That is the opposite of the pipeline switch's fail-safe
 * and the asymmetry is genuinely reversed here: a wrong refusal wedges a turn
 * and can strand an unattended pass in `Building`, while a miss just leaves
 * the written rule doing the work it was already doing. Three refusals per
 * session, then it stands down for the same reason.
 *
 * Escape hatch: SKIP_OPERATOR_HANDOFF=1 (say so and why, per CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');
const {
  offendingCommands,
  statedException,
  lastAssistantTurn,
  isInteractive,
  stateDir,
  refusalMessage,
} = require('../lib/operator_handoff.cjs');

const MAX_REFUSALS = 3;

function stateFile(gitDir, sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  return path.join(gitDir, `operator-handoff-${safe}.json`);
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { refusals: 0 };
  }
}

function writeState(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Best-effort: losing the state costs at worst one extra refusal.
  }
}

function main(input) {
  if (process.env.SKIP_OPERATOR_HANDOFF === '1') process.exit(0);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable -- never wedge the session
  }

  // Only the main agent's Stop event. A subagent's reply is read by this
  // session, not by Dane.
  if (payload && payload.hook_event_name && payload.hook_event_name !== 'Stop') {
    process.exit(0);
  }

  const turn = lastAssistantTurn(payload && payload.transcript_path);

  // The harness may hand the message over directly; prefer it when it is
  // there, and fall back to what the transcript says.
  const direct = payload && payload.last_assistant_message;
  const message = (typeof direct === 'string' && direct.trim())
    ? direct
    : (turn && turn.text) || '';

  // Cannot tell who is reading -> step aside. See "IT FAILS OPEN" above.
  const entrypoint = turn && turn.entrypoint;
  if (!entrypoint) process.exit(0);
  if (!isInteractive(entrypoint)) process.exit(0);

  if (!message.trim()) process.exit(0);

  const offenders = offendingCommands(message);
  if (!offenders.length) process.exit(0);

  // The exception line is the sanctioned way through.
  if (statedException(message)) process.exit(0);

  const cwd = String((payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const dir = stateDir(cwd);

  if (dir) {
    const file = stateFile(dir, payload && payload.session_id);
    const state = readState(file);
    if (state.refusals >= MAX_REFUSALS) {
      // Stood down deliberately: a wedged conversation is worse than a miss.
      process.exit(0);
    }
    state.refusals += 1;
    writeState(file, state);
  }

  process.stderr.write(refusalMessage(offenders) + '\n');
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
