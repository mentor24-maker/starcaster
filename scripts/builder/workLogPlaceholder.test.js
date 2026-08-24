'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { fillNewestPlaceholder, commitAndPushWorkLog } = require('./workLogPlaceholder');

/**
 * Task 86bbk1r7w. Three branches red in one day (#377, #420, #418) on the same
 * assertion, none of them for a reason connected to their work.
 *
 * The guard is right and stays. What moves is WHEN the number gets filled in:
 * out of "remember to go back afterwards" and into `pr-opened`, which already
 * runs at the only moment the number is known and the pass has not moved on.
 *
 * The two rules worth defending here are both about NOT doing too much:
 * only the newest entry is touched, and only one file is committed.
 */

const NEWEST = '## 2026-08-24 — The newest thing (#PR)';
const OLDER = '## 2026-08-23 — Somebody else\'s open branch (#PR)';

function logWith(...headings) {
  return headings.map((h) => `${h}\n\nSome body text.\n`).join('\n');
}

// ── Only the newest entry ────────────────────────────────────────────────

test('the newest entry gets the number', () => {
  const out = fillNewestPlaceholder(logWith(NEWEST), '418');
  assert.equal(out.changed, true);
  assert.match(out.text, /## 2026-08-24 — The newest thing \(#418\)/);
});

test('an OLDER placeholder is never touched', () => {
  // It belongs to another open branch, or is inherited from a main this
  // branch has not caught up with. Stamping this PR's number onto it would be
  // worse than the bug: it would attribute one PR's work to another.
  const out = fillNewestPlaceholder(logWith(NEWEST, OLDER), '418');
  assert.equal(out.changed, true);
  assert.match(out.text, /The newest thing \(#418\)/);
  assert.match(out.text, /Somebody else's open branch \(#PR\)/, 'the older one must survive untouched');
  assert.equal((out.text.match(/\(#PR\)/g) || []).length, 1);
});

test('a newest entry that already has its number is left alone, quietly', () => {
  const out = fillNewestPlaceholder(logWith('## 2026-08-24 — Already done (#417)', OLDER), '418');
  assert.equal(out.changed, false);
  assert.match(out.why, /already carries its number/);
  assert.match(out.text, /Somebody else's open branch \(#PR\)/, 'it must not reach past the newest to "help"');
});

test('body text is left alone — the number belongs in the heading', () => {
  const src = '## 2026-08-24 — A thing (#PR)\n\nsomething something (#PR)\n';
  const out = fillNewestPlaceholder(src, '418');
  assert.match(out.text, /A thing \(#418\)/);
  assert.match(out.text, /something something \(#PR\)/);
});

// ── Bad input does nothing rather than something wrong ───────────────────

test('a PR number that is not a number fills nothing', () => {
  for (const bad of ['', null, undefined, 'abc', '12a', '#', {}]) {
    const out = fillNewestPlaceholder(logWith(NEWEST), bad);
    assert.equal(out.changed, false, `should refuse ${JSON.stringify(bad)}`);
    assert.match(out.text, /\(#PR\)/, 'the placeholder must survive a refusal');
  }
});

test('a leading # on the number is accepted, not doubled', () => {
  const out = fillNewestPlaceholder(logWith(NEWEST), '#418');
  assert.match(out.text, /\(#418\)/);
  assert.doesNotMatch(out.text, /\(##418\)/);
});

test('an empty or heading-less file does nothing and does not throw', () => {
  assert.equal(fillNewestPlaceholder('', '418').changed, false);
  assert.equal(fillNewestPlaceholder(null, '418').changed, false);
  assert.equal(fillNewestPlaceholder('just prose, no headings\n', '418').changed, false);
});

// ── One file, by path, never -A ──────────────────────────────────────────

function gitSpy(overrides = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const key = args[0];
    if (overrides[key]) return overrides[key];
    return { ok: true, stdout: '', stderr: '' };
  };
  return { calls, run };
}

test('it stages exactly one path and never uses -A', () => {
  // Staging is whole-file here and the tree often carries somebody else's
  // pending edits (CLAUDE.md landmine 5). A `git add -A` would commit them.
  const spy = gitSpy();
  const out = commitAndPushWorkLog({ runGit: spy.run, cwd: '/x', prNumber: '418' });
  assert.equal(out.ok, true);

  const add = spy.calls.find((c) => c[0] === 'add');
  assert.deepEqual(add, ['add', '--', 'docs/WORK-LOG.md']);
  const flat = spy.calls.flat();
  assert.ok(!flat.includes('-A'), `no call may use -A: ${JSON.stringify(spy.calls)}`);
  assert.ok(!flat.includes('.'), 'no call may stage the whole tree');

  const commit = spy.calls.find((c) => c[0] === 'commit');
  assert.ok(commit.includes('--') && commit.includes('docs/WORK-LOG.md'),
    'the commit itself must be scoped to the path too');
});

test('a failed push is a failure, not a shrug', () => {
  // Recording the PR link on the ticket while the placeholder still ships is
  // exactly the state this exists to prevent.
  const spy = gitSpy({ push: { ok: false, stdout: '', stderr: 'rejected' } });
  const out = commitAndPushWorkLog({ runGit: spy.run, cwd: '/x', prNumber: '418' });
  assert.equal(out.ok, false);
  assert.match(out.why, /could NOT push/);
});

test('a failed stage or commit is reported, not pushed past', () => {
  for (const step of ['add', 'commit']) {
    const spy = gitSpy({ [step]: { ok: false, stdout: '', stderr: 'boom' } });
    const out = commitAndPushWorkLog({ runGit: spy.run, cwd: '/x', prNumber: '418' });
    assert.equal(out.ok, false, `${step} failure must stop it`);
    assert.ok(!spy.calls.some((c) => c[0] === 'push'), `nothing may be pushed after a failed ${step}`);
  }
});

// ── pr-opened must actually call it ──────────────────────────────────────

test('pr-opened fills the placeholder, after the trail is verified', () => {
  const src = fs.readFileSync(path.join(__dirname, '../clickup_direct.mjs'), 'utf8');

  const verified = src.indexOf('read back and parsed by the merge step');
  const fill = src.indexOf('fillNewestPlaceholder');
  assert.ok(verified > -1, 'the trail verification must still be there');
  assert.ok(fill > -1, 'pr-opened must fill the placeholder');
  assert.ok(fill > verified, 'fill AFTER the trail is verified — a ticket with no readable PR trail is the bigger failure');

  // A skip that does not report is a false all-clear (DOCTRINE 3.11).
  assert.match(src, /already had uncommitted changes/, 'a dirty work log must be reported, not silently skipped');
  assert.match(src, /CI will go red on it/, 'a failure to record must name the consequence');
});

test('the real work log has no unfilled heading — the condition this prevents', () => {
  // Belt and braces alongside workLog.test.js: if this branch ever ships one,
  // both fail and the message says which is which.
  const log = fs.readFileSync(path.join(__dirname, '../../docs/WORK-LOG.md'), 'utf8');
  const left = log.split('\n').filter((l) => l.startsWith('## ') && l.includes('(#PR)'));
  assert.deepEqual(left, [], `unfilled heading(s):\n  ${left.join('\n  ')}`);
});
