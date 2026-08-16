/**
 * How widely is a shared block used, and what will saving it disturb?
 *
 * Saving a saved-section master rewrites that section on every page that
 * follows it. Until now a save that rewrote 46 pages and a save that rewrote
 * none produced the same silent "Saved section." — the operator had no way to
 * know a routine edit had just reached the whole site. That is how 46 Marinoff
 * pages were rewritten on 2026-07-21 with nobody watching, and how a menu edit
 * on 2026-08-15 reached 35 pages unannounced.
 *
 * These helpers answer two questions in plain numbers: before a save, how many
 * pages this will touch; after it, how many it actually touched.
 */

/** Only the fields usage counting depends on — structural, so tests stay light. */
export type UsageSection = {
  savedSectionId?: string;
  canonical?: boolean;
};

export type UsagePage = {
  id?: string;
  name?: string;
  slug?: string;
  layoutSections?: readonly UsageSection[];
};

export type BlockUsage = {
  /** Copies that take updates from the original. */
  following: number;
  /** Copies that remember the original but deliberately ignore it. */
  independent: number;
  /** Distinct pages holding at least one following copy. */
  pages: number;
  /** Page labels for the following copies, for a preview list. */
  pageLabels: string[];
};

export const EMPTY_USAGE: BlockUsage = { following: 0, independent: 0, pages: 0, pageLabels: [] };

function labelFor(page: UsagePage): string {
  const name = String(page?.name ?? '').trim();
  if (name) return name;
  const slug = String(page?.slug ?? '').trim();
  return slug ? `/${slug}` : 'Untitled page';
}

/**
 * Count every saved section's usage in ONE pass over the pages.
 *
 * A per-section scan would be O(sections x pages); the manager lists dozens of
 * sections against a project that already carries 138 pages, so it is built as
 * an index instead.
 */
export function buildSavedSectionUsageIndex(
  pages: readonly UsagePage[] | null | undefined
): Map<string, BlockUsage> {
  const index = new Map<string, BlockUsage>();
  if (!Array.isArray(pages)) return index;

  for (const page of pages) {
    const sections = Array.isArray(page?.layoutSections) ? page.layoutSections : [];
    const countedOnThisPage = new Set<string>();

    for (const section of sections) {
      const id = String(section?.savedSectionId ?? '').trim();
      if (!id) continue;

      let usage = index.get(id);
      if (!usage) {
        usage = { following: 0, independent: 0, pages: 0, pageLabels: [] };
        index.set(id, usage);
      }

      // `canonical !== true` covers both an explicit detach and the older rows
      // that carry provenance without ever having followed.
      if (section.canonical !== true) {
        usage.independent += 1;
        continue;
      }

      usage.following += 1;
      if (!countedOnThisPage.has(id)) {
        countedOnThisPage.add(id);
        usage.pages += 1;
        usage.pageLabels.push(labelFor(page));
      }
    }
  }

  return index;
}

export function savedSectionUsage(
  pages: readonly UsagePage[] | null | undefined,
  savedSectionId: string
): BlockUsage {
  const id = String(savedSectionId ?? '').trim();
  if (!id) return EMPTY_USAGE;
  return buildSavedSectionUsageIndex(pages).get(id) ?? EMPTY_USAGE;
}

/** "35 pages" / "1 page" / "not used yet" — for the manager column. */
export function describeUsage(usage: BlockUsage | null | undefined): string {
  const pages = usage?.pages ?? 0;
  if (pages > 0) return pages === 1 ? '1 page' : `${pages} pages`;
  const independent = usage?.independent ?? 0;
  if (independent > 0) return independent === 1 ? '1 disconnected copy' : `${independent} disconnected copies`;
  return 'Not used yet';
}

const PREVIEW_LIMIT = 12;

/**
 * The sentence shown BEFORE the write. Returns null when nothing follows this
 * block, so a first save or an unused block is never interrupted by a dialog.
 */
export function describePushImpact(name: string, usage: BlockUsage | null | undefined): string | null {
  const pages = usage?.pages ?? 0;
  if (pages < 1) return null;

  const label = String(name ?? '').trim() || 'this section';
  const listed = (usage?.pageLabels ?? []).slice(0, PREVIEW_LIMIT);
  const remainder = pages - listed.length;
  const lines = [
    `Saving "${label}" updates it on ${pages === 1 ? '1 page' : `${pages} pages`}.`,
    '',
    ...listed.map((pageLabel) => `  • ${pageLabel}`),
  ];
  if (remainder > 0) lines.push(`  • …and ${remainder} more`);
  lines.push('', 'Any local edits on those pages are replaced. Continue?');
  return lines.join('\n');
}

export type CanonicalOverwriteImpact = {
  /** One sentence: what saving over the master does. */
  summary: string;
  /** Pages that will be rewritten, capped for display. */
  pageLabels: string[];
  /** How many following pages are not in `pageLabels`. */
  more: number;
};

/**
 * The same warning as {@link describePushImpact}, but broken into parts so a
 * dialog can lay it out instead of pouring it into a `window.confirm`.
 *
 * This one is shown when Save is clicked on a section INSIDE a page — where
 * "save" used to mean only "file a brand new copy", so an edit meant to correct
 * the shared original quietly became a second saved section with the same name
 * (operator, 2026-08-16). Unlike the push warning it never returns null: the
 * question there is "shall I interrupt you?", the question here is "which of
 * these two saves did you mean?", and that has to be asked even when nothing
 * else follows the master yet.
 */
export function describeCanonicalOverwrite(
  name: string,
  usage: BlockUsage | null | undefined
): CanonicalOverwriteImpact {
  const label = String(name ?? '').trim() || 'the saved section';
  const pages = usage?.pages ?? 0;

  // Typographic quotes, unlike the plain ones in describePushImpact: that text
  // goes into a window.confirm, this text is rendered beside the dialog's own
  // “…” and the two styles side by side read as two different voices.
  if (pages < 1) {
    return {
      summary: `Replaces “${label}” itself. No other page follows it yet, so nothing else changes.`,
      pageLabels: [],
      more: 0,
    };
  }

  const pageLabels = (usage?.pageLabels ?? []).slice(0, PREVIEW_LIMIT);
  return {
    summary: `Replaces “${label}” itself, and rewrites it on ${
      pages === 1 ? 'the 1 page' : `the ${pages} pages`
    } that follow it. Any local edits on those pages are replaced.`,
    pageLabels,
    more: Math.max(0, pages - pageLabels.length),
  };
}

export type PropagationTally = {
  ok?: boolean;
  total?: number;
  updated?: number;
  failed?: number;
};

/**
 * The sentence shown AFTER the write. The route has always returned this tally;
 * both clients threw it away, so a partly-failed fan-out looked like a clean save.
 */
export function describePropagationOutcome(
  name: string,
  propagation: PropagationTally | null | undefined
): string {
  const label = String(name ?? '').trim() || 'Section';
  const updated = Number(propagation?.updated ?? 0) || 0;
  const failed = Number(propagation?.failed ?? 0) || 0;

  if (failed > 0) {
    return `Saved "${label}" and updated ${updated} ${updated === 1 ? 'page' : 'pages'}, but ${failed} ${failed === 1 ? 'page' : 'pages'} could not be updated. Reload and save again to finish.`;
  }
  if (updated > 0) {
    return `Saved "${label}" and updated ${updated} ${updated === 1 ? 'page' : 'pages'}.`;
  }
  return `Saved "${label}". No pages use it yet.`;
}
