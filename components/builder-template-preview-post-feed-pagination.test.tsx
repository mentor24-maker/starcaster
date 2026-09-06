// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * `https://delraytennis.starcaster.pro/tags?tag=junior tennis` said "Blog posts
 * matching the tag “junior tennis”: 13" and rendered 9 cards, with no pager, no
 * "load more" and nothing saying the list had been cut (task 86bbup88u). The
 * count was honest and the list was not — a visitor who counts the cards
 * concludes the site is broken, and one who does not never learns four posts
 * exist.
 *
 * Underneath that sat the worse half: the feed read ONE page of 100 posts and
 * filtered it in the browser, so past 100 posts a tag on an older one came back
 * genuinely empty and #572's "No posts tagged X" would have said so with
 * complete confidence.
 *
 * These tests hold both halves: what the module states must be reachable, and
 * what it reads must be the whole archive.
 */

const CATEGORIES = [{ id: "c1", name: "Guides", slug: "guides" }];

// react-dom 18 wants this flag before act(); without it every render warns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let pagesAsked: number[] = [];

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  pagesAsked = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Post {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  categoryIds: string[];
  status: string;
}

function makePosts(count: number, tag: string): Post[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    slug: `post-${i + 1}`,
    title: `Post ${i + 1}`,
    tags: [tag],
    categoryIds: [],
    status: "published",
  }));
}

/**
 * Answers `/api/blog/posts` the way `listPosts` does — honouring page and
 * limit, capping a page at 100 (lib/blogPostsStore.js) — so a feed that reads
 * only page one really does miss the later posts, exactly as production did.
 */
function stubApi(all: Post[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("/api/blog/posts")) {
        const params = new URLSearchParams(href.split("?")[1] || "");
        const page = parseInt(params.get("page") || "1", 10) || 1;
        const limit = Math.min(100, parseInt(params.get("limit") || "20", 10) || 20);
        pagesAsked.push(page);
        const offset = (page - 1) * limit;
        return { ok: true, json: async () => ({ posts: all.slice(offset, offset + limit) }) };
      }
      if (href.includes("/api/blog/categories")) {
        return { ok: true, json: async () => ({ categories: CATEGORIES }) };
      }
      // Anything else this page happens to call answers the way an unreachable
      // endpoint does, so no other module's fallback path is skipped.
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
}

async function renderFeed(
  archive: Post[],
  search: string,
  settings: Record<string, string> = {}
) {
  stubApi(archive);
  window.history.replaceState({}, "", `/tags${search}`);
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
            modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings }],
          },
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );
  });
  // Let the paged read, the categories and the card template settle. More
  // turns than a single-fetch test needs, because each page is another hop.
  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const cardCount = () => document.querySelectorAll("article").length;
const resultsLine = () =>
  document.querySelector(".builder-blog-post-list-results-line")?.textContent ?? "";
const showingLine = () =>
  document.querySelector(".builder-blog-post-list-showing")?.textContent ?? "";
const moreButton = () =>
  document.querySelector<HTMLButtonElement>(".builder-blog-post-list-more-button");

/** The reported shape exactly: 13 posts carrying the tag, 9 per page. */
const THIRTEEN = makePosts(13, "junior tennis");

describe("Post Feed: the list and its own count agree", () => {
  it("offers the rest when the count is higher than one page of cards", async () => {
    await renderFeed(THIRTEEN, "?tag=junior%20tennis", { filterMode: "tag", postsPerPage: "9" });

    expect(resultsLine()).toBe("Blog posts matching the tag “junior tennis”: 13");
    expect(cardCount()).toBe(9);
    expect(showingLine()).toBe("Showing 9 of 13");
    expect(moreButton()).not.toBeNull();
  });

  it("reaches every stated post through the control", async () => {
    await renderFeed(THIRTEEN, "?tag=junior%20tennis", { filterMode: "tag", postsPerPage: "9" });

    await act(async () => {
      moreButton()!.click();
    });

    expect(cardCount()).toBe(13);
    expect(resultsLine()).toBe("Blog posts matching the tag “junior tennis”: 13");
    // Nothing left out of reach, so nothing left to offer.
    expect(moreButton()).toBeNull();
    expect(showingLine()).toBe("");
  });

  it("shows no control at all when everything already fits", async () => {
    await renderFeed(THIRTEEN, "?tag=junior%20tennis", { filterMode: "tag", postsPerPage: "20" });

    expect(cardCount()).toBe(13);
    expect(moreButton()).toBeNull();
    expect(showingLine()).toBe("");
  });

  it("starts a new filter back at the first page of cards", async () => {
    await renderFeed(THIRTEEN, "?tag=junior%20tennis", { filterMode: "tag", postsPerPage: "9" });
    await act(async () => {
      moreButton()!.click();
    });
    expect(cardCount()).toBe(13);

    const select = Array.from(document.querySelectorAll("select")).find(
      (el) => (el.options[0]?.textContent ?? "") === "All Tags"
    )!;
    await act(async () => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(cardCount()).toBe(9);
  });
});

describe("Post Feed: a tag past the first 100 posts", () => {
  it("finds a post the single-page read could never have reached", async () => {
    /*
     * 120 posts, and the only match is the 105th. A feed that reads one page of
     * 100 and filters in the browser reports "No posts tagged X" — confidently,
     * and wrongly.
     */
    const all = makePosts(120, "everything");
    all[104] = { ...all[104], tags: ["everything", "junior tennis"] };

    await renderFeed(all, "?tag=junior%20tennis", { filterMode: "tag", postsPerPage: "9" });

    expect(pagesAsked).toContain(2);
    expect(resultsLine()).toBe("Blog posts matching the tag “junior tennis”: 1");
    expect(cardCount()).toBe(1);
    expect(document.body.textContent).not.toContain("No posts tagged");
  });

  it("still names the tag when nothing carries it, after reading all of it", async () => {
    // #572 must not regress: an honest empty state, now taken from the whole
    // archive rather than from the first page of it.
    await renderFeed(makePosts(120, "everything"), "?tag=junior%20tennis", {
      filterMode: "tag",
      postsPerPage: "9",
    });

    expect(document.body.textContent).toContain("No posts tagged “junior tennis”.");
    expect(document.body.textContent).not.toContain("No posts match your filters.");
    // The archive WAS fully read, so no doubt is claimed either.
    expect(document.querySelector(".builder-blog-post-list-partial")).toBeNull();
  });

  it("pages all the way through a long archive and counts every match", async () => {
    await renderFeed(makePosts(250, "junior tennis"), "?tag=junior%20tennis", {
      filterMode: "tag",
      postsPerPage: "9",
    });

    expect(pagesAsked).toEqual([1, 2, 3]);
    expect(resultsLine()).toBe("Blog posts matching the tag “junior tennis”: 250");
    expect(showingLine()).toBe("Showing 9 of 250");
  });
});
