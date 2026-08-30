/**
 * Which modules a VISITOR may see.
 *
 * The live site (BuilderPublicSitePage) and the Builder preview
 * (builder-preview-page) both render through this one filter, so the preview
 * cannot show a module the live page would drop — that drift was the whole
 * point of 86bbq2y7x: "the preview should look like the live site". Private
 * slugs (admin pages behind the cookie) skip the filter and show everything.
 *
 * site-search.ts keeps its own, larger, NEVER_INDEXED list; this one is only
 * the admin surfaces that must never paint on a public page.
 */

type SectionWithModules<M extends { type: string }> = { modules?: M[] };

/** Admin-only module types stripped from every public page (defence in depth). */
export const PRIVATE_ONLY_MODULE_TYPES: ReadonlySet<string> = new Set([
  "blog-post-create",
  "blog-post-manager",
  "blog-category-manager",
]);

export function isPrivateOnlyModuleType(type: string): boolean {
  return PRIVATE_ONLY_MODULE_TYPES.has(type);
}

/** The same sections, minus any module a visitor must not see. Never mutates. */
export function filterPublicSections<M extends { type: string }, S extends SectionWithModules<M>>(
  sections: S[]
): S[] {
  return sections.map((section) => ({
    ...section,
    modules: (section.modules || []).filter((m) => !isPrivateOnlyModuleType(m.type)),
  }));
}
