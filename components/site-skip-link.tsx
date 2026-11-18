import type { BuilderTemplateSection } from "@/lib/builder-template";
import { sectionHasOnlyPageOverlayImageModules } from "@/components/builder/builder-utils";
import { pickSkipLinkTarget, skipLinkTargetElementId } from "@/lib/skip-link-target";

/**
 * The hidden "Skip to content" link every published page starts with
 * (SC-857). Invisible until a keyboard visitor presses Tab; Enter then jumps
 * past the header and menu. Styled in `_builder-react-overrides.css`.
 *
 * Shared by BuilderPublicSitePage and the preview page's `?live=1` mode, so
 * the render contracts measure the same link a visitor gets.
 */

/**
 * The section the link jumps to, picked from the sections the preview renders
 * in the page flow — overlay-only rows float over the page and are not where
 * content starts. Null (no link) for a page with no sections.
 */
export function pickPageSkipLinkTarget(
  sections: readonly BuilderTemplateSection[] | null | undefined
): BuilderTemplateSection | null {
  if (!Array.isArray(sections)) return null;
  return pickSkipLinkTarget(sections.filter((section) => !sectionHasOnlyPageOverlayImageModules(section)));
}

export function SiteSkipLink({ target }: { target: BuilderTemplateSection | null }) {
  if (!target) return null;
  return (
    <a className="site-skip-link" href={`#${skipLinkTargetElementId(target)}`}>
      Skip to content
    </a>
  );
}
