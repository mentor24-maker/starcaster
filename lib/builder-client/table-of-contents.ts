/**
 * The Table of contents module (task SC-863): a page's headings as jump links.
 *
 * It reads the headings the page actually SHOWS, once they are on screen —
 * every `h2`–`h6` carrying an id, in page order. The ids come from slice 1
 * (SC-856, `heading-anchors.ts`), which names every rich-text heading from its
 * words as the page is drawn. Nothing is stored on the module, so the list
 * always matches the page as published and cannot go stale (landmine 19).
 *
 * Three pieces, kept pure so they are tested without a page:
 *
 * - `resolveTableOfContentsSettings` — the module's settings with defaults.
 * - `readPageHeadings` — the headings inside a part of the page, in order.
 * - `pickTableOfContentsEntries` — which of those to list, and how deep each
 *   one sits.
 */

export type TocHeadingLevels = "h2" | "h2-h3" | "all";

export type TableOfContentsSettings = {
  title: string;
  levels: TocHeadingLevels;
  indent: boolean;
  alignment: "left" | "center" | "right";
  fontSize: number;
  /** Empty = follow the theme's link colour. */
  color: string;
};

export const TABLE_OF_CONTENTS_DEFAULT_TITLE = "On this page";

export const TABLE_OF_CONTENTS_DEFAULT_SETTINGS: Record<string, string> = {
  title: TABLE_OF_CONTENTS_DEFAULT_TITLE,
  headingLevels: "h2-h3",
  indentSubheadings: "true",
  alignment: "left",
  fontSize: "16",
  // A2: empty = follow the theme.
  color: ""
};

export function resolveTableOfContentsSettings(settings: Record<string, string> | undefined): TableOfContentsSettings {
  const s = settings || {};
  const levels: TocHeadingLevels = s.headingLevels === "h2" || s.headingLevels === "all" ? s.headingLevels : "h2-h3";
  const alignment = s.alignment === "center" || s.alignment === "right" ? s.alignment : "left";
  const size = parseInt(s.fontSize ?? "", 10);
  return {
    // A title cleared on purpose stays cleared: the list shows without one.
    title: s.title === undefined ? TABLE_OF_CONTENTS_DEFAULT_TITLE : String(s.title).trim(),
    levels,
    indent: s.indentSubheadings !== "false",
    alignment,
    fontSize: Number.isFinite(size) && size >= 10 && size <= 32 ? size : 16,
    color: String(s.color || "").trim()
  };
}

export type PageHeading = {
  /** 2–6 */
  level: number;
  id: string;
  text: string;
};

/** The deepest heading level each choice lists. */
function deepestLevel(levels: TocHeadingLevels): number {
  if (levels === "h2") return 2;
  if (levels === "h2-h3") return 3;
  return 6;
}

export type TableOfContentsEntry = PageHeading & {
  /** 0 for the shallowest listed level, 1 for the next, and so on. 0 when not indenting. */
  depth: number;
};

/**
 * The headings to list, in page order. A heading with no id (nothing to jump
 * to) or no words (nothing to show) is left out, as is anything deeper than
 * the chosen levels. H1 is never listed: it is the page's own title.
 *
 * Depth is counted from the shallowest heading actually listed, so a post
 * whose headings are all H3 is not pushed in a step for an H2 it never had.
 */
export function pickTableOfContentsEntries(
  headings: readonly PageHeading[],
  settings: Pick<TableOfContentsSettings, "levels" | "indent">
): TableOfContentsEntry[] {
  const deepest = deepestLevel(settings.levels);
  const kept = headings.filter(
    (heading) => heading.level >= 2 && heading.level <= deepest && heading.id && heading.text.trim()
  );
  const shallowest = kept.reduce((min, heading) => Math.min(min, heading.level), 7);
  return kept.map((heading) => ({
    ...heading,
    text: heading.text.trim(),
    depth: settings.indent ? heading.level - shallowest : 0
  }));
}

const HEADING_SELECTOR = "h2[id], h3[id], h4[id], h5[id], h6[id]";

/**
 * Every heading with an id inside `root`, in page order, skipping anything
 * inside `exclude` (the table of contents itself, so it never lists its own
 * title) and anything inside another table of contents.
 */
export function readPageHeadings(root: ParentNode | null | undefined, exclude?: Element | null): PageHeading[] {
  if (!root) return [];
  const headings: PageHeading[] = [];
  for (const element of Array.from(root.querySelectorAll(HEADING_SELECTOR))) {
    if (exclude && exclude.contains(element)) continue;
    if (element.closest("[data-table-of-contents]")) continue;
    const id = (element.getAttribute("id") || "").trim();
    const level = Number(element.tagName.slice(1));
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (!id || !text) continue;
    headings.push({ level, id, text });
  }
  return headings;
}

/** True when two readings list the same headings — so a re-read that found nothing new changes nothing. */
export function sameHeadings(a: readonly PageHeading[], b: readonly PageHeading[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((heading, i) => heading.id === b[i].id && heading.level === b[i].level && heading.text === b[i].text);
}

/** The builder-only note shown where the module finds nothing (landmine 17: say why). */
export function tableOfContentsEmptyNote(levels: TocHeadingLevels, foundAny: boolean): string {
  if (foundAny) {
    const which = levels === "h2" ? "H2" : levels === "h2-h3" ? "H2 or H3" : "H2–H6";
    return `No ${which} headings on this page. Change "Which headings" to list the ones it has.`;
  }
  return "No headings on this page yet. Headings in Text modules and blog posts are listed here.";
}
