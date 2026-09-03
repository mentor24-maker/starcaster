/**
 * The blog's tag list, derived from the posts.
 *
 * There is no tags table. `blog_posts.tags` is a `text[]` column, so the set
 * of tags that exists is whatever the posts happen to carry - which means
 * "manage tags" is really "rewrite the arrays on every post that carries this
 * word". These helpers compute the derived list and the exact rewrite each
 * operation implies, so the store can apply it and the UI can show the count
 * before the user commits to anything.
 *
 * Case: tags are matched case-INSENSITIVELY but stored with the casing the
 * author typed. "Immigration" and "immigration" are one tag with two spellings
 * and must not appear as two rows - otherwise renaming one leaves the other
 * behind and the count is a lie.
 */

export type TagCount = {
  /** The tag as it should be shown - the most common spelling in use. */
  tag: string;
  /** How many posts carry it, counting all spellings. */
  postCount: number;
};

export type TaggedPost = {
  id: string;
  tags: string[];
};

/** The comparison key for a tag. Case and surrounding space never distinguish two tags. */
export function tagKey(tag: unknown): string {
  return String(tag ?? "").trim().toLowerCase();
}

function cleanTag(tag: unknown): string {
  return String(tag ?? "").trim();
}

/**
 * Every distinct tag across the given posts, with a post count, sorted by
 * count descending then alphabetically - the busiest tags first, which is the
 * order someone tidying a tag list wants.
 *
 * A post carrying the same tag twice (or in two spellings) counts ONCE: the
 * count is "how many posts use this", and a duplicate inside one post's array
 * is a data blemish, not a second use.
 */
export function buildTagIndex(posts: readonly TaggedPost[]): TagCount[] {
  const counts = new Map<string, number>();
  const spellings = new Map<string, Map<string, number>>();

  for (const post of posts ?? []) {
    const seenInPost = new Set<string>();
    for (const raw of post?.tags ?? []) {
      const display = cleanTag(raw);
      const key = tagKey(display);
      if (!key || seenInPost.has(key)) continue;
      seenInPost.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const bySpelling = spellings.get(key) ?? new Map<string, number>();
      bySpelling.set(display, (bySpelling.get(display) ?? 0) + 1);
      spellings.set(key, bySpelling);
    }
  }

  const out: TagCount[] = [];
  for (const [key, postCount] of counts) {
    out.push({ tag: preferredSpelling(spellings.get(key), key), postCount });
  }
  out.sort((a, b) => b.postCount - a.postCount || a.tag.localeCompare(b.tag));
  return out;
}

/**
 * Which spelling to display when a tag is written several ways: the most
 * common one, ties broken alphabetically so the answer is stable between
 * loads rather than depending on Map insertion order.
 */
function preferredSpelling(bySpelling: Map<string, number> | undefined, fallback: string): string {
  if (!bySpelling || bySpelling.size === 0) return fallback;
  let best = "";
  let bestCount = -1;
  for (const [spelling, count] of bySpelling) {
    if (count > bestCount || (count === bestCount && spelling.localeCompare(best) < 0)) {
      best = spelling;
      bestCount = count;
    }
  }
  return best || fallback;
}

/** The posts carrying a given tag, in the order supplied. */
export function postsWithTag(tag: unknown, posts: readonly TaggedPost[]): TaggedPost[] {
  const key = tagKey(tag);
  if (!key) return [];
  return (posts ?? []).filter((post) => (post?.tags ?? []).some((t) => tagKey(t) === key));
}

/**
 * The new tag array for one post after renaming `from` to `to`.
 *
 * Renaming onto a tag that already exists is a MERGE, and merging is the case
 * that breaks a naive implementation: a post carrying both words must end up
 * with one, not a duplicate. Every result is de-duplicated by key for that
 * reason. Order is otherwise preserved, and the renamed tag keeps the renamed
 * position rather than jumping to the end.
 */
export function renameTagInPost(post: TaggedPost, from: unknown, to: unknown): string[] {
  const fromKey = tagKey(from);
  const target = cleanTag(to);
  if (!fromKey || !target) return [...(post?.tags ?? [])];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of post?.tags ?? []) {
    const display = cleanTag(raw);
    if (!display) continue;
    const next = tagKey(display) === fromKey ? target : display;
    const key = tagKey(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

/** The new tag array for one post after removing a tag entirely. */
export function removeTagFromPost(post: TaggedPost, tag: unknown): string[] {
  const key = tagKey(tag);
  if (!key) return [...(post?.tags ?? [])];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of post?.tags ?? []) {
    const display = cleanTag(raw);
    const displayKey = tagKey(display);
    if (!display || displayKey === key || seen.has(displayKey)) continue;
    seen.add(displayKey);
    out.push(display);
  }
  return out;
}

/**
 * The posts a rename or removal actually CHANGES, with their new arrays.
 *
 * The point of returning only the changed posts is that the store writes only
 * these: rewriting every post in the project to change one tag would touch
 * hundreds of rows, bump every `updated_at`, and make the operation impossible
 * to audit afterwards.
 */
export function tagRewritePlan(
  posts: readonly TaggedPost[],
  operation: { type: "rename"; from: string; to: string } | { type: "remove"; tag: string }
): Array<{ id: string; tags: string[] }> {
  const plan: Array<{ id: string; tags: string[] }> = [];
  for (const post of posts ?? []) {
    if (!post?.id) continue;
    const before = (post.tags ?? []).map(cleanTag).filter(Boolean);
    const after =
      operation.type === "rename"
        ? renameTagInPost(post, operation.from, operation.to)
        : removeTagFromPost(post, operation.tag);
    if (before.length === after.length && before.every((t, i) => t === after[i])) continue;
    plan.push({ id: post.id, tags: after });
  }
  return plan;
}
