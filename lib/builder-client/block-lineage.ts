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
 *   Independent  — not taking updates from a master. Two blocks land here:
 *                  one that never had a master, and one that remembers a
 *                  master but has stopped following it. Their tooltips differ,
 *                  because only the first is genuinely local — see the branch.
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
  /**
   * True when the block still carries a `savedSectionId`, whether or not it
   * still follows it. Separate from `isFollowing` on purpose: "where did this
   * come from" and "does it still take updates" are two different questions
   * (`docs/SAVED_SECTIONS.md`), and the save path keys off the FIRST one.
   */
  hasMasterSource?: boolean;
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
  hasMasterSource = false,
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
    // Two different blocks land here, and they do NOT behave the same way.
    //
    // A block that never had a master is genuinely local: saving it can only
    // create something new. But a block that still remembers a master and has
    // merely stopped following it is not local at all --- `saveSection()` in
    // admin-builder-editor.tsx keys off `savedSectionId` ALONE and never looks
    // at `canonical`, so its save button still opens the "overwrite the
    // original?" dialog, which fans out to every page that does follow.
    //
    // Both used to read "edits here stay on this page", which is the exact
    // failure this feature exists to end: a confident sentence that is the
    // opposite of the truth, on the one screen the operator consults to find
    // out how far a save reaches. Same chip, honest tooltip --- the smallest
    // truthful change. Whether "disconnected" deserves a visible state of its
    // own is the operator's call, and is one line from here.
    return {
      state: "independent",
      label: "Independent",
      hint: hasMasterSource
        ? "No longer takes updates from the original — but it still remembers one, " +
          "so saving it can still offer to overwrite that original for every page following it."
        : "Not following a saved section — edits here stay on this page.",
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
