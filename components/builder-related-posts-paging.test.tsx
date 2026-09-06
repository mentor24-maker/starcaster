// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Related Posts matches by tag IN THE BROWSER, over whatever the posts API
 * handed back. It asked for one page of 100, and `listPosts` caps a page at
 * 100 whatever is asked for — so on a blog with more than 100 published posts
 * the match ran over the newest hundred, and a post deeper than that could
 * never be offered as related no matter how well it matched (task 86bbuncxj).
 *
 * The Post Feed half of this was fixed separately (task 86bbup88u); this
 * module kept the single-page read until now, which is why it gets its own
 * fixture rather than sharing the feed's.
 */

const PAGE_SIZE = 100;

/**
 * A blog of `total` published posts. The post the visitor is reading is #1,
 * and the ONLY other post sharing its tag sits at #140 — past the first page.
 * Before paging, this match was invisible.
 */
function blogOf(total: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: `p${i + 1}`,
    slug: `post-${i + 1}`,
    title: `Post ${i + 1}`,
    tags: i === 0 || i === 139 ? ["shared tag"] : ["unrelated"],
    categoryIds: [],
    status: "published",
  }));
}

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

function stubApi(posts: Array<Record<string, unknown>>, failPage = 0) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const href = String(url);
      // The single-post read must be matched BEFORE the list read: both begin
      // "/api/blog/posts", and taking the list branch first answers the
      // current-post fetch with a page of the archive.
      const single = href.match(/\/api\/blog\/posts\/([^?]+)\?by=slug/);
      if (single) {
        const slug = decodeURIComponent(single[1]);
        const post = posts.find((p) => p.slug === slug) ?? null;
        return { ok: true, json: async () => ({ post }) };
      }
      if (href.includes("/api/blog/posts")) {
        const params = new URLSearchParams(href.split("?")[1] ?? "");
        const page = parseInt(params.get("page") ?? "1", 10) || 1;
        if (failPage && page === failPage) return { ok: false, status: 500, json: async () => ({}) };
        const limit = Math.min(PAGE_SIZE, parseInt(params.get("limit") ?? "20", 10) || 20);
        const offset = (page - 1) * limit;
        return { ok: true, json: async () => ({ posts: posts.slice(offset, offset + limit) }) };
      }
      if (href.includes("/api/blog/categories")) return { ok: true, json: async () => ({ categories: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    })
  );
}

async function renderRelated(posts: Array<Record<string, unknown>>, failPage = 0) {
  window.history.replaceState({}, "", "/blog-post-view?post=post-1");
  stubApi(posts, failPage);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            title: "Related",
            layout: "single",
            modules: [
              {
                id: "rel-1",
                type: "blog-related-posts",
                column: "main",
                text: "",
                // Match by TAGS: no post anywhere carries a category
                // (CLAUDE.md landmine 18), so the default would match nothing
                // on every site and prove nothing here.
                settings: { matchBy: "tags", count: "3" },
              },
            ],
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

describe("Related Posts on a blog bigger than one page", () => {
  it("finds a match at #140 that the first page of 100 never contained", async () => {
    await renderRelated(blogOf(150));

    expect(document.body.textContent).toContain("Post 140");
  });

  it("does not offer the post the visitor is already reading", async () => {
    await renderRelated(blogOf(150));

    expect(document.body.textContent).not.toContain("Post 1Read");
  });

  it("says the search was incomplete when a later page could not be read", async () => {
    await renderRelated(blogOf(150), 2);

    expect(document.body.textContent).toContain("search was incomplete");
  });
});
