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
 * grant the command -- the permission system still refuses it. It also does
 * NOT reach the force-push guard below, for the reason given there.
 *
 * THE SECOND INCIDENT
 * 2026-08-23: a loop-build run force-pushed anyway. The deny rules are command
 * PREFIX globs (`Bash(git push --force*)`), and this repo's own documented way
 * to push is `git -c credential.helper='!gh auth git-credential' push ...` --
 * which does not begin with `git push`. The house idiom walked through the
 * house rule. Prefix matching cannot be patched into safety here, so the
 * force-push question is now asked by parsing the command
 * (`../lib/force_push_guard.cjs`) rather than by pattern.
 */

const path = require('path');
const { findDenyRule } = require('../lib/permission_rules.cjs');
const { findForcePush } = require('../lib/force_push_guard.cjs');

/**
 * Refused BEFORE the deny-rule explanation, and deliberately not behind
 * SKIP_DENY_EXPLAIN: that variable exists to silence an explanation, and if it
 * also silenced this it would be a one-word way around the rule -- which is the
 * exact class of hole this guard was written to close.
 */
function guardForcePush(command, projectDir) {
  let forced = null;
  try {
    forced = findForcePush(command);
  } catch {
    return; // a bug in the guard must not wedge every command
  }
  if (!forced) return;

  // Quote the operator's actual rule when there is one. There nearly always is
  // -- four of them -- but the guard does not depend on finding it: a
  // force-push is refused here even against an empty settings file, because
  // "the rule file could not be read" must never read as "go ahead".
  let named = null;
  try {
    named = findDenyRule('git push --force', projectDir);
  } catch {
    named = null;
  }

  process.stderr.write(
    `BLOCKED BY A STANDING RULE — not a one-off refusal.\n` +
    `This command force-pushes, and force-pushing is already decided here.\n` +
    `\n` +
    `  rule:    ${named ? named.rule : 'Bash(git push --force*)'}\n` +
    `  source:  ${named ? named.source : '~/.claude/settings.json'}\n` +
    `  command: ${forced.command}\n` +
    `  because: ${forced.reason}\n` +
    `\n` +
    `The operator configured this deliberately, so it is already decided.\n` +
    `Do NOT ask him to approve it and do NOT reword the command to slip past\n` +
    `the rule — an approval cannot take effect against a deny rule anyway, so\n` +
    `asking spends his attention on a question whose answer changes nothing.\n` +
    `\n` +
    `Rewording will not work in any case. Those rules match a command that\n` +
    `STARTS with "git push", so on 2026-08-23 these forms slipped through:\n` +
    `    git -c credential.helper=... push --force-with-lease\n` +
    `    git -C <dir> push --force\n` +
    `    git push origin +branch\n` +
    `This check parses the command rather than matching a prefix.\n` +
    `\n` +
    `Find another route — for a force-push there is almost always one, because\n` +
    `it is a rewrite you did not need. Amending a commit you already pushed?\n` +
    `Add a second commit instead. Branch behind main? Merge origin/main in\n` +
    `rather than rebasing — that is what "npm run ship" does, on purpose, and\n` +
    `it never force-pushes.\n` +
    `\n` +
    `If there genuinely is none, tell him the rule exists, name it, and let him\n` +
    `decide whether to change the rule itself — that is a deliberate config\n` +
    `change, not a per-occasion override.\n`
  );
  process.exit(2);
}

function main(input) {
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

  guardForcePush(command, projectDir);

  if (process.env.SKIP_DENY_EXPLAIN === '1') process.exit(0);

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
