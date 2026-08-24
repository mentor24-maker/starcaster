'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'explain_denied_commands.cjs');
const { patternToRegExp, subcommands, findDenyRule } = require('../lib/permission_rules.cjs');

/**
 * The PreToolUse hook that tells a denial apart from a refusal.
 *
 * The case that matters is the 2026-08-14 one: `git push --force-with-lease`
 * against a `Bash(git push --force*)` deny rule. If that does not block here
 * with the rule named, the hook has not solved anything -- the agent would
 * again read the vague refusal as a one-off and spend an operator decision on
 * a question already answered.
 */

function makeProject(denyList) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denyexplain-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { deny: denyList } })
  );
  return dir;
}

function runHook(dir, command) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      cwd: dir,
      tool_input: { command },
    }),
    encoding: 'utf8',
    env: { ...process.env, SKIP_DENY_EXPLAIN: '', HOME: dir },
  });
  return { code: result.status, stderr: result.stderr || '' };
}

test('BLOCKS the real 2026-08-14 case and names the rule', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  const { code, stderr } = runHook(dir, 'git push --force-with-lease');

  assert.equal(code, 2, 'must block');
  assert.match(stderr, /STANDING RULE/);
  assert.match(stderr, /Bash\(git push --force\*\)/);
  assert.match(stderr, /settings\.json/);
  // The whole point: it must steer away from asking the operator.
  assert.match(stderr, /Do NOT ask him to approve it/);
  assert.match(stderr, /Find another route/);
});

test('BLOCKS the other force spellings on the operator\'s real list', () => {
  const dir = makeProject([
    'Bash(git push --force*)',
    'Bash(git push -f *)',
    'Bash(git push * --force*)',
    'Bash(git push * -f)',
  ]);
  for (const cmd of [
    'git push --force',
    'git push --force-with-lease',
    'git push -f origin main',
    'git push origin --force-with-lease',
    'git push origin -f',
  ]) {
    assert.equal(runHook(dir, cmd).code, 2, cmd);
  }
});

test('warns against rewording past the rule, which is the obvious wrong move', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  assert.match(runHook(dir, 'git push --force').stderr, /do NOT reword the command to slip past/i);
});

test('stays out of the way for ordinary commands', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  for (const cmd of ['git push', 'git status', 'npm run build', 'git push -u origin topic']) {
    assert.equal(runHook(dir, cmd).code, 0, cmd);
  }
});

test('catches a denied command hidden in a compound line', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  assert.equal(runHook(dir, 'npm run build && git push --force-with-lease').code, 2);
});

test('strips leading VAR=value the way the permission system does', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  assert.equal(runHook(dir, 'GIT_TRACE=1 git push --force-with-lease').code, 2);
});

/**
 * The three tests below are about the deny-rule EXPLANATION path -- what
 * happens when there is no rule, when the settings file is broken, and when
 * the explanation is silenced. They used a force-push as their example
 * command, which stopped working on 2026-08-23 when the force-push guard
 * started refusing those before the explanation is ever reached, regardless of
 * settings (see `scripts/hooks/force_push_guard.test.js`).
 *
 * So they now use `rm -rf /` instead: denied by a rule in the first test's
 * project, and otherwise an ordinary command as far as this hook is concerned.
 * Testing "does the explanation fire" with a command the guard blocks outright
 * would only ever re-test the guard.
 */
test('no deny rules configured means it never fires', () => {
  const dir = makeProject([]);
  assert.equal(runHook(dir, 'rm -rf /tmp/whatever').code, 0);
});

test('a malformed settings file must not wedge every command', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denyexplain-bad-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
  assert.equal(runHook(dir, 'rm -rf /tmp/whatever').code, 0);
});

test('SKIP_DENY_EXPLAIN=1 silences the explanation', () => {
  const dir = makeProject(['Bash(rm -rf *)']);
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: dir, tool_input: { command: 'rm -rf /tmp/whatever' } }),
    encoding: 'utf8',
    env: { ...process.env, SKIP_DENY_EXPLAIN: '1', HOME: dir },
  });
  assert.equal(result.status, 0, 'the explanation is silenced');
});

test('SKIP_DENY_EXPLAIN=1 does NOT silence the force-push guard', () => {
  // Otherwise one environment variable would be a way around a standing rule,
  // which is the class of hole the guard exists to close.
  const dir = makeProject(['Bash(git push --force*)']);
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: dir, tool_input: { command: 'git push --force' } }),
    encoding: 'utf8',
    env: { ...process.env, SKIP_DENY_EXPLAIN: '1', HOME: dir },
  });
  assert.equal(result.status, 2);
});

test('a force-push is refused even with no deny rules readable at all', () => {
  // "The rule file could not be read" must never read as "go ahead".
  const dir = makeProject([]);
  assert.equal(runHook(dir, 'git push --force-with-lease').code, 2);
});

test('unparseable hook input never blocks', () => {
  assert.equal(spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' }).status, 0);
});

test('an empty command is ignored', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  assert.equal(runHook(dir, '   ').code, 0);
});

test('patternToRegExp anchors, so a rule cannot match a longer command by accident', () => {
  assert.ok(patternToRegExp('git push').test('git push'));
  assert.ok(!patternToRegExp('git push').test('git push --force'), 'exact rule must not match extra args');
  assert.ok(patternToRegExp('git push *').test('git push origin main'));
});

test('patternToRegExp treats regex metacharacters in a rule as literal text', () => {
  assert.ok(patternToRegExp('rm -rf /(tmp)').test('rm -rf /(tmp)'));
  assert.ok(!patternToRegExp('a.c').test('abc'), 'a dot is a dot, not any-character');
});

test('subcommands splits on every operator and keeps the whole line too', () => {
  const parts = subcommands('a && b || c ; d | e');
  for (const expected of ['a', 'b', 'c', 'd', 'e']) assert.ok(parts.includes(expected), expected);
  assert.ok(parts.includes('a && b || c ; d | e'), 'the whole line is a candidate as well');
});

test('findDenyRule reports which rule matched and what it matched on', () => {
  const dir = makeProject(['Bash(git push --force*)']);
  const hit = findDenyRule('npm run build && git push --force-with-lease', dir);
  assert.equal(hit.rule, 'Bash(git push --force*)');
  assert.equal(hit.matched, 'git push --force-with-lease');
  assert.match(hit.source, /settings\.json/);
});
