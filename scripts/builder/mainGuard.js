'use strict';

/**
 * Detect a shell command that writes into the repo's tracked SOURCE, for the
 * main-branch guard. On 2026-08-20 a loop pass wrote a whole feature into the
 * main checkout through Bash heredocs and python — the Edit/Write PreToolUse
 * hook never saw it, because that hook only watches those tools. A rule that
 * covers one of two ways to do the thing silently does not run (DOCTRINE §3).
 *
 * This is BEST-EFFORT and only moves the failure earlier: the real guarantee
 * is the pre-commit refusal (every path ends in a commit). So this errs
 * toward NOT blocking — a false positive that stops a legitimate command is
 * worse than a miss the commit hook will still catch.
 *
 * Only writes into tracked CODE directories count; docs/, scratch files, /tmp
 * and data are not the hazard this guards (and are edited legitimately from
 * the main folder during ops).
 */

const CODE_DIRS = ['lib', 'routes', 'src', 'components', 'scripts', 'public', 'api'];
const DIR_ALT = CODE_DIRS.join('|');

// A path under a code dir, e.g. lib/foo.js, routes/x/y.ts, scripts/a.cjs.
const CODE_PATH = new RegExp(`(?:\\./)?(?:${DIR_ALT})/[A-Za-z0-9_./-]+`);

const WRITE_FORMS = [
  // redirect (> or >>) into a code path: `cmd > lib/x`, `cat > routes/x <<EOF`
  { why: 'a redirect into tracked source', re: new RegExp(`>>?\\s*["']?(?:\\./)?(?:${DIR_ALT})/`) },
  // in-place sed on a code path
  { why: 'sed -i on tracked source', re: new RegExp(`sed\\s+-i\\b[^\\n]*\\b(?:${DIR_ALT})/`) },
  // cp/mv whose LAST token is a code path (destination)
  { why: 'cp/mv into tracked source', re: new RegExp(`\\b(?:cp|mv)\\s+[^\\n]*\\s(?:\\./)?(?:${DIR_ALT})/[A-Za-z0-9_./-]+\\s*$`, 'm') },
  // node/python writing a file with a code path anywhere in the command
  { why: 'a script writing tracked source', re: new RegExp(`(?:writeFileSync|open\\s*\\([^)]*['"](?:${DIR_ALT})/)`) },
];

/** The reason a command looks like a main-source write, or '' if it does not. */
function detectSourceWrite(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) return '';
  for (const form of WRITE_FORMS) {
    if (form.re.test(cmd)) return form.why;
  }
  // A python heredoc that names a code path and opens it for writing.
  if (/python3?\s+-\s*<<|python3?\s+-\s*['"]?<</.test(cmd) && CODE_PATH.test(cmd) && /open\s*\([^)]*['"][wa]/.test(cmd)) {
    return 'a python heredoc writing tracked source';
  }
  return '';
}

/** Does the command clearly operate inside a linked worktree, not the main
 *  checkout? Then it is not the hazard — the loop writes source in worktrees
 *  all day via `cd .claude/worktrees/<topic>`. */
function targetsWorktree(command) {
  return /\.claude\/worktrees\//.test(String(command || ''));
}

/**
 * The block decision for a Bash command. Blocks only when ALL hold: we are on
 * main, the command writes tracked source, and it is not clearly operating in
 * a worktree. Anything uncertain → allow (the pre-commit hook is the net).
 */
function shouldBlockBashOnMain(command, { onMain }) {
  if (!onMain) return { block: false, reason: '' };
  if (targetsWorktree(command)) return { block: false, reason: '' };
  const reason = detectSourceWrite(command);
  return reason ? { block: true, reason } : { block: false, reason: '' };
}

module.exports = { detectSourceWrite, targetsWorktree, shouldBlockBashOnMain, CODE_DIRS };
