'use strict';

/**
 * Does this command force-push? Answered by parsing, not by prefix-matching.
 *
 * THE INCIDENT
 * 2026-08-23, ~05:09: an unattended loop-build run on the Mac Mini force-pushed
 * a branch despite four standing deny rules forbidding exactly that. Recovered
 * from the session transcripts (not from the agent's own account), every
 * instance had the same shape:
 *
 *     git -c credential.helper='!gh auth git-credential' push --force-with-lease
 *
 * The deny rules are command-PREFIX globs — `Bash(git push --force*)` and three
 * siblings — and that command does not begin with `git push`. It begins with
 * `git -c`. The `-c credential.helper=...` prefix is not an evasion anyone
 * invented: it is this repo's own documented way to push at all, because
 * osxkeychain is unreachable from an agent session. So the house idiom for
 * pushing walked straight through the house rule against force-pushing, and
 * the only reason anyone found out is that the agent volunteered it.
 *
 * `permission_rules.cjs` did not catch it either: it splits compound commands
 * and then applies the same prefix globs, so it inherited the same blind spot.
 *
 * WHY THIS IS A SEPARATE MODULE
 * Because the fix cannot be another pattern. A pattern can always be reworded
 * around — `git -C <dir> push --force`, a newline instead of `&&`, a `+refspec`
 * with no flag at all — and each rewording needs a new pattern nobody thinks to
 * write until after the next incident. This asks the question the rules were
 * trying to ask: after stripping environment assignments and git's own global
 * options, is the subcommand `push`, and does it force?
 *
 * Deliberately conservative in one direction only: it is a guard, so a false
 * positive costs one reworded command and a false negative costs shared
 * history. When in doubt it blocks.
 */

/** Separators the shell treats as "and now a different command". */
const SEPARATORS = /\s*(?:&&|\|\||;|\||\n|\r)\s*/g;

/** `FOO=bar BAZ=qux git push ...` — env assignments are not the program. */
const LEADING_ASSIGNMENTS = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/;

/**
 * git's global options, which sit BEFORE the subcommand and are what defeated
 * the prefix rules. Those that consume the following token are listed
 * separately, because skipping their value is what keeps `-C /tmp/x push` from
 * reading as the subcommand `/tmp/x`.
 */
const GIT_GLOBAL_WITH_VALUE = new Set(['-c', '-C', '--exec-path', '--git-dir', '--work-tree', '--namespace', '--config-env']);
const GIT_GLOBAL_FLAGS = new Set([
  '-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--bare',
  '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
  '--no-optional-locks', '--html-path', '--man-path', '--info-path', '--no-lazy-fetch',
]);

/** Flags that mean "overwrite what is on the remote". */
const FORCE_FLAGS = /^(?:-f|--force|--force-with-lease|--force-if-includes)(?:=.*)?$/;

/**
 * Split into shell words, keeping quoted runs together.
 *
 * One shell word can mix quoted and unquoted pieces —
 * `credential.helper='!gh auth git-credential'` is a SINGLE argument whose
 * spaces are inside the quotes. An alternation of "quoted OR unquoted-run"
 * gets this wrong: it stops the unquoted run at the opening quote and hands
 * back three tokens, so `-c` swallows the wrong one and the parser never
 * reaches `push`. That bug let the exact command from the incident through the
 * first draft of this guard, which is why the tokenizer is written as
 * one-or-more pieces of either kind glued together.
 */
function tokenize(text) {
  const tokens = [];
  const re = /(?:[^\s'"]+|'[^']*'|"[^"]*")+/g;
  let match;
  while ((match = re.exec(text)) !== null) tokens.push(match[0]);
  return tokens;
}

function unquote(token) {
  const text = String(token || '');
  if (text.length >= 2 && ((text[0] === "'" && text.endsWith("'")) || (text[0] === '"' && text.endsWith('"')))) {
    return text.slice(1, -1);
  }
  return text;
}

/** Every separate command inside one Bash call, sans leading env assignments. */
function splitCommands(command) {
  return String(command || '')
    .split(SEPARATORS)
    .map((part) => part.trim().replace(/^[({]\s*/, '').replace(/\s*[)}]$/, '').trim())
    .filter(Boolean)
    .map((part) => part.replace(LEADING_ASSIGNMENTS, '').trim())
    .filter(Boolean);
}

/**
 * A refspec like `+main:main` forces the push with no flag anywhere on the
 * line — the one form none of the four deny rules could ever have matched.
 */
function isForcingRefspec(token) {
  const text = unquote(token);
  return text.startsWith('+') && text.length > 1 && !text.startsWith('++');
}

/** Inspect ONE command. Returns a reason string, or null if it does not force-push. */
function inspectOne(command) {
  const tokens = tokenize(command);
  if (!tokens.length) return null;

  let index = 0;
  const program = unquote(tokens[index]);
  // Accept `git`, `/usr/bin/git`, `"git"` — the path does not change what it does.
  if (!/(?:^|\/)git$/.test(program)) return null;
  index += 1;

  // Step over git's own global options to reach the subcommand.
  while (index < tokens.length) {
    const token = unquote(tokens[index]);
    if (GIT_GLOBAL_WITH_VALUE.has(token)) { index += 2; continue; }
    if (token.startsWith('--') && GIT_GLOBAL_WITH_VALUE.has(token.split('=')[0])) { index += 1; continue; }
    if (GIT_GLOBAL_FLAGS.has(token)) { index += 1; continue; }
    break;
  }

  if (index >= tokens.length) return null;
  if (unquote(tokens[index]) !== 'push') return null;

  const args = tokens.slice(index + 1).map(unquote);
  // `--` ends option parsing; everything after it is a refspec, which can still force.
  for (const arg of args) {
    if (FORCE_FLAGS.test(arg)) return `\`${arg}\``;
    if (isForcingRefspec(arg)) return `the forcing refspec \`${arg}\``;
  }
  return null;
}

/**
 * The whole question, for one Bash tool call.
 * Returns `{ command, reason }` for the first force-push found, or null.
 */
function findForcePush(command) {
  for (const one of splitCommands(command)) {
    const reason = inspectOne(one);
    if (reason) return { command: one, reason };
  }
  return null;
}

module.exports = {
  findForcePush,
  splitCommands,
  tokenize,
  inspectOne,
};
