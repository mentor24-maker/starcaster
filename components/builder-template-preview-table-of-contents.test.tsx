// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, createEmptyModule, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The Table of Contents module on a drawn page (task SC-863): it lists the
 * headings the page shows, using the anchors SC-856 gives rich-text headings,
 * and on a live page with no headings it leaves nothing behind.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BODY =
  "<h2>Juniors</h2><p>Kids.</p><h3>Ages 5 to 8</h3><h3>Ages 9 to 12</h3><h2>Adults</h2><h2>Private Lessons</h2>";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderPage(text: string, tocSettings: Record<string, string>, liveSite: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const layoutSections = normalizeLayoutSections([
    {
      id: "row-toc",
      title: "Contents",
      layout: "single",
      modules: [{ id: "toc", type: "table-of-contents", column: "main", text: "", settings: tocSettings }]
    },
    {
      id: "row-body",
      title: "Body",
      layout: "single",
      modules: [{ id: "body", type: "text", column: "main", text, settings: {} }]
    }
  ]);
  act(() => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={layoutSections}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
        liveSite={liveSite}
      />
    );
  });
  return host;
}

function links(page: HTMLElement) {
  return Array.from(page.querySelectorAll(".builder-preview-toc a")).map((a) => ({
    href: a.getAttribute("href"),
    text: a.textContent,
    depth: a.closest("li")?.getAttribute("data-toc-depth")
  }));
}

describe("Table of Contents on a page", () => {
  it("survives normalization as its own type, not text", () => {
    const [section] = normalizeLayoutSections([
      { id: "r", title: "r", layout: "single", modules: [{ id: "t", type: "table-of-contents", column: "main", text: "", settings: {} }] }
    ]);
    expect(section.modules[0].type).toBe("table-of-contents");
    // A new one starts with the panel's defaults.
    const fresh = createEmptyModule("table-of-contents");
    expect(fresh.type).toBe("table-of-contents");
    expect(fresh.settings).toMatchObject({ title: "On this page", headingLevels: "h2-h3", indentSubheadings: "true" });
  });

  it("lists three H2s and two H3s in page order, H3s indented, each linking to the heading's anchor", () => {
    const page = renderPage(BODY, {}, true);
    expect(links(page)).toEqual([
      { href: "#juniors", text: "Juniors", depth: "0" },
      { href: "#ages-5-to-8", text: "Ages 5 to 8", depth: "1" },
      { href: "#ages-9-to-12", text: "Ages 9 to 12", depth: "1" },
      { href: "#adults", text: "Adults", depth: "0" },
      { href: "#private-lessons", text: "Private Lessons", depth: "0" }
    ]);
    // Every link points at a heading that exists on the page.
    for (const link of links(page)) expect(page.querySelector(link.href!)).not.toBeNull();
    expect(page.querySelector(".builder-preview-toc-title")?.textContent).toBe("On this page");
  });

  it("H2 only leaves the three H2 links", () => {
    const page = renderPage(BODY, { headingLevels: "h2" }, true);
    expect(links(page).map((l) => l.href)).toEqual(["#juniors", "#adults", "#private-lessons"]);
  });

  it("indent off lists the H3s flush", () => {
    const page = renderPage(BODY, { indentSubheadings: "false" }, true);
    expect(links(page).every((l) => l.depth === "0")).toBe(true);
  });

  it("a live page with no headings shows nothing: no title, no list, no note", () => {
    const page = renderPage("<p>Just a paragraph.</p>", {}, true);
    expect(page.querySelector(".builder-preview-toc")).toBeNull();
    expect(page.querySelector(".builder-only-note")).toBeNull();
    expect(page.textContent).not.toContain("On this page");
    expect(page.textContent).not.toContain("No headings");
  });

  it("in the Builder, the same empty page says why it is empty", () => {
    const page = renderPage("<p>Just a paragraph.</p>", {}, false);
    expect(page.querySelector(".builder-only-note")?.textContent).toBe(
      "No headings on this page yet. Headings in Text modules and blog posts are listed here."
    );
  });

  it("in the Builder, a page that has headings lists them too", () => {
    const page = renderPage(BODY, {}, false);
    expect(links(page)).toHaveLength(5);
  });
});
