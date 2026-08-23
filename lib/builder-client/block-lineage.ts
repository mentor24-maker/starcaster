/**
 * What a block IS, in two lines the operator can read at a glance.
 *
 * A section in a page is one of four things, and until now the header said so
 * only in fragments: a bare "(canonical)" tag, a "Changed" tag next to it, an
 * "Unlinked" tag somewhere else, and nothing at all naming what the block is a
 * copy of or how far a save would reach. The operator had to hold the shared
 * structure of the site in his head.
 *
 * This turns that into a state and a sentence:
 *
 *   Original     — this IS the master. Saving it reaches every follower.
 *   Following    — a copy that still takes updates from the master.
 *   Changed      — a copy still marked as following, but hand-edited here, so
 *                  the next push skips it unless it is overwritten on purpose
 *                  (`hasSectionDrifted`, ./section-drift).
 *   Independent  — not linked to a master at all.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing here writes, and nothing here decides
 * what a push does — it only describes state that already exists. The actions
 * that act on these states are slices 6b and 6c.
 *
 * The page count is NOT recounted here: it comes from the usage index in
 * ./shared-block-usage, which already walks every page once. A second counter
 * is a second answer, and two counters that disagree are worse than none.
 */
import { describeUsage, type BlockUsage } from "./shared-block-usage";

export type BlockLineageState = "original" | "following" | "changed" | "independent";

export type BlockLineage = {
  state: BlockLineageState;
  /** The chip's text. */
  label: string;
  /** The chip's tooltip — one sentence on what the state means for a save. */
  hint: string;
  /**
   * The line beneath the chip, or `null` when there is no master to name.
   *
   * Null rather than an empty string on purpose: an Independent block must
   * show the chip and NO second line — not a blank one, and never
   * "used on 0 pages".
   */
  line: string | null;
};

export type BlockLineageInput = {
  /** True when the card is editing the master itself, not a copy of it. */
  isMaster?: boolean;
  /** True when this copy still takes updates from its master (`canonical`). */
  isFollowing?: boolean;
  /** True when this following copy's content no longer matches the master. */
  hasDrifted?: boolean;
  /** The master's name, when it could be resolved. */
  masterName?: string;
  /** Usage for the master, straight out of `buildSavedSectionUsageIndex`. */
  usage?: BlockUsage | null;
};

/** " · used on 35 pages", or "" when nothing follows the master yet. */
function usedClause(usage: BlockUsage | null | undefined): string {
  return (usage?.pages ?? 0) > 0 ? ` · used on ${describeUsage(usage)}` : "";
}

export function describeBlockLineage({
  isMaster = false,
  isFollowing = false,
  hasDrifted = false,
  masterName,
  usage,
}: BlockLineageInput): BlockLineage {
  const name = String(masterName ?? "").trim();

  if (isMaster) {
    // No usage passed means "not counted here", which is NOT the same as zero.
    // Saying "not used on any page yet" about a master that 35 pages follow
    // would be the most dangerous sentence on the screen, so an unknown count
    // shows the chip and no line at all.
    const pages = usage ? usage.pages : null;
    return {
      state: "original",
      label: "Original",
      hint:
        pages === null || pages > 0
          ? "This is the original. Saving it rewrites this section on every page that follows it."
          : "This is the original. No page follows it yet, so saving it changes nothing else.",
      line: pages === null ? null : pages > 0 ? `Used on ${describeUsage(usage)}` : "Not used on any page yet",
    };
  }

  if (!isFollowing) {
    // Covers both a block that never had a master and one deliberately
    // detached from its own: neither takes updates, so neither has a lineage
    // to state. See BlockLineage.line for why this is null and not "".
    return {
      state: "independent",
      label: "Independent",
      hint: "Not following a saved section — edits here stay on this page.",
      line: null,
    };
  }

  // A following copy whose master could not be resolved still has a state
  // worth showing; it just has nothing to name.
  const line = name ? `Copy of "${name}"${usedClause(usage)}` : null;

  if (hasDrifted) {
    return {
      state: "changed",
      label: "Changed",
      hint:
        "This copy was edited here and no longer matches the original — the next push skips it " +
        "unless you overwrite it on purpose.",
      line,
    };
  }

  return {
    state: "following",
    label: "Following",
    hint: name
      ? `Matches the original "${name}" and takes its updates.`
      : "Matches the original and takes its updates.",
    line,
  };
}
