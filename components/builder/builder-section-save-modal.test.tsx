// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderSectionSaveModal } from "./builder-section-save-modal";
import { describeCanonicalOverwrite } from "@/lib/shared-block-usage";
import { diffSavedSectionOverwrite, type DiffPage, type DiffSection } from "@/lib/saved-section-diff";

/**
 * The dialog that stopped Save on a page section from silently meaning "file a
 * duplicate". What must not regress is that BOTH saves are offered and neither
 * is the default: the operator lost an edit to that assumption on 2026-08-16.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function buttonLabelled(match: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(match)
  );
  if (!found) throw new Error(`No button containing "${match}"`);
  return found as HTMLButtonElement;
}

const impact = describeCanonicalOverwrite("Footer Menu", {
  following: 2,
  independent: 1,
  pages: 2,
  pageLabels: ["Home", "About"]
});

/** Three outcomes in one fixture: two pages alike, one drifted, one unchanged. */
const MENU = "saved_section_menu";

function section(text: string): DiffSection {
  return {
    id: "sec-master",
    title: "Footer Menu",
    modules: [{ id: "m1", type: "text", column: "a", name: "", text: `<p>${text}</p>`, settings: {} }]
  };
}

const proposed = section("Call 555-0100 for a free consult");

function following(name: string, instance: DiffSection): DiffPage {
  return { id: name, name, slug: name.toLowerCase(), layoutSections: [{ ...instance, id: `inst-${name}`, savedSectionId: MENU, canonical: true }] };
}

const diff = diffSavedSectionOverwrite(
  [
    following("Home", section("Call us today")),
    following("About", section("Call us today")),
    following("Rates", section("Rates from $40/hr")),
    following("Blog", proposed)
  ],
  MENU,
  proposed
);

describe("BuilderSectionSaveModal", () => {
  it("offers both saves, and names the original in each", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    expect(buttonLabelled("Overwrite")).toBeTruthy();
    expect(buttonLabelled("Save as a new section")).toBeTruthy();
    expect(buttonLabelled("Cancel")).toBeTruthy();
    expect(document.body.textContent).toContain("Footer Menu");
  });

  it("lists the pages an overwrite rewrites, before the click", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    const items = Array.from(document.querySelectorAll(".builder-choice-dialog-list li")).map(
      (item) => item.textContent
    );
    expect(items).toEqual(["Home", "About"]);
  });

  it("routes each button to its own choice", () => {
    const clicked: string[] = [];
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => clicked.push("cancel")}
        onOverwrite={() => clicked.push("overwrite")}
        onSaveAsNew={() => clicked.push("new")}
      />
    );

    act(() => buttonLabelled("Overwrite").click());
    act(() => buttonLabelled("Save as a new section").click());
    act(() => buttonLabelled("Cancel").click());

    expect(clicked).toEqual(["overwrite", "new", "cancel"]);
  });

  it("says what changes on each page, not only which pages", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        diff={diff}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain("Rates from $40/hr");
    expect(text).toContain("Call 555-0100");
  });

  it("collapses the pages that change alike and stands the odd one out beside them", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        diff={diff}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    const groups = Array.from(document.querySelectorAll(".builder-section-diff-group"));
    expect(groups).toHaveLength(3);
    // The page that drifted leads; the two that change alike follow it.
    expect(groups[0].querySelector(".builder-section-diff-group-count")?.textContent).toBe("1 page");
    expect(groups[0].textContent).toContain("Rates");
    expect(groups[1].querySelector(".builder-section-diff-group-count")?.textContent).toBe("2 pages");

    // Every group names its pages up front, open or shut, so one long group can
    // never hide that another exists.
    expect(groups[1].querySelector(".builder-section-diff-group-pages")?.textContent).toContain("Home");

    // Only the first group's detail is open; the rest are one click away.
    expect((groups[0] as HTMLDetailsElement).open).toBe(true);
    expect((groups[1] as HTMLDetailsElement).open).toBe(false);

    // Nothing sits behind the unchanged group, so it is not a disclosure at all.
    expect(groups[2].getAttribute("data-unchanged")).toBe("true");
    expect(groups[2].tagName).toBe("DIV");
    expect(groups[2].textContent).toContain("no visible change");
  });

  it("falls back to the plain page list when no diff is handed in", () => {
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    expect(document.querySelector(".builder-section-diff-groups")).toBeNull();
    expect(document.querySelectorAll(".builder-choice-dialog-list li")).toHaveLength(2);
  });

  it("says out loud when the page list it read was capped", () => {
    // Under-reporting silently is the exact failure this feature prevents.
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        diff={{ ...diff, truncated: true }}
        isSaving={false}
        onCancel={() => {}}
        onOverwrite={() => {}}
        onSaveAsNew={() => {}}
      />
    );

    expect(document.querySelector(".builder-section-diff-truncated")?.textContent)
      .toContain("still reaches them");
  });

  it("closes on Escape but not on a stray backdrop click", () => {
    const clicked: string[] = [];
    render(
      <BuilderSectionSaveModal
        canonicalName="Footer Menu"
        impact={impact}
        isSaving={false}
        onCancel={() => clicked.push("cancel")}
        onOverwrite={() => clicked.push("overwrite")}
        onSaveAsNew={() => clicked.push("new")}
      />
    );

    act(() => {
      (document.querySelector(".builder-gallery-overlay") as HTMLElement).click();
    });
    expect(clicked).toEqual([]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(clicked).toEqual(["cancel"]);
  });
});
