"use client";

import { createContext, useContext } from "react";
import type { BuilderTemplateSection } from "@/lib/builder-template";

/**
 * The page being edited, as the editor holds it RIGHT NOW (task SC-852).
 *
 * Two panels need the page's sections and are mounted far below the editor:
 * a section's "Anchor name" checks that no other section on the page has
 * taken the name, and a menu item's link picker lists the named sections of
 * the page being edited — including one named a moment ago and not yet
 * saved, which the page list fetched at load cannot know about.
 *
 * Null outside the page editor (a saved-section or module editor has no
 * page), and both panels then behave as they would on any other page.
 */
export type BuilderPageSections = { pageId: string; sections: BuilderTemplateSection[] };

export const BuilderPageSectionsContext = createContext<BuilderPageSections | null>(null);

export function useBuilderPageSections(): BuilderPageSections | null {
  return useContext(BuilderPageSectionsContext);
}
