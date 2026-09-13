// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * On a Post Feed card the "Read More" link always opened the post, and the
 * featured image did when its setting was on — but the headline was a plain
 * <h3>. Visitors click a headline before anything else, and a headline that
 * does nothing reads as a broken site (Dane, 2026-09-13, task 86bbzy3kb).
 *
 * The headline links to the SAME address "Read More" does, unconditionally,
 * on the published page and in the Builder preview alike — they are one
 * component. The one exception is a card with no usable address at all,
 * which renders plain text rather than a dead anchor.
 */

const POSTS = [
  { id: "p1", slug: "levels", title: "What Level Player Are You?", tags: ["beginner tennis"], categoryIds: [], status: "published" },
  { id: "p2", slug: "open",   title: "Delray Beach Open",         tags: ["tournament"],      categoryIds: [], status: "published" }
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/blog/posts")) return { ok: true, json: async () => ({ posts: POSTS }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

async function renderFeed(settings: Record<string, string> = {}) {
  window.history.replaceState({}, "", "/blog");
  stubApi();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            title: "Feed",
            layout: "single",
            modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings }]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function cardFor(title: string): HTMLElement {
  const heading = Array.from(document.querySelectorAll("h3")).find((h) => (h.textContent ?? "").trim() === title);
  if (!heading) throw new Error(`No card headline reading "${title}"`);
  const article = heading.closest("article");
  if (!article) throw new Error(`Headline "${title}" is not inside a card`);
  return article;
}

function readMoreHref(card: HTMLElement): string {
  const link = Array.from(card.querySelectorAll("a")).find((a) => (a.textContent ?? "").startsWith("Read More"));
  if (!link) throw new Error("Card has no Read More link");
  return link.getAttribute("href") ?? "";
}

describe("Post Feed card headline", () => {
  it("links to the post, at the same address Read More opens", async () => {
    await renderFeed({ postPageUrl: "/post" });

    for (const title of ["What Level Player Are You?", "Delray Beach Open"]) {
      const card = cardFor(title);
      const headline = card.querySelector("h3")!;
      const link = headline.querySelector("a");
      expect(link, `headline "${title}" is not a link`).not.toBeNull();
      expect(link!.getAttribute("href")).toBe(readMoreHref(card));
      expect(link!.getAttribute("href")).toContain("/post?post=");
    }
  });

  it("keeps the headline text itself as the link, not an empty anchor beside it", async () => {
    await renderFeed({ postPageUrl: "/post" });

    const link = cardFor("Delray Beach Open").querySelector("h3 a")!;
    expect((link.textContent ?? "").trim()).toBe("Delray Beach Open");
  });
});
