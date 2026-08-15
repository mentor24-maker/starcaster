#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook (Bash).
 *
 * When a command is forbidden by a standing deny rule, block it HERE, with the
 * rule quoted and the file named -- instead of letting it fall through to the
 * permission system, whose refusal reads exactly like the operator clicking
 * "no" once.
 *
 * PreToolUse runs before permissions are evaluated and fires even for commands
 * a deny rule would refuse, so this gets to speak first. The outcome for the
 * command is identical either way; what changes is that the agent now knows
 * the difference between "he said no this time" and "he decided this already",
 * and only one of those is worth a question.
 *
 * THE INCIDENT
 * 2026-08-14: a rebase needed `git push --force-with-lease`. It was refused.
 * Reading that as a one-off, the agent asked the operator to choose -- who
 * approved it. The approval could not take effect: `Bash(git push --force*)`
 * sits on the deny list in ~/.claude/settings.json. An operator decision was
 * spent on a question already answered, and the answer could not be honoured.
 * The alternative route (merge instead of rebase) needed nothing from him and
 * was available the whole time.
 *
 * Escape hatch: SKIP_DENY_EXPLAIN=1 disables the explanation. It does NOT
 * grant the command -- the permission system still refuses it.
 */

const path = require('path');
const { findDenyRule } = require('../lib/permission_rules.cjs');

function main(input) {
  if (process.env.SKIP_DENY_EXPLAIN === '1') process.exit(0);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable — never block on our own confusion
  }

  const command = String(payload?.tool_input?.command || '');
  if (!command.trim()) process.exit(0);

  const projectDir = String(
    payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  );

  let hit = null;
  try {
    hit = findDenyRule(command, projectDir);
  } catch {
    process.exit(0); // a broken settings file must not wedge every command
  }
  if (!hit) process.exit(0);

  process.stderr.write(
    `BLOCKED BY A STANDING RULE — not a one-off refusal.\n` +
    `\n` +
    `  rule:    ${hit.rule}\n` +
    `  source:  ${hit.source}\n` +
    `  command: ${hit.matched}\n` +
    `\n` +
    `The operator configured this deliberately, so it is already decided.\n` +
    `Do NOT ask him to approve it and do NOT reword the command to slip past\n` +
    `the rule — an approval cannot take effect against a deny rule anyway, so\n` +
    `asking spends his attention on a question whose answer changes nothing.\n` +
    `\n` +
    `Find another route. If there genuinely is none, tell him the rule exists,\n` +
    `name it, and let him decide whether to change the rule itself — that is a\n` +
    `deliberate config change, not a per-occasion override.\n`
  );
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
