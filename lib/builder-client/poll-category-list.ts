import { buildPublicPollCategoryPath, type PollCategorySeed } from "@/lib/poll-categories";

export type PollCategoryListSort = "alphabetical" | "canonical";

export type PollCategoryListFlow = "rows" | "columns";

export type PollCategoryListEntry = PollCategorySeed & { href: string };

export const POLL_CATEGORY_LIST_DEFAULT_SORT: PollCategoryListSort = "alphabetical";
export const POLL_CATEGORY_LIST_DEFAULT_FLOW: PollCategoryListFlow = "rows";
export const POLL_CATEGORY_LIST_COLUMN_COUNT = 4;
export const POLL_CATEGORY_LIST_DEFAULT_TITLE = "Categories";
export const POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE = "18";
export const POLL_CATEGORY_LIST_DEFAULT_ITEM_GAP = "8";
export const POLL_CATEGORY_LIST_DEFAULT_BACKGROUND_COLOR = "#e8f6fc";

export function normalizePollCategoryListSort(value: string | undefined): PollCategoryListSort {
  return value === "canonical" ? "canonical" : "alphabetical";
}

export function normalizePollCategoryListFlow(value: string | undefined): PollCategoryListFlow {
  return value === "columns" ? "columns" : "rows";
}

export function sortPollCategoriesForList(
  categories: readonly PollCategorySeed[],
  sort: PollCategoryListSort
): PollCategorySeed[] {
  const copy = [...categories];

  if (sort === "alphabetical") {
    return copy.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }

  return copy;
}

export function buildPollCategoryListEntries(
  catalog: readonly PollCategorySeed[],
  sort: PollCategoryListSort
): PollCategoryListEntry[] {
  return sortPollCategoriesForList(catalog, sort).map((category) => ({
    ...category,
    href: buildPublicPollCategoryPath(category)
  }));
}

/** Column-major DOM order so a 4-column grid reads A→Z down each column before the next. */
export function orderPollCategoryListForGrid(
  entries: readonly PollCategoryListEntry[],
  flow: PollCategoryListFlow,
  columnCount = POLL_CATEGORY_LIST_COLUMN_COUNT
): PollCategoryListEntry[] {
  if (flow === "rows" || entries.length === 0 || columnCount < 1) {
    return [...entries];
  }

  const rows = Math.ceil(entries.length / columnCount);
  const ordered: PollCategoryListEntry[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const index = column * rows + row;
      if (index < entries.length) {
        ordered.push(entries[index]);
      }
    }
  }

  return ordered;
}

export function getPollCategoryListEntries(
  sort: PollCategoryListSort,
  catalog: readonly PollCategorySeed[],
  flow: PollCategoryListFlow = "rows",
  columnCount = POLL_CATEGORY_LIST_COLUMN_COUNT
): PollCategoryListEntry[] {
  const entries = buildPollCategoryListEntries(catalog, sort);
  return orderPollCategoryListForGrid(entries, flow, columnCount);
}
