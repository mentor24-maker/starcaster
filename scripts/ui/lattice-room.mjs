/**
 * THE LABEL TRACK HAS A CEILING, NOT ONLY A FLOOR (task 86bbufmdt).
 *
 * `check_panels` has always asked whether a label track is too NARROW — the
 * operator's rule is "40px more than the longest string", and a track that fits
 * the text exactly is the cramped look W0 was written against. It never asked
 * whether a track was too WIDE, and that is the other half of the same rule: a
 * label track hugely wider than the longest label it carries is the notch that
 * pushes every control in the block sideways.
 *
 * WHY THIS EXISTS AS ITS OWN FILE
 * On 2026-09-03, while merging PR #449 ("Panel sweep 8/15"), the Definition of
 * done's "break it on purpose and watch it fail" step was performed on the
 * Trigger panel and BOTH deliberate breaks came back green — including
 * reverting the exact `grid-template-columns` line the sweep had just shipped.
 * A check that cannot fail is worse than no check, because it gets reported as
 * evidence. Two things were wrong, and neither was the blanket blindness the
 * defect ticket assumed:
 *
 *   1. `room = labelW - labelTextW` was only ever compared against a MINIMUM.
 *      Under the reverted grid the Trigger block measured labelW=418 against a
 *      labelTextW of 56 — 362px of room, the notch itself, as a number the
 *      harness had already computed and thrown away.
 *
 *   2. Three of the four Trigger blocks render a single row, and every other
 *      lattice assertion is a `new Set(...).length > 1` comparison between
 *      fields. At n=1 they are vacuous. `check_panels` already knows this trap
 *      — it is why a shared lattice needs `shared.length > 1` before it is
 *      measured at all — but the declared-manager list carried no such guard.
 *
 * The assertion below fixes (1), and it fixes it for n=1 too, because it is a
 * property of one field set rather than a comparison between fields.
 * `findUncomparableManagers` addresses (2) by making the shape visible in the
 * harness's own output, so a count can never again read as a verdict.
 *
 * EVERYTHING HERE IS PER PAIR-COLUMN, AND THAT IS ROUND 2 OF THE SAME LESSON.
 * The first version of this file asked its question per GROUP: it took
 * `Math.min` over every field in the manager and ran once, outside the bucket
 * loop the floor check runs inside. On a `data-lattice-pairs="2"` manager a
 * correct left column pinned that minimum at 40px and a notched right column
 * was invisible — 5 of the 10 declared managers in the fixture are two-column
 * (`feature-cards`, `carousel/Slides`, `carousel/Cards`, `program-list`,
 * `blog-tag-cloud`), so the assertion added to close a hole still could not
 * fail on half the blocks it covered. Review sent it back on 2026-09-05 for
 * exactly that. `bucketFields` is now the ONE definition of what a pair-column
 * is, shared with `assertLattice`, so the ceiling and the floor can never
 * again be asking different questions about the same geometry.
 *
 * Pure and dependency-free on purpose: everything else in `check_panels.mjs`
 * needs a browser, a server, a database and a seeded fixture, so none of it can
 * be tested in CI. This can, and is — `scripts/builder/latticeRoom.test.js`.
 */

/**
 * The most room a declared item manager's label track may have beyond its
 * longest label, in pixels.
 *
 * MEASURED, not proposed (2026-09-05, against the seeded fixture at
 * 1440/1600/1920px):
 *
 *   every declared manager, correct build   40px exactly, all 30 groups,
 *                                           zero variance — it is the
 *                                           `--builder-field-room` token
 *   loosest group anywhere in the app       133px (`breadcrumb` / Content, a
 *                                           non-manager axis column, whose
 *                                           label track is a shared fixed
 *                                           token and so is legitimately
 *                                           wider than its shortest label)
 *   the Trigger notch this ticket exists    362px
 *   for
 *
 * 140 sits above every legitimate value the app renders today — including the
 * loosest non-manager group, which this does not even police — and 2.6x below
 * the defect. It is deliberately not 40 + a few pixels: a manager that later
 * adopts a shared fixed-width label token would be as legitimate as the
 * breadcrumb column is, and this must not fail it for that.
 */
export const MANAGER_ROOM_CEILING = 140;

/**
 * THE ONE DEFINITION OF A PAIR-COLUMN, shared by every assertion that has an
 * opinion about one.
 *
 * W0 is a per-COLUMN rule. A manager that puts two label/field pairs on a row
 * (L6a — the Feature Cards manager) has two columns inside it, and each is held
 * to the rule on its own. Bucketing is by the label's own x, and ONLY for a
 * group that declared more than one pair: an undeclared group stays a single
 * bucket, so a genuine stagger still fails rather than being explained away as
 * a second column.
 *
 * This lives here, rather than inline in `assertLattice` where it started,
 * because the label-room ceiling got it wrong by not using it at all — see the
 * header. Two definitions of "column" is how one assertion ends up policing a
 * different shape than the one beside it.
 */
export function bucketFields(panel) {
  const fields = panel?.fields || [];
  const declared = panel?.pairs || 1;
  if (declared <= 1) return [fields];
  return [...new Map(fields.map((f) => [f.labelBoxX, null])).keys()]
    .sort((a, b) => a - b)
    .map((x) => fields.filter((f) => f.labelBoxX === x));
}

/**
 * Scoped to DECLARED MANAGERS, and that is the whole point of the scope.
 *
 * A manager carrying `data-lattice-pairs` is a self-contained lattice saying
 * "measure me" — its label track is sized from its own content, so room beyond
 * the token is a defect. An axis column's track is a shared token deliberately
 * uniform across every panel in the app, so a short label in it legitimately
 * has room to spare; the breadcrumb column's 133px is correct, and policing it
 * here would fail 600-odd groups for obeying the rule.
 *
 * This is also precisely what the ticket's acceptance criteria ask for:
 * `data-lattice-pairs` should carry an assertion that CAN fail, rather than
 * buying a block a place in the count.
 */
export function assertManagerRoom(panel, width) {
  if (!panel?.declaredManager) return [];
  if (!(panel.fields || []).length) return [];

  const buckets = bucketFields(panel);
  const failures = [];

  for (const [bi, fields] of buckets.entries()) {
    if (!fields.length) continue;

    const measured = fields
      .map((f) => ({ field: f, room: f.labelW - f.labelTextW }))
      .filter((m) => Number.isFinite(m.room));
    if (!measured.length) continue;

    // The MINIMUM, matching the floor check in `assertLattice` exactly — same
    // number, same bucket, opposite direction. The longest label is what sizes
    // the track, so the room around it is the room the track actually has
    // spare. Using the maximum would instead measure the shortest label, which
    // in any multi-row block is a number about that label rather than about
    // the track.
    //
    // The field NAMED is the one that achieves that minimum, not the one with
    // the widest text. Those are the same field whenever the labels in a
    // column share a width — which the assertion directly above this one
    // enforces — but under a break they need not be, and quoting the widest
    // text beside the smallest room printed two numbers that did not subtract
    // to the headline figure.
    const tightest = measured.reduce((a, b) => (a.room <= b.room ? a : b));
    if (tightest.room <= MANAGER_ROOM_CEILING) continue;

    failures.push(
      `${where(panel, width, bi, buckets.length)}: label track is ${tightest.room}px wider than ` +
      `the label that fills it most ("${tightest.field.name}" needs ${tightest.field.labelTextW}px, ` +
      `the track is ${tightest.field.labelW}px) — the rule asks for 40px of room ` +
      `(--builder-field-room) and the ceiling is ${MANAGER_ROOM_CEILING}px. A declared manager ` +
      'sizes its label track from its own content, so this is a notch pushing every control in ' +
      'the block sideways — usually a proportional `1fr` track where the block wants `max-content`.'
    );
  }

  return failures;
}

/**
 * Which declared pair-columns rendered fewer than two label/field pairs.
 *
 * Not a failure. A single-row manager can be entirely correct — the Trigger
 * block on a module that is not Confetti genuinely has one row, and there is
 * nothing to seed that would give it a second. What it is NOT is evidence
 * about the four comparative assertions, which at n=1 have nothing to compare
 * and therefore cannot fail.
 *
 * PER COLUMN, for the same reason the ceiling is: the comparative assertions
 * run inside the bucket loop, so a two-column manager holding a single item
 * has every one of them vacuous in both columns while its group-wide field
 * count is a perfectly comparable-looking 2.
 *
 * Returns descriptors rather than a number so the caller can de-duplicate
 * across widths. Summing the count over three widths printed "9 declared
 * managers" for 3 real blocks — a number that reads as three times the truth,
 * on the one ticket whose acceptance criterion is that a count must not read
 * as a verdict.
 */
export function findUncomparableManagers(panels) {
  const found = [];
  for (const panel of panels || []) {
    if (!panel?.declaredManager) continue;
    if (!(panel.fields || []).length) continue;      // the empty manager has its own, louder failure
    const buckets = bucketFields(panel);
    for (const [bi, fields] of buckets.entries()) {
      if (fields.length >= 2) continue;
      found.push({
        // Stable across widths on purpose: the same block at 1440/1600/1920 is
        // one finding measured three times, not three findings.
        key: `#${panel.index}/${panel.group}${buckets.length > 1 ? `/pair-column ${bi + 1}` : ''}`,
        label: `panel #${panel.index}${panel.panelName ? ` (${panel.panelName})` : ''} / ${panel.group}`
          + (buckets.length > 1 ? ` pair-column ${bi + 1}` : '')
      });
    }
  }
  return found;
}

/** The same location string the rest of the harness prints, so failures sort together. */
function where(panel, width, bucketIndex, bucketCount) {
  const name = panel.panelName ? ` (${panel.panelName})` : '';
  const column = bucketCount > 1 ? ` pair-column ${bucketIndex + 1}` : '';
  return `${width}px panel #${panel.index}${name} / ${panel.group}${column}`;
}
