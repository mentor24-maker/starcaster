'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'clickup_direct.mjs');
const source = fs.readFileSync(SCRIPT, 'utf8');

/**
 * Urgent is the human lane (ratified 2026-08-18): the Loop Queue sorts
 * priority-then-age, so an Urgent flag is a human override that outranks
 * everything the machine decided, with no other machinery needed — AS LONG
 * AS agents cannot set it themselves.
 *
 * Source-level, not behavioral: `clickup_direct.mjs` needs CLICKUP_API_TOKEN
 * (Doppler-supplied, DOCTRINE 4.1 — agents/CI never handle it directly) for
 * anything past the guard itself, so a subprocess test cannot run in CI.
 * Same reasoning, same pattern as shipThread.test.js's no-force-push guard.
 * The guard itself WAS driven for real, live, against a scratch ClickUp
 * task (86bbgm68r) — both the refused and allowed forms of `task`, both
 * directions of `priority`, and the queue-ordering effect — see the PR body
 * for the transcript; that verification cannot be replayed in `node --test`
 * without a live token, which is exactly why this file exists.
 */

/** Executable source only: comments explain the rule and must not trip it. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = withoutComments(source);

test('creating a task refuses urgent priority without --operator-asked', () => {
  const taskBlock = code.slice(code.indexOf("cmd === 'task'"), code.indexOf("cmd === 'chat'"));
  assert.match(taskBlock, /toLowerCase\(\)\s*===\s*'urgent'/, 'must check the requested priority for urgent');
  assert.match(taskBlock, /!flag\('operator-asked'\)/, 'must require the confirmation flag');
  assert.match(taskBlock, /process\.exit\(1\)/, 'a missing confirmation must stop the command');
});

test('the urgent guard runs BEFORE any network call — nothing is created on a refusal', () => {
  const taskBlock = code.slice(code.indexOf("cmd === 'task'"), code.indexOf("cmd === 'chat'"));
  const guardIndex = taskBlock.search(/toLowerCase\(\)\s*===\s*'urgent'/);
  const firstCallIndex = taskBlock.indexOf("call('POST'");
  assert.ok(guardIndex > -1 && firstCallIndex > -1, 'both the guard and the POST call must exist');
  assert.ok(guardIndex < firstCallIndex, 'the guard must run before the task is created, not after');
});

test('a new `priority` command exists, guarded the same way, and works in both directions', () => {
  assert.match(code, /cmd === 'priority'/, 'the priority subcommand must exist');
  const priorityBlock = code.slice(code.indexOf("cmd === 'priority'"), code.indexOf("cmd === 'comment'"));

  assert.match(priorityBlock, /!flag\('operator-asked'\)/, 'same confirmation flag is required for urgent here too');
  assert.match(priorityBlock, /process\.exit\(1\)/);

  // Read-back verification, not a trust-the-200 write — same discipline as
  // `status`'s own was -> now check.
  assert.match(priorityBlock, /before\.json\.priority\?\.priority/, 'must read the priority BEFORE the write');
  assert.match(priorityBlock, /out\.json\.priority\?\.priority/, 'must verify from the write\'s own response');
  assert.match(priorityBlock, /now\s*!==\s*wanted/, 'a priority that did not stick must be caught, not assumed');

  // Lowering must not require the flag: only urgent is guarded.
  const guardIndex = priorityBlock.search(/wanted === 'urgent'/);
  assert.ok(guardIndex > -1, 'the guard must be conditioned on urgent specifically, not on every priority change');
});

test('an unrecognized priority name is rejected before anything is attempted', () => {
  const priorityBlock = code.slice(code.indexOf("cmd === 'priority'"), code.indexOf("cmd === 'comment'"));
  assert.match(priorityBlock, /!\(wanted in PRIORITY\)/, 'must validate against the known priority set');
});

test('the guard is documented in usage(), so it is discoverable without reading the source', () => {
  assert.match(source, /operator-asked/i);
  assert.match(source, /priority --task/);
});

test('the comment-stripper does not defeat the tests it feeds', () => {
  assert.ok(code.includes("cmd === 'priority'"), 'executable code survived stripping');
  assert.ok(!code.includes('ratified 2026-08-18'), 'the file header block comment was stripped');
  assert.ok(code.length > 5000, 'stripping left a plausible amount of code');
});
