/**
 * Client-safe subset of normie's lib/poll-test-mode (the original mixes
 * next/headers cookie helpers with these browser-side helpers).
 */

export const POLL_TEST_MODE_CHANGED_EVENT = 'normie:poll-test-mode-changed';

export type PollAnswerClientPayload = {
  duplicate?: boolean;
  pollTestMode?: boolean;
  progressPollsTaken?: number;
  playerAnswerCount?: number;
  /** Logged-in player portal user — anonymous visitors only get reminders, not game events. */
  isRegistered?: boolean;
};

export function resolvePollAnswerProgress(payload: PollAnswerClientPayload): number | null {
  const progress = payload.progressPollsTaken ?? payload.playerAnswerCount;

  if (!Number.isFinite(progress)) {
    return null;
  }

  return progress as number;
}

export function shouldFirePollAnswerEffects(payload: PollAnswerClientPayload): boolean {
  if (payload.pollTestMode) {
    return true;
  }

  return !payload.duplicate;
}
