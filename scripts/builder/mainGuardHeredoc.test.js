'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSourceWrite, splitHeredocs, shouldBlockBashOnMain } = require('./mainGuard.js');

/**
 * The 2026-08-23 miss, and its opposite.
 *
 * A loop-build pass working in a worktree had its shell cwd silently reset to
 * the MAIN checkout between tool calls. The next command used a repo-relative
 * path, so an edit meant for the worktree landed on `main` — the branch that
 * auto-deploys to production. It was caught and reverted within a minute and
 * nothing was pushed. The guard not firing is the finding.
 *
 * Why it did not fire: the write-verb list held `writeFileSync` and
 * `open(..., 'w')` only. The command used
 * `pathlib.Path('scripts/lib/x.cjs').write_text(...)` — an utterly ordinary
 * way for an agent to make a multi-line edit, and not on the list. The guard
 * knew the shapes someone had thought of and silently permitted the rest,
 * which is the same defect as the force-push deny rule a `git -c` prefix
 * walked through the same night (PR #394).
 *
 * The second half is the opposite failure, found while filing the ticket for
 * the first: the guard refused to let the ticket be WRITTEN, because its text
 * quoted an example redirect. Prose about a rule must not trip the rule.
 *
 * EDITING NOTE: this file is written with an editor, not a shell heredoc —
 * its examples read as commands. That is the guard working.
 */

const G = '$'; // keeps template-looking text out of this file's own source

// ── The miss ───────────────────────────────────────────────────────────────

const MUST_DETECT = [
  [
    'python3 - <<PY\nimport pathlib\npathlib.Path("scripts/lib/repo_state.cjs").write_text("x")\nPY',
    'the exact command from the incident — pathlib write_text in a heredoc',
  ],
  [
    'python3 -c "import pathlib; pathlib.Path(\'lib/x.js\').write_text(1)"',
    'the same thing via -c, with no heredoc at all',
  ],
  [
    'python3 - <<PY\npathlib.Path("src/css/main.css").write_bytes(b"x")\nPY',
    'write_bytes, the sibling nobody lists',
  ],
  [
    'node -e "require(\'fs\').writeFile(\'routes/a.js\', 1, cb)"',
    'the async node write — only the Sync form was listed',
  ],
  [
    'node -e "require(\'fs\').appendFileSync(\'lib/a.js\', 1)"',
    'appending is writing',
  ],
  [
    'node -e "require(\'fs\').createWriteStream(\'public/x.js\')"',
    'a write stream is a write',
  ],
  ['perl -i -pe "s/a/b/" src/x.css', 'perl spells in-place -i too'],
  ['ruby -i -pe "x" components/A.tsx', 'so does ruby'],
  ['cat /tmp/x | tee scripts/gen.sh', 'tee writes the file it names'],
  ['dd if=/dev/zero of=public/app.js', 'dd of='],
  ['truncate -s 0 lib/x.js', 'truncate empties it'],
  ['install -m 644 /tmp/x lib/new.js', 'install is a copy'],
];

test('every way of handing a program a path to write is caught', async (t) => {
  for (const [command, why] of MUST_DETECT) {
    await t.test(why, () => {
      assert.ok(detectSourceWrite(command), `must be detected: ${command}`);
    });
  }
});

test('the original forms still work — this is additive', () => {
  assert.ok(detectSourceWrite('cat > routes/publicSite.js <<EOF'));
  assert.ok(detectSourceWrite('sed -i "" "s/a/b/" scripts/thing.cjs'));
  assert.ok(detectSourceWrite("node -e \"require('fs').writeFileSync('lib/x.js','y')\""));
  assert.ok(detectSourceWrite("python3 - <<'PY'\nopen('lib/x.js','w').write('z')\nPY"));
});

// ── The opposite failure: prose about the rule ─────────────────────────────

test('a quoted example in prose does not trip the rule', () => {
  // This is the shape that refused to let the ticket be filed: a heredoc bound
  // for a SCRATCH file whose body quotes a redirect as documentation. `cat` is
  // not an interpreter, so its heredoc body is data, not a command.
  const ticket = [
    'cat > /tmp/ticket.md <<NOTE',
    '| command shape | guard |',
    '| a redirect like `echo x > scripts/foo.js` | blocked |',
    '| `sed -i` on lib/y.js | blocked |',
    'NOTE',
  ].join('\n');
  assert.equal(detectSourceWrite(ticket), '', 'writing ABOUT the rule must be allowed');
});

test('but a real redirect on the same command line is still caught', () => {
  // The guard against the guard: if heredoc-stripping ever ate the shell text,
  // the test above would pass vacuously and this one would start failing.
  assert.ok(detectSourceWrite('cat > scripts/foo.js <<EOF\nconsole.log(1)\nEOF'));
  assert.ok(
    detectSourceWrite('cat > /tmp/note.md <<NOTE\nprose\nNOTE\necho x > lib/real.js'),
    'a real write AFTER a prose heredoc is still a real write'
  );
});

test('an interpreter heredoc is code; cat\'s heredoc is data', () => {
  const py = 'python3 - <<PY\npathlib.Path("lib/x.js").write_text(1)\nPY';
  const cat = 'cat > /tmp/x.md <<TXT\npathlib.Path("lib/x.js").write_text(1)\nTXT';

  assert.ok(detectSourceWrite(py), 'a python heredoc body IS the program');
  assert.equal(detectSourceWrite(cat), '', 'the identical text as data is not a command');

  const split = splitHeredocs(py);
  assert.equal(split.codeBodies.length, 1, 'the interpreter body is collected as code');
  assert.equal(splitHeredocs(cat).codeBodies.length, 0, 'the cat body is not');
});

test('a script writing somewhere harmless is left alone', () => {
  assert.equal(detectSourceWrite('python3 - <<PY\npathlib.Path("/tmp/x.md").write_text(1)\nPY'), '');
  assert.equal(detectSourceWrite('node -e "require(\'fs\').writeFileSync(\'/tmp/a\',1)"'), '');
  assert.equal(detectSourceWrite('python3 - <<PY\npathlib.Path("docs/WORK-LOG.md").write_text(1)\nPY'), '',
    'docs are edited legitimately from the main folder');
});

test('reading tracked source is never a write', () => {
  for (const command of [
    'cat lib/foo.js',
    'grep -rn write_text scripts/',
    'git log --oneline -- lib/x.js',
    'node -e "require(\'fs\').readFileSync(\'lib/x.js\')"',
    'npm run build',
    `echo ${G}HOME`,
  ]) {
    assert.equal(detectSourceWrite(command), '', `must be allowed: ${command}`);
  }
});

// ── The decision the hook actually makes ───────────────────────────────────

test('none of this matters when the checkout is not on main', () => {
  const incident = 'python3 - <<PY\npathlib.Path("lib/x.js").write_text(1)\nPY';
  assert.equal(shouldBlockBashOnMain(incident, { onMain: false }).block, false);
  assert.equal(shouldBlockBashOnMain(incident, { onMain: true }).block, true);
});

test('a command that names a worktree is still exempt', () => {
  const inWorktree = 'cd .claude/worktrees/topic && python3 - <<PY\npathlib.Path("lib/x.js").write_text(1)\nPY';
  assert.equal(shouldBlockBashOnMain(inWorktree, { onMain: true }).block, false,
    'the loop writes source in worktrees all day');
});

test('the block reason names what was seen, not just that something was', () => {
  const verdict = shouldBlockBashOnMain(
    'python3 - <<PY\npathlib.Path("lib/x.js").write_text(1)\nPY',
    { onMain: true }
  );
  assert.match(verdict.reason, /script writing tracked source/);
});
