/**
 * Type subset of normie's lib/poll-deep-dive needed by the previous-results
 * runtime. Deep-dive content loading (blog/youtube/related) is a normie
 * feature; starcaster renders the "empty" kind (capability pollDeepDive off).
 */
import { DEEP_DIVE_RELATED_LIMIT } from '../poll-deep-dive-constants';

export { DEEP_DIVE_RELATED_LIMIT };

export type DeepDiveSource = {
  question: string;
  totalResponses: number;
  options: Array<{ label: string; votes: number; percentage: number }>;
};

export type DeepDivePollRef = {
  id: string;
  question: string;
  category: string | null;
};

export type DeepDiveBlogCard = {
  title: string;
  href: string;
  featuredImageUrl: string;
};

export type PollDeepDiveContent =
  | { kind: 'blog'; title: string; href: string; featuredImageUrl: string }
  | { kind: 'youtube'; embedUrl: string }
  | { kind: 'related'; polls: DeepDivePollRef[] }
  | { kind: 'empty' };

export function getPollDeepDiveOverlayPillLabel(content: PollDeepDiveContent): string {
  switch (content.kind) {
    case 'related':
      return 'Related Polls';
    case 'blog':
      return 'From the Blog';
    case 'youtube':
      return 'Video';
    case 'empty':
      return 'Details';
  }
}
