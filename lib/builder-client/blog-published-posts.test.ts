import { describe, expect, it, vi } from "vitest";
import {
  MAX_POSTS_PAGES,
  POSTS_PAGE_SIZE,
  incompleteListNotice,
  readAllPublishedPosts,
} from "./blog-published-posts";

type Post = { id: string };

/** A blog of `total` posts, served the way the real API serves it: pages capped at `pageSize`. */
function blogOf(total: number, pageSize = POSTS_PAGE_SIZE) {
  const all: Post[] = Array.from({ length: total }, (_, i) => ({ id: `p${i + 1}` }));
  return vi.fn(async (page: number, size: number) => {
    const offset = (page - 1) * size;
    return all.slice(offset, offset + Math.min(size, pageSize));
  });
}

describe("readAllPublishedPosts", () => {
  it("reads a blog smaller than one page in a single request", async () => {
    const readPage = blogOf(9);
    const result = await readAllPublishedPosts<Post>(readPage);
    expect(result.posts).toHaveLength(9);
    expect(result.truncated).toBe(false);
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  /*
   * The bug this module exists for. Delray has 55 posts with 46 of them
   * drafts; publishing the imported backlog takes it past the cap, and before
   * this the feed filtered over the newest 100 with nothing saying so.
   */
  it("reads every post on a 150-post blog, not the first 100", async () => {
    const readPage = blogOf(150);
    const result = await readAllPublishedPosts<Post>(readPage);
    expect(result.posts).toHaveLength(150);
    expect(result.posts[149]?.id).toBe("p150");
    expect(result.truncated).toBe(false);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("stops at a page boundary without an extra request when the last page is short", async () => {
    const readPage = blogOf(200);
    const result = await readAllPublishedPosts<Post>(readPage, { maxPages: 5 });
    expect(result.posts).toHaveLength(200);
    // Pages 1 and 2 are full, page 3 comes back empty and ends the walk.
    expect(readPage).toHaveBeenCalledTimes(3);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation, and the ceiling, once there is provably more behind it", async () => {
    const readPage = blogOf(1500);
    const result = await readAllPublishedPosts<Post>(readPage);
    expect(result.posts).toHaveLength(POSTS_PAGE_SIZE * MAX_POSTS_PAGES);
    expect(result.truncated).toBe(true);
    expect(result.ceiling).toBe(1000);
  });

  /*
   * A blog holding EXACTLY the ceiling is complete. Without the probe page it
   * would warn a visitor that older posts are being hidden when none exist —
   * a warning about nothing is still a wrong statement on a client's site.
   */
  it("does not call a blog of exactly the ceiling truncated", async () => {
    const readPage = blogOf(1000);
    const result = await readAllPublishedPosts<Post>(readPage);
    expect(result.posts).toHaveLength(1000);
    expect(result.truncated).toBe(false);
    expect(readPage).toHaveBeenCalledTimes(MAX_POSTS_PAGES + 1);
  });

  it("keeps what it read and names the page that failed, instead of calling it a cap", async () => {
    const readPage = vi.fn(async (page: number) =>
      page === 1 ? [{ id: "p1" }, { id: "p2" }, { id: "p3" }] : null
    );
    const result = await readAllPublishedPosts<Post>(readPage, { pageSize: 3, maxPages: 4 });
    expect(result.posts).toHaveLength(3);
    expect(result.failedAtPage).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("treats a thrown reader the same as an unreadable page", async () => {
    const readPage = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await readAllPublishedPosts<Post>(readPage);
    expect(result.posts).toEqual([]);
    expect(result.failedAtPage).toBe(1);
  });
});

describe("incompleteListNotice", () => {
  it("says nothing when the list is the whole blog", () => {
    expect(incompleteListNotice({ truncated: false, ceiling: 1000, failedAtPage: 0 })).toBe("");
  });

  it("names the ceiling when the cap was hit", () => {
    const notice = incompleteListNotice({ truncated: true, ceiling: 1000, failedAtPage: 0 });
    expect(notice).toContain("1,000");
    expect(notice).toContain("older");
  });

  // Page 1 failing leaves an empty list, and the empty state already explains
  // itself. Two messages saying "nothing here" is worse than one.
  it("stays quiet when the very first page failed", () => {
    expect(incompleteListNotice({ truncated: false, ceiling: 1000, failedAtPage: 1 })).toBe("");
  });

  it("warns when a later page failed and left a partial list", () => {
    expect(incompleteListNotice({ truncated: false, ceiling: 1000, failedAtPage: 3 })).toContain(
      "may be incomplete"
    );
  });
});
