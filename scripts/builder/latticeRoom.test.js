/**
 * THE LABEL-TRACK CEILING, AND WHY IT IS TESTED HERE AT ALL (task 86bbufmdt).
 *
 * `check_panels` is the gate CI cannot run — CI has no browser — so it exists
 * on the honour system, and the Definition of done's answer is "break it on
 * purpose and watch it fail". On 2026-09-03 that step was performed on the
 * Trigger panel and both deliberate breaks came back GREEN, including
 * reverting the exact `grid-template-columns` line PR #449 had just shipped to
 * fix a 268px notch. A check that cannot fail is worse than no check, because
 * it gets reported as evidence.
 *
 * The assertion that closes that hole is deliberately pure — it reads numbers
 * the harness has already measured — so unlike every other assertion in that
 * file it CAN be held in place by a test that needs no browser, no server, no
 * database and no fixture. These are that test.
 *
 * The geometry in the fixtures below is not invented. It is what the real
 * harness measured against the seeded fixture on 2026-09-05, at
 * 1440/1600/1920px, with and without the break.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const UI = path.join(__dirname, '..', 'ui');

/** A measured group, in the shape `measure()` returns from the browser. */
function group({ declaredManager = true, fields = [], panelName = 'confetti', index = 3 } = {}) {
  return { index, panelName, group: 'item manager 3', pairs: 1, declaredManager, fields };
}

/** One measured label/field pair. `labelW` is the track, `labelTextW` the words. */
function field(name, labelW, labelTextW) {
  return {
    name, kind: '', full: false, labelW, labelTextW,
    labelTextX: 0, labelBoxX: 0, fieldX: labelW, fieldW: labelW, stretchable: true
  };
}

test('the break that reverting PR #449 reintroduces now FAILS', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // Measured 2026-09-05 with `grid-template-columns` reverted to three
  // proportional `minmax(0, 1fr)` tracks: the label track resolves to 418px to
  // carry the 56px word "Trigger" — 362px of spare room, which IS the notch.
  const failures = assertManagerRoom(
    group({ fields: [field('Trigger', 418, 56)] }), 1440
  );

  assert.strictEqual(failures.length, 1, 'the reverted grid must produce exactly one failure');
  assert.match(failures[0], /362px wider than its longest label/);
  assert.match(failures[0], /1440px panel #3 \(confetti\)/, 'a failure has to name the panel');
});

test('it bites at n=1, where every comparative assertion is vacuous', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // Three of the four Trigger blocks render ONE row (speech-bubble,
  // tractor-nav x2). That is the shape the four `new Set(...).length > 1`
  // assertions cannot fail on, and the reason this one is not a comparison.
  const one = assertManagerRoom(
    group({ panelName: 'speech-bubble', fields: [field('Trigger', 418, 56)] }), 1920
  );
  assert.strictEqual(one.length, 1, 'a single-row manager must still be assertable');
});

test('the correct build passes — every declared manager measured exactly 40px', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // All 30 declared-manager groups on the correct build, across all three
  // widths, measured a minimum room of exactly 40 — the --builder-field-room
  // token, zero variance. If this ever fails, the ceiling has been set below
  // what the app legitimately renders.
  assert.deepStrictEqual(
    assertManagerRoom(group({ fields: [field('Trigger', 96, 56), field('Button Label', 138, 98)] }), 1440),
    []
  );
});

test('the ceiling clears the loosest group the app legitimately renders', async () => {
  const { assertManagerRoom, MANAGER_ROOM_CEILING } = await import(path.join(UI, 'lattice-room.mjs'));

  // 133px is the widest spare room measured anywhere in the app: the
  // `breadcrumb` Content column, whose label track is a shared fixed token and
  // so is legitimately wider than its shortest label. It is not a manager and
  // so is not policed here, but the ceiling must clear it anyway — a manager
  // adopting the same shared token later would be just as correct.
  assert.ok(MANAGER_ROOM_CEILING > 133, 'the ceiling must sit above the loosest legitimate group');
  assert.deepStrictEqual(
    assertManagerRoom(group({ fields: [field('Separator', 189, 56)] }), 1440),
    []
  );
});

test('a group that did NOT declare data-lattice-pairs is left alone', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // An axis column's label track is a token shared across every panel in the
  // app, so a short label in it legitimately has room to spare. Policing those
  // would fail 600-odd correct groups; that is why the scope is the
  // declaration.
  assert.deepStrictEqual(
    assertManagerRoom(group({ declaredManager: false, fields: [field('Style', 418, 56)] }), 1440),
    []
  );
});

test('an empty manager is left to the existing "rendered no rows" failure', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // check_panels already fails an empty declared manager with a message that
  // names the seeder. Two failures for one cause would send the reader looking
  // for two problems.
  assert.deepStrictEqual(assertManagerRoom(group({ fields: [] }), 1440), []);
});

test('single-pair managers are counted, so a count never reads as a verdict', async () => {
  const { countUncomparableManagers } = await import(path.join(UI, 'lattice-room.mjs'));

  const panels = [
    group({ panelName: 'confetti', fields: [field('Trigger', 96, 56), field('Button Label', 138, 98)] }),
    group({ panelName: 'speech-bubble', fields: [field('Trigger', 96, 56)] }),
    group({ panelName: 'tractor-nav', fields: [field('Trigger', 96, 56)] }),
    group({ declaredManager: false, fields: [field('Style', 96, 56)] }),
    group({ panelName: 'feature-cards', fields: [] })
  ];

  // Two of the five: the two one-row managers. Not the undeclared group, not
  // the empty one (which has its own louder failure).
  assert.strictEqual(countUncomparableManagers(panels), 2);
});
