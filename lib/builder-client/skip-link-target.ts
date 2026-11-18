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

/**
 * WHY THIS EXISTS (the SC-857 send-back)
 *
 * `normalizeLayoutSections` rebuilds every section from a whitelist that does
 * not include `savedSectionId` or `canonical`, so a live page that runs its
 * sections through `normalizeBuilderDocument` loses the very marker
 * `isFrameSection` reads. Without this, no section on a published page ever
 * counted as shared header, and a page opening with a shared strip that holds
 * no menu (a logo or contact bar) pointed the link at that strip — above the
 * menu, so the next Tab went straight back into it.
 *
 * This copies the two lineage fields from the raw page back onto the
 * normalized sections, pairing them the way the normalizer does (it keeps
 * every plain-object section, in order, and drops anything else). Nothing
 * renders these fields; they only let the skip link see the shared header.
 * The normalizer itself is left alone on purpose: it also shapes what pages
 * SAVE, and a change there has a much wider reach than this link.
 */
function rawSectionObjects(value: unknown): Record<string, unknown>[] {
  let raw: unknown = value;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const document = raw as Record<string, unknown>;
    raw = document.sections ?? document.layoutSections;
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (section): section is Record<string, unknown> =>
      Boolean(section) && typeof section === "object" && !Array.isArray(section)
  );
}

/**
 * `normalized` with each section's `savedSectionId` / `canonical` restored
 * from `rawDocument` (whatever was handed to `normalizeBuilderDocument`).
 * If the two do not pair up one-for-one it returns `normalized` unchanged:
 * a guessed pairing could mark the wrong section as header.
 */
export function withSectionLineage<S extends object>(rawDocument: unknown, normalized: S[]): S[] {
  const raw = rawSectionObjects(rawDocument);
  if (raw.length !== normalized.length) return normalized;
  return normalized.map((section, index) => {
    const source = raw[index];
    const savedSectionId =
      typeof source.savedSectionId === "string" ? source.savedSectionId.trim().slice(0, 120) : "";
    const canonical = typeof source.canonical === "boolean" ? source.canonical : undefined;
    if (!savedSectionId && canonical === undefined) return section;
    return {
      ...section,
      ...(savedSectionId ? { savedSectionId } : {}),
      ...(canonical !== undefined ? { canonical } : {})
    };
  });
}
