// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The Post Feed's dropdown filters each name themselves when they empty the
 * page ("No posts tagged X" — #572). Its search box did not, and that gap is
 * the same defect one step further on: a visitor who typed a word nothing
 * matched was told "No posts match your filters", which never says WHICH word
 * emptied the page.
 *
 * Worse, with a tag also selected the message read "No posts tagged
 * “beginner tennis”." — a sentence that is FALSE while posts carry that tag.
 * The search emptied the list; the tag took the blame. A confident wrong
 * message is the worst of the three (docs/DOCTRINE.md §5.31).
 *
 * These tests came out of 86bbvqhp6, where the /tags page's search was being
 * switched from the dead sidebar module to the feed's own field. That switch
 * is only worth making if the field tells the truth when it finds nothing.
 */

const POSTS = [
  { id: "p1", slug: "levels", title: "What Level Player Are You?", excerpt: "Find your level.", tags: ["beginner tennis"], categoryIds: [], status: "published" },
  { id: "p2", slug: "open",   title: "Delray Beach Open",          excerpt: "ATP week.",        tags: ["ATP tennis"],      categoryIds: [], status: "published" },
  { id: "p3", slug: "clinic", title: "Adult Clinics",              excerpt: "Weekly clinics.",  tags: ["beginner tennis"], categoryIds: [], status: "published" }
];

// react-dom 18 wants this flag before act(); without it every render warns.
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

async function renderFeed(search: string, settings: Record<string, string> = {}) {
  window.history.replaceState({}, "", `/tags${search}`);
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
            modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings: { showSearch: "true", ...settings } }]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
  });
  // Let the posts/categories/card-template promises settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/*
 * React tracks an input's value on the DOM node, so assigning `.value` and
 * firing "input" is ignored — the native setter is what makes onChange run.
 * This is the visitor typing, which is the whole thing under test.
 */
async function typeInSearchBox(text: string) {
  const input = document.querySelector('input[type="search"]') as HTMLInputElement | null;
  if (!input) throw new Error("the feed rendered no search field");
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function cardTitles(): string {
  return Array.from(document.querySelectorAll("h3, h2")).map((h) => h.textContent ?? "").join(" ");
}

describe("Post Feed search that finds nothing", () => {
  it("filters the list down when the word does match", async () => {
    // A2's premise: the feed's own field really does search. If this fails,
    // switching /tags onto it would trade one dead box for another.
    await renderFeed("");
    await typeInSearchBox("Clinics");

    expect(cardTitles()).toContain("Adult Clinics");
    expect(cardTitles()).not.toContain("Delray Beach Open");
  });

  it("names the word that emptied the page", async () => {
    await renderFeed("");
    await typeInSearchBox("zzzznotarealquery");

    expect(document.body.textContent).toContain("No posts match “zzzznotarealquery”.");
    expect(document.body.textContent).not.toContain("No posts match your filters.");
  });

  it("does not blame the tag for an emptiness the search caused", async () => {
    // Posts tagged "beginner tennis" exist; "No posts tagged X." would be a lie.
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    expect(cardTitles()).toContain("What Level Player Are You?");

    await typeInSearchBox("zzzznotarealquery");

    expect(document.body.textContent)
      .toContain("No posts tagged “beginner tennis” match “zzzznotarealquery”.");
    expect(document.body.textContent).not.toContain("No posts tagged “beginner tennis”.");
  });

  it("offers a way back, and taking it restores the whole feed", async () => {
    await renderFeed("");
    await typeInSearchBox("zzzznotarealquery");

    const back = Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Show all posts");
    expect(back).toBeTruthy();

    await act(async () => { back!.click(); });
    expect(cardTitles()).toContain("Delray Beach Open");
    expect(document.body.textContent).not.toContain("No posts match");
  });

  it("leaves the dropdown-only messages exactly as they were", async () => {
    // #572's wording is load-bearing and unchanged when nothing was typed.
    await renderFeed("?tag=junior%20tennis", { filterMode: "tag" });

    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");
    expect(document.body.textContent).not.toContain("match “");
  });
});
