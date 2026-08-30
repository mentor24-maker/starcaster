// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderSectionCard } from "./builder-section-card";
import type { BuilderTemplateSection } from "@/lib/builder-template";
import type { BlockUsage } from "@/lib/shared-block-usage";

/**
 * The chip has to REACH THE SCREEN, not merely be derivable.
 *
 * `block-lineage.test.ts` proves the wording; this proves the header renders
 * it. Those are two different failures — a helper that returns the right
 * string and a card that never calls it look identical in the source, and the
 * builder has shipped exactly that shape before (a class name is not a
 * rendering, docs/IMAGE_EFFECTS.md).
 *
 * It also pins the read-only guarantee of slice 6a: rendering any state must
 * not call a single one of the card's write callbacks.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

const SECTION: BuilderTemplateSection = {
  id: "sec-1",
  layout: "single",
  title: "Menu Banner",
  modules: [],
} as unknown as BuilderTemplateSection;

const usage = (over: Partial<BlockUsage> = {}): BlockUsage => ({
  following: 0,
  independent: 0,
  pages: 0,
  pageLabels: [],
  ...over,
});

/**
 * Every write callback the card takes, as one spy each, so a test can assert
 * that a render touched none of them.
 */
function writeCallbacks() {
  const names = [
    "onToggleCollapsed", "onMoveUp", "onMoveDown", "onRemove", "onCloneSection",
    "onSaveSection", "onUpdateSection", "onUpdateCellBackground", "onUpdateCellBorderWidth",
    "onUpdateCellBorderColor", "onUpdateCellBorderRadius", "onToggleModuleExpanded",
    "onUpdateModule", "onUpdateModuleBackground", "onMoveModule", "onDropModule",
    "onRemoveModule", "onCloneModule", "onSaveModule", "onSaveCellModules",
    "onInsertCellModule", "onInsertSavedModule", "onOpenGallery", "onOpenRichTextGallery",
    "onOpenButtonBackgroundGallery", "onOpenSocialIconGallery", "onUploadMediaForModule",
    "onUploadButtonBackgroundMedia", "onOpenSectionBackgroundGallery",
    "onUploadSectionBackgroundMedia", "onOpenModulePalette", "onToggleCanonical",
  ] as const;
  const spies = Object.fromEntries(names.map((name) => [name, vi.fn()]));
  return spies as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
}

function renderCard(props: Record<string, unknown>) {
  const spies = writeCallbacks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <BuilderSectionCard
        section={SECTION}
        sectionIndex={0}
        editorDevice="browser"
        isCollapsed
        expandedModuleIds={[]}
        cellModules={[]}
        products={[]}
        {...spies}
        {...props}
      />
    )
  );
  return spies;
}

function chip(): HTMLElement {
  const found = container?.querySelector<HTMLElement>(".builder-block-state-chip");
  if (!found) throw new Error("no state chip in the block header");
  return found;
}

function lineageLine(): HTMLElement | null {
  return container?.querySelector<HTMLElement>(".builder-block-lineage") ?? null;
}

describe("the block header's state chip", () => {
  it("reads Following, and states its reach, on a linked copy", () => {
    renderCard({
      section: { ...SECTION, savedSectionId: "menu", canonical: true },
      canonicalSourceName: "2 - Menu Banner",
      canonicalUsage: usage({ pages: 35, following: 35 }),
    });
    expect(chip().textContent).toBe("Following");
    expect(chip().dataset.blockState).toBe("following");
    // The heading is the master's name now, so the line carries the reach and
    // not a second copy of the name — see resolveSharedSectionTitle.
    expect(lineageLine()?.textContent).toBe("Used on 35 pages");
  });

  it("reads Changed once the copy has drifted", () => {
    renderCard({
      section: { ...SECTION, savedSectionId: "menu", canonical: true },
      canonicalSourceName: "2 - Menu Banner",
      canonicalUsage: usage({ pages: 35, following: 35 }),
      hasDrifted: true,
    });
    expect(chip().textContent).toBe("Changed");
    expect(chip().dataset.blockState).toBe("changed");
    // Same sentence as the Following case above: only the chip moves.
    expect(lineageLine()?.textContent).toBe("Used on 35 pages");
  });

  it("titles a following copy by its MASTER, over a stale stamped title", () => {
    // The Delray header bug, at the surface it reached the operator through:
    // the row was renamed "2a - Header" three times and every page card kept
    // reading "2 - Menu Banner", the title the last fan-out stamped. One name,
    // and it is the manager's.
    renderCard({
      section: { ...SECTION, title: "2 - Menu Banner", savedSectionId: "menu", canonical: true },
      canonicalSourceName: "2a - Header",
      canonicalUsage: usage({ pages: 35, following: 35 }),
    });
    const heading = container?.querySelector(".builder-section-title-main")?.textContent ?? "";
    expect(heading).toContain("2a - Header");
    expect(heading).not.toContain("2 - Menu Banner");
  });

  it("keeps the stamped title when the master was deleted", () => {
    // Nothing to resolve, so the stamp is the only name there is.
    renderCard({
      section: { ...SECTION, title: "2 - Menu Banner", savedSectionId: "gone", canonical: true },
      canonicalUsage: usage({ pages: 2, following: 2 }),
    });
    expect(container?.querySelector(".builder-section-title-main")?.textContent).toContain(
      "2 - Menu Banner"
    );
  });

  it("reads Independent with no second line on an unlinked block", () => {
    renderCard({ section: SECTION });
    expect(chip().textContent).toBe("Independent");
    // Not an empty div, not "used on 0 pages" — no element at all.
    expect(lineageLine()).toBeNull();
  });

  it("reads Original when the card is editing the master itself", () => {
    renderCard({ isCanonicalMaster: true, canonicalUsage: usage({ pages: 35, following: 35 }) });
    expect(chip().textContent).toBe("Original");
    expect(lineageLine()?.textContent).toBe("Used on 35 pages");
  });

  it("still shows the title next to the chip", () => {
    renderCard({ section: { ...SECTION, savedSectionId: "menu", canonical: true } });
    expect(container?.querySelector(".builder-section-title-main")?.textContent).toContain(
      "Menu Banner"
    );
  });

  it("writes nothing merely by rendering", () => {
    const spies = renderCard({
      section: { ...SECTION, savedSectionId: "menu", canonical: true },
      canonicalSourceName: "2 - Menu Banner",
      canonicalUsage: usage({ pages: 35, following: 35 }),
      hasDrifted: true,
    });
    const called = Object.entries(spies).filter(([, spy]) => spy.mock.calls.length > 0);
    expect(called.map(([name]) => name)).toEqual([]);
  });
});
