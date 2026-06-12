import { formatPollCategoryDisplayName, sortPollCategorySeeds } from "@/lib/poll-categories";

export function normalizeGalleryMediaCategory(value: unknown): string {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  return formatPollCategoryDisplayName(text).slice(0, 255);
}

/** Extra gallery-only labels merged with poll category names for filter dropdowns. */
export function buildGalleryMediaCategoryOptions(extraCategories: string[] = []): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const entry of extraCategories) {
    const label = normalizeGalleryMediaCategory(entry);

    if (!label || seen.has(label.toLowerCase())) {
      continue;
    }

    seen.add(label.toLowerCase());
    ordered.push(label);
  }

  return sortPollCategorySeeds(ordered.map((name) => ({ name, slug: name }))).map((category) => category.name);
}
