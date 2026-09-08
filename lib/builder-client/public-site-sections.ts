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
  "event-manager",
  // The blog taxonomy admin surfaces. `admin-blog-links` was missing from this
  // list from the day it shipped (86bbu4qh5) — its endpoints refuse an
  // unauthenticated caller, so a visitor would have seen a panel of 401s
  // rather than a tenant's data, but a management UI painting on a public page
  // is not something to leave standing next to the module being added beside
  // it. Both are listed now (86bbuhph0).
  "admin-blog-links",
  "admin-related-articles",
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
