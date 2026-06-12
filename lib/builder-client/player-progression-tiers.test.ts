import { describe, expect, it } from "vitest";
import {
  completedLevelRewardsToGradeLevel,
  eventTargetProgressPolls,
  formatProgressionMilestone,
  gradeLevelToCompletedLevelRewards,
  progressPollsAtEvent,
  progressPollsAtLevelCompletion,
  readEventProgressionFromMetadata,
  readProgressionTiersFromMetadata
} from "@/lib/player-progression-tiers";

describe("player progression tiers", () => {
  it("maps grade and level to cumulative completed levels", () => {
    expect(gradeLevelToCompletedLevelRewards(1, 1)).toBe(1);
    expect(gradeLevelToCompletedLevelRewards(1, 10)).toBe(10);
    expect(gradeLevelToCompletedLevelRewards(2, 1)).toBe(11);
  });

  it("inverts cumulative completed levels back to grade and level", () => {
    expect(completedLevelRewardsToGradeLevel(1)).toEqual({ gradeTier: 1, levelTier: 1 });
    expect(completedLevelRewardsToGradeLevel(10)).toEqual({ gradeTier: 1, levelTier: 10 });
    expect(completedLevelRewardsToGradeLevel(11)).toEqual({ gradeTier: 2, levelTier: 1 });
  });

  it("calculates progress polls at level completion", () => {
    expect(progressPollsAtLevelCompletion(1, 2)).toBe(20);
    expect(progressPollsAtLevelCompletion(2, 1)).toBe(110);
  });

  it("calculates progress polls for poll-level milestones", () => {
    expect(progressPollsAtEvent(1, 1, 3, 10)).toBe(3);
    expect(progressPollsAtEvent(1, 2, 10, 10)).toBe(20);
    expect(progressPollsAtEvent(1, 2, 5, 10)).toBe(15);
  });

  it("formats milestone labels", () => {
    expect(formatProgressionMilestone(2, 1)).toBe("Grade 2, Level 1");
    expect(formatProgressionMilestone(1, 2, 5, 10)).toBe("Grade 1, Level 2, Poll 5");
  });

  it("reads tiers from metadata or legacy sublevel name", () => {
    expect(readProgressionTiersFromMetadata({ gradeTier: 2, levelTier: 3 }, "99")).toEqual({
      gradeTier: 2,
      levelTier: 3
    });
    expect(readProgressionTiersFromMetadata({}, "11")).toEqual({ gradeTier: 2, levelTier: 1 });
  });

  it("reads poll-level metadata with defaults", () => {
    expect(readEventProgressionFromMetadata({ gradeTier: 1, levelTier: 2, pollTier: 4 }, null)).toEqual({
      gradeTier: 1,
      levelTier: 2,
      pollTier: 4,
      pollsPerLevel: 10
    });
  });

  it("resolves event target progress polls from metadata", () => {
    expect(
      eventTargetProgressPolls(
        {
          gradeTier: 1,
          levelTier: 1,
          pollTier: 3,
          pollsPerLevel: 10
        },
        "1"
      )
    ).toBe(3);
  });
});
