import { describe, expect, it } from "vitest";
import { matchPostKeywords } from "./match-post-keywords";

/** Substack Miner upgrade 3/4 (86bcuxwn5): the "Also mentions" matcher. */
describe("matchPostKeywords", () => {
  it("ignores capital letters", () => {
    expect(matchPostKeywords([{ title: "Why TENNIS Coaching Works" }], ["tennis", "Coaching"])).toEqual(["tennis", "Coaching"]);
  });

  it("matches whole words only: art is not in start", () => {
    expect(matchPostKeywords([{ title: "How to start a newsletter" }], ["art"])).toEqual([]);
    expect(matchPostKeywords([{ title: "The art of the start" }], ["art"])).toEqual(["art"]);
    expect(matchPostKeywords([{ excerpt: "Art, mostly." }], ["art"])).toEqual(["art"]);
  });

  it("matches multi-word phrases, as the same words in order", () => {
    const posts = [{ subtitle: "Notes on junior   tennis in Florida" }];
    expect(matchPostKeywords(posts, ["junior tennis", "tennis junior", "junior ten"])).toEqual(["junior tennis"]);
  });

  it("does not let a phrase run from one post into the next", () => {
    expect(matchPostKeywords([{ title: "All about junior" }, { title: "tennis today" }], ["junior tennis"])).toEqual([]);
  });

  it("leaves out keywords already hit, whatever their capitals", () => {
    expect(matchPostKeywords([{ title: "Tennis and polymaths" }], ["tennis", "polymaths"], ["Tennis"])).toEqual(["polymaths"]);
  });

  it("reads title, subtitle and excerpt, lists each keyword once, and handles symbols", () => {
    const posts = [{ title: "One", subtitle: "Learning C++ fast", excerpt: "about writing" }, { title: "writing again" }];
    expect(matchPostKeywords(posts, ["writing", "Writing", "c++", "c"])).toEqual(["writing", "c++", "c"]);
  });

  it("finds nothing when there are no posts or no keywords", () => {
    expect(matchPostKeywords([], ["tennis"])).toEqual([]);
    expect(matchPostKeywords([{ title: "tennis" }], [])).toEqual([]);
    expect(matchPostKeywords([{ title: "tennis" }], ["", "  "])).toEqual([]);
  });
});
