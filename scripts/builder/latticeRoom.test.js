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
 * ROUND 2 OF THE SAME LESSON is the second half of this file. The first
 * version of the ceiling asked its question per GROUP while the geometry it
 * polices is per COLUMN, so on the 5 two-column managers in the fixture a
 * correct left column hid a notched right one and the new assertion still
 * could not fail. Every test below whose name says "pair-column" exists
 * because of that send-back; between them they are what stops the fix being
 * the same shape as the defect.
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
function group({ declaredManager = true, fields = [], panelName = 'confetti', index = 3, pairs = 1 } = {}) {
  return { index, panelName, group: 'item manager 3', pairs, declaredManager, fields };
}

/**
 * One measured label/field pair. `labelW` is the track, `labelTextW` the words,
 * `labelBoxX` the column the pair sits in — which is what the harness buckets on.
 */
function field(name, labelW, labelTextW, labelBoxX = 0) {
  return {
    name, kind: '', full: false, labelW, labelTextW,
    labelTextX: labelBoxX, labelBoxX,
    fieldX: labelBoxX + labelW, fieldW: labelW, stretchable: true
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
  assert.match(failures[0], /362px wider than/);
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

test('a notch in ONE pair-column of a two-column manager fails', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // THE ROUND-1 SEND-BACK, as a test. The ceiling used to take `Math.min` over
  // the whole group, so the correct left column below pinned the minimum at
  // 40px and the 362px notch on the right was invisible. 5 of the 10 declared
  // managers in the fixture are two-column — `feature-cards`, `carousel`
  // (Slides and Cards), `program-list`, `blog-tag-cloud` — so the assertion
  // added to close a hole could not fail on half the blocks it covered.
  const twoColumn = group({
    panelName: 'feature-cards', index: 7, pairs: 2,
    fields: [
      field('Title', 96, 56, 0), field('Body', 96, 56, 0),
      field('Trigger', 418, 56, 500), field('Link', 418, 56, 500)
    ]
  });

  const failures = assertManagerRoom(twoColumn, 1440);
  assert.strictEqual(failures.length, 1, 'the notched column must fail on its own');
  assert.match(failures[0], /pair-column 2/, 'the failure has to name WHICH column');
  assert.match(failures[0], /362px wider than/);

  // And the correct column is not dragged down with it.
  assert.ok(!failures[0].includes('pair-column 1'));
});

test('a correct two-column manager still passes', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // The other direction of the same change: making the ceiling per-column must
  // not start failing the 5 two-column managers that are right today.
  assert.deepStrictEqual(
    assertManagerRoom(group({
      pairs: 2,
      fields: [
        field('Title', 96, 56, 0), field('Body', 138, 98, 0),
        field('Link', 96, 56, 500), field('Icon', 138, 98, 500)
      ]
    }), 1600),
    []
  );
});

test('the failure names the field whose room it is quoting', async () => {
  const { assertManagerRoom } = await import(path.join(UI, 'lattice-room.mjs'));

  // The headline number is the MINIMUM room in the column; the parenthetical
  // used to quote the widest-TEXT field instead, so where label widths differ
  // within a group the two numbers did not subtract to the headline. Here
  // "Trigger" has the widest text (56px) but 300px of room, while "On" has the
  // narrowest track and only 180px — so the headline must be 180, and the name
  // beside it must be "On", whose 200 - 20 is the 180 being reported.
  const failures = assertManagerRoom(group({
    fields: [field('Trigger', 356, 56), field('On', 200, 20)]
  }), 1440);

  assert.strictEqual(failures.length, 1);
  assert.match(failures[0], /180px wider than the label that fills it most \("On" needs 20px, the track is 200px\)/);
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

test('bucketFields is the ONE definition of a pair-column', async () => {
  const { bucketFields } = await import(path.join(UI, 'lattice-room.mjs'));

  // Shared with `assertLattice` on purpose. It used to be inline there and
  // absent from the ceiling, which is precisely how one assertion ended up
  // policing a different shape than the one beside it.

  // An UNDECLARED group stays one bucket even when labels start at two
  // x-positions — that is a stagger, and must keep failing as one rather than
  // being explained away as a second column.
  assert.strictEqual(
    bucketFields(group({ pairs: 1, fields: [field('A', 96, 56, 0), field('B', 96, 56, 500)] })).length,
    1
  );

  // A declared two-column manager splits by the label's own x, left to right.
  const buckets = bucketFields(group({
    pairs: 2,
    fields: [field('A', 96, 56, 500), field('B', 96, 56, 0), field('C', 96, 56, 500)]
  }));
  assert.strictEqual(buckets.length, 2);
  assert.deepStrictEqual(buckets.map((b) => b.map((f) => f.name)), [['B'], ['A', 'C']]);
});

test('single-pair columns are found, so a count never reads as a verdict', async () => {
  const { findUncomparableManagers } = await import(path.join(UI, 'lattice-room.mjs'));

  const panels = [
    group({ panelName: 'confetti', fields: [field('Trigger', 96, 56), field('Button Label', 138, 98)] }),
    group({ panelName: 'speech-bubble', index: 12, fields: [field('Trigger', 96, 56)] }),
    group({ panelName: 'tractor-nav', index: 27, fields: [field('Trigger', 96, 56)] }),
    group({ declaredManager: false, fields: [field('Style', 96, 56)] }),
    group({ panelName: 'feature-cards', fields: [] })
  ];

  // Two of the five: the two one-row managers. Not the undeclared group, not
  // the empty one (which has its own louder failure).
  const found = findUncomparableManagers(panels);
  assert.strictEqual(found.length, 2);
  assert.deepStrictEqual(found.map((f) => f.key), ['#12/item manager 3', '#27/item manager 3']);
});

test('a two-column manager holding ONE item is uncomparable in both columns', async () => {
  const { findUncomparableManagers } = await import(path.join(UI, 'lattice-room.mjs'));

  // The other half of the round-1 send-back. This group's total field count is
  // 2, so the old per-GROUP test called it comparable — while every
  // comparative assertion, which runs per bucket, had exactly one field to
  // look at in each column and could not fail in either.
  const found = findUncomparableManagers([group({
    panelName: 'program-list', index: 9, pairs: 2,
    fields: [field('Name', 96, 56, 0), field('Link', 96, 56, 500)]
  })]);

  assert.strictEqual(found.length, 2, 'both columns are uncomparable, and the group count hides it');
  assert.deepStrictEqual(
    found.map((f) => f.key),
    ['#9/item manager 3/pair-column 1', '#9/item manager 3/pair-column 2']
  );
});

test('the key is stable across widths, so three readings are one finding', async () => {
  const { findUncomparableManagers } = await import(path.join(UI, 'lattice-room.mjs'));

  // The harness measures at 1440/1600/1920 and used to ADD the count each
  // time, printing "9 declared manager(s)" for the 3 real blocks in the
  // fixture — three times the truth, on the one ticket whose acceptance
  // criterion is that a count must not read as a verdict.
  const panel = group({ panelName: 'tractor-nav', index: 66, fields: [field('Trigger', 96, 56)] });
  const keys = [1440, 1600, 1920].flatMap(() => findUncomparableManagers([panel]).map((f) => f.key));

  assert.strictEqual(new Set(keys).size, 1, 'one block measured three times is one key');
});
