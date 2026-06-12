import { firePublicProgressGameEvents } from "@/lib/public-game-level-events-client";
import {
  resolvePollAnswerProgress,
  shouldFirePollAnswerEffects,
  type PollAnswerClientPayload
} from "@/lib/poll-test-mode";

export async function runPollAnswerSideEffects(payload: PollAnswerClientPayload): Promise<void> {
  if (!shouldFirePollAnswerEffects(payload)) {
    return;
  }

  if (payload.isRegistered !== true) {
    return;
  }

  const progress = resolvePollAnswerProgress(payload);

  if (progress === null || progress <= 0) {
    return;
  }

  await firePublicProgressGameEvents(progress, { duplicate: false });
}
