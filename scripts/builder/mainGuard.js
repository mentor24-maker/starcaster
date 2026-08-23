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

/**
 * Forms tested against the SHELL text — the command with heredoc bodies
 * removed. A heredoc body fed to `cat` is data, not a command, and scanning it
 * for shell syntax reads a quoted example as an instruction (see below).
 */
const SHELL_WRITE_FORMS = [
  // redirect (> or >>) into a code path: `cmd > lib/x`, `cat > routes/x <<EOF`
  { why: 'a redirect into tracked source', re: new RegExp(`>>?\\s*["']?(?:\\./)?(?:${DIR_ALT})/`) },
  // in-place edit on a code path — sed, perl and ruby all spell it `-i`
  { why: 'an in-place edit of tracked source', re: new RegExp(`\\b(?:sed|perl|ruby)\\s+-i\\b[^\\n]*\\b(?:${DIR_ALT})/`) },
  // cp/mv/install whose LAST token is a code path (the destination)
  { why: 'cp/mv into tracked source', re: new RegExp(`\\b(?:cp|mv|install)\\s+[^\\n]*\\s(?:\\./)?(?:${DIR_ALT})/[A-Za-z0-9_./-]+\\s*$`, 'm') },
  // tee writes its stdin to the named file
  { why: 'tee into tracked source', re: new RegExp(`\\btee\\s+(?:-a\\s+)?["']?(?:\\./)?(?:${DIR_ALT})/`) },
  // dd of=<code path>
  { why: 'dd writing tracked source', re: new RegExp(`\\bdd\\b[^\\n]*\\bof=["']?(?:\\./)?(?:${DIR_ALT})/`) },
  // truncate
  { why: 'truncate on tracked source', re: new RegExp(`\\btruncate\\s+[^\\n]*\\b(?:${DIR_ALT})/`) },
];

/**
 * Ways a PROGRAM writes a file it was handed the path to. Tested against the
 * shell text PLUS the bodies of heredocs fed to an interpreter, because for
 * `python3 - <<PY` the body IS the program.
 *
 * This list is where the 2026-08-23 miss lived: it had `writeFileSync` and
 * `open(..., 'w')` only, so `pathlib.Path('lib/x.js').write_text(...)` — an
 * utterly ordinary way to make a multi-line edit — walked straight through and
 * an agent wrote to the main checkout.
 */
const PROGRAM_WRITE_VERBS = [
  // node
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'createWriteStream', 'truncateSync', 'copyFileSync', 'renameSync',
  // python — pathlib
  'write_text', 'write_bytes',
];
const VERB_ALT = PROGRAM_WRITE_VERBS.join('|');

const PROGRAM_WRITE_FORMS = [
  {
    why: 'a script writing tracked source',
    // A write verb anywhere AND a code path anywhere. Both must be present:
    // the verb alone is a scratch-file write, the path alone is a read.
    test: (text) => new RegExp(`\\b(?:${VERB_ALT})\\s*\\(`).test(text) && CODE_PATH.test(text),
  },
  {
    why: 'a script opening tracked source for writing',
    // python's `open('lib/x', 'w')` — the mode is the second argument.
    test: (text) => new RegExp(`open\\s*\\(\\s*["'](?:\\./)?(?:${DIR_ALT})/[^"']*["']\\s*,\\s*["'][wax+]`).test(text)
      || new RegExp(`open\\s*\\([^)]*["'][wax+][br+]*["']\\s*\\)`).test(text) && CODE_PATH.test(text),
  },
];

/** An interpreter's heredoc body is a PROGRAM; anything else's is data. */
const INTERPRETERS = /\b(?:python3?|node|perl|ruby|sh|bash|zsh|php)\b/;

/**
 * Split a command into its shell text and the heredoc bodies that are code.
 *
 * Filing the ticket for this very bug was refused, because the ticket text
 * quoted a redirect as an EXAMPLE inside a heredoc bound for a scratch file.
 * The guard could not tell a command from a description of one. Prose about
 * the rule must not trip the rule, or the workaround becomes "stop writing
 * down the examples".
 */
function splitHeredocs(command) {
  const text = String(command || '');
  const opener = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  const codeBodies = [];
  let shell = '';
  let cursor = 0;
  let match;

  while ((match = opener.exec(text)) !== null) {
    const delimiter = match[2];
    // The line the heredoc was opened on tells us who receives the body.
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const openingLine = text.slice(lineStart, match.index);
    const isCode = INTERPRETERS.test(openingLine);

    const bodyStart = text.indexOf('\n', opener.lastIndex);
    if (bodyStart === -1) break;
    const end = new RegExp(`^\\s*${delimiter}\\s*$`, 'm');
    const rest = text.slice(bodyStart + 1);
    const endMatch = end.exec(rest);
    const bodyEnd = endMatch ? bodyStart + 1 + endMatch.index : text.length;

    shell += text.slice(cursor, bodyStart + 1);
    if (isCode) codeBodies.push(text.slice(bodyStart + 1, bodyEnd));
    cursor = endMatch ? bodyEnd + endMatch[0].length : text.length;
    opener.lastIndex = cursor;
  }
  shell += text.slice(cursor);
  return { shell, codeBodies };
}

/** The reason a command looks like a main-source write, or '' if it does not. */
function detectSourceWrite(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) return '';

  const { shell, codeBodies } = splitHeredocs(cmd);

  for (const form of SHELL_WRITE_FORMS) {
    if (form.re.test(shell)) return form.why;
  }

  // A program's own source: the shell text (covers `python3 -c "..."` and
  // `node -e "..."`) plus any heredoc body an interpreter was given.
  const programText = [shell, ...codeBodies].join('\n');
  for (const form of PROGRAM_WRITE_FORMS) {
    if (form.test(programText)) return form.why;
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

module.exports = { detectSourceWrite, targetsWorktree, shouldBlockBashOnMain, splitHeredocs, CODE_DIRS };
