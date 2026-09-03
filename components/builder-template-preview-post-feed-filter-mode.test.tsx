// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultBackgroundSettings,
  createEmptyModule,
  normalizeLayoutSections
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * filterMode — what this feed IS, rather than which checkboxes are ticked.
 *
 * The three show*Filter toggles could always produce a tag-only filter bar, but
 * nothing in the module knew that was the INTENT, so nothing could title the
 * results (Dane, 2026-09-03: "add instructions saying 'Blog posts matching the
 * tag [tag]: n'").
 *
 * The load-bearing tests are the last two, and they guard DIFFERENT paths.
 * createEmptyModule's defaults reach only modules newly dragged from the
 * palette; a Post Feed already saved on a page carries no filterMode key at
 * all and depends entirely on the renderer's own "all" fallback. Breaking
 * either one silently retitles and re-narrows live pages, so both are held.
 */

const POSTS = [
  { id: "p1", slug: "levels", title: "What Level Player Are You?", tags: ["beginner tennis"], categoryIds: ["c1"], author: "Jeff Bingo",   status: "published" },
  { id: "p2", slug: "open",   title: "Delray Beach Open",         tags: ["tournament"],       categoryIds: ["c2"], author: "Rich Benvin",  status: "published" },
  { id: "p3", slug: "clinic", title: "Adult Clinics",             tags: ["beginner tennis"],  categoryIds: ["c1"], author: "Jeff Bingo",   status: "published" }
];
const CATEGORIES = [
  { id: "c1", name: "Guides", slug: "guides" },
  { id: "c2", name: "Events", slug: "events" }
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

async function renderFeed(search: string, settings: Record<string, string> = {}) {
  window.history.replaceState({}, "", `/results${search}`);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/api/blog/posts")) return { ok: true, json: async () => ({ posts: POSTS }) };
    if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: CATEGORIES }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          { id: "row-1", title: "Feed", layout: "single",
            modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings }] }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const firstOptions = () =>
  Array.from(document.querySelectorAll("select")).map((s) => s.options[0]?.textContent ?? "");
const resultsLine = () =>
  document.querySelector(".builder-blog-post-list-results-line")?.textContent ?? "";

describe("Post Feed filterMode", () => {
  it("tag mode shows only the tag selector and titles the results", async () => {
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });

    expect(firstOptions()).toEqual(["All Tags"]);
    expect(resultsLine()).toBe("Blog posts matching the tag “beginner tennis”: 2");
  });

  it("category mode does the same for categories", async () => {
    await renderFeed("?category=events", { filterMode: "category" });

    expect(firstOptions()).toEqual(["All Categories"]);
    expect(resultsLine()).toBe("Blog posts matching the category “Events”: 1");
  });

  it("author mode does the same for authors, seeded from ?author=", async () => {
    await renderFeed("?author=Jeff%20Bingo", { filterMode: "author" });

    expect(firstOptions()).toEqual(["All Authors"]);
    expect(resultsLine()).toBe("Blog posts matching the author “Jeff Bingo”: 2");
  });

  it("says nothing when the mode has no value to describe", async () => {
    // "matching the tag “”: 3" would be noise on a page showing everything.
    await renderFeed("", { filterMode: "tag" });

    expect(resultsLine()).toBe("");
    expect(firstOptions()).toEqual(["All Tags"]);
  });

  it("does not print the count twice", async () => {
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });

    // The bare "2 results" counter stands down when the line carries the count.
    expect(document.body.textContent).not.toContain("2 results");
    expect(resultsLine()).toContain(": 2");
  });

  it("lets the mode beat a contradicting checkbox", async () => {
    await renderFeed("?tag=beginner%20tennis", {
      filterMode: "tag", showCategoryFilter: "true", showAuthorFilter: "true"
    });

    expect(firstOptions()).toEqual(["All Tags"]);
  });

  it("leaves the search box and date range to their own settings", async () => {
    await renderFeed("", { filterMode: "tag", showSearch: "true", showDateFilter: "true" });

    expect(document.querySelector('input[type="search"]')).not.toBeNull();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(2);
  });

  it("changes NOTHING for a feed that never set filterMode", async () => {
    /*
     * Every Post Feed already on a page. Their saved settings have no
     * filterMode key — nothing backfills one — so this is the renderer's own
     * fallback and nothing else.
     */
    await renderFeed("?tag=beginner%20tennis");

    expect(firstOptions()).toEqual(["All Categories", "All Tags", "All Authors"]);
    expect(resultsLine()).toBe("");
    expect(document.body.textContent).toContain("2 results");
  });

  it("gives a newly dragged Post Feed the all-filters mode", async () => {
    // The other path: createEmptyModule seeds modules added from the palette.
    // Its default and the renderer's fallback must agree, or a brand-new feed
    // behaves differently from every feed already on a page.
    expect(createEmptyModule("blog-post-list").settings.filterMode).toBe("all");
  });
});
