// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The Post Feed filters by tag, category, author and date IN THE BROWSER, over
 * whatever the posts API handed back. It asked for one page of 100, and
 * `listPosts` caps a page at 100 whatever is asked for — so on a blog with
 * more than 100 published posts the filters ran over the newest hundred and
 * nothing said so. A tag page showed an incomplete list, or an empty one, and
 * "no posts tagged X" could not be told from "no posts tagged X among the
 * newest hundred" (task 86bbuncxj).
 *
 * Delray has 55 posts today with 46 of them drafts; publishing the imported
 * backlog takes it straight past the cap, so these fixtures are the shape a
 * real client blog is about to become.
 */

const PAGE_SIZE = 100;

/** A blog of `total` published posts, served the way the real API serves it. */
function blogOf(total: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: `p${i + 1}`,
    slug: `post-${i + 1}`,
    title: `Post ${i + 1}`,
    // One post deep past the first page carries a tag nothing else does. It is
    // the whole test: before paging, this post was invisible to the filter.
    tags: i === 139 ? ["deep tag"] : ["common"],
    categoryIds: [],
    status: "published",
  }));
}

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

function stubApi(posts: Array<Record<string, unknown>>) {
  pagesAsked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("/api/blog/posts")) {
        const params = new URLSearchParams(href.split("?")[1] ?? "");
        const page = parseInt(params.get("page") ?? "1", 10) || 1;
        const limit = Math.min(PAGE_SIZE, parseInt(params.get("limit") ?? "20", 10) || 20);
        pagesAsked.push(page);
        const offset = (page - 1) * limit;
        return { ok: true, json: async () => ({ posts: posts.slice(offset, offset + limit) }) };
      }
      if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
}

async function renderFeed(
  posts: Array<Record<string, unknown>>,
  search: string,
  settings: Record<string, string> = {}
) {
  window.history.replaceState({}, "", `/tags${search}`);
  stubApi(posts);
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
  // The walk is sequential, so every page needs its own turn of the microtask
  // queue before the render settles.
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

describe("Post Feed on a blog bigger than one page", () => {
  it("finds a post at #140 that the first page of 100 never contained", async () => {
    await renderFeed(blogOf(150), "?tag=deep%20tag");

    expect(document.body.textContent).toContain("Post 140");
    expect(document.body.textContent).not.toContain("No posts tagged");
  });

  it("walks both pages and stops at the short one", async () => {
    await renderFeed(blogOf(150), "");

    expect(pagesAsked).toEqual([1, 2]);
    // The tag dropdown is built from every post that was read, so a tag only
    // post #140 carries proves page 2 was kept and not merely requested.
    const tagSelect = Array.from(document.querySelectorAll("select")).find(
      (el) => (el.options[0]?.textContent ?? "") === "All Tags"
    );
    expect(Array.from(tagSelect!.options).map((o) => o.textContent)).toContain("deep tag");
  });

  it("costs exactly one request on a blog that fits in a page", async () => {
    await renderFeed(blogOf(9), "");

    expect(pagesAsked).toEqual([1]);
    expect(document.body.textContent).not.toContain("Showing the most recent");
  });

  it("counts every matching post, not the ones on the first page", async () => {
    // filterMode=tag turns on the results line, which carries the count. With
    // 150 posts, 149 carry "common" — a count of 99 would be the old bug.
    await renderFeed(blogOf(150), "?tag=common", { filterMode: "tag" });

    expect(document.body.textContent).toContain("Blog posts matching the tag “common”: 149");
  });

  /*
   * The ceiling has to be honest in both directions. Past it the page says so
   * rather than quietly showing less; AT it there is nothing behind the
   * ceiling, and warning about hidden posts that do not exist is its own wrong
   * statement on a client's site.
   */
  it("says so when the blog runs past the ceiling", async () => {
    await renderFeed(blogOf(1050), "");

    expect(document.body.textContent).toContain("Showing the most recent 1,000 posts");
    expect(document.body.textContent).toContain("do not reach older ones");
  });

  it("stays quiet on a blog of exactly the ceiling", async () => {
    await renderFeed(blogOf(1000), "");

    expect(document.body.textContent).not.toContain("Showing the most recent");
  });

  it("admits a partial list when a later page could not be read", async () => {
    const posts = blogOf(150);
    stubApi(posts);
    const paged = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href.includes("/api/blog/posts") && href.includes("page=2")) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return paged(url);
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState({}, "", "/tags");
    await act(async () => {
      root!.render(
        <BuilderTemplatePreview
          layoutSections={normalizeLayoutSections([
            {
              id: "row-1",
              title: "Feed",
              layout: "single",
              modules: [{ id: "feed-1", type: "blog-post-list", column: "main", text: "", settings: {} }],
            },
          ])}
          pageBackground={createDefaultBackgroundSettings()}
          showShell={false}
        />
      );
    });
    for (let i = 0; i < 10; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }

    expect(document.body.textContent).toContain("may be incomplete");
    // What it DID read is still shown — a failed page is not an empty blog.
    expect(document.body.textContent).toContain("Post 1");
  });
});
