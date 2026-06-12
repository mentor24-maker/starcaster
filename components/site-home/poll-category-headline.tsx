import { formatPollCategoryDisplayName } from "@/lib/poll-categories";

type PollCategoryHeadlineProps = {
  category?: string | null;
};

export function PollCategoryHeadline({ category }: PollCategoryHeadlineProps) {
  const label = formatPollCategoryDisplayName(String(category ?? ""));

  if (!label) {
    return null;
  }

  return <p className="poll-panel-category">Category: {label}</p>;
}
