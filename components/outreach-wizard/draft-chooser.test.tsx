import { describe, expect, it } from "vitest";
import { droppedLine, keptOptions } from "./draft-chooser";

/**
 * Outreach wizard 9/19 (86bcrmbke). The chooser's two pure halves; the
 * clicking, keys and Approve are driven through the Reddit screen in
 * components/reddit-comments/reddit-comments-panel.test.tsx.
 */

describe("draft chooser", () => {
  it("keeps only options with words, each carrying its stored index", () => {
    expect(keptOptions([
      { text: "a", angle: "story" },
      { angle: "dropped one", dropped: true, rule: { ok: false, reason: "r" } },
      { text: "  ", angle: "blank" },
      { text: "c" },
    ])).toEqual([{ index: 0, text: "a", angle: "story" }, { index: 3, text: "c", angle: "" }]);
    expect(keptOptions(undefined)).toEqual([]);
  });

  it("says how many were dropped and why, in the server's words", () => {
    expect(droppedLine([{ text: "a" }])).toBe("");
    expect(droppedLine([{ dropped: true, rule: { ok: false, reason: "it names Dane of Earth" } }]))
      .toBe("One option was dropped: it names Dane of Earth.");
    expect(droppedLine([{ dropped: true }, { dropped: true, rule: { ok: false, reason: "too long" } }]))
      .toBe("Two options were dropped: too long.");
  });
});
