'use strict';

/**
 * Reads the operator's Bash permission rules out of the settings files and
 * answers one question: is this command forbidden by a standing rule?
 *
 * WHY THIS EXISTS
 * A refused tool call reports only "Permission to use Bash with command X has
 * been denied." That sentence is identical whether the operator clicked "no"
 * once or a deny rule in his settings forbids it permanently. On 2026-08-14 an
 * agent read that ambiguity the wrong way, asked him to approve a force-push,
 * got a yes -- and the yes could not take effect, because
 * `Bash(git push --force*)` was already denied in ~/.claude/settings.json.
 * A decision was spent on something already decided, and the answer was
 * unactionable.
 *
 * Making the reason legible is the whole fix: an agent that can see "standing
 * rule, from this file" never asks, and goes and finds another route.
 *
 * Used by scripts/hooks/explain_denied_commands.cjs (PreToolUse on Bash),
 * which fires BEFORE the permission system, so it gets to speak first.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Lowest precedence first, so a later file's rules are reported as the nearer source. */
function settingsFiles(projectDir) {
  const files = [{ label: '~/.claude/settings.json', file: path.join(os.homedir(), '.claude', 'settings.json') }];
  if (projectDir) {
    files.push(
      { label: '.claude/settings.json', file: path.join(projectDir, '.claude', 'settings.json') },
      { label: '.claude/settings.local.json', file: path.join(projectDir, '.claude', 'settings.local.json') }
    );
  }
  return files;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every `Bash(...)` entry on the deny list, tagged with the file it came from
 * so the message can point at something the operator can actually go and edit.
 */
function denyRules(projectDir) {
  const rules = [];
  for (const { label, file } of settingsFiles(projectDir)) {
    const json = readJson(file);
    const deny = json?.permissions?.deny;
    if (!Array.isArray(deny)) continue;
    for (const entry of deny) {
      const match = /^Bash\((.*)\)$/.exec(String(entry || '').trim());
      if (match) rules.push({ rule: String(entry).trim(), pattern: match[1], source: label });
    }
  }
  return rules;
}

/** Claude Code permission globs: `*` is the only wildcard, and the match is whole-string. */
function patternToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Split a compound command the way the permission system does: each
 * subcommand is checked on its own, and leading VAR=value assignments are
 * stripped. Deliberately conservative -- this exists to explain a denial, not
 * to be the denial, so over-splitting costs nothing and under-splitting only
 * means the agent gets the vaguer message it would have got anyway.
 */
function subcommands(command) {
  const parts = String(command || '')
    .split(/\s*(?:&&|\|\||;|\|)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''));
  const whole = String(command || '').trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
  return [...new Set([whole, ...parts])].filter(Boolean);
}

/** The first standing rule that forbids this command, or null. */
function findDenyRule(command, projectDir) {
  const rules = denyRules(projectDir);
  if (!rules.length) return null;

  const candidates = subcommands(command);
  for (const rule of rules) {
    const re = patternToRegExp(rule.pattern);
    for (const candidate of candidates) {
      if (re.test(candidate)) return { ...rule, matched: candidate };
    }
  }
  return null;
}

module.exports = {
  denyRules,
  patternToRegExp,
  subcommands,
  findDenyRule,
};
