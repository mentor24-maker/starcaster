/**
 * Reading EVERY published post, not just the first page of them.
 *
 * The public Post Feed and the Related Posts module both filter by tag,
 * category, author and date in the browser, over whatever the posts API
 * handed back. They each asked for `limit=100` — and `listPosts`
 * (`lib/blogPostsStore.js`) caps a page at 100 whatever is asked for, so on a
 * blog with more than 100 published posts the filters ran over the newest 100
 * and nothing said so. A tag page then showed an incomplete list, or an empty
 * one, and "no posts tagged X" was indistinguishable from "no posts tagged X
 * among the newest hundred" (task 86bbuncxj).
 *
 * The fix is the same one `lib/blogTagsStore.js` already uses on the server:
 * walk the pages. This module is the browser's half of that walk, kept out of
 * the component so the arithmetic — where it stops, and whether stopping means
 * anything was left behind — can be tested without a DOM.
 *
 * WHAT THIS DOES NOT DO: it is not a replacement for server-side filtering. A
 * blog past the ceiling still needs the filter moved into the query. What it
 * guarantees is that the page never quietly shows less than it found.
 */

/** The server's hard cap on one page (`lib/blogPostsStore.js`). Asking for more returns 100. */
export const POSTS_PAGE_SIZE = 100;

/**
 * How many pages one feed will walk before it stops.
 *
 * Ten is a ceiling, not a target: the walk stops the moment a short page comes
 * back, so a blog of 9 posts still costs exactly one request. It only matters
 * to a blog of 1,000+, where the alternative to a ceiling is a page load that
 * makes an unbounded number of requests.
 */
export const MAX_POSTS_PAGES = 10;

/** A reader for one page of posts. Returns null when the page could not be read at all. */
export type PostsPageReader<T> = (page: number, pageSize: number) => Promise<readonly T[] | null>;

export type PublishedPostsRead<T> = {
  /** The posts that were actually read, newest first, in the order the server gave them. */
  posts: T[];
  /**
   * True only when the ceiling was reached AND there is provably more behind
   * it. A blog of exactly 1,000 posts is complete, not truncated — see the
   * probe below.
   */
  truncated: boolean;
  /** The most posts this walk was ever willing to read. Meaningful when `truncated`. */
  ceiling: number;
  /**
   * The page that could not be read, or 0. A failed read is not an empty blog
   * and not a cap: it is a third state, and folding it into either one is how
   * a partial list gets presented as a complete one.
   */
  failedAtPage: number;
};

export type ReadAllOptions = {
  pageSize?: number;
  maxPages?: number;
};

/**
 * Every published post the reader can reach, and an honest account of what it
 * could not reach.
 *
 * Stops as soon as a page comes back shorter than a full one — that short page
 * IS the end of the list. If every page up to the ceiling comes back full it
 * reads ONE more page as a probe: without it, a blog holding exactly
 * `pageSize * maxPages` posts would be reported as truncated when the list is
 * in fact complete, which is a warning about missing posts that do not exist.
 * The probe's own posts are discarded — the ceiling is the promise the caller
 * made — and only whether it found anything is kept.
 */
export async function readAllPublishedPosts<T>(
  readPage: PostsPageReader<T>,
  options: ReadAllOptions = {}
): Promise<PublishedPostsRead<T>> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? POSTS_PAGE_SIZE));
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? MAX_POSTS_PAGES));
  const ceiling = pageSize * maxPages;
  const posts: T[] = [];

  for (let page = 1; page <= maxPages + 1; page += 1) {
    let batch: readonly T[] | null;
    try {
      batch = await readPage(page, pageSize);
    } catch {
      batch = null;
    }

    if (!Array.isArray(batch)) {
      // A page that could not be read tells us nothing about what lies past
      // it, so this is never reported as a cap.
      return { posts, truncated: false, ceiling, failedAtPage: page };
    }

    if (page > maxPages) {
      return { posts, truncated: batch.length > 0, ceiling, failedAtPage: 0 };
    }

    posts.push(...batch);
    if (batch.length < pageSize) return { posts, truncated: false, ceiling, failedAtPage: 0 };
  }

  /* istanbul ignore next — the loop above always returns. */
  return { posts, truncated: true, ceiling, failedAtPage: 0 };
}

/**
 * What a visitor should be told when the list they are filtering is not the
 * whole blog — or "" when it is.
 *
 * Deliberately visitor-safe: it states what the list covers and stops. It is
 * NOT a builder-only note (CLAUDE.md landmine 16) because a reader filtering a
 * partial list is being misled by the page itself, and the sentence that fixes
 * that is one they can act on — narrow the search, or use an older-posts link.
 */
export function incompleteListNotice(read: Pick<PublishedPostsRead<unknown>, "truncated" | "ceiling" | "failedAtPage">): string {
  if (read.truncated) {
    return `Showing the most recent ${read.ceiling.toLocaleString()} posts. Filters on this page do not reach older ones.`;
  }
  // Page 1 failing leaves nothing at all, and the empty state already speaks
  // for that. It is a PARTIAL list that needs saying out loud.
  if (read.failedAtPage > 1) {
    return "Some posts could not be loaded, so this list may be incomplete. Reload the page to try again.";
  }
  return "";
}
