import type { PollDeepDiveContent } from "@/lib/poll-deep-dive";
import type { PollSettingsSnapshot } from "@/lib/poll-pod-config";

export type PollOption = {
  id: string;
  label: string;
};

export type CurrentPoll = {
  id: string;
  question: string;
  category?: string | null;
  imageUrl?: string;
  options: PollOption[];
};

export type PreviousPollOption = {
  id: string;
  label: string;
  votes: number;
  percentage: number;
};

export type { PollDeepDiveContent } from "@/lib/poll-deep-dive";
export type { PollPodsSnapshot, PollSettingsSnapshot } from "@/lib/poll-pod-config";

export type PreviousPoll = {
  id: string;
  question: string;
  category?: string | null;
  totalResponses: number;
  options: PreviousPollOption[];
  deepDive: PollDeepDiveContent;
};

export type PollCategoryFilter = {
  slug: string;
  name: string;
};

export type PollDoneReason =
  | "all_answered"
  | "all_answered_in_category"
  | "all_answered_in_preferences"
  | "no_polls_available"
  | "no_polls_in_category"
  | "no_polls_matching_preferences"
  | "invalid_category";

export type PollPayload = {
  done?: boolean;
  doneReason?: PollDoneReason;
  error?: string;
  activeCategory?: PollCategoryFilter | null;
  currentPoll: CurrentPoll | null;
  previousPoll: PreviousPoll | null;
  settings?: PollSettingsSnapshot;
  /** Browser poll session id (also stored httpOnly); mirrored to localStorage for post-login recovery. */
  pollSessionId?: string;
  /** Progressive feature keys unlocked for the signed-in player on this poll load. */
  unlockedFeatures?: string[];
};
