import { describe, expect, it } from "vitest";
import {
  buildTagIndex,
  postsWithTag,
  removeTagFromPost,
  renameTagInPost,
  tagKey,
  tagRewritePlan
} from "./blog-tag-index";

const posts = [
  { id: "p1", tags: ["Immigration", "Visas"] },
  { id: "p2", tags: ["immigration", "Asylum"] },
  { id: "p3", tags: ["Visas"] },
  { id: "p4", tags: [] }
];

describe("tagKey", () => {
  it("ignores case and surrounding space", () => {
    expect(tagKey("  Immigration ")).toBe("immigration");
    expect(tagKey("IMMIGRATION")).toBe(tagKey("immigration"));
  });
});

describe("buildTagIndex", () => {
  it("counts two spellings of one tag as one tag", () => {
    const index = buildTagIndex(posts);
    const immigration = index.filter((t) => tagKey(t.tag) === "immigration");
    expect(immigration).toHaveLength(1);
    expect(immigration[0].postCount).toBe(2);
  });

  it("sorts the busiest tags first", () => {
    const index = buildTagIndex(posts);
    expect(index.map((t) => t.postCount)).toEqual([2, 2, 1]);
    // Equal counts break alphabetically, so the order is stable between loads.
    // "immigration" and "Immigration" are used once each, and that tie also
    // breaks by localeCompare - deterministic whatever order the posts arrive
    // in, which post-date ordering would otherwise keep changing.
    expect(index.slice(0, 2).map((t) => t.tag)).toEqual(["immigration", "Visas"]);
  });

  it("counts a post once even if it carries the tag twice", () => {
    const index = buildTagIndex([{ id: "p1", tags: ["Tech", "tech", "TECH"] }]);
    expect(index).toEqual([{ tag: "Tech", postCount: 1 }]);
  });

  it("ignores blank tags rather than listing an empty row", () => {
    const index = buildTagIndex([{ id: "p1", tags: ["", "  ", "Real"] }]);
    expect(index).toEqual([{ tag: "Real", postCount: 1 }]);
  });

  it("shows the most common spelling, not the first one seen", () => {
    const index = buildTagIndex([
      { id: "p1", tags: ["tech"] },
      { id: "p2", tags: ["Tech"] },
      { id: "p3", tags: ["Tech"] }
    ]);
    expect(index[0].tag).toBe("Tech");
  });
});

describe("postsWithTag", () => {
  it("finds posts regardless of how the tag is spelled", () => {
    expect(postsWithTag("IMMIGRATION", posts).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("returns nothing for a blank tag rather than every post", () => {
    expect(postsWithTag("", posts)).toEqual([]);
  });
});

describe("renameTagInPost", () => {
  it("renames the tag and leaves the others in place", () => {
    expect(renameTagInPost({ id: "p1", tags: ["Immigration", "Visas"] }, "immigration", "Migration"))
      .toEqual(["Migration", "Visas"]);
  });

  it("MERGES rather than duplicating when the target tag is already there", () => {
    const next = renameTagInPost({ id: "p1", tags: ["Immigration", "Visas"] }, "Immigration", "Visas");
    expect(next).toEqual(["Visas"]);
  });

  it("merges case-insensitively, so a rename cannot leave a near-duplicate", () => {
    const next = renameTagInPost({ id: "p1", tags: ["Immigration", "visas"] }, "Immigration", "Visas");
    expect(next).toEqual(["Visas"]);
  });

  it("leaves a post untouched when it does not carry the tag", () => {
    expect(renameTagInPost({ id: "p3", tags: ["Visas"] }, "Immigration", "Migration")).toEqual(["Visas"]);
  });

  it("refuses to rename to nothing - that is a removal, not a rename", () => {
    expect(renameTagInPost({ id: "p1", tags: ["A", "B"] }, "A", "  ")).toEqual(["A", "B"]);
  });
});

describe("removeTagFromPost", () => {
  it("drops the tag in every spelling", () => {
    expect(removeTagFromPost({ id: "p1", tags: ["Immigration", "immigration", "Visas"] }, "IMMIGRATION"))
      .toEqual(["Visas"]);
  });

  it("leaves an empty array when it was the only tag", () => {
    expect(removeTagFromPost({ id: "p3", tags: ["Visas"] }, "Visas")).toEqual([]);
  });
});

describe("tagRewritePlan", () => {
  it("returns ONLY the posts that actually change", () => {
    const plan = tagRewritePlan(posts, { type: "rename", from: "Immigration", to: "Migration" });
    expect(plan.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(plan[0].tags).toEqual(["Migration", "Visas"]);
    expect(plan[1].tags).toEqual(["Migration", "Asylum"]);
  });

  it("plans nothing when no post carries the tag", () => {
    expect(tagRewritePlan(posts, { type: "rename", from: "Nonexistent", to: "X" })).toEqual([]);
  });

  it("plans a removal across every post carrying the tag", () => {
    const plan = tagRewritePlan(posts, { type: "remove", tag: "Visas" });
    expect(plan.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(plan[1].tags).toEqual([]);
  });

  it("plans the merge as a change even though the tag count drops", () => {
    const plan = tagRewritePlan(
      [{ id: "p1", tags: ["Immigration", "Visas"] }],
      { type: "rename", from: "Immigration", to: "Visas" }
    );
    expect(plan).toEqual([{ id: "p1", tags: ["Visas"] }]);
  });
});
