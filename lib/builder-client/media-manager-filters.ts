/**
 * The Media Manager's gallery filters — name, aspect, tag, category.
 *
 * Pure on purpose. The module around it is all fetches, state and DOM, none of
 * which a test in this repo can hold still; this is the part that can be
 * pinned exactly, so it lives here rather than inline in the renderer.
 *
 * Everything filtered on already exists: `assets.asset_name`, `assets.aspect`
 * (the three values the database's check constraint allows), `assets.tags`,
 * and `assets.category`. No filter invents a field.
 */

export type MediaFilterAsset = {
  assetName?: string;
  category?: string;
  aspect?: string;
  tags?: string[];
};

export type MediaFilters = {
  name: string;
  aspect: string;
  tag: string;
  category: string;
};

export const EMPTY_MEDIA_FILTERS: MediaFilters = { name: "", aspect: "", tag: "", category: "" };

/**
 * The three from lib/assetAspect.js. Labelled with the bare words rather than
 * that file's ASPECT_LABELS ("Wide Images", …), which read wrong in a manager
 * that also holds video. The VALUES are unchanged, so they still match the
 * column.
 */
export const MEDIA_ASPECTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "wide", label: "Wide" },
  { value: "square", label: "Square" },
  { value: "tall", label: "Tall" }
];

/** One spelling of a tag, matching lib/assetTagsStore.js. */
export function normalizeMediaTag(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function mediaTagKey(value: string): string {
  return normalizeMediaTag(value).toLowerCase();
}

/**
 * What the Tag select offers: the project's tag registry PLUS any tag actually
 * sitting on a file.
 *
 * Registry-only was the first version and it was wrong. A tag can reach an
 * asset without going through the registry — rows predating it, or anything
 * tagged from the platform Assets screen — and those tags render on the cards.
 * A tag you can SEE but cannot filter by is worse than no filter.
 *
 * This also matches what /api/asset-categories already does for categories:
 * it merges the registry with the categories found on assets.
 *
 * De-duplicated case-insensitively, first spelling seen wins, sorted for a
 * stable list.
 */
export function mediaTagOptions(
  registryTags: ReadonlyArray<{ tag?: string }>,
  assets: ReadonlyArray<MediaFilterAsset>
): string[] {
  const seen = new Map<string, string>();
  const add = (value: unknown) => {
    const name = normalizeMediaTag(String(value || ""));
    if (name && !seen.has(mediaTagKey(name))) seen.set(mediaTagKey(name), name);
  };
  (Array.isArray(registryTags) ? registryTags : []).forEach((t) => add(t?.tag));
  (Array.isArray(assets) ? assets : []).forEach((a) => {
    (Array.isArray(a?.tags) ? a.tags : []).forEach(add);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function mediaFiltersActive(filters: MediaFilters): boolean {
  return Boolean(
    String(filters?.name || "").trim()
    || filters?.aspect
    || filters?.tag
    || filters?.category
  );
}

/**
 * Every ACTIVE filter must hold. They combine; none replaces another, and an
 * unset filter constrains nothing — the failure mode where picking a category
 * quietly discards the name you typed.
 */
export function mediaAssetMatchesFilters(asset: MediaFilterAsset, filters: MediaFilters): boolean {
  const name = String(filters?.name || "").trim().toLowerCase();
  if (name && !String(asset?.assetName || "").toLowerCase().includes(name)) return false;

  if (filters?.aspect && String(asset?.aspect || "") !== filters.aspect) return false;

  if (filters?.category
    && String(asset?.category || "").toLowerCase() !== String(filters.category).toLowerCase()) {
    return false;
  }

  if (filters?.tag) {
    // Case-insensitive, through the same normaliser the tag modal writes with,
    // or a filter misses a file over its casing.
    const key = mediaTagKey(filters.tag);
    const tags = Array.isArray(asset?.tags) ? asset.tags : [];
    if (!tags.some((t) => mediaTagKey(t) === key)) return false;
  }

  return true;
}
