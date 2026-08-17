'use strict';

/**
 * Guards scripts/check_model_ids.cjs — the gate that keeps retired AI model ids
 * out of the codebase.
 *
 * This test exists because the check's first implementation was wrong in a way
 * that looked right. Staged mode scanned only the diff's *added* lines, so a
 * retired id that already existed in HEAD and merely moved within the file read
 * as unchanged context and was skipped — silently passing the exact case the
 * check was written for. It was caught only by deliberately reintroducing a dead
 * id and watching the gate stay green (docs/DOCTRINE.md: break it on purpose
 * before believing the pass).
 *
 * So the assertions below are deliberately about BLOCKING, not about passing: a
 * check that never fires is indistinguishable from a clean repo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { run, RETIRED } = require('../check_model_ids.cjs');

test('the retired list is non-empty and well formed', () => {
  assert.ok(RETIRED.length > 0, 'no retired ids listed — the gate would never fire');
  for (const entry of RETIRED) {
    assert.equal(entry.length, 3, `expected [id, why, replacement], got ${JSON.stringify(entry)}`);
    const [id, why, replacement] = entry;
    assert.ok(id && typeof id === 'string', 'id must be a non-empty string');
    assert.ok(why && typeof why === 'string', `${id}: missing the reason it is dead`);
    assert.ok(replacement && typeof replacement === 'string', `${id}: missing a replacement`);
    assert.notEqual(id, replacement, `${id}: replacement must differ from the retired id`);
  }
});

test('replacements are not themselves retired', () => {
  const retiredIds = new Set(RETIRED.map(([id]) => id));
  for (const [id, , replacement] of RETIRED) {
    assert.ok(
      !retiredIds.has(replacement),
      `${id} points at ${replacement}, which is also on the retired list`
    );
  }
});

test('replacements carry no date suffix', () => {
  // Current ids are complete as written ("claude-sonnet-5"). A trailing -YYYYMMDD
  // is the shape of the dated snapshots that keep getting retired.
  for (const [id, , replacement] of RETIRED) {
    assert.ok(
      !/-\d{8}$/.test(replacement),
      `${id} points at ${replacement}, which carries a date suffix`
    );
  }
});

test('the repo is currently clean of retired ids', () => {
  const { failures } = run({ all: true });
  assert.deepEqual(failures, [], `retired model id(s) present:\n${failures.join('\n')}`);
});

test('a full --all scan actually reads files', () => {
  // A scan that silently reads nothing reports zero failures and looks identical
  // to a clean repo. Assert it says how much it covered (docs/DOCTRINE.md 3.11).
  const { notes } = run({ all: true });
  const scanned = notes.find((n) => n.startsWith('model ids: scanned '));
  assert.ok(scanned, `no coverage note emitted; got: ${JSON.stringify(notes)}`);
  const count = Number(scanned.match(/scanned (\d+) file/)?.[1] ?? 0);
  assert.ok(count > 50, `only ${count} file(s) scanned — the glob is probably wrong`);
});
