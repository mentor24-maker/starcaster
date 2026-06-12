/**
 * Stub for normie's poll deep-dive overlay content (blog/youtube/related
 * polls). BUILDER_CAPABILITIES.pollDeepDive is off in starcaster, so the
 * previous-results runtime only ever renders the "empty" kind.
 */
import type { PollDeepDiveContent } from "@/lib/poll-deep-dive";

export function PollDeepDiveContentView({ content }: { content: PollDeepDiveContent }) {
  if (content.kind === "empty") {
    return null;
  }
  return <p className="builder-capability-placeholder">Deep-dive content is not available in StarCaster.</p>;
}
