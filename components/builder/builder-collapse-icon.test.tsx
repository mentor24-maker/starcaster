// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILDER_PAGE_LOADING_LABEL,
  BuilderCollapseIcon,
  builderPanelToggleLoadingProps,
  isBuilderPageLoading,
  type BuilderPageLoadingInput,
} from "./builder-collapse-icon";
import { BuilderPageHistory } from "./builder-page-history";

/**
 * Task 86bczp0zy: the Page Details, Publish, Page History and Workspace bars
 * could be clicked before the page had loaded, which opened an empty or
 * half-filled Workspace. Until the page is in, each shows a spinner and
 * refuses the click.
 */

const mockFetch = vi.fn();
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: (...args: unknown[]) => mockFetch(...args),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  mockFetch.mockReset();
});

function render(node: React.ReactElement) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root!.render(node));
}

describe("BuilderCollapseIcon loading", () => {
  it("draws a spinner and no triangle while loading", () => {
    render(<BuilderCollapseIcon expanded={false} loading />);
    expect(container!.querySelector("[data-collapse-spinner]")).not.toBeNull();
    expect(container!.querySelector(".builder-collapse-icon-spinner circle")).not.toBeNull();
    expect(container!.querySelector("polygon")).toBeNull();
  });

  it("draws the triangle and no spinner otherwise", () => {
    render(<BuilderCollapseIcon expanded={false} />);
    expect(container!.querySelector("[data-collapse-spinner]")).toBeNull();
    expect(container!.querySelector("polygon")?.getAttribute("points")).toBe("7,4 7,20 20,12");
  });
});

describe("builderPanelToggleLoadingProps", () => {
  it("disables and labels a loading bar", () => {
    expect(builderPanelToggleLoadingProps(true, "Expand Workspace")).toEqual({
      disabled: true,
      "aria-busy": true,
      "aria-label": BUILDER_PAGE_LOADING_LABEL,
      title: BUILDER_PAGE_LOADING_LABEL,
    });
  });

  it("hands back the bar's own label and title when not loading", () => {
    expect(builderPanelToggleLoadingProps(false, "Expand X", "Expand X title")).toEqual({
      disabled: false,
      "aria-label": "Expand X",
      title: "Expand X title",
    });
  });
});

describe("isBuilderPageLoading — what counts as loaded", () => {
  const base: BuilderPageLoadingInput = {
    builderMode: "pages",
    pagesLoaded: true,
    pageIds: ["p1", "p2"],
    initialPageId: undefined,
    initialSelectionApplied: false,
    selectedPageId: "",
    hydratedPageId: "",
  };

  it("is loading until the pages list comes back", () => {
    expect(isBuilderPageLoading({ ...base, pagesLoaded: false, pageIds: [] })).toBe(true);
  });

  it("is loaded once the list is back and no page was asked for", () => {
    expect(isBuilderPageLoading(base)).toBe(false);
  });

  it("a failed pages load (list back, empty) stops the spinner", () => {
    expect(isBuilderPageLoading({ ...base, pageIds: [], initialPageId: "p1" })).toBe(false);
  });

  it("waits for the page the editor was opened for to be selected", () => {
    expect(isBuilderPageLoading({ ...base, initialPageId: "p1" })).toBe(true);
  });

  it("waits for the selected page's sections to reach the draft", () => {
    expect(isBuilderPageLoading({ ...base, initialPageId: "p1", initialSelectionApplied: true, selectedPageId: "p1" })).toBe(true);
    expect(
      isBuilderPageLoading({ ...base, initialPageId: "p1", initialSelectionApplied: true, selectedPageId: "p1", hydratedPageId: "p1" }),
    ).toBe(false);
  });

  it("does not wait forever for a page that is not in the list", () => {
    expect(isBuilderPageLoading({ ...base, initialPageId: "gone" })).toBe(false);
    expect(isBuilderPageLoading({ ...base, selectedPageId: "gone" })).toBe(false);
  });

  it("never spins outside the pages mode", () => {
    expect(isBuilderPageLoading({ ...base, builderMode: "templates", pagesLoaded: false })).toBe(false);
  });
});

describe("a panel bar while the page loads", () => {
  it("Page History's bar is disabled and busy while loading, and works afterwards", () => {
    render(<BuilderPageHistory loading pageId="p1" pageName="Home" onRestored={() => {}} />);
    let toggle = container!.querySelector("button.builder-panel-toggle") as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-busy")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe(BUILDER_PAGE_LOADING_LABEL);
    expect(toggle.querySelector("[data-collapse-spinner]")).not.toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    render(<BuilderPageHistory loading={false} pageId="p1" pageName="Home" onRestored={() => {}} />);
    toggle = container!.querySelector("button.builder-panel-toggle") as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.hasAttribute("aria-busy")).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Expand Page History");
    expect(toggle.querySelector("[data-collapse-spinner]")).toBeNull();
    expect(toggle.querySelector("polygon")).not.toBeNull();
  });
});
