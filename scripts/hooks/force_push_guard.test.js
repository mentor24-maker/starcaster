'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { findForcePush, splitCommands, inspectOne } = require('../lib/force_push_guard.cjs');
const { subcommands, findDenyRule } = require('../lib/permission_rules.cjs');

const HOOK = path.join(__dirname, 'explain_denied_commands.cjs');

/**
 * 2026-08-23 — an unattended loop-build run force-pushed despite four standing
 * deny rules. Recovered from the session transcripts, every instance was:
 *
 *     git -c credential.helper='<gh credential helper>' push --force-with-lease
 *
 * The rules are command-PREFIX globs, and that command begins `git -c`, not
 * `git push`. The `-c credential.helper=...` prefix is this repo's documented
 * way to push at all, so the house idiom walked through the house rule.
 *
 * Nothing here runs git. The guard's job is to refuse BEFORE git is reached,
 * so the enforcement point is the hook's exit code — actually performing a
 * force-push would add no evidence about the guard and would mean composing an
 * evasion, which the hook's own message forbids.
 *
 * EDITING NOTE: write this file with an editor, not a shell heredoc. The guard
 * inspects the whole Bash command string, so a heredoc carrying these examples
 * reads as an attempt to run them and is refused. That is the guard working.
 */

const CRED = String.fromCharCode(39) + '!gh auth git-credential' + String.fromCharCode(39);
const INCIDENT = `git -c credential.helper=${CRED} push --force-with-lease`;

// ── The forms that must be refused ─────────────────────────────────────────

const MUST_BLOCK = [
  [INCIDENT, 'the exact command from the incident'],
  ['git -c credential.helper="!gh auth git-credential" push --force', 'double-quoted config value'],
  ['git -C /tmp/sandbox push --force-with-lease', '-C consumes a directory, not the subcommand'],
  ['git --git-dir=/tmp/x/.git push --force', 'long-form global option'],
  ['git -c a=b -c c=d push --force-with-lease=main:abc', 'several globals, valued force flag'],
  ['git push --force', 'the plain form the deny rules already caught'],
  ['git push -f origin main', 'short flag'],
  ['git push origin main --force', 'flag last'],
  ['git push --force-if-includes origin main', 'the third force flag'],
  ['git push origin +main', 'a forcing refspec, with no flag anywhere'],
  ['git push origin +main:refs/heads/main', 'forcing refspec, fully qualified'],
  ['cd /tmp/x && git push --force-with-lease', 'compound with &&'],
  ['cd /tmp/x; git push --force', 'compound with a semicolon'],
  ['cd /tmp/x\ngit push --force-with-lease', 'separated by a newline only'],
  ['GIT_SSH_COMMAND="ssh -i /tmp/k" git push --force', 'leading env assignment'],
  ['/usr/bin/git push --force', 'absolute path to git'],
  ['npm test && git -c foo=bar push -f && echo done', 'buried in the middle of a chain'],
];

// ── The forms that must NOT be refused ─────────────────────────────────────

const MUST_ALLOW = [
  ['git push origin main', 'an ordinary push'],
  [`git -c credential.helper=${CRED} push`, 'the credential idiom WITHOUT a force flag'],
  ['git push --set-upstream origin topic', 'a flag that merely looks long'],
  ['git push --follow-tags', 'not a force flag'],
  ['git commit --amend', 'amending is fine; it is pushing the amendment that is not'],
  ['git fetch --force origin', '--force on a different subcommand'],
  ['git pull --force', 'likewise'],
  ['echo git push --force', 'a mention, not a call'],
  ['npm run ship', 'the sanctioned path, which merges rather than rebases'],
  ['git log --oneline -1', 'unrelated'],
];

test('the force-push guard refuses every reworded form', async (t) => {
  for (const [command, why] of MUST_BLOCK) {
    await t.test(`blocks: ${why}`, () => {
      const hit = findForcePush(command);
      assert.ok(hit, `must be refused (${why}): ${command}`);
      assert.ok(hit.reason, 'the message has to say WHICH part forces');
    });
  }
});

test('the force-push guard lets ordinary work through', async (t) => {
  for (const [command, why] of MUST_ALLOW) {
    await t.test(`allows: ${why}`, () => {
      assert.equal(findForcePush(command), null, `must NOT be refused (${why}): ${command}`);
    });
  }
});

test('the incident command is the one the old prefix rules missed', () => {
  // Pinning the actual hole, so a future "simplification" back to prefix
  // matching fails here rather than in production at 5am.
  assert.ok(findForcePush(INCIDENT), 'the guard must catch it');
  assert.notEqual(
    findDenyRule('git push --force-with-lease', __dirname),
    null,
    'sanity: the deny rules DO catch the plain form — the hole was only the prefix'
  );
});

test('quoted config values stay one token', () => {
  // The first draft of this guard split credential.helper='!gh auth git-credential'
  // into three tokens, so `-c` swallowed the wrong one and the parser never
  // reached `push` — it passed the incident command straight through.
  assert.ok(inspectOne(INCIDENT), 'a quoted value with spaces must not hide the subcommand');
});

test('splitCommands sees a newline as a separator', () => {
  assert.deepEqual(splitCommands('cd /tmp\ngit push --force'), ['cd /tmp', 'git push --force']);
  assert.ok(
    subcommands('cd /tmp\ngit push --force').includes('git push --force'),
    'the deny-rule matcher must split newlines too, or every rule misses a multi-line command'
  );
});

// ── The hook is the enforcement point ──────────────────────────────────────

function runHook(command, env = {}) {
  const payload = JSON.stringify({ tool_input: { command }, cwd: process.cwd() });
  try {
    execFileSync('node', [HOOK], {
      input: payload,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status, stderr: String(err.stderr || '') };
  }
}

test('the PreToolUse hook actually refuses, and says why', async (t) => {
  await t.test('exits 2 on the incident command', () => {
    const { code, stderr } = runHook(INCIDENT);
    assert.equal(code, 2, 'exit 2 is what blocks the tool call');
    assert.match(stderr, /BLOCKED/);
    assert.match(stderr, /force-with-lease/, 'name the offending flag');
    assert.match(stderr, /npm run ship/, 'offer the route that does not need a force-push');
  });

  await t.test('exits 0 on an ordinary push', () => {
    assert.equal(runHook('git push origin main').code, 0);
  });

  await t.test('SKIP_DENY_EXPLAIN=1 does NOT open a way around it', () => {
    // That variable silences an explanation. If it also silenced this, it would
    // be a one-word bypass of the very rule the guard exists to hold.
    assert.equal(runHook(INCIDENT, { SKIP_DENY_EXPLAIN: '1' }).code, 2);
  });

  await t.test('a malformed payload never wedges the tool', () => {
    try {
      execFileSync('node', [HOOK], { input: 'not json', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      assert.fail(`a broken payload must exit 0, got ${err.status}`);
    }
  });
});
