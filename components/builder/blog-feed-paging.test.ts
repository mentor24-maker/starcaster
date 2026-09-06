import { describe, expect, it } from "vitest";
import { BLOG_FEED_PAGE_SIZE, readAllPages } from "./blog-feed-paging";

/**
 * The Post Feed fetched `limit=100` once and filtered the answer in the
 * browser, so a tag carried only by the 101st-newest post came back empty on a
 * site with more than 100 published posts — and #572's "No posts tagged X"
 * would have said so confidently (task 86bbup88u). These hold the paging rule
 * on its own, away from React: read until a page comes back short, and never
 * report a partial read as a whole one.
 */

/** A page reader over a fixed list, the way `/api/blog/posts` behaves. */
function pagerOver(items: { id: string }[], { hardCap = Infinity } = {}) {
  const asked: number[] = [];
  const read = async (page: number, limit: number) => {
    asked.push(page);
    const size = Math.min(limit, hardCap);
    const offset = (page - 1) * size;
    return items.slice(offset, offset + size);
  };
  return { read, asked };
}

const posts = (n: number, prefix = "p") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}` }));

describe("readAllPages", () => {
  it("reads every page when the archive is longer than one", async () => {
    const { read, asked } = pagerOver(posts(250));

    const result = await readAllPages(read, { pageSize: 100 });

    expect(result.items).toHaveLength(250);
    expect(result.complete).toBe(true);
    expect(asked).toEqual([1, 2, 3]);
    // The 101st-newest post — the one the single-page read could never see.
    expect(result.items.map((p) => p.id)).toContain("p101");
  });

  it("stops after one page when the archive fits in one", async () => {
    const { read, asked } = pagerOver(posts(9));

    const result = await readAllPages(read, { pageSize: 100 });

    expect(result.items).toHaveLength(9);
    expect(result.complete).toBe(true);
    expect(asked).toEqual([1]);
  });

  it("asks for a second page when the first is exactly full", async () => {
    // 100 is the boundary: a full page says nothing about whether more exist,
    // so stopping there is the original bug in miniature.
    const { read, asked } = pagerOver(posts(100));

    const result = await readAllPages(read, { pageSize: 100 });

    expect(asked).toEqual([1, 2]);
    expect(result.items).toHaveLength(100);
    expect(result.complete).toBe(true);
  });

  it("reports an incomplete read rather than a short answer when the page cap is hit", async () => {
    const { read } = pagerOver(posts(1000));

    const result = await readAllPages(read, { pageSize: 10, maxPages: 3 });

    expect(result.items).toHaveLength(30);
    expect(result.complete).toBe(false);
  });

  it("keeps what it read and says so when a later page fails", async () => {
    let calls = 0;
    const read = async (page: number, limit: number) => {
      calls += 1;
      if (page === 2) throw new Error("network");
      return posts(limit, `page${page}-`);
    };

    const result = await readAllPages(read, { pageSize: 5 });

    expect(calls).toBe(2);
    expect(result.items).toHaveLength(5);
    expect(result.complete).toBe(false);
  });

  it("rethrows when the FIRST page fails — that is 'the feed did not load'", async () => {
    const read = async () => {
      throw new Error("network");
    };

    await expect(readAllPages(read, { pageSize: 5 })).rejects.toThrow("network");
  });

  it("drops a post that arrives on two pages", async () => {
    // `published_at desc, created_at desc` has no tiebreak on id, so two posts
    // sharing both timestamps can swap between reads. Duplicate cards are the
    // visible half; duplicate React keys are the half that breaks rendering.
    const read = async (page: number) => (page === 1 ? posts(3) : page === 2 ? [{ id: "p3" }] : []);

    const result = await readAllPages(read, { pageSize: 3 });

    expect(result.items.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.complete).toBe(true);
  });

  it("defaults to the page size the posts store actually enforces", async () => {
    const seen: number[] = [];
    const read = async (_page: number, limit: number) => {
      seen.push(limit);
      return [];
    };

    await readAllPages(read);

    expect(seen).toEqual([BLOG_FEED_PAGE_SIZE]);
    expect(BLOG_FEED_PAGE_SIZE).toBe(100);
  });
});
