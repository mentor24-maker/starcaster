// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createEmptyModule, type BuilderPageRecord } from "@/lib/builder-template";
import { BuilderTableModuleSettings } from "./builder-table-module-settings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A PAGE WITH NO NAME IN THE TABLE CELL'S LINK DROPDOWN (86bbw9a8y).
 *
 * The option was built as `{p.name}` with no fallback, so a page whose name is
 * empty rendered as a blank line in the middle of the list — nothing to click
 * on and no way to tell which page it was. Every other page dropdown in the
 * product already falls back to the slug: the shared data picker, the theme
 * wizard, and the vanilla campaigns screen all do `name || slug || id`.
 *
 * WHY A TEST AND NOT A FIXTURE ROW. The ticket asked for the UI fixture to
 * grow an image module inside a table cell so `check:panels` could see this.
 * It already has one (`cell-image`, seeded since PR #190 on 2026-08-12) and it
 * already seeds a nameless page (`['', 'empty-name-row']`). The dropdown was
 * reachable the whole time. What `check:panels` cannot do is read the TEXT of
 * an option — it measures slot geometry, so a blank label is exactly the kind
 * of defect it passes green. That is the hole this test fills.
 *
 * Driven through a real mount and a real click rather than static markup,
 * because the editor is modal state: rendered cold, the Link row does not
 * exist at all and an assertion over the markup would pass while proving
 * nothing.
 */

function page(id: string, name: string, slug: string): BuilderPageRecord {
  return { id, name, slug } as unknown as BuilderPageRecord;
}

/** Cell 0-0 holds an image module — the only cell shape that offers a Link row. */
const TABLE_DATA = JSON.stringify({
  headers: ["Phone", "Hours"],
  rowCount: 1,
  cells: {
    "0-0": [{
      id: "cell-image",
      type: "image",
      column: "0-0",
      name: "Cell Image",
      text: "",
      settings: { url: "/images/court.png", alt: "Clay courts", size: "100" },
    }],
  },
});

const PAGES: BuilderPageRecord[] = [
  page("page-named", "Court Fees", "course-fees"),
  page("page-nameless", "", "empty-name-row"),
];

/** Mount the panel and open the cell module's editor, which is where Link lives. */
function linkPageOptions(pages: BuilderPageRecord[] = PAGES): HTMLOptionElement[] {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const module = { ...createEmptyModule("table"), settings: { tableData: TABLE_DATA } };

  act(() => {
    root.render(
      <BuilderTableModuleSettings
        module={module as never}
        pages={pages}
        onUpdateModule={() => {}}
        onUpdateModuleBackground={() => {}}
        renderCellPreview={() => null}
      />
    );
  });

  const toggle = host.querySelector<HTMLButtonElement>(".builder-table-cell-module-toggle");
  if (!toggle) throw new Error("no cell module toggle — the fixture cell lost its image module");
  act(() => { toggle.click(); });

  // Searched from document.body, NOT from the mount host: the cell editor
  // renders through BuilderBodyPortal, so it is not a descendant of the tree
  // it was mounted into. Scoped to the "— Page —" placeholder rather than to a
  // position in the list, because the editor carries a dozen other selects and
  // an index would silently start measuring Size % the day one is added.
  const linkSelect = [...document.body.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.textContent === "— Page —"));
  if (!linkSelect) throw new Error("no page dropdown in the open cell editor");

  act(() => { root.unmount(); });
  host.remove();
  return [...linkSelect.options].filter((o) => o.value !== "");
}

describe("Table cell Link dropdown — page options", () => {
  it("shows the slug for a page with no name, instead of a blank row", () => {
    const nameless = linkPageOptions().find((o) => o.value === "/empty-name-row");
    expect(nameless).toBeDefined();
    expect(nameless!.textContent).toBe("empty-name-row");
  });

  it("never renders an option with an empty label", () => {
    // The defect as the operator met it: a blank line in the middle of the
    // list. Asserted over EVERY option, so a future page shape that is also
    // nameless cannot reintroduce it somewhere else in the list.
    for (const option of linkPageOptions()) {
      expect(option.textContent?.trim()).not.toBe("");
    }
  });

  it("leaves a named page reading as its name", () => {
    const named = linkPageOptions().find((o) => o.value === "/course-fees");
    expect(named?.textContent).toBe("Court Fees");
  });

  it("keeps the option value as /<slug> — this is a display fix only", () => {
    // Acceptance criterion 2. If the fallback were ever written into the value
    // as well, every link the operator picked for a nameless page would point
    // at the wrong address, which is a far worse bug than the blank row.
    expect(linkPageOptions().map((o) => o.value).sort())
      .toEqual(["/course-fees", "/empty-name-row"]);
  });

  it("falls back to the id when a page has neither a name nor a slug", () => {
    // Matches builder-theme-wizard.tsx, the closest analogue in the codebase.
    // Without the third rung this row is blank again for a page mid-creation.
    const options = linkPageOptions([page("page-bare", "", "")]);
    expect(options.map((o) => o.textContent)).toEqual(["page-bare"]);
  });
});
