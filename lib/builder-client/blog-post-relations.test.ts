import { describe, expect, it } from "vitest";
import {
  canonicalPair,
  pairKey,
  pairsForRelatedSet,
  pairsToAdd,
  relatedIdsFor,
  relationChangesForPost
} from "./blog-post-relations";

describe("canonicalPair", () => {
  it("orders a pair the same way whichever way round it arrives", () => {
    expect(canonicalPair("b", "a")).toEqual({ postIdA: "a", postIdB: "b" });
    expect(canonicalPair("a", "b")).toEqual({ postIdA: "a", postIdB: "b" });
  });

  it("refuses a self-pair - a post is not related to itself", () => {
    expect(canonicalPair("a", "a")).toBeNull();
    expect(canonicalPair("a", " a ")).toBeNull();
  });

  it("refuses a pair with a blank side rather than writing an unmatchable row", () => {
    expect(canonicalPair("a", "")).toBeNull();
    expect(canonicalPair("", "b")).toBeNull();
    expect(canonicalPair(null, undefined)).toBeNull();
  });
});

describe("pairsForRelatedSet", () => {
  it("relates every checked post to every other - three posts make three pairs", () => {
    const pairs = pairsForRelatedSet(["c", "a", "b"]);
    expect(pairs.map(pairKey).sort()).toEqual(["a b", "a c", "b c"]);
  });

  it("makes n*(n-1)/2 pairs", () => {
    expect(pairsForRelatedSet(["a", "b", "c", "d"])).toHaveLength(6);
    expect(pairsForRelatedSet(["a", "b"])).toHaveLength(1);
  });

  it("implies no relation from fewer than two distinct posts", () => {
    expect(pairsForRelatedSet(["a"])).toEqual([]);
    expect(pairsForRelatedSet([])).toEqual([]);
    // The same post checked twice is still one post, not a self-relation.
    expect(pairsForRelatedSet(["a", "a"])).toEqual([]);
  });

  it("drops blank rows instead of pairing them", () => {
    const pairs = pairsForRelatedSet(["a", "", "  ", "b"]);
    expect(pairs.map(pairKey)).toEqual(["a b"]);
  });

  it("never emits the same pair twice even from a duplicated selection", () => {
    const keys = pairsForRelatedSet(["a", "b", "a", "b"]).map(pairKey);
    expect(keys).toEqual(["a b"]);
  });
});

describe("relatedIdsFor", () => {
  const pairs = pairsForRelatedSet(["a", "b", "c"]);

  it("finds the other two whichever side of the pair the post sits on", () => {
    expect(relatedIdsFor("a", pairs).sort()).toEqual(["b", "c"]);
    expect(relatedIdsFor("b", pairs).sort()).toEqual(["a", "c"]);
    expect(relatedIdsFor("c", pairs).sort()).toEqual(["a", "b"]);
  });

  it("returns nothing for a post in no pair", () => {
    expect(relatedIdsFor("z", pairs)).toEqual([]);
    expect(relatedIdsFor("", pairs)).toEqual([]);
  });

  it("does not list the same relation twice when a pair is stored twice", () => {
    const doubled = [...pairs, ...pairs];
    expect(relatedIdsFor("a", doubled).sort()).toEqual(["b", "c"]);
  });
});

describe("pairsToAdd", () => {
  it("writes nothing when the same selection is related a second time", () => {
    const existing = pairsForRelatedSet(["a", "b", "c"]);
    const next = pairsForRelatedSet(["a", "b", "c"]);
    expect(pairsToAdd(next, existing)).toEqual([]);
  });

  it("writes only the genuinely new pairs when the selection grows", () => {
    const existing = pairsForRelatedSet(["a", "b"]);
    const next = pairsForRelatedSet(["a", "b", "c"]);
    expect(pairsToAdd(next, existing).map(pairKey).sort()).toEqual(["a c", "b c"]);
  });

  it("treats a stored pair as matching however it was ordered", () => {
    const existing = [{ postIdA: "b", postIdB: "a" }];
    expect(pairsToAdd(pairsForRelatedSet(["a", "b"]), existing)).toEqual([]);
  });
});

describe("relationChangesForPost", () => {
  const keys = (pairs: { postIdA: string; postIdB: string }[]) => pairs.map(pairKey).sort();

  it("adds a pair for each newly checked post", () => {
    const change = relationChangesForPost("a", ["b", "c"], []);
    expect(keys(change.add)).toEqual(["a b", "a c"]);
    expect(change.remove).toEqual([]);
  });

  it("removes the pair for a post that was unchecked", () => {
    const existing = pairsForRelatedSet(["a", "b"]);
    const change = relationChangesForPost("a", [], existing);
    expect(change.add).toEqual([]);
    expect(keys(change.remove)).toEqual(["a b"]);
  });

  it("writes nothing when the selection is unchanged", () => {
    const existing = [...pairsForRelatedSet(["a", "b"]), ...pairsForRelatedSet(["a", "c"])];
    const change = relationChangesForPost("a", ["c", "b"], existing);
    expect(change.add).toEqual([]);
    expect(change.remove).toEqual([]);
  });

  it("leaves pairs between two OTHER posts alone", () => {
    // b--c is somebody else's relation. Saving post a must not touch it, even
    // though it is in the same list of stored pairs.
    const existing = pairsForRelatedSet(["b", "c"]);
    const change = relationChangesForPost("a", ["b"], existing);
    expect(keys(change.add)).toEqual(["a b"]);
    expect(change.remove).toEqual([]);
  });

  it("never relates a post to itself, however the id arrives", () => {
    const change = relationChangesForPost("a", ["a", "", "  ", "b"], []);
    expect(keys(change.add)).toEqual(["a b"]);
  });

  it("matches a stored pair however it was ordered", () => {
    const change = relationChangesForPost("b", ["a"], [{ postIdA: "a", postIdB: "b" }]);
    expect(change.add).toEqual([]);
    expect(change.remove).toEqual([]);
  });

  it("does nothing at all without a post id", () => {
    const change = relationChangesForPost("", ["a", "b"], []);
    expect(change).toEqual({ add: [], remove: [] });
  });
});
