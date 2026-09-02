'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'LOOP_ENGINEERING.md');
const SKILLS = ['loop-build', 'loop-review', 'loop-spec']
  .map((s) => path.join(ROOT, '.claude', 'skills', s, 'SKILL.md'));
const CLI = path.join(ROOT, 'scripts', 'clickup_direct.mjs');

/**
 * The rule has to be WHERE THE AGENT IS LOOKING, not only in the module that
 * implements it (task 86bbk34x7, acceptance criterion 6).
 *
 * A command nobody is told to run is a command nobody runs, and this one only
 * pays off at the moment an agent is about to state that something needs Dane
 * — which is a moment in a skill file, not in a library. The 2026-08-23
 * failures were both agents that would have been correct if they had run one
 * command; nothing told them to.
 *
 * So: pin the mention. Cheap, and it fails the day someone rewrites a skill
 * and drops the line — which is exactly how a written-down step goes quiet
 * (the `pr-opened` step was in loop-build the whole time it was being skipped).
 */

const read = (p) => fs.readFileSync(p, 'utf8');

test('LOOP_ENGINEERING.md carries the rule and the command', () => {
  const doc = read(DOC);
  assert.match(doc, /npm run clickup -- waiting/, 'the doc must name the command');
  assert.match(doc, /waiting on you without running `waiting` first/i, 'the doc must state the rule as a rule');
});

test('all three loop skills tell the agent to run it', () => {
  for (const p of SKILLS) {
    const s = read(p);
    assert.match(s, /npm run clickup -- waiting/, `${path.basename(path.dirname(p))} must name the command`);
    assert.match(
      s,
      /Never say something is waiting on Dane without checking/,
      `${path.basename(path.dirname(p))} must carry the rule heading`,
    );
  }
});

test('the command actually exists in the CLI the docs point at', () => {
  // A doc that names a command the script does not have is worse than no doc:
  // the agent runs it, gets the usage text, and learns the instruction is
  // decorative.
  const cli = read(CLI);
  assert.match(cli, /cmd === 'waiting'/, 'clickup_direct.mjs must implement `waiting`');
  assert.match(cli, /console\.error\('  waiting \[--task <id>\]/, 'and list it in its own usage');
});

test('`ask` carries the guard that stops a second ask', () => {
  const cli = read(CLI);
  assert.match(cli, /operatorSpokeLast\(/, '`ask` must consult the same rule `waiting` uses');
  assert.match(cli, /--after-his-answer/, 'and offer the on-the-record override');
});

/**
 * THE GUARD HAS TO STAND ON BOTH DOORS INTO HIS LANE.
 *
 * `ask` is one way in. `status --status "Needs your input" --no-card` is the
 * other, and it auto-assigns him just the same — so for one review cycle the
 * double-ask this ticket exists to stop still had a clear route, three lines
 * below a comment recording that the Ready-to-launch gate had already learned
 * this exact lesson ("`status --no-card` is the other door into that status,
 * so the gate has to stand on both", task 86bbjt18r).
 *
 * A guard that can be walked around is worse than none: it earns the belief
 * that the failure is now impossible. So pin the structure, not just the
 * mention — one shared refusal, reached from both commands.
 */
test('the already-answered guard stands on BOTH doors into his lane', () => {
  const cli = read(CLI);

  // One shared implementation, so the two callers cannot drift apart.
  assert.match(
    cli,
    /async function alreadyAnsweredRefused\(/,
    'the refusal must live in one function, not be copied into each caller',
  );

  // Both callers must actually reach it.
  const calls = cli.match(/await alreadyAnsweredRefused\(/g) || [];
  assert.ok(
    calls.length >= 2,
    `both \`ask\` and \`status\` must call the guard — found ${calls.length} call site(s)`,
  );

  // And specifically the `status --no-card` door, which is the one that was
  // missing. It sits beside the Ready-to-launch gate, which guards the same
  // command against the same shape of bypass.
  const statusCmd = cli.slice(cli.indexOf("} else if (cmd === 'status') {"));
  const statusBody = statusCmd.slice(0, statusCmd.indexOf("} else if (cmd === 'priority') {"));
  assert.match(
    statusBody,
    /alreadyAnsweredRefused\(/,
    '`status` (the --no-card door) must consult the guard, not only `ask`',
  );
  assert.match(
    statusBody,
    /readyToLaunchRefused\(/,
    'and it must still carry the Ready-to-launch gate beside it (task 86bbjt18r)',
  );
});

/**
 * A 2xx whose body is not JSON leaves `call()` holding `json: null`. Every
 * comment read that then says `json.comments` turns a carefully worded
 * refusal into an unhandled TypeError — at the one moment it matters, which
 * is when ClickUp is returning a gateway page instead of a ticket.
 */
test('the comment reads on THIS ticket\'s paths survive a 2xx with an unparseable body', () => {
  const cli = read(CLI);

  // Scoped to the code this ticket owns — the guard and the `waiting` command.
  // The same shape exists at eleven older call sites (bus-relay, pr-opened,
  // verdict, …); those are a real gap and a separate ticket, not something to
  // sweep into an unattended build pass.
  const guard = cli.slice(cli.indexOf('async function alreadyAnsweredRefused('));
  // Bounded at the command dispatch. `indexOf` returning -1 makes `slice`
  // count from the END, which silently hands back nearly the whole file
  // instead of the guard — so the marker is located first and asserted. It
  // drifted once already, when `const cmd` became `let cmd` (task 86bbr1u9v).
  const dispatchAt = guard.search(/\n(?:const|let) cmd = process\.argv\[2\];/);
  assert.ok(dispatchAt > 0, 'could not find the command dispatch — this test has drifted');
  const guardBody = guard.slice(0, dispatchAt);
  const waitingCmd = cli.slice(cli.indexOf("} else if (cmd === 'waiting') {"));
  const waitingBody = waitingCmd.slice(0, waitingCmd.indexOf("} else if (cmd === 'lists') {"));

  for (const [where, body] of [['the already-answered guard', guardBody], ['`waiting`', waitingBody]]) {
    assert.ok(body.length > 0, `could not locate ${where} in the CLI — the test has drifted`);
    assert.equal(
      (body.match(/\bjson\.comments\b/g) || []).length,
      0,
      `${where} must use \`json?.comments\` — \`call()\` leaves json null when a 2xx body is `
        + 'not JSON, and a refusal that throws first is not a refusal',
    );
  }
});
