/**
 * Where a live page's hidden "Skip to content" link jumps to (task SC-857).
 *
 * Every published page starts with a link that stays invisible until a
 * keyboard visitor presses Tab, and lets them jump past the header and menu
 * instead of tabbing through every menu item on every page. This decides
 * which section that is, so the rule lives in one place with a test beside it.
 *
 * THE RULE
 * The first section after the page's leading "header furniture". Furniture is
 * what the code already calls frame — a section linked to a shared (saved)
 * section, `isFrameSection` — plus any section holding the navigation menu.
 *
 * Fallbacks, when every section is furniture: the first section that holds no
 * navigation menu; else the first section on the page. The worst case is
 * "jumps to the first section", which is harmless. No sections, no link.
 */
import { isFrameSection, type FrameSection } from "./builder-template-frame";

/** The id the target section wears when it has no anchor name of its own. */
export const SKIP_LINK_TARGET_ID = "site-main-content";

export type SkipLinkSection = FrameSection & { anchorName?: string };

/** A section holding the site's navigation menu. */
export function sectionHoldsNavigation(section: SkipLinkSection | null | undefined): boolean {
  if (!section || !Array.isArray(section.modules)) return false;
  return section.modules.some(
    (module) => Boolean(module) && (module as { type?: unknown }).type === "navigation"
  );
}

function isHeaderFurniture(section: SkipLinkSection): boolean {
  return isFrameSection(section) || sectionHoldsNavigation(section);
}

/**
 * The section the skip link jumps to, or null when the page has none. Returns
 * the section object itself (not its id): copies of one saved section share an
 * id, so an id could name two rows.
 */
export function pickSkipLinkTarget<S extends SkipLinkSection>(
  sections: readonly S[] | null | undefined
): S | null {
  if (!Array.isArray(sections) || sections.length === 0) return null;
  const firstContent = sections.findIndex((section) => !isHeaderFurniture(section));
  if (firstContent >= 0) return sections[firstContent];
  return sections.find((section) => !sectionHoldsNavigation(section)) ?? sections[0];
}

/**
 * The element id the link points at: the section's own anchor name when it has
 * one (it is already the section's `id`, and an element has only one), else
 * SKIP_LINK_TARGET_ID.
 */
export function skipLinkTargetElementId(section: SkipLinkSection): string {
  const anchor = typeof section.anchorName === "string" ? section.anchorName.trim() : "";
  return anchor || SKIP_LINK_TARGET_ID;
}
