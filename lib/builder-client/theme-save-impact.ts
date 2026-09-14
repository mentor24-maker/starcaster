/**
 * "Saving this theme changes these pages. Do you want them live too?"
 *
 * The Themes page asks the same question the saved-section and saved-module
 * managers ask, through the same dialog (`BuilderSharedBlockSaveModal`). This
 * module shapes the answer to `GET /api/builder/themes/:id/usage` into that
 * dialog's `CanonicalOverwriteImpact`, and pulls the page ids back out for
 * `POST /api/builder/publish`.
 *
 * WHY THE THEMES PAGE NEEDS THIS AT ALL
 * A theme is a reference — saving one writes the theme row and no page row —
 * and a published page is a snapshot. Until 2026-09-13 nothing connected the
 * two: the theme changed, every page using it kept an older clock than its
 * build, and the Publish panel said there was nothing to publish while the
 * live site still showed the old headline colour. The server now counts a
 * page as pending when its THEME is newer than its build; this is the half
 * that asks, and then names the pages to publish (task 86bbzy9ym).
 */

import type { CanonicalOverwriteImpact } from "./shared-block-usage";

export type ThemeUsagePage = { id: string; name: string; slug: string };

/** Mirrors PREVIEW_LIMIT in shared-block-usage: the dialog lists this many, then "…and N more". */
const PREVIEW_LIMIT = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The usage route's body → the pages it named. Returns null when the body
 * does not carry a page list at all — which is NOT the same as zero pages:
 * a read that failed must still ask the question (see the Themes page).
 */
export function readThemeUsage(body: unknown): ThemeUsagePage[] | null {
  if (!isRecord(body)) return null;
  const data = isRecord(body.data) ? body.data : body;
  const pages = data.pages;
  if (!Array.isArray(pages)) return null;
  return pages
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const id = String(entry.id ?? "").trim();
      if (!id) return null;
      return {
        id,
        name: String(entry.name ?? "").trim(),
        slug: String(entry.slug ?? "").trim(),
      };
    })
    .filter((page): page is ThemeUsagePage => page !== null);
}

/** What the dialog prints for a page: its name, or its address when it has no name. */
export function themeUsagePageLabel(page: ThemeUsagePage): string {
  if (page.name) return page.name;
  if (page.slug) return `/${page.slug.replace(/^\/+/, "")}`;
  return `Page ${page.id}`;
}

/**
 * The dialog's text for a theme save.
 *
 * `pages` null means the usage read failed. The dialog is still shown then —
 * skipping it would quietly save a theme that dozens of pages follow with no
 * question asked — so the summary says the list could not be read rather
 * than pretending it was empty.
 */
export function describeThemeSaveImpact(
  name: string,
  pages: readonly ThemeUsagePage[] | null
): CanonicalOverwriteImpact {
  const label = String(name ?? "").trim() || "this theme";

  if (pages === null) {
    return {
      summary: `Saves “${label}”. The pages that use it could not be counted just now, so any page following it changes too.`,
      pageLabels: [],
      more: 0,
      driftedPageLabels: [],
    };
  }

  if (!pages.length) {
    return {
      summary: `Saves “${label}”. No page uses it yet, so nothing else changes.`,
      pageLabels: [],
      more: 0,
      driftedPageLabels: [],
    };
  }

  const pageLabels = pages.slice(0, PREVIEW_LIMIT).map(themeUsagePageLabel);
  return {
    summary:
      `Saves “${label}”, and every page that uses it picks up the change: ${
        pages.length === 1 ? "1 page" : `${pages.length} pages`
      }. Nothing on those pages is rewritten — they read the theme.`,
    pageLabels,
    more: Math.max(0, pages.length - pageLabels.length),
    driftedPageLabels: [],
  };
}

/** The ids to hand to the publish route. Empty publishes nothing — never the whole site. */
export function themeUsagePageIds(pages: readonly ThemeUsagePage[] | null): string[] {
  return (pages ?? []).map((page) => page.id).filter(Boolean);
}
