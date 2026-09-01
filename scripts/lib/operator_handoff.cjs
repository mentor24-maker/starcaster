'use strict';

/**
 * Shared logic for the operator hand-off tripwire (CLAUDE.md "CC runs the
 * operational commands"; DOCTRINE.md §6.9).
 *
 * WHY THIS IS CODE AND NOT A REMINDER
 * "CC runs the operational commands; handing Dane a command is itself a claim
 * that CC cannot run it" has been written down three times -- 2026-08-07,
 * 08-23 and 08-30 -- and broken three times, twice by sessions that had read
 * the rule that day. A rule that depends on being remembered is not a control,
 * it is a hope. This module is the tripwire, in the same family as
 * check_conventions, check:syntax and the terminology guard.
 *
 * Used by:
 *   - scripts/hooks/check_operator_handoff.cjs   (Stop hook -- refuses the turn)
 *
 * The logic lives here rather than in the hook so the tests can drive the
 * decision directly as well as through the real hook process, the same split
 * as lib/sql_handoff.cjs.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

/**
 * The four exceptions named in CLAUDE.md. A hand-off is legitimate ONLY when
 * the reply says which of these applies -- that is the whole contract: not
 * "may I hand this over" but "name the reason out loud".
 */
const EXCEPTIONS = ['secret value', 'billing', 'browser login', 'decision'];

/**
 * `npm run pipeline -- resume` is operator-only by doctrine: an agent may
 * PAUSE the line (a safety move anyone should be able to make) but only Dane
 * hands the deck back. Handing him that one command is correct, so it must
 * never trip the wire.
 */
function isOperatorOnlyNpm(line) {
  return /^npm\s+run\s+pipeline\s+--\s+resume\b/.test(line);
}

/**
 * The command shapes that mean "an operational command was handed over".
 * Each one is something CC runs itself in this repo every day.
 */
const HANDOFF_RULES = [
  { name: 'doppler run', test: (l) => /^doppler\s+run\b/.test(l) },
  // `ssh host ...` and `ssh -p ... host`, but NOT ssh-keygen/ssh-add, which
  // are local key work rather than a hand-off to another machine.
  { name: 'ssh', test: (l) => /^ssh(\s|$)/.test(l) },
  { name: 'npm run', test: (l) => /^npm\s+run\b/.test(l) && !isOperatorOnlyNpm(l) },
  { name: 'node scripts/', test: (l) => /^node\s+scripts\//.test(l) },
  // The copy-paste preamble. Any path that names the repo counts -- the point
  // is the shape "cd somewhere && do a thing", not one machine's layout.
  { name: 'the cd-preamble', test: (l) => /^cd\s+[^\s&|;]*starcaster[^\s&|;]*\s*&&/.test(l) },
];

/**
 * Split a message into fenced code blocks and the prose around them.
 *
 * Fenced blocks are the only thing that counts. An inline `npm run doctor` in
 * backticks is a REFERENCE -- naming a command while explaining something --
 * and the rule has never been against mentioning a command. It is against
 * handing one over ready to paste, which is what a fence is for.
 */
function splitFences(message) {
  const lines = String(message == null ? '' : message).split(/\r?\n/);
  const blocks = [];
  const prose = [];
  let open = null;

  for (const raw of lines) {
    const marker = /^(`{3,}|~{3,})(.*)$/.exec(raw.trim());
    if (open) {
      // A closing fence uses the same character, is at least as long, and
      // carries nothing after it. Anything else is body.
      if (marker && marker[1][0] === open.char && marker[1].length >= open.len
          && marker[2].trim() === '') {
        blocks.push(open.body.join('\n'));
        open = null;
      } else {
        open.body.push(raw);
      }
      continue;
    }
    if (marker) {
      open = { char: marker[1][0], len: marker[1].length, body: [] };
      continue;
    }
    prose.push(raw);
  }

  // An unterminated fence still counts. The block was still written down, and
  // a truncated reply is not a reason to let a hand-off through.
  if (open) blocks.push(open.body.join('\n'));

  return { blocks, prose };
}

/** The first line with anything on it. Kept for callers that want just that. */
function firstCommandLine(block) {
  for (const line of String(block == null ? '' : block).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * `$ doppler run ...` is still a hand-off; strip a pasted shell prompt.
 *
 * `$` and `%` only. `>` used to be in this set and had to come out: it is
 * npm's own output marker, so with every line of a fence now judged, a pasted
 * run log ("> starcaster@1.0.0 clickup" / "> doppler run --project ...") read
 * as a hand-off of the very command whose OUTPUT was being reported. Nobody
 * hands over a command wearing a `>` prompt, so this costs nothing real.
 */
function stripPrompt(line) {
  return line.replace(/^[$%]\s+/, '');
}

/**
 * Strip any leading `VAR=value ` assignments so the command underneath is what
 * gets judged.
 *
 * `UI_HARNESS_BASE_URL=http://localhost:3057 npm run check:panels` is a
 * hand-off wearing a hat -- and it is the exact shape CLAUDE.md itself prints,
 * so it is among the likeliest to be pasted at Dane. Every rule below is
 * start-anchored, so without this peel the prefix hides the command completely.
 *
 * Peeled one assignment at a time rather than with one greedy pattern, so
 * `FOO=1 BAR=2 npm run x` comes all the way down to `npm run x`.
 */
function stripEnvPrefix(line) {
  let out = String(line == null ? '' : line);
  for (;;) {
    const next = out.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)[ \t]+/, '');
    if (next === out) return out;
    out = next;
  }
}

/**
 * Every command handed over in a fenced block in this message.
 * Returns [{ command, rule }].
 *
 * EVERY LINE OF A BLOCK IS JUDGED, NOT ONLY THE FIRST.
 * The first draft keyed off the first non-blank line, which let the exact
 * hand-off shape CLAUDE.md itself prints walk straight through -- a setup line
 * followed by the real command:
 *
 *     PORT=3058 node server.js
 *     UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:render
 *
 * `node server.js` is not a hand-off, so the block was judged clean and the
 * `npm run` under it was never looked at.
 *
 * The worry about widening it is false positives on pasted OUTPUT, so it was
 * measured rather than argued: across 11,803 real assistant messages in this
 * project's transcripts, every-line scanning flagged exactly the same 152
 * messages as first-line scanning -- zero newly refused. (Control: on the
 * three synthetic shapes above the two disagree, so the instrument can tell
 * them apart; the agreement on real messages is a reading, not a broken test.)
 * The one output shape that did read as a hand-off was npm's `>` log prefix,
 * which is why stripPrompt no longer treats `>` as a shell prompt.
 */
function offendingCommands(message) {
  const { blocks } = splitFences(message);
  const found = [];
  for (const block of blocks) {
    for (const raw of String(block == null ? '' : block).split(/\r?\n/)) {
      const line = stripEnvPrefix(stripPrompt(raw.trim()));
      if (!line) continue;
      const rule = HANDOFF_RULES.find((r) => r.test(line));
      if (rule) found.push({ command: line, rule: rule.name });
    }
  }
  return found;
}

/**
 * The stated exception, or null. Checked in the PROSE only: an `Exception:`
 * line inside a code fence is part of an example, not a claim the reply is
 * making. Markdown emphasis is tolerated (`**Exception:** decision`) because
 * that is how these actually get written.
 */
function statedException(message) {
  const { prose } = splitFences(message);
  for (const raw of prose) {
    // Leading list/quote markers first, THEN emphasis. A hyphen bullet is a
    // normal way to write this line, and being refused while correctly naming
    // an exception is the surest way to send an agent to the escape hatch for
    // no reason -- so `-`, `+`, `*` and `>` all have to lead a valid claim.
    // Only the LEADING run is peeled: a hyphen inside the text survives.
    const line = raw.replace(/^[\s>*_+-]+/, '').replace(/[*_>`]/g, '').trim();
    const match = /^Exception:\s*(.+)$/i.exec(line);
    if (!match) continue;
    const rest = match[1].trim().toLowerCase();
    const hit = EXCEPTIONS.find((e) => rest.startsWith(e));
    if (hit) return hit;
  }
  return null;
}

/**
 * The last assistant message that actually said something, plus the session's
 * entrypoint, read from the transcript the harness points at.
 *
 * Walks BACKWARDS and skips records with no text: the final assistant record
 * is very often a bare tool_use, so "the last record" and "the last message"
 * are different things, and only one of them is what the operator read.
 */
function lastAssistantTurn(transcriptPath) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n');
  let entrypoint = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entrypoint && typeof record.entrypoint === 'string') entrypoint = record.entrypoint;
    if (record.type !== 'assistant') continue;

    const content = record.message && record.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (text) return { text, entrypoint };
  }

  return entrypoint ? { text: '', entrypoint } : null;
}

/**
 * Is there an operator at the other end of this turn?
 *
 * `cli` is a terminal session Dane is sitting in front of. `sdk-cli` is a
 * headless run -- the build and review loops, whose reply goes to a ClickUp
 * ticket rather than to a person waiting on a prompt. Measured across 25
 * transcripts in this project on 2026-08-31: every loop-build and loop-review
 * session was `sdk-cli`, and the only `cli` one was a `/loop` Dane started at
 * his own terminal, where he IS reading.
 *
 * This is the constraint "must not fire where there is no operator reading",
 * answered from a real signal rather than by scoping it away.
 */
function isInteractive(entrypoint) {
  return entrypoint === 'cli';
}

/**
 * Where the per-session refusal counter lives.
 *
 * NOT `<toplevel>/.git/` -- that is only a directory in the MAIN checkout. In
 * a worktree `.git` is a one-line FILE pointing at the real git dir, so
 * writing a state file under it fails with ENOTDIR. The write is wrapped in a
 * try/catch, so the failure is silent, and the effect is that the
 * three-refusal stand-down never engages. Every thread here runs in a
 * worktree, so that is the case that matters: the safety valve would have been
 * inoperative exactly where the work happens, and a hook that can wedge a
 * conversation shut is worse than the miss it prevents.
 *
 * `--absolute-git-dir` answers correctly from both -- the main checkout's
 * `.git`, or `<main>/.git/worktrees/<name>` from inside a linked worktree.
 * Per-worktree is the right grain anyway: sessions are per-folder.
 */
function stateDir(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** The refusal the agent reads. Named so the test can assert on its shape. */
function refusalMessage(offenders) {
  const lines = [
    'BLOCKED: this reply hands the operator a command CC could have run itself.',
    '',
    'CLAUDE.md, "CC runs the operational commands": handing Dane a command to',
    'paste is itself a claim that CC cannot run it, and he reads it that way',
    'every time. He has raised this three times (2026-08-07, 08-23, 08-30);',
    'the incident is DOCTRINE.md §6.9.',
    '',
    'Handed over:',
  ];

  for (const { command, rule } of offenders) {
    lines.push(`  ${command}`);
    lines.push(`      ^ a fenced ${rule} block`);
  }

  lines.push(
    '',
    'Do one of two things:',
    '',
    '  1. RUN IT. Then report what it said, in plain English. A gate or a',
    '     permission refusal is not a reason to hand it over -- it refused one',
    '     call, not the session, so retry it when the step actually comes.',
    '     If a script has a dry run and an --apply, run both.',
    '',
    '  2. Or name the exception, on its own line, outside any code fence:',
    '',
    `       Exception: ${EXCEPTIONS.join(' | ')}`,
    '',
    '     Those are the only four. A secret VALUE, a billing screen, a browser',
    '     login, and a decision that is genuinely his.',
    '',
    'To mention a command WITHOUT handing it over, write it inline in single',
    'backticks rather than in a fenced block.',
    '',
    '(Deliberate one-off override: SKIP_OPERATOR_HANDOFF=1.)'
  );

  return lines.join('\n');
}

module.exports = {
  EXCEPTIONS,
  HANDOFF_RULES,
  splitFences,
  firstCommandLine,
  stripPrompt,
  stripEnvPrefix,
  offendingCommands,
  statedException,
  lastAssistantTurn,
  isInteractive,
  stateDir,
  refusalMessage,
};
