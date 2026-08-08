/**
 * Menu-shape logic for the Navigation module's mega-panel mode.
 *
 * Kept out of the React components deliberately: the depth rules decide
 * whether an operator can build a three-level menu at all, and the column
 * grouping decides what a visitor sees. Both are pure functions of the item
 * list, so both are unit-testable — see builder-nav-mega.test.ts.
 *
 * ClickUp 86bbafg38.
 */

export type NavMegaItem = {
  id?: string;
  label: string;
  href: string;
  parentId?: string;
  featureImage?: string;
  featureHeading?: string;
};

export type NavMegaColumn<T> = {
  id: string;
  /** null for a headless column of plain links. */
  heading: T | null;
  links: T[];
};

/**
 * Zero-based depth cap. Level 0 = the top bar, 1 = column headings,
 * 2 = the links inside a column. A mega panel needs exactly these three.
 */
export const MAX_NAV_DEPTH = 2;

/**
 * Group one top-level item's descendants into mega-panel columns.
 *
 * The shape is chosen from the data rather than from a setting, so an
 * operator cannot select a layout their menu can't fill:
 *   - any child has children of its own → each child becomes a column,
 *     its label the heading and its children the links;
 *   - no child has children → the children are plain links, dealt evenly
 *     into `columnCount` headless columns.
 */
export function buildMegaColumns<T extends { id?: string }>(
  children: T[],
  childrenOf: (parentId: string) => T[],
  columnCount: number
): NavMegaColumn<T>[] {
  const nested = children.some((child) => childrenOf(child.id ?? "").length > 0);

  if (nested) {
    return children.map((child, index) => ({
      id: child.id ?? `mega-col-${index}`,
      heading: child,
      links: childrenOf(child.id ?? "")
    }));
  }

  if (children.length === 0) return [];

  const perColumn = Math.max(1, Math.ceil(children.length / Math.max(1, columnCount)));
  const columns: NavMegaColumn<T>[] = [];
  for (let index = 0; index < children.length; index += perColumn) {
    columns.push({ id: `mega-col-${index}`, heading: null, links: children.slice(index, index + perColumn) });
  }
  return columns;
}

/** How many levels down `item` sits. 0 = top level. Cycle-safe. */
export function navDepthOf(items: NavMegaItem[], item: NavMegaItem): number {
  let depth = 0;
  let cursor: NavMegaItem | undefined = item;
  const seen = new Set<string>();

  while (cursor?.parentId && !seen.has(cursor.id ?? "")) {
    seen.add(cursor.id ?? "");
    const parent: NavMegaItem | undefined = items.find((candidate) => candidate.id === cursor?.parentId);
    if (!parent) break;
    depth += 1;
    cursor = parent;
  }

  return depth;
}

/** How many levels of descendants hang below `id`. 0 = none. Cycle-safe. */
export function navSubtreeHeight(items: NavMegaItem[], id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);

  const kids = items.filter((item) => item.parentId === id);
  if (kids.length === 0) return 0;

  return 1 + Math.max(...kids.map((kid) => navSubtreeHeight(items, kid.id ?? "", seen)));
}

export function isNavDescendantOf(items: NavMegaItem[], candidateId: string, ancestorId: string): boolean {
  let cursor = items.find((item) => item.id === candidateId);
  const seen = new Set<string>();

  while (cursor?.parentId && !seen.has(cursor.id ?? "")) {
    seen.add(cursor.id ?? "");
    if (cursor.parentId === ancestorId) return true;
    cursor = items.find((item) => item.id === cursor?.parentId);
  }

  return false;
}

/**
 * Which items `item` may legally be filed under.
 *
 * Replaces the old rule — "only top-level items, and anything with children
 * can't be nested at all" — which made a three-level menu impossible to
 * build by hand even though the importer could produce one and the "Levels"
 * control offered 3.
 */
export function eligibleNavParents(
  items: NavMegaItem[],
  item: NavMegaItem,
  maxDepth: number = MAX_NAV_DEPTH
): NavMegaItem[] {
  const ownHeight = navSubtreeHeight(items, item.id ?? "");

  return items.filter((candidate) => {
    if (!candidate.id || candidate.id === item.id) return false;
    // Filing an item under its own descendant would build a cycle.
    if (isNavDescendantOf(items, candidate.id, item.id ?? "")) return false;
    return navDepthOf(items, candidate) + 1 + ownHeight <= maxDepth;
  });
}
