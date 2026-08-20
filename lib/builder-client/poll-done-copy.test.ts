import { describe, expect, it } from "vitest";
import { getPollDoneMessage } from "./poll-done-copy";
import type { PollDoneReason } from "./site-home/types";

/**
 * A pure copy helper — every reason a poll session can end maps to a
 * message, and an unrecognized reason falls back safely rather than
 * showing nothing. Sentences aren't asserted verbatim (brittle, and this
 * is copy that's expected to be edited); the shape that matters is that
 * every reason has SOME message, and different reasons say different things.
 */

const ALL_REASONS: PollDoneReason[] = [
  "all_answered",
  "all_answered_in_category",
  "all_answered_in_preferences",
  "no_polls_available",
  "no_polls_in_category",
  "no_polls_matching_preferences",
  "invalid_category",
];

describe("getPollDoneMessage", () => {
  it("returns a non-empty message for every known reason", () => {
    for (const reason of ALL_REASONS) {
      const message = getPollDoneMessage(reason);
      expect(message.trim().length, `reason "${reason}" must have a message`).toBeGreaterThan(0);
    }
  });

  it("falls back to a default message when the reason is undefined", () => {
    const message = getPollDoneMessage(undefined);
    expect(message.trim().length).toBeGreaterThan(0);
    // Not one of the reason-specific messages — the fallback is its own text.
    for (const reason of ALL_REASONS) {
      expect(message).not.toBe(getPollDoneMessage(reason));
    }
  });

  it("distinct reasons say distinct things — proves the switch actually branches", () => {
    const messages = new Set(ALL_REASONS.map((reason) => getPollDoneMessage(reason)));
    expect(messages.size).toBe(ALL_REASONS.length);
  });

  it("a category-specific reason and a preferences-specific reason read differently", () => {
    // Two reasons that are easy to accidentally collapse into the same
    // copy, since both mean roughly "you've run out of polls to answer".
    expect(getPollDoneMessage("all_answered_in_category")).not.toBe(
      getPollDoneMessage("all_answered_in_preferences")
    );
  });
});
