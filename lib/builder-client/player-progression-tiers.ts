import {
  PLAYER_LEVELS_PER_GRADE,
  PLAYER_POLLS_PER_LEVEL
} from "@/lib/player-portal";

export const DEFAULT_EVENT_POLLS_PER_LEVEL = PLAYER_POLLS_PER_LEVEL;

function normalizePollsPerLevel(pollsPerLevel?: number | null): number {
  const parsed = Number(pollsPerLevel);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return DEFAULT_EVENT_POLLS_PER_LEVEL;
}

function normalizePollTier(pollTier: number | undefined | null, pollsPerLevel: number): number {
  const parsed = Number(pollTier);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(pollsPerLevel, Math.max(1, Math.floor(parsed)));
  }

  return pollsPerLevel;
}

/** Cumulative completed-level count after finishing Grade G, Level L (10 polls per level). */
export function gradeLevelToCompletedLevelRewards(gradeTier: number, levelTier: number): number {
  const grade = Math.max(1, gradeTier);
  const level = Math.min(PLAYER_LEVELS_PER_GRADE, Math.max(1, levelTier));
  return (grade - 1) * PLAYER_LEVELS_PER_GRADE + level;
}

export function completedLevelRewardsToGradeLevel(completedLevelRewards: number): {
  gradeTier: number;
  levelTier: number;
} {
  const completed = Math.max(1, completedLevelRewards);
  const gradeTier = Math.floor((completed - 1) / PLAYER_LEVELS_PER_GRADE) + 1;
  const levelTier = ((completed - 1) % PLAYER_LEVELS_PER_GRADE) + 1;
  return { gradeTier, levelTier };
}

export type EventProgressionTiers = {
  gradeTier: number;
  levelTier: number;
  pollTier: number;
  pollsPerLevel: number;
};

export function readEventPollsPerLevel(metadata: Record<string, unknown> | undefined): number {
  return normalizePollsPerLevel(Number.parseInt(String(metadata?.pollsPerLevel ?? ""), 10));
}

export function readEventPollTier(metadata: Record<string, unknown> | undefined, pollsPerLevel: number): number {
  const parsed = Number.parseInt(String(metadata?.pollTier ?? metadata?.pollLevel ?? ""), 10);
  return normalizePollTier(Number.isFinite(parsed) && parsed > 0 ? parsed : pollsPerLevel, pollsPerLevel);
}

/** Progress polls when an event should fire for Grade G, Level L, Poll P. */
export function progressPollsAtEvent(
  gradeTier: number,
  levelTier: number,
  pollTier?: number,
  pollsPerLevel?: number
): number {
  const pollsPer = normalizePollsPerLevel(pollsPerLevel);
  const grade = Math.max(1, gradeTier);
  const level = Math.min(PLAYER_LEVELS_PER_GRADE, Math.max(1, levelTier));
  const poll = normalizePollTier(pollTier, pollsPer);

  return (grade - 1) * PLAYER_LEVELS_PER_GRADE * pollsPer + (level - 1) * pollsPer + poll;
}

/** Progress polls required to complete Grade G, Level L (last poll in the level). */
export function progressPollsAtLevelCompletion(
  gradeTier: number,
  levelTier: number,
  pollsPerLevel?: number
): number {
  const pollsPer = normalizePollsPerLevel(pollsPerLevel);
  return progressPollsAtEvent(gradeTier, levelTier, pollsPer, pollsPer);
}

export function formatProgressionMilestone(
  gradeTier: number,
  levelTier: number,
  pollTier?: number,
  pollsPerLevel?: number
): string {
  const pollsPer = normalizePollsPerLevel(pollsPerLevel);
  const poll = normalizePollTier(pollTier, pollsPer);
  const base = `Grade ${Math.max(1, gradeTier)}, Level ${Math.min(PLAYER_LEVELS_PER_GRADE, Math.max(1, levelTier))}`;

  if (poll >= pollsPer) {
    return base;
  }

  return `${base}, Poll ${poll}`;
}

export function readProgressionTiersFromMetadata(
  metadata: Record<string, unknown> | undefined,
  legacySublevelName?: string | null
): { gradeTier: number; levelTier: number } {
  const full = readEventProgressionFromMetadata(metadata, legacySublevelName);
  return { gradeTier: full.gradeTier, levelTier: full.levelTier };
}

export function readEventProgressionFromMetadata(
  metadata: Record<string, unknown> | undefined,
  legacySublevelName?: string | null
): EventProgressionTiers {
  const pollsPerLevel = readEventPollsPerLevel(metadata);
  const gradeFromMetadata = Number.parseInt(String(metadata?.gradeTier ?? ""), 10);
  const levelFromMetadata = Number.parseInt(String(metadata?.levelTier ?? ""), 10);

  if (
    Number.isFinite(gradeFromMetadata) &&
    gradeFromMetadata > 0 &&
    Number.isFinite(levelFromMetadata) &&
    levelFromMetadata > 0
  ) {
    return {
      gradeTier: gradeFromMetadata,
      levelTier: Math.min(PLAYER_LEVELS_PER_GRADE, levelFromMetadata),
      pollTier: readEventPollTier(metadata, pollsPerLevel),
      pollsPerLevel
    };
  }

  const legacyCompleted = Number.parseInt(String(legacySublevelName ?? "").trim(), 10);

  if (Number.isFinite(legacyCompleted) && legacyCompleted > 0) {
    const { gradeTier, levelTier } = completedLevelRewardsToGradeLevel(legacyCompleted);

    return {
      gradeTier,
      levelTier,
      pollTier: pollsPerLevel,
      pollsPerLevel
    };
  }

  return {
    gradeTier: 1,
    levelTier: 1,
    pollTier: pollsPerLevel,
    pollsPerLevel
  };
}

export function eventTargetProgressPolls(
  metadata: Record<string, unknown> | undefined,
  legacySublevelName?: string | null
): number {
  const progression = readEventProgressionFromMetadata(metadata, legacySublevelName);

  return progressPollsAtEvent(
    progression.gradeTier,
    progression.levelTier,
    progression.pollTier,
    progression.pollsPerLevel
  );
}
