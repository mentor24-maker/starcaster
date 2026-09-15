/**
 * Latest Blog Posts module (`blog-latest-posts`, task 86bc0neew) — the parts
 * that decide WHICH posts appear and what an empty row says, kept apart from
 * the React renderer so they can be tested without a browser.
 *
 * The module has two modes, chosen by one checkbox:
 *   - Latest posts ticked (the default): the newest published posts, no filter.
 *   - Unticked: posts carrying ANY chosen tag or ANY chosen category, still
 *     newest first.
 */

export type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export type LatestPostsSettings = {
  title: string;
  /** The tag the heading renders as; h2 unless chosen (what it always was). */
  headingLevel: HeadingLevel;
  /** Empty = follow the site's own heading colour. */
  headingColor: string;
  latest: boolean;
  /** Tag names as the operator picked them; matched case-insensitively. */
  tags: string[];
  /** Category ids. */
  categoryIds: string[];
  count: number;
  columns: number;
  gap: number;
  postSlug: string;
};

export type LatestPostCandidate = {
  published_at?: string;
  categoryIds?: string[];
  tags?: string[];
};

export const LATEST_POSTS_MAX_COUNT = 24;
export const LATEST_POSTS_MAX_COLUMNS = 4;

/** A JSON array of strings, tolerating a blank or malformed value as empty. */
export function parseStringList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const HEADING_LEVELS: HeadingLevel[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

export function resolveLatestPostsSettings(settings: Record<string, string>): LatestPostsSettings {
  return {
    title: String(settings.title || "").trim(),
    headingLevel: HEADING_LEVELS.includes(String(settings.headingLevel || "").toLowerCase() as HeadingLevel)
      ? (String(settings.headingLevel).toLowerCase() as HeadingLevel)
      : "h2",
    headingColor: String(settings.headingColor || "").trim(),
    // Only an explicit "false" leaves latest mode: a module saved before the
    // key existed, or with it blank, keeps showing the newest posts.
    latest: settings.latestPosts !== "false",
    tags: parseStringList(settings.filterTags),
    categoryIds: parseStringList(settings.filterCategories),
    count: clampInt(settings.count, 3, 1, LATEST_POSTS_MAX_COUNT),
    columns: clampInt(settings.columns, 3, 1, LATEST_POSTS_MAX_COLUMNS),
    gap: clampInt(settings.cardGap, 24, 0, 96),
    postSlug: String(settings.postSlug || "").trim().replace(/^\/+/, "")
  };
}

/** Unticked with nothing chosen: there is no question to answer yet. */
export function hasNoFilterChosen(s: LatestPostsSettings): boolean {
  return !s.latest && s.tags.length === 0 && s.categoryIds.length === 0;
}

function publishedTime(post: LatestPostCandidate): number {
  const t = post.published_at ? Date.parse(post.published_at) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * The posts the row shows, newest first, at most `count`. The server already
 * orders by publish date, but the order is the whole point of this module, so
 * it is not left to whichever read supplied the list.
 */
export function selectLatestPosts<T extends LatestPostCandidate>(posts: T[], s: LatestPostsSettings): T[] {
  if (hasNoFilterChosen(s)) return [];
  const wantedTags = new Set(s.tags.map((t) => t.toLowerCase()));
  const wantedCats = new Set(s.categoryIds);
  const matching = s.latest
    ? posts
    : posts.filter(
        (post) =>
          (post.tags || []).some((t) => wantedTags.has(String(t).trim().toLowerCase())) ||
          (post.categoryIds || []).some((id) => wantedCats.has(id))
      );
  return [...matching]
    .map((post, index) => ({ post, index }))
    // Stable on ties, so two posts published in the same instant keep the
    // server's order instead of swapping between renders.
    .sort((a, b) => publishedTime(b.post) - publishedTime(a.post) || a.index - b.index)
    .slice(0, s.count)
    .map(({ post }) => post);
}

/**
 * Why the row is empty, naming the values involved (landmine 17). Shown to
 * the page builder only; a visitor's page renders nothing instead.
 */
export function latestPostsEmptyReason(
  s: LatestPostsSettings,
  context: { publishedCount: number; categoryNames: Record<string, string> }
): string {
  if (hasNoFilterChosen(s)) {
    return "Latest Blog Posts: tick Latest posts, or choose at least one tag or category.";
  }
  if (context.publishedCount === 0) return "Latest Blog Posts: this site has no published posts yet.";
  if (s.latest) return "Latest Blog Posts: no published posts could be read.";
  const phrases = [
    ...s.tags.map((t) => `tagged “${t}”`),
    ...s.categoryIds.map((id) => `in the category “${context.categoryNames[id] || id}”`)
  ];
  const joined =
    phrases.length <= 1 ? phrases[0] || "" : `${phrases.slice(0, -1).join(", ")} or ${phrases[phrases.length - 1]}`;
  return `Latest Blog Posts: no published posts ${joined}.`;
}
