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
 *
 * KNOWN AND ACCEPTED: an example quoted INLINE in a command still refuses.
 * Writing `echo x > lib/y.js` inside a sentence, on the same line as the
 * command, is indistinguishable from running it without parsing the shell
 * properly — so documenting this rule from the main folder trips it, and did
 * so three times while this very fix was being written and reviewed. A heredoc
 * bound for a non-interpreter is handled (its body is data and is dropped),
 * which covers the common case of writing notes to a file. For the rest the
 * answer is `ALLOW_MAIN_EDITS=1` with a reason, and this paragraph exists so
 * that is a DECISION rather than a thing nobody noticed. The direction is the
 * safe one: refusing to write prose costs a rephrase, missing a write to
 * `main` costs a deploy.
 *
 * THE LIMIT OF THE VERB LIST is likewise deliberate. A list of remembered
 * shapes is the defect this file keeps rediscovering, and no list will be
 * complete — `os.rename`, a perl three-argument open, anything not yet
 * invented. What makes that survivable is that this guard is not the
 * guarantee: the pre-commit refusal is, and every path to production goes
 * through a commit. This moves the failure earlier and cheaper, nothing more.
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
  // python — pathlib, then the stdlib file movers
  'write_text', 'write_bytes', 'copyfile', 'copy2', 'copytree', 'move',
  // ruby's one-call file write
  'IO\\.write', 'File\\.write',
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

/**
 * A heredoc body is one of THREE things, depending on who receives it, and
 * conflating any two of them is a hole.
 *
 *   program interpreter  the body is a program  -> scan with PROGRAM_WRITE_FORMS
 *   shell interpreter    the body is shell text -> scan with SHELL_WRITE_FORMS
 *   anything else        the body is data       -> do not scan it at all
 *
 * The first draft of this file put `sh`/`bash`/`zsh` in with the program
 * interpreters, which sent their bodies to the program scan only. A bash
 * heredoc redirecting into a tracked path was then silently permitted —
 * a REGRESSION against the rule it was meant to strengthen, because the plain
 * `echo x > lib/y.js` form has always been caught. Caught in review.
 */
const PROGRAM_INTERPRETERS = /\b(?:python3?|node|perl|ruby|php)\b/;
const SHELL_INTERPRETERS = /\b(?:sh|bash|zsh|ksh|dash)\b/;

/**
 * Commands that cannot write, whatever they mention. `git log -S writeFileSync
 * -- lib/` satisfies "a write verb somewhere and a code path somewhere" while
 * being a pure search — the module's stated bias is to err toward not blocking,
 * and refusing to let someone SEARCH for writes is the wrong side of that.
 */
const READ_ONLY_LEADERS = /^(?:git\s+(?:log|grep|show|diff|blame)|grep|rg|ag|ack|cat|less|head|tail|wc|find)\b/;

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
  const shellBodies = [];
  let shell = '';
  let cursor = 0;
  let match;

  while ((match = opener.exec(text)) !== null) {
    const delimiter = match[2];
    // The line the heredoc was opened on tells us who receives the body.
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const openingLine = text.slice(lineStart, match.index);

    const bodyStart = text.indexOf('\n', opener.lastIndex);
    if (bodyStart === -1) break;
    const end = new RegExp(`^\\s*${delimiter}\\s*$`, 'm');
    const rest = text.slice(bodyStart + 1);
    const endMatch = end.exec(rest);
    const bodyEnd = endMatch ? bodyStart + 1 + endMatch.index : text.length;
    const body = text.slice(bodyStart + 1, bodyEnd);

    shell += text.slice(cursor, bodyStart + 1);
    if (PROGRAM_INTERPRETERS.test(openingLine)) codeBodies.push(body);
    else if (SHELL_INTERPRETERS.test(openingLine)) shellBodies.push(body);
    // else: data, and deliberately dropped.

    cursor = endMatch ? bodyEnd + endMatch[0].length : text.length;
    opener.lastIndex = cursor;
  }
  shell += text.slice(cursor);
  return { shell, codeBodies, shellBodies };
}

/** Split on shell separators so a read-only leader is judged per subcommand. */
function subcommands(text) {
  return String(text || '')
    .split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/g)
    .map((part) => part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''))
    .filter(Boolean);
}

/** The reason a command looks like a main-source write, or '' if it does not. */
function detectSourceWrite(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) return '';

  const { shell, codeBodies, shellBodies } = splitHeredocs(cmd);

  // Shell text is the command itself PLUS any heredoc body handed to a shell —
  // that body is shell too, and omitting it let `bash <<SH ... > lib/x ... SH`
  // through when the identical redirect on one line has always been refused.
  const shellText = [shell, ...shellBodies].join('\n');
  for (const form of SHELL_WRITE_FORMS) {
    if (form.re.test(shellText)) return form.why;
  }

  // A program's own source: the shell text (covers `python3 -c "..."` and
  // `node -e "..."`) plus any heredoc body a program interpreter was given.
  // Subcommands led by a pure search are dropped first, so looking FOR a write
  // is not mistaken for performing one.
  const programText = [...subcommands(shellText).filter((part) => !READ_ONLY_LEADERS.test(part)), ...codeBodies]
    .join('\n');
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

module.exports = { detectSourceWrite, targetsWorktree, shouldBlockBashOnMain, splitHeredocs, subcommands, CODE_DIRS };
