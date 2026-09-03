/**
 * Hand-picked relations between blog posts.
 *
 * A relation is MUTUAL and has no direction: relating A, B and C means each of
 * the three sees the other two. The storage is therefore a set of unordered
 * PAIRS, and the only way to keep "A related to B" and "B related to A" from
 * becoming two different rows is to canonicalise every pair the same way
 * before it is written or compared. That is what `canonicalPair` is for, and
 * every function here goes through it.
 *
 * Keeping this in builder-client (rather than beside the store) is deliberate:
 * it is pure, so vitest can test it without a database, and both the manager
 * UI and the server store call the same functions - two implementations of
 * "which pairs does this set imply" would drift apart silently.
 */

export type PostRelationPair = {
  /** Lexicographically first of the two ids. */
  postIdA: string;
  /** Lexicographically second. Never equal to postIdA. */
  postIdB: string;
};

function clean(id: unknown): string {
  return String(id ?? "").trim();
}

/**
 * Order a pair so the same two posts always produce the same row, whichever
 * order the caller happened to hold them in. Returns null for a self-pair or
 * a pair with a blank side - neither is a relation, and both would otherwise
 * become a row that can never be matched or removed.
 */
export function canonicalPair(first: unknown, second: unknown): PostRelationPair | null {
  const a = clean(first);
  const b = clean(second);
  if (!a || !b || a === b) return null;
  return a < b ? { postIdA: a, postIdB: b } : { postIdA: b, postIdB: a };
}

/** A stable string key for a pair, for Set/Map dedupe. */
export function pairKey(pair: PostRelationPair): string {
  return `${pair.postIdA} ${pair.postIdB}`;
}

/**
 * Every pair implied by relating a set of posts to each other - the whole of
 * what "Relate Checked" means. Checking n posts produces n*(n-1)/2 pairs.
 *
 * Blank ids and duplicates in the input are dropped first, so checking the
 * same post twice (or a list carrying an empty row) cannot produce a
 * self-pair. Fewer than two distinct posts implies no relation at all, which
 * returns an empty list rather than throwing - the caller shows "check at
 * least two" rather than handling an error.
 */
export function pairsForRelatedSet(postIds: readonly unknown[]): PostRelationPair[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of postIds ?? []) {
    const id = clean(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const pairs: PostRelationPair[] = [];
  const emitted = new Set<string>();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const pair = canonicalPair(ids[i], ids[j]);
      if (!pair) continue;
      const key = pairKey(pair);
      if (emitted.has(key)) continue;
      emitted.add(key);
      pairs.push(pair);
    }
  }
  return pairs;
}

/**
 * Given every stored pair, the ids related to one post. Order is stable
 * (the order the pairs arrived in) so a list does not reshuffle between loads.
 */
export function relatedIdsFor(postId: unknown, pairs: readonly PostRelationPair[]): string[] {
  const target = clean(postId);
  if (!target) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pair of pairs ?? []) {
    const a = clean(pair?.postIdA);
    const b = clean(pair?.postIdB);
    if (!a || !b) continue;
    const other = a === target ? b : b === target ? a : "";
    if (!other || seen.has(other)) continue;
    seen.add(other);
    out.push(other);
  }
  return out;
}

/**
 * The pairs in `next` that are not already in `existing`. The manager writes
 * only these, so pressing Relate Checked twice on the same selection is a
 * no-op rather than a duplicate-key failure.
 */
export function pairsToAdd(
  next: readonly PostRelationPair[],
  existing: readonly PostRelationPair[]
): PostRelationPair[] {
  const have = new Set<string>();
  for (const pair of existing ?? []) {
    const canonical = canonicalPair(pair?.postIdA, pair?.postIdB);
    if (canonical) have.add(pairKey(canonical));
  }
  const out: PostRelationPair[] = [];
  const emitted = new Set<string>();
  for (const pair of next ?? []) {
    const canonical = canonicalPair(pair?.postIdA, pair?.postIdB);
    if (!canonical) continue;
    const key = pairKey(canonical);
    if (have.has(key) || emitted.has(key)) continue;
    emitted.add(key);
    out.push(canonical);
  }
  return out;
}

/**
 * What has to change for ONE post's related set to become `nextRelatedIds`.
 *
 * The post editor is a different shape of write from the links manager. The
 * manager relates a whole checked SET to each other and only ever adds; the
 * editor owns one post's list, so unchecking has to remove a pair as surely as
 * checking adds one — and it must touch only the pairs that involve this post.
 * A pair between two OTHER posts is somebody else's relation and is left alone;
 * computing "the pairs this post should have" and diffing against "the pairs
 * this post has" is the only way to get that right, which is why this returns
 * both halves rather than reusing pairsToAdd on its own.
 */
export function relationChangesForPost(
  postId: unknown,
  nextRelatedIds: readonly unknown[],
  existingPairs: readonly PostRelationPair[]
): { add: PostRelationPair[]; remove: PostRelationPair[] } {
  const target = clean(postId);
  if (!target) return { add: [], remove: [] };

  const wanted: PostRelationPair[] = [];
  const wantedKeys = new Set<string>();
  for (const raw of nextRelatedIds ?? []) {
    const pair = canonicalPair(target, raw);
    if (!pair) continue;
    const key = pairKey(pair);
    if (wantedKeys.has(key)) continue;
    wantedKeys.add(key);
    wanted.push(pair);
  }

  const mine: PostRelationPair[] = [];
  const mineKeys = new Set<string>();
  for (const pair of existingPairs ?? []) {
    const canonical = canonicalPair(pair?.postIdA, pair?.postIdB);
    if (!canonical) continue;
    // Only this post's own pairs. Everything else belongs to other posts.
    if (canonical.postIdA !== target && canonical.postIdB !== target) continue;
    const key = pairKey(canonical);
    if (mineKeys.has(key)) continue;
    mineKeys.add(key);
    mine.push(canonical);
  }

  return {
    add: wanted.filter((pair) => !mineKeys.has(pairKey(pair))),
    remove: mine.filter((pair) => !wantedKeys.has(pairKey(pair))),
  };
}
