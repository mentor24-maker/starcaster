/**
 * The request body Bulk Create posts for each page it makes.
 *
 * Bulk Create has TWO routes behind one button. Picking a content model sends
 * the batch to `/api/builder/landing-pages/bulk-create-with-model`; picking no
 * content model — which is the default, and what the operator does when he
 * just wants ten pages off a template — posts each page separately to the
 * SINGLE create route, `/api/admin/pages`.
 *
 * That second path is the one that kept dropping the template. `pageTemplateId`
 * was missing from the single create's server whitelist (#614) and then, once
 * that was fixed, missing from the body this path SENT (#635 round 1). Both
 * times the page was created, the route answered 201, and Page Details read
 * "No template".
 *
 * So the field list lives here, in a named function a test can hold, rather
 * than inline inside the component — the same move `buildBulkCreatePageInput`
 * makes on the server for the other route. A field list assembled inside a
 * caller is a list nothing can check, which is how one field went missing on
 * three separate paths.
 */

export interface BulkCreatePageBodyInput {
  name: string;
  slug: string;
  /**
   * The chosen page template's ROW id (a `builder_page_templates` id, or one
   * of the built-in ids like `standard-right-form`).
   *
   * It goes to the server twice on purpose. `pageTemplateId` is the real
   * column — which template this page was built from. `templateId` is the
   * legacy layout NAME column, and this path has always put the chosen id
   * there; anything reading that column must keep seeing exactly what it saw
   * before, so the fix adds a field rather than moving one.
   */
  templateId: string;
  themeId?: string;
  pageBackground: unknown;
  theme: unknown;
  layoutSections: unknown[];
}

export function buildBulkCreatePageBody(input: BulkCreatePageBodyInput): Record<string, unknown> {
  return {
    name: input.name,
    slug: input.slug,
    templateId: input.templateId,
    pageTemplateId: input.templateId,
    themeId: input.themeId || undefined,
    templateKind: "modular",
    pageBackground: input.pageBackground,
    theme: input.theme,
    layoutSections: input.layoutSections,
  };
}
