// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPageList } from "./builder-page-list";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";

/**
 * Video is offered per surface — the shared picker hides it unless the surface
 * says it can play one. Page Details can, since the page background is mounted
 * as a real <video> layer by `BuilderViewportShellLayout`. Nothing else in the
 * suite can see that this call site passes the flag: the picker's own tests
 * prove the gate works, not that Page Details opened it.
 *
 * It has to be a browser test rather than a static render because Page Details
 * starts collapsed and is opened by a click.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function openPageDetails() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    pages: [{ id: "p1", name: "Home", slug: "home" }],
    templates: [],
    themes: [],
    selectedPageId: "p1",
    draftName: "Home",
    pageBackground: createDefaultBackgroundSettings(),
    theme: {},
    pageSlug: "home",
    pageTemplateId: "",
    pageThemeId: "",
    isSaving: false,
    onSelectPage: () => {},
    onPreviewPage: () => {},
    onClonePage: () => {},
    onDeletePage: () => {},
    onDeletePages: () => {},
    onSetDraftName: () => {},
    onUpdatePageBackground: () => {},
    onUpdateTheme: () => {},
    onSetPageSlug: () => {},
    onApplyTemplate: () => {},
    onApplyTheme: () => {},
    onNewPage: () => {},
    onBulkCreate: () => {},
    onPreviewDraft: () => {},
    onMakeTemplate: () => {},
    onPageEditorFocus: () => {},
    onSavePage: () => {},
    pageVisibility: "public",
    onSetPageVisibility: () => {},
    pageSearchPriority: "",
    onSetPageSearchPriority: () => {},
    snapshots: [],
    isSnapshoting: false,
    isRestoring: false,
    activeArchive: null,
    onArchivePages: () => {},
    onLoadArchive: () => {},
    onRestoreArchive: () => {},
    onDeleteSnapshot: () => {},
  } as unknown as ComponentProps<typeof BuilderPageList>;

  act(() => {
    root!.render(<BuilderPageList {...props} />);
  });

  const toggle = Array.from(container.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === "Expand Page Details"
  );
  expect(toggle, "the Page Details toggle").toBeTruthy();
  act(() => {
    toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const picker = container.querySelector(".builder-meta-grid-pages-background select");
  expect(picker, "the Page Background mode picker").toBeTruthy();
  return picker as HTMLSelectElement;
}

describe("Page Details → Background", () => {
  it("offers Video, because a page can mount a video layer", () => {
    const modes = Array.from(openPageDetails().options).map((option) => option.value);
    expect(modes).toContain("video");
  });

  it("still offers the five modes it offered before, with no reordering", () => {
    const modes = Array.from(openPageDetails().options).map((option) => option.value);
    expect(modes).toEqual(["none", "color", "gradient", "image", "video", "style"]);
  });
});
