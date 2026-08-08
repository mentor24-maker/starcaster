/**
 * Search across the whole module library.
 *
 * The palette is a two-level drill-down (category → modules). With dozens
 * of categories over hundreds of modules, "browse to the right category
 * first" stops being navigation and starts being a memory test — so search
 * deliberately spans EVERY category at once and returns modules directly,
 * not just the categories that contain them. A search that only filtered
 * category names would still leave the operator guessing which drawer a
 * module lives in, which is the actual problem.
 *
 * Pure and data-only so it can be unit-tested without React.
 */

export type ModuleSearchGroup = {
  value: string;
  label: string;
  description: string;
};

export type ModuleSearchItem = {
  id: string;
  label: string;
  description: string;
  group: string;
  groupLabel: string;
};

export type ModuleSearchSaved = {
  id: string;
  label: string;
  group: string;
  groupLabel: string;
};

export type ModuleSearchHit =
  | { kind: "group"; score: number; group: ModuleSearchGroup }
  | { kind: "item"; score: number; item: ModuleSearchItem }
  | { kind: "saved"; score: number; saved: ModuleSearchSaved };

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Score one candidate against the query.
 *
 * Higher is better; 0 means "no match, drop it". The tiers exist so that
 * typing "card" surfaces the module actually called "Feature Cards" above
 * every module whose description merely mentions a card.
 */
export function scoreModuleMatch(query: string, label: string, description = "", extra = ""): number {
  if (!query) return 0;

  const haystackLabel = label.toLowerCase();
  const haystackDescription = description.toLowerCase();
  const haystackExtra = extra.toLowerCase();

  if (haystackLabel === query) return 100;
  if (haystackLabel.startsWith(query)) return 80;

  // Start of any word in the label — "cards" should find "Feature Cards".
  if (new RegExp(`\\b${escapeRegExp(query)}`).test(haystackLabel)) return 60;
  if (haystackLabel.includes(query)) return 40;
  if (haystackExtra.includes(query)) return 25;
  if (haystackDescription.includes(query)) return 20;

  // Every whitespace-separated term appears somewhere — lets "nav menu"
  // match "Top Menu" in the Navigation category.
  const terms = query.split(" ").filter(Boolean);
  if (terms.length > 1) {
    const all = `${haystackLabel} ${haystackDescription} ${haystackExtra}`;
    if (terms.every((term) => all.includes(term))) return 10;
  }

  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchModulePalette(
  rawQuery: string,
  source: {
    groups: ModuleSearchGroup[];
    items: ModuleSearchItem[];
    saved?: ModuleSearchSaved[];
  }
): ModuleSearchHit[] {
  const query = normalizeSearchQuery(rawQuery);
  if (!query) return [];

  const hits: ModuleSearchHit[] = [];

  for (const item of source.items) {
    const score = scoreModuleMatch(query, item.label, item.description, item.groupLabel);
    if (score > 0) hits.push({ kind: "item", score, item });
  }

  for (const saved of source.saved ?? []) {
    const score = scoreModuleMatch(query, saved.label, "", saved.groupLabel);
    if (score > 0) hits.push({ kind: "saved", score, saved });
  }

  for (const group of source.groups) {
    const score = scoreModuleMatch(query, group.label, group.description);
    // A category is a coarser answer than a module, so it never outranks a
    // module that scored the same way.
    if (score > 0) hits.push({ kind: "group", score: score - 5, group });
  }

  return hits.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return labelOf(left).localeCompare(labelOf(right), undefined, { sensitivity: "base" });
  });
}

function labelOf(hit: ModuleSearchHit): string {
  if (hit.kind === "group") return hit.group.label;
  if (hit.kind === "item") return hit.item.label;
  return hit.saved.label;
}
