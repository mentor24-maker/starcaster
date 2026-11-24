// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyModule,
  normalizeBuilderModuleSettingsForType,
  type BuilderTemplateModule
} from "@/lib/builder-template";
import { BuilderCarouselModuleSettings } from "./builder-carousel-module-settings";
import { BuilderFeatureCardsModuleSettings } from "./builder-feature-cards-module-settings";
import { HeadlineRotatorModuleEditor } from "./builder-module-card";

/**
 * "Open in new tab" on the modules that link to another website (SC-908,
 * the second half of Dane's 2026-11-22 ask: "Check for any other modules that
 * include the ability to link that should have an 'open in new tab' option").
 *
 * Feature Cards and Carousel get a box per item, shown only once that item
 * has a link; Headline Rotator gets one box for all its headlines, stored in
 * its own key and never inside the `headlines` text. Every box is off unless
 * ticked, so no page saved before the setting existed changes.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Link pickers list the project's pages over the wire; nothing here needs them.
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) })
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

type Editor = (props: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
}) => React.ReactNode;

async function mount(type: "carousel" | "feature-cards" | "headline-rotator", settings: Record<string, string>, Editor: Editor) {
  let current: BuilderTemplateModule = {
    ...createEmptyModule(type),
    settings: normalizeBuilderModuleSettingsForType(type, { ...createEmptyModule(type).settings, ...settings })
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const paint = () =>
    root!.render(
      <Editor
        module={current}
        onUpdateModule={(updater) => {
          current = updater(current);
          paint();
        }}
      />
    );
  await act(async () => paint());
  return { module: () => current };
}

function boxes(label: RegExp): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((box) =>
    label.test(box.getAttribute("aria-label") ?? "")
  );
}

function click(el: Element | undefined, what: string) {
  if (!el) throw new Error(`Nothing to click for ${what}`);
  act(() => (el as HTMLElement).click());
}

const items = (...entries: Array<Record<string, string>>) =>
  JSON.stringify(entries.map((entry, i) => ({ id: `i${i}`, title: `Item ${i}`, ...entry })));

describe.each([
  ["carousel", "items", BuilderCarouselModuleSettings as unknown as Editor],
  ["feature-cards", "cards", BuilderFeatureCardsModuleSettings as unknown as Editor]
] as const)("%s — Open in New Tab per item", (type, key, Editor) => {
  const parse = (m: BuilderTemplateModule) => JSON.parse(m.settings[key] || "[]") as Array<Record<string, string>>;

  it("offers the box only on an item that has a link, unticked", async () => {
    await mount(type, { [key]: items({ linkUrl: "https://example.com/" }, { linkUrl: "" }) }, Editor);
    const found = boxes(/opens in a new tab/);
    expect(found).toHaveLength(1);
    expect(found[0].checked).toBe(false);
  });

  it("writes newTab on that item only, true when ticked and false when unticked", async () => {
    const harness = await mount(
      type,
      { [key]: items({ linkUrl: "https://example.com/" }, { linkUrl: "/about" }) },
      Editor
    );
    click(boxes(/opens in a new tab/)[0], "the first item's box");
    expect(parse(harness.module())[0].newTab).toBe("true");
    expect(parse(harness.module())[1].newTab ?? "").not.toBe("true");
    expect(boxes(/opens in a new tab/)[0].checked).toBe(true);
    click(boxes(/opens in a new tab/)[0], "the first item's box");
    expect(parse(harness.module())[0].newTab).toBe("false");
  });

  it("shows a saved choice", async () => {
    await mount(type, { [key]: items({ linkUrl: "https://example.com/", newTab: "true" }) }, Editor);
    expect(boxes(/opens in a new tab/)[0].checked).toBe(true);
  });

  it("clears the choice when the link is cleared, so a link added later starts unticked", async () => {
    const harness = await mount(type, { [key]: items({ linkUrl: "https://example.com/", newTab: "true" }) }, Editor);
    // Let the picker finish loading its (mocked, empty) page list.
    await act(async () => {});
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((el) =>
      / link$/.test(el.getAttribute("aria-label") ?? "")
    );
    if (!select) throw new Error("No link picker found");
    act(() => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(parse(harness.module())[0].linkUrl).toBe("");
    expect(parse(harness.module())[0].newTab).toBe("");
    expect(boxes(/opens in a new tab/)).toHaveLength(0);
  });
});

describe("carousel — the thumbnail sits beside the item's whole column (SC-908 review)", () => {
  /**
   * The thumbnail must follow the column's FIRST field in the markup, and
   * span one row per field. "New Tab" is one more field on a linked item, and
   * the first build put it between Link and the thumbnail with captions off,
   * and left the span a row short in both formats.
   */
  function leftFieldsAndThumb() {
    const grid = document.querySelector(".builder-cards-panel-fields")!;
    const children = Array.from(grid.children);
    const head = children.findIndex((el) => el.classList.contains("builder-card-editor-head"));
    const out: { fields: string[]; thumbAfter: string | null; rows: string } = { fields: [], thumbAfter: null, rows: "" };
    let last: string | null = null;
    for (const el of children.slice(head + 1)) {
      if (el.classList.contains("builder-card-editor-head") || el.classList.contains("builder-card-field--wide")) break;
      if (el.classList.contains("builder-card-thumb--beside")) {
        out.thumbAfter = last;
        out.rows = (el as HTMLElement).style.getPropertyValue("--builder-card-thumb-rows");
        continue;
      }
      if (el.classList.contains("builder-card-field--a")) {
        last = (el.querySelector(".builder-module-field-label")?.textContent ?? "").trim();
        out.fields.push(last);
      }
    }
    return out;
  }

  it.each([
    ["captions off", "false", ["Link", "New Tab", "Alt Text"], "Link"],
    ["captions on", "true", ["Caption Title", "Link", "New Tab", "Link Label", "Alt Text"], "Caption Title"]
  ])("%s: starts after the first field and spans every field", async (_name, showCaptions, fields, first) => {
    await mount(
      "carousel",
      { format: "slideshow", showCaptions, items: items({ linkUrl: "https://example.com/", imageUrl: "/a.png" }) },
      BuilderCarouselModuleSettings as unknown as Editor
    );
    const found = leftFieldsAndThumb();
    expect(found.fields).toEqual(fields);
    expect(found.thumbAfter).toBe(first);
    expect(found.rows).toBe(String(fields.length));
  });
});

describe("feature-cards — New Tab sits in the Link's column, under it (SC-908 review)", () => {
  it("places New Tab in the Link's pair-column, right after Link Text, with Alt Text below", async () => {
    await mount(
      "feature-cards",
      { cards: items({ linkUrl: "https://example.com/" }) },
      BuilderFeatureCardsModuleSettings as unknown as Editor
    );
    const grid = document.querySelector(".builder-cards-panel-fields")!;
    const fields = Array.from(grid.querySelectorAll(":scope > .builder-module-field")).map((el) => ({
      label: (el.querySelector(".builder-module-field-label")?.textContent ?? "").trim(),
      column: el.classList.contains("builder-card-field--a") ? "a" : el.classList.contains("builder-card-field--b") ? "b" : "wide"
    }));
    expect(fields.slice(0, 5)).toEqual([
      { label: "Title", column: "a" },
      { label: "Link", column: "b" },
      { label: "Link Text", column: "a" },
      { label: "New Tab", column: "b" },
      { label: "Alt Text", column: "a" }
    ]);
  });

  it("keeps the 2x2 on a card with no link", async () => {
    await mount("feature-cards", { cards: items({ linkUrl: "" }) }, BuilderFeatureCardsModuleSettings as unknown as Editor);
    const grid = document.querySelector(".builder-cards-panel-fields")!;
    const altText = Array.from(grid.querySelectorAll(":scope > .builder-module-field")).find(
      (el) => (el.querySelector(".builder-module-field-label")?.textContent ?? "").trim() === "Alt Text"
    );
    expect(altText?.classList.contains("builder-card-field--b")).toBe(true);
  });
});

describe("carousel — the choice survives a load", () => {
  /**
   * The carousel's loader rebuilds every item from a fixed list of field
   * names on EVERY load (it folds the retired slideshow/slider shapes in), so
   * a field it does not list is stripped the next time the page is saved.
   */
  it("keeps newTab through the normalizer, and reads an item that never had it as same-tab", () => {
    const settings = normalizeBuilderModuleSettingsForType("carousel", {
      items: items({ linkUrl: "https://example.com/", newTab: "true" }, { linkUrl: "/old" })
    });
    const parsed = JSON.parse(settings.items) as Array<Record<string, string>>;
    expect(parsed[0].newTab).toBe("true");
    expect(parsed[1].newTab).toBe("");
  });
});

describe("headline-rotator — one Open Links in New Tab box", () => {
  function box(): HTMLInputElement | null {
    const label = Array.from(document.querySelectorAll("label.field")).find(
      (el) => (el.querySelector("span")?.textContent ?? "").trim() === "Open Links in New Tab"
    );
    return label?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
  }
  const headlines = JSON.stringify([{ id: "h1", label: "Book a court", href: "https://example.com/" }]);

  it("is unticked on a new rotator and on one saved before the setting existed", async () => {
    await mount("headline-rotator", { headlines }, HeadlineRotatorModuleEditor as unknown as Editor);
    expect(box()).not.toBeNull();
    expect(box()!.checked).toBe(false);
  });

  it("writes linksNewTab and never touches the headlines text", async () => {
    const harness = await mount("headline-rotator", { headlines }, HeadlineRotatorModuleEditor as unknown as Editor);
    const before = harness.module().settings.headlines;
    click(box() ?? undefined, "the Open Links in New Tab box");
    expect(harness.module().settings.linksNewTab).toBe("true");
    expect(harness.module().settings.headlines).toBe(before);
    expect(harness.module().settings.headlines).not.toContain("newTab");
    click(box() ?? undefined, "the Open Links in New Tab box");
    expect(harness.module().settings.linksNewTab).toBe("false");
  });
});
