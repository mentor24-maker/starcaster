/**
 * Template naming rules shared by Builder › Templates (rename) and
 * Builder › Pages › Save as Template (name the new one). Task SC-803.
 *
 * Kept as plain functions so the two screens cannot disagree about what a
 * usable name is, and so the rules can be tested without a browser.
 */

/**
 * Can this template be saved (and so renamed) at all?
 *
 * A template the database holds has a numeric id ("47"). The built-in
 * "Standard Right-Form" template is injected by GET /api/builder/page-templates
 * (routes/builder.js) with the id `standard-right-form` and has no database row,
 * so the store's `Number(id) || 0` turns its id into 0 and refuses every save
 * with "id is required". Asking the same question the store asks — is the id a
 * number? — keeps this from drifting when another built-in is added.
 *
 * An empty id is a new, unsaved template: saving it creates one, so it counts
 * as savable.
 */
export function isSavableTemplateId(id: string | null | undefined): boolean {
  const value = String(id ?? "").trim();
  if (!value) return true;
  return /^\d+$/.test(value);
}

/** Shown in place of a working name box on a template that cannot be saved. */
export const BUILT_IN_TEMPLATE_NAME_NOTE =
  "This is a built-in template that comes with every project, so its name cannot be changed.";

/** What Save as Template offers before the builder types anything. */
export function defaultTemplateNameForPage(pageName: string): string {
  const base = String(pageName ?? "").trim();
  return base ? `${base} Template` : "";
}

/** Shown when Save is pressed on a blank name. */
export const BLANK_TEMPLATE_NAME_MESSAGE = "Type a name for the template before saving.";

/**
 * The name to save, or null when there is nothing usable to save.
 * Surrounding spaces are trimmed so " My template " and "My template" are one name.
 */
export function cleanTemplateName(name: string): string | null {
  const value = String(name ?? "").trim();
  return value ? value : null;
}
