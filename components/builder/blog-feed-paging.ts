/*
 * Reading a whole list out of an endpoint that only ever answers one page.
 *
 * The Post Feed used to ask `/api/blog/posts?status=published&limit=100` once
 * and filter the answer in the browser. `listPosts` caps a page at 100
 * (lib/blogPostsStore.js), so on a site with more than 100 published posts a
 * tag carried only by an older one came back genuinely empty — and the empty
 * state shipped in #572 ("No posts tagged X") would then be confidently WRONG,
 * which is worse than the vague message it replaced (task 86bbup88u).
 *
 * So the feed pages through instead. The part worth testing on its own is the
 * paging rule, which is nothing to do with React: keep asking for the next page
 * until one comes back short, and be honest when you stopped early.
 */

/** The cap `listPosts` enforces. Asking for more than this silently gets this. */
export const BLOG_FEED_PAGE_SIZE = 100;

/**
 * A backstop, not a limit anyone should hit: 20 pages is 2,000 published posts.
 * It exists so a paginator that never reports a short page — a bug at the other
 * end, or an endpoint answering the same page forever — cannot spin the
 * visitor's browser. Reaching it is reported, never swallowed.
 */
export const BLOG_FEED_MAX_PAGES = 20;

export interface PagedReadResult<T> {
  /** Everything read, in the order the pages returned it, deduplicated by id. */
  items: T[];
  /**
   * `false` when the read stopped before the endpoint said it was done — the
   * page cap was reached, or a page after the first failed. The caller owes the
   * visitor a word about it: a count taken from a partial read is a floor, not
   * a total, and an empty result may only mean "not looked at yet".
   */
  complete: boolean;
}

/**
 * Read every page of a paginated endpoint.
 *
 * A failure on the FIRST page is rethrown — that is "the feed could not load",
 * which the caller already handles. A failure on a later page is not: some
 * posts were read and showing them beats showing nothing, so the read returns
 * what it has and marks itself incomplete.
 */
export async function readAllPages<T extends { id?: string }>(
  fetchPage: (page: number, limit: number) => Promise<T[]>,
  { pageSize = BLOG_FEED_PAGE_SIZE, maxPages = BLOG_FEED_MAX_PAGES }: {
    pageSize?: number;
    maxPages?: number;
  } = {}
): Promise<PagedReadResult<T>> {
  const items: T[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    let batch: T[];
    try {
      batch = await fetchPage(page, pageSize);
    } catch (err) {
      if (page === 1) throw err;
      return { items, complete: false };
    }
    if (!Array.isArray(batch)) return { items, complete: page === 1 && items.length === 0 };

    for (const item of batch) {
      /*
       * The order is `published_at desc, created_at desc` with no tiebreak on
       * id, so two posts sharing both timestamps can swap places between two
       * page reads and arrive twice. Duplicate cards are the visible half; the
       * duplicate React keys are the half that breaks rendering.
       */
      const id = typeof item?.id === "string" ? item.id : "";
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      items.push(item);
    }

    if (batch.length < pageSize) return { items, complete: true };
  }

  return { items, complete: false };
}
