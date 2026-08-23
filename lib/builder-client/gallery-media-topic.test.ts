import { describe, expect, it } from "vitest";
import {
  buildGalleryMediaTopicOptions,
  normalizeGalleryMediaTopic,
} from "./gallery-media-topic";

/**
 * The two pure helpers behind the gallery's Topic filter.
 *
 * Both are small enough to read in one go, which is exactly why they are worth
 * pinning: nothing about them is hard, so nothing about them draws attention
 * when it changes. The trimming, the 255-character cap, the case-insensitive
 * de-duplication and the sort are all decisions a future edit could quietly
 * drop while still producing a plausible-looking list of topics.
 *
 * Read-only on the subject, per the ticket — these tests describe what the code
 * does today, not what it might be nicer for it to do.
 */

describe("normalizeGalleryMediaTopic", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeGalleryMediaTopic("  Cats  ")).toBe("Cats");
    expect(normalizeGalleryMediaTopic("\t\nCats\r\n ")).toBe("Cats");
  });

  it("leaves inner whitespace alone", () => {
    // Trimming the ends is tidying; touching the middle would be renaming
    // somebody's topic.
    expect(normalizeGalleryMediaTopic("  Big  Cats  ")).toBe("Big  Cats");
  });

  it("turns nothing into an empty string rather than throwing", () => {
    expect(normalizeGalleryMediaTopic(null)).toBe("");
    expect(normalizeGalleryMediaTopic(undefined)).toBe("");
    expect(normalizeGalleryMediaTopic("")).toBe("");
    expect(normalizeGalleryMediaTopic("   ")).toBe("");
  });

  it("accepts a value that is not a string", () => {
    // The signature is `unknown` on purpose — this reads values straight off
    // stored media records, where a number or a boolean is entirely possible.
    expect(normalizeGalleryMediaTopic(42)).toBe("42");
    expect(normalizeGalleryMediaTopic(true)).toBe("true");
    expect(normalizeGalleryMediaTopic(0)).toBe("0");
    // `?? ""` catches null and undefined only, so 0 and false are their own
    // strings rather than empty — worth pinning, since `|| ""` would differ.
    expect(normalizeGalleryMediaTopic(false)).toBe("false");
  });

  it("caps the length at 255 characters", () => {
    const long = "x".repeat(300);
    expect(normalizeGalleryMediaTopic(long)).toHaveLength(255);
    expect(normalizeGalleryMediaTopic("y".repeat(255))).toHaveLength(255);
    expect(normalizeGalleryMediaTopic("z".repeat(254))).toHaveLength(254);
  });

  it("trims BEFORE capping, so padding cannot eat the topic", () => {
    // Order matters: cap-then-trim would spend the budget on spaces and hand
    // back a shorter topic than the one that was typed.
    const padded = `   ${"a".repeat(255)}   `;
    expect(normalizeGalleryMediaTopic(padded)).toBe("a".repeat(255));
  });
});

describe("buildGalleryMediaTopicOptions", () => {
  it("returns an empty list for no input", () => {
    expect(buildGalleryMediaTopicOptions([])).toEqual([]);
    expect(buildGalleryMediaTopicOptions()).toEqual([]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling seen", () => {
    // The filter is one dropdown, so "Cats" and "cats" must not both appear.
    // Which one survives is a real decision: the first, so the list reflects
    // the order the media was loaded in rather than an arbitrary winner.
    expect(buildGalleryMediaTopicOptions(["Cats", "cats", "CATS"])).toEqual(["Cats"]);
    expect(buildGalleryMediaTopicOptions(["cats", "Cats"])).toEqual(["cats"]);
  });

  it("treats values differing only by whitespace as the same topic", () => {
    expect(buildGalleryMediaTopicOptions(["Cats", "  Cats  "])).toEqual(["Cats"]);
  });

  it("skips empty and whitespace-only entries", () => {
    expect(buildGalleryMediaTopicOptions(["", "   ", "\t", "Cats"])).toEqual(["Cats"]);
    expect(buildGalleryMediaTopicOptions(["", "  "])).toEqual([]);
  });

  it("sorts the result", () => {
    expect(buildGalleryMediaTopicOptions(["Zebra", "apple", "Mango"]))
      .toEqual(["apple", "Mango", "Zebra"]);
  });

  it("sorts with localeCompare, not by character code", () => {
    // The distinction is the point of using localeCompare at all: a raw sort
    // puts every capital before every lowercase, so "Zebra" would come before
    // "apple" and the dropdown would look broken to anybody reading it.
    const sorted = buildGalleryMediaTopicOptions(["apple", "Banana"]);
    expect(sorted).toEqual(["apple", "Banana"]);
    expect([...["apple", "Banana"]].sort()).toEqual(["Banana", "apple"]);
  });

  it("sorts accented topics next to their plain neighbours", () => {
    // The other thing localeCompare buys: "Éclair" belongs beside "Eclair",
    // not after "Zebra" where its character code would put it.
    const sorted = buildGalleryMediaTopicOptions(["Zebra", "Éclair", "Apple"]);
    expect(sorted).toEqual(["Apple", "Éclair", "Zebra"]);
  });

  it("caps each entry, and two topics differing only past the cap collapse", () => {
    const base = "a".repeat(255);
    const options = buildGalleryMediaTopicOptions([`${base}ONE`, `${base}TWO`]);
    expect(options).toHaveLength(1);
    expect(options[0]).toBe(base);
  });

  it("keeps every genuinely distinct topic", () => {
    const options = buildGalleryMediaTopicOptions([
      "Cats", "Dogs", "cats", "  Birds  ", "", "Dogs",
    ]);
    expect(options).toEqual(["Birds", "Cats", "Dogs"]);
  });

  it("does not mutate the array it was given", () => {
    // `.sort()` sorts in place, and it is applied to the helper's own array —
    // but a future edit that sorts the input instead would reorder the
    // caller's media list as a side effect, which is the kind of bug that
    // surfaces three screens away.
    const input = ["Zebra", "apple"];
    buildGalleryMediaTopicOptions(input);
    expect(input).toEqual(["Zebra", "apple"]);
  });
});
