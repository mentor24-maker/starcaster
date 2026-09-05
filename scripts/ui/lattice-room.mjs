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
 * reverting the very `grid-template-columns` line the sweep had just shipped.
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
 * property of one field set rather than a comparison between fields. `countUncomparableManagers`
 * addresses (2) by making the shape visible in the harness's own output, so a
 * count can never again read as a verdict.
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
  const fields = panel.fields || [];
  if (!fields.length) return [];

  const room = fields
    .map((f) => f.labelW - f.labelTextW)
    .filter((n) => Number.isFinite(n));
  if (!room.length) return [];

  // The MINIMUM, matching the floor check directly above it in the harness.
  // The longest label is what sizes the track, so the room around it is the
  // room the track actually has spare. Using the maximum would instead
  // measure the shortest label, which in any multi-row block is a number
  // about that label rather than about the track.
  const spare = Math.min(...room);
  if (spare <= MANAGER_ROOM_CEILING) return [];

  const longest = fields.reduce((a, b) => (a.labelTextW >= b.labelTextW ? a : b));
  return [
    `${where(panel, width)}: label track is ${spare}px wider than its longest label ` +
    `("${longest.name}" needs ${longest.labelTextW}px, the track is ${longest.labelW}px) — ` +
    `the rule asks for ${'40'}px of room (--builder-field-room) and the ceiling is ` +
    `${MANAGER_ROOM_CEILING}px. A declared manager sizes its label track from its own ` +
    'content, so this is a notch pushing every control in the block sideways — ' +
    'usually a proportional `1fr` track where the block wants `max-content`.'
  ];
}

/**
 * How many declared managers rendered fewer than two label/field pairs.
 *
 * Not a failure. A single-row manager can be perfectly correct — the Trigger
 * block on a module that is not Confetti genuinely has one row, and there is
 * nothing to seed that would give it a second. What it is NOT is evidence
 * about the four comparative assertions, which at n=1 have nothing to compare
 * and therefore cannot fail.
 *
 * Reported rather than enforced, so the harness's closing line stops reading
 * as a verdict over blocks where most of it was vacuous. That is the ticket's
 * option (b) obligation honoured alongside option (a): the assertion is added,
 * AND the count says what it is worth.
 */
export function countUncomparableManagers(panels) {
  return (panels || []).filter(
    (p) => p?.declaredManager && (p.fields || []).length > 0 && p.fields.length < 2
  ).length;
}

/** The same location string the rest of the harness prints, so failures sort together. */
function where(panel, width) {
  const name = panel.panelName ? ` (${panel.panelName})` : '';
  return `${width}px panel #${panel.index}${name} / ${panel.group}`;
}
