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
const cardCount = () => document.querySelectorAll("article").length;

/*
 * React tracks an input's value on the DOM node, so assigning `.value` and
 * firing "input" is ignored — the native setter is what makes onChange run.
 * This is the visitor typing, which is what put the two numbers in the results
 * line out of step with each other.
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

/*
 * Task 86bbw4j6e, live on the client's /tags page. The results line names ONE
 * filter and prints `filteredPosts.length`, which is the count after every
 * filter — so the moment anything else narrowed the list, the sentence made a
 * claim about the tag using a number the tag had nothing to do with. The A2
 * change on 86bbvyr6d put showSearch on that page on 2026-09-07, which is what
 * made the two able to disagree in front of visitors.
 *
 * Two honest answers were available: count the tag alone, or say what the
 * number counts. The second is the one taken, because the number stays equal
 * to the cards on screen — the only half of the sentence a visitor can check.
 */
describe("Post Feed results line — the count and the sentence describe the same list", () => {
  it("names the search once it is narrowing the count", async () => {
    // Two posts carry "beginner tennis"; "Clinics" matches one of them.
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    expect(resultsLine()).toBe("Blog posts matching the tag “beginner tennis”: 2");

    await typeInSearchBox("Clinics");

    expect(resultsLine()).toBe(
      "Blog posts matching the tag “beginner tennis” and the search “Clinics”: 1"
    );
    // The defect exactly: the old sentence with the new number.
    expect(resultsLine()).not.toBe("Blog posts matching the tag “beginner tennis”: 1");
  });

  it("keeps the printed count equal to the cards on the page", async () => {
    // The check a visitor can actually make, and the one that failed live.
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    await typeInSearchBox("Clinics");

    expect(cardCount()).toBe(1);
    expect(resultsLine().endsWith(`: ${cardCount()}`)).toBe(true);
  });

  it("does the same in author mode", async () => {
    await renderFeed("?author=Jeff%20Bingo", { filterMode: "author" });
    await typeInSearchBox("Clinics");

    expect(resultsLine()).toBe(
      "Blog posts matching the author “Jeff Bingo” and the search “Clinics”: 1"
    );
  });

  it("names another filter the URL set, not only the typed word", async () => {
    /*
     * ?tag=, ?category= and ?author= each seed their filter whatever filterMode
     * says, so a tag-results page can be narrowed by an author it never shows a
     * control for. Same false sentence, no typing required.
     */
    await renderFeed("?tag=beginner%20tennis&author=Rich%20Benvin", { filterMode: "tag" });

    expect(resultsLine()).toBe(
      "Blog posts matching the tag “beginner tennis” and the author “Rich Benvin”: 0"
    );
  });

  it("leaves the sentence alone while nothing else is narrowing it", async () => {
    // The wording Dane asked for, unchanged on the page he asked for it on.
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    await typeInSearchBox("Clinics");
    await typeInSearchBox("");

    expect(resultsLine()).toBe("Blog posts matching the tag “beginner tennis”: 2");
  });
});

/*
 * Round 1 of task 86bbw4j6e fixed both defects the ticket named and put a third
 * on the same screen: the results line named the typed word unconditionally
 * while the empty state, ten lines below, had just stopped blaming it. On a tag
 * with no published posts both sentences rendered at once —
 *
 *   Blog posts matching the tag “junior tennis” and the search “tennis”: 0
 *   No posts tagged “junior tennis”.
 *
 * — so the page re-issued the "clear the word and try again" invitation it had
 * removed, and clearing the word brought nothing back. 97 tags on the Delray
 * project carry no published post and the live tag cloud links to every one of
 * them, so this was reachable on the client site.
 *
 * These read the two sentences TOGETHER, in one scene, which is the only way
 * the contradiction is visible: each sentence on its own was defensible.
 */
describe("Post Feed — the results line and the empty state agree about the search", () => {
  it("leaves the typed word out of BOTH when the tag is empty on its own", async () => {
    // No post carries "junior tennis", so the word "tennis" changed nothing.
    await renderFeed("?tag=junior%20tennis", { filterMode: "tag" });
    await typeInSearchBox("tennis");

    expect(resultsLine()).toBe("Blog posts matching the tag “junior tennis”: 0");
    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");
    // The contradiction itself: the word blamed above, cleared below.
    expect(resultsLine()).not.toContain("the search");
    expect(document.body.textContent).not.toContain("match “tennis”");
  });

  it("does the same for an author nobody matches", async () => {
    await renderFeed("?author=Nobody", { filterMode: "author" });
    await typeInSearchBox("tennis");

    expect(resultsLine()).toBe("Blog posts matching the author “Nobody”: 0");
    expect(document.body.textContent).toContain("No posts by “Nobody”.");
    expect(resultsLine()).not.toContain("the search");
  });

  it("does the same for a ?category= slug that matches no category", async () => {
    await renderFeed("?category=no-such-category", { filterMode: "category" });
    await typeInSearchBox("tennis");

    expect(document.body.textContent).toContain("No posts in the category “no-such-category”.");
    expect(resultsLine()).not.toContain("the search");
  });

  it("still names the word in BOTH when the dropdowns leave posts standing", async () => {
    /*
     * The other direction, and what #643 exists to protect: two posts carry
     * "beginner tennis", so a word matching neither of them IS what emptied the
     * page, and clearing it does bring them back. Both sentences say so.
     */
    await renderFeed("?tag=beginner%20tennis", { filterMode: "tag" });
    await typeInSearchBox("zzzznothing");

    expect(resultsLine()).toBe(
      "Blog posts matching the tag “beginner tennis” and the search “zzzznothing”: 0"
    );
    expect(document.body.textContent).toContain(
      "No posts tagged “beginner tennis” match “zzzznothing”."
    );
  });
});
