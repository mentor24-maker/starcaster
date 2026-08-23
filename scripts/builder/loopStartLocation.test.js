'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, '.claude', 'skills', 'loop-build', 'SKILL.md');
const DOC = path.join(ROOT, 'docs', 'LOOP_ENGINEERING.md');
const HELPER = path.join(ROOT, 'scripts', 'lib', 'main_checkout.mjs');

/**
 * Where does a loop session start, and does that decide where it BUILDS?
 *
 * After NODES Slice A (#368) the loop-build skill derived its checkout with
 * `git rev-parse --show-toplevel`, which answers "the folder I am in".
 * `docs/LOOP_ENGINEERING.md` meanwhile told the operator to run each loop in
 * its own worktree, and called that the #1 safety rule. Follow both and the
 * loop nested every per-task worktree INSIDE the worktree it was started in.
 *
 * Nothing errored either way, which is what makes it worth a test rather than
 * a note: the wrong one just builds somewhere nobody expects.
 */

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// ── The behaviour, against a real worktree ────────────────────────────────

test('the derivation gives the MAIN checkout from inside a linked worktree', () => {
  // A real repo with a real linked worktree. `--git-common-dir` is a property
  // of how git links worktrees, so asserting it against a mock would only pin
  // this file's belief about git — and that belief is what was wrong.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopstart-'));
  const main = path.join(dir, 'main');
  fs.mkdirSync(main);
  sh(main, ['init', '-q', '-b', 'main']);
  sh(main, ['config', 'user.email', 'test@example.com']);
  sh(main, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  sh(main, ['add', '-A']);
  sh(main, ['commit', '-qm', 'base']);

  const linked = path.join(main, '.claude', 'worktrees', 'topic');
  sh(main, ['worktree', 'add', '-q', linked, '-b', 'topic']);

  const ask = (cwd) => execFileSync('node', [HELPER], { cwd, encoding: 'utf8' }).trim();

  // The bug, in one line: --show-toplevel means "the folder I am in".
  assert.equal(fs.realpathSync(sh(linked, ['rev-parse', '--show-toplevel'])), fs.realpathSync(linked));

  // The fix: the same answer from either place.
  assert.equal(fs.realpathSync(ask(linked)), fs.realpathSync(main),
    'from inside a worktree, the main checkout — this is the whole fix');
  assert.equal(fs.realpathSync(ask(main)), fs.realpathSync(main),
    'and from the main checkout, still itself');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the helper runs as a command, not only as an import', () => {
  // The skill is a shell snippet; if this file stops being executable the
  // snippet silently produces an empty MAIN and the guard on the next line
  // is what catches it. Better to catch it here.
  const out = execFileSync('node', [HELPER], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.ok(out.length > 0, 'running it prints a path');
  assert.ok(path.isAbsolute(out), 'and an absolute one');
});

// ── The two documents must not disagree ───────────────────────────────────

test('the skill derives the main checkout, not the folder it is standing in', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');
  const step2 = skill.slice(skill.indexOf('Get an isolated workspace'), skill.indexOf('Build to the acceptance criteria'));

  assert.match(step2, /main_checkout\.mjs/, 'step 2 asks the helper for the checkout');
  assert.match(step2, /REPO="\$\(node -e "console\.log\(require\('\$MAIN/,
    'and feeds that answer to taskRepo, rather than --show-toplevel');

  // `--show-toplevel` may still appear — it legitimately locates the helper
  // file, which every worktree carries. What must not come back is using it
  // for the ANSWER.
  assert.doesNotMatch(
    step2,
    /require\('\$\(git rev-parse --show-toplevel\)/,
    'the folder-I-am-in derivation must not return'
  );
});

test('the operator guide no longer says each loop needs its own worktree', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const section = doc.slice(doc.indexOf('## How to run it'), doc.indexOf('## How to run it') + 2500);

  // Only the INSTRUCTION half. The paragraph after it recounts what the doc
  // used to say and why that was wrong, and quoting the old wording there is
  // the point — a rule with its incident attached is how this repo records
  // things. An assertion that banned the phrase outright would forbid the
  // history along with the mistake, and it did on the first run of this test.
  const instruction = section.slice(0, section.indexOf('This paragraph used to say'));
  assert.ok(instruction.length > 100, 'the historical note marker must still be present');

  assert.doesNotMatch(
    instruction,
    /each in \*\*its own worktree\*\*/,
    'the instruction that contradicted the skill must not come back'
  );
  assert.doesNotMatch(instruction, /#1 safety rule/, 'nor the claim that it was the #1 safety rule');
  assert.match(instruction, /Start them wherever you like/i, 'it says where to start');
  assert.match(instruction, /per-task worktree/, 'and why that is safe');
});

test('the two places agree about where a loop starts', () => {
  // The acceptance criterion, stated as a property rather than as prose: no
  // document may tell the operator to start a loop inside a worktree.
  for (const [file, label] of [[SKILL, 'the skill'], [DOC, 'the operator guide']]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /(?:run|start)[^.\n]{0,40}each loop[^.\n]{0,40}in its own worktree/i,
      `${label} must not tell you to start a loop in a worktree`
    );
  }
});
