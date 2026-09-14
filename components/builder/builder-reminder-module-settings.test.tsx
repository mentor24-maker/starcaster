import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BuilderReminderModuleSettings,
  BuilderReminderRecordEditor
} from "./builder-reminder-module-settings";
import { parseReminderRecordsFromModule } from "@/lib/builder-reminder-module";
import { createEmptyModule, normalizeBuilderModuleSettingsForType } from "@/lib/builder-template";

/**
 * Two records, deliberately of DIFFERENT appearances — a speech bubble carries
 * Width, Background, Border Color and Border; a strip carries Placement. That
 * asymmetry is what made the two cards measure different label tracks when each
 * one was its own grid, so a fixture with two identical records would prove
 * nothing about the thing this panel had to be fixed for.
 */
const RECORDS = JSON.stringify([
  {
    id: "bubble",
    name: "Signup Nudge",
    messageHtml: "<p>Create a free account.</p>",
    appearance: "speech_bubble",
    gameAudience: "both",
    isActive: true,
    criteriaLogic: "and",
    criteria: [{ id: "c1", type: "polls_taken", value: { operator: "gte", count: 1 } }],
    backgroundColor: "#ffffff",
    borderColor: "#4cbb17",
    borderThickness: "2",
    containerWidth: "520",
    offsetX: "12",
    offsetY: "-8",
    zIndex: "46"
  },
  {
    id: "strip",
    name: "Court Fees",
    messageHtml: "<p>Guest rates apply.</p>",
    appearance: "strip",
    gameAudience: "registered",
    isActive: true,
    criteriaLogic: "or",
    criteria: [{ id: "c2", type: "polls_taken", value: { operator: "gte", count: 3 } }],
    stripPlacement: "bottom",
    offsetX: "0",
    offsetY: "0",
    zIndex: "48"
  }
]);

function reminderModule() {
  return {
    ...createEmptyModule("reminder"),
    settings: normalizeBuilderModuleSettingsForType("reminder", { reminderRecordsJson: RECORDS })
  };
}

/** The module component. Its record cards render COLLAPSED, so this is the
    list and its chrome — not the fields. */
function panelHtml() {
  return renderToStaticMarkup(
    <BuilderReminderModuleSettings module={reminderModule() as never} onUpdateModule={() => {}} />
  );
}

/** One expanded record card. `index` 0 is the speech bubble, 1 the strip. */
function recordHtml(index: number) {
  const records = parseReminderRecordsFromModule(reminderModule() as never);
  return renderToStaticMarkup(
    <BuilderReminderRecordEditor pollOptions={[]} record={records[index]} onChange={() => {}} />
  );
}

const overridesCss = readFileSync(
  path.resolve(__dirname, "../../src/css/_builder-react-overrides.css"),
  "utf8"
);

/**
 * THE SHEET WITH ITS PROSE TAKEN OUT, and every assertion below reads this one
 * rather than the raw file.
 *
 * Round 2 of this ticket shipped a guard that could not fail. The rule these
 * declarations live in carries a long comment explaining WHY it sets
 * `column-gap: 0`, and that comment says the string `column-gap: 0` twice — so
 * `expect(body).toMatch(/column-gap:\s*0/)` was satisfied by the explanation
 * of the declaration rather than by the declaration. Deleting the line left
 * the test green and the 52px gutter came straight back. A comment is the one
 * thing in a stylesheet guaranteed to restate the declaration next to it, so
 * matching a rule body that still contains its comments is a test that reports
 * on its own documentation.
 *
 * Stripping here rather than in each assertion also fixes a second, quieter
 * hazard: `ruleBody` ends the body at the first `}`, and a `}` inside a
 * comment would have truncated it — silently shrinking what any future
 * assertion is allowed to see.
 */
const overridesDeclarations = overridesCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the one rule with this exact selector, so an assertion about it
    cannot be satisfied by some other rule elsewhere in the sheet. Comments are
    already gone, so what comes back is declarations and nothing else. */
function ruleBody(selector: string) {
  const at = overridesDeclarations.indexOf(selector + " {");
  if (at < 0) return null;
  return overridesDeclarations.slice(at, overridesDeclarations.indexOf("}", at));
}

/**
 * Asserted on rendered markup rather than on the source, because both defects
 * below read perfectly well in TSX. `check:panels` is the real gate for this
 * panel's geometry and it needs a browser, a server, a database and a seeded
 * fixture — so CI never runs it. What CI CAN hold is the two things the
 * geometry rests on: the declaration that makes the block measurable at all,
 * and the absence of a per-field width.
 *
 * Panel sweep 11/15, ticket 86bbjt1b9.
 */
describe("Reminder settings panel", () => {
  /**
   * On the LIST, not on a card. `check_panels` measures each declared element
   * as one group and a group always agrees with itself, so a per-card
   * declaration would let the two cards drift apart and report clean on both.
   */
  it("declares the record list so check_panels measures every card together", () => {
    expect(panelHtml()).toContain('class="builder-reminder-module-records" data-lattice-pairs="2"');
  });

  /** The criteria block is a nested lattice; without its own declaration it
      matched none of the check's selectors and was skipped in silence. */
  it("declares the criteria block as a lattice of its own", () => {
    expect(recordHtml(0)).toContain('data-lattice-pairs="1"');
    expect(recordHtml(0)).toContain('class="admin-game-reminder-criteria-panel"');
  });

  /**
   * ...and NAMES it, which is what stops the declaration above from being a
   * per-card promise. This editor renders once inside every record card, so
   * `data-lattice-pairs` alone gives one group per card and a group always
   * agrees with itself — card 1 and card 2 could drift apart by any amount and
   * both report clean. `data-lattice-group` is what `check_panels` reads to
   * measure every block wearing the name as ONE lattice.
   */
  it("names the criteria lattice so every card's criteria are measured together", () => {
    expect(recordHtml(0)).toContain('data-lattice-group="reminder-criteria"');
    expect(recordHtml(1)).toContain('data-lattice-group="reminder-criteria"');
  });

  /**
   * THE GUTTER IS THE TRACK, NOT THE TRACK PLUS A GAP.
   *
   * The base sheet gives the record list `gap: 12px`, which is the shorthand
   * and so sets column-gap too — the space between the two columns rendered as
   * 52px against an acceptance criterion asking for a real 40px, and the 12px
   * was absorbed unevenly by the subgrid chain below (two control tracks the
   * CSS resolves as equal rendered 19px apart). No browser check catches it:
   * `check_panels` buckets fields by pair-column and compares only within a
   * bucket, so a left-vs-right asymmetry is invisible to it by construction.
   * This assertion is the only automated thing standing on it.
   */
  it("puts no column gap on the record list, so the 40px room track is the whole gutter", () => {
    const body = ruleBody(".builder-react-root .builder-reminder-module-records");
    expect(body).not.toBeNull();
    expect(body).toMatch(/column-gap:\s*0/);
  });

  /**
   * The other half of the same shorthand, as its OWN test rather than a second
   * expectation in the one above. Round 2's break test deleted both lines at
   * once and read the resulting failure as proof of both; only the row-gap half
   * could actually fail, so the failure came from the line that worked. Two
   * tests means the failure names which line went, and a break of either one on
   * its own is answerable.
   */
  it("keeps the 12px row gap the shorthand was really there for", () => {
    const body = ruleBody(".builder-react-root .builder-reminder-module-records");
    expect(body).not.toBeNull();
    expect(body).toMatch(/row-gap:\s*12px/);
  });

  /**
   * THE SAME SHORTHAND, ONE LEVEL DOWN — three boxes, three tests.
   *
   * Round 2 took `gap`'s column half off the record list and stopped. The
   * three boxes it newly made subgrids kept theirs from the base sheet (panel
   * 10px, list 12px, criterion card 10px), and a subgrid whose column-gap is
   * wider than its parent's takes the extra out of its own tracks — so each
   * box shrank the one inside it, and the criterion control started at x=255.25
   * where the module's field track started at x=250.25. The sheet said in
   * writing that a criterion "takes the ordinary field track, the same one
   * every other control in the module takes"; it did not.
   *
   * With all three zeroed, both start at x=245.25. One test per box rather
   * than one test with three expectations, so deleting any single declaration
   * fails by the name of the box it was deleted from — the lesson this
   * ticket's own round-2 send-back was about.
   */
  it("puts no column gap on the criteria panel", () => {
    const body = ruleBody(
      ".builder-react-root .builder-reminder-record-settings.builder-cards-panel-fields"
      + " > .admin-game-reminder-criteria-panel"
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/column-gap:\s*0/);
  });

  it("puts no column gap on the criteria list", () => {
    const body = ruleBody(
      ".builder-react-root .admin-game-reminder-criteria-panel > .admin-game-reminder-criteria-list"
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/column-gap:\s*0/);
  });

  it("puts no column gap on the criterion card", () => {
    const body = ruleBody(
      ".builder-react-root .admin-game-reminder-criteria-list > .admin-game-reminder-criterion-card"
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/column-gap:\s*0/);
  });

  /** One rule, not two. The sheet carried this selector twice at identical
      specificity, so the first block never applied and the long comment
      explaining the declaration introduced the dead copy. */
  it("declares the criteria panel's placement exactly once", () => {
    const selector =
      ".builder-react-root .builder-reminder-record-settings.builder-cards-panel-fields"
      + " > .admin-game-reminder-criteria-panel";
    const hits = overridesDeclarations.split(selector + " {").length - 1;
    expect(hits).toBe(1);
  });

  /**
   * W0 forbids a width on an individual field BY NAME, and this panel carried
   * three: `style={{ width: "9ch" }}` on X Offset, Y Offset and Z-Index. No
   * browser check could have caught them — `check_panels` measures a field's
   * SLOT, and the slot was whatever the flex row handed it.
   */
  it("puts no width on an individual field", () => {
    const html = recordHtml(0) + recordHtml(1);
    expect(html).not.toMatch(/style="[^"]*width/i);
    expect(html).not.toContain("9ch");
  });

  /** Every field is a lattice field placed in a pair-column, which is what
      `display: contents` needs in order to flatten them onto the tracks. */
  it("places every field in a pair-column of the card lattice", () => {
    const html = recordHtml(0) + recordHtml(1);
    expect(html).toContain("builder-cards-panel-fields");
    expect(html).toContain("builder-card-field--a");
    expect(html).toContain("builder-card-field--b");
    expect(html).toContain("builder-card-field--wide");
    // The flex strips the rows used to live in are gone; a strip inside the
    // card would be a second formatting context and its fields would measure
    // against each other instead of against the card.
    expect(html).not.toContain("builder-module-field-strip");
  });

  /** A checkbox keeps its natural size at the start of its slot (W0's stated
      exception); `auto` let it be treated as stretchable and compared against
      the half-row controls. */
  it("declares the Active toggle as a checkbox rather than an auto field", () => {
    expect(recordHtml(0)).toContain("builder-module-field--check builder-card-field--wide");
  });
});
