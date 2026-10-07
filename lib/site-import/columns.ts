/**
 * Site Import — column inference. Turns the desktop positions the capture
 * recorded for a section's elements into rows ("bands") of 1–6 columns, so a
 * source page's 2x2 grid or image-beside-text block arrives in Builder as a
 * multi-column section instead of one long stack.
 *
 * Supersedes mapping-spec decision #5 ("one IR section → one single-column
 * section"), overridden by Dane on 2026-10-06 (task 86bce4vv8) after
 * daneofearth.org's grids all arrived flattened.
 *
 * Pure, no I/O. The method is a recursive-free XY cut:
 *   1. Bands: sort boxes by top edge and sweep; a box that starts above the
 *      running band's bottom joins it. A band ends where nothing crosses the
 *      horizontal gap below it.
 *   2. Columns: inside a band, sort by left edge and sweep the same way
 *      horizontally. Two or more columns = a side-by-side row.
 *   3. Tidy: a row with a sliver column (an icon beside a line of text) is
 *      treated as stacked; a row wider than six columns wraps; consecutive
 *      stacked bands merge; consecutive rows whose columns line up merge
 *      (that is what makes a 2x2 grid ONE two-column section).
 *
 * The safe failure is today's behaviour: anything this cannot read with
 * confidence (no positions, one element, overlapping layout) stays stacked.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** `group` names the styled box (a card) the item sits in, if any: rows only
 *  merge when each column holds the same cards, so two cards are never
 *  poured into one Builder cell that can wear only one card's look. */
export type GridItem = { id: string; box?: Box | null; group?: string };

export type Cell = { band: number; col: number };

export type BandPlan = {
  /** Horizontal extent of each column, left to right. One entry = stacked. */
  columns: { x0: number; x1: number }[];
};

export type SectionGrid = {
  cells: Map<string, Cell>;
  bands: BandPlan[];
};

/** Track ratios of every Builder layout, by column count. MUST match
 *  LAYOUT_SPECS in lib/builder-client/builder-template.ts — checked by
 *  scripts/site-import/columns.test.js against the built server template. */
export const LAYOUT_RATIOS: Record<string, number[]> = {
  single: [1],
  "two-column": [1, 1],
  "two-four": [2, 4],
  "four-two": [4, 2],
  "one-five": [1, 5],
  "five-one": [5, 1],
  "one-three": [1, 3],
  "three-one": [3, 1],
  "two-three": [2, 3],
  "three-two": [3, 2],
  "three-column": [1, 1, 1],
  "one-four-one": [1, 4, 1],
  "one-three-one": [1, 3, 1],
  "one-two-one": [1, 2, 1],
  "two-one-one": [2, 1, 1],
  "one-one-two": [1, 1, 2],
  "three-one-one": [3, 1, 1],
  "one-one-three": [1, 1, 3],
  "four-column": [1, 1, 1, 1],
  "five-column": [1, 1, 1, 1, 1],
  "six-column": [1, 1, 1, 1, 1, 1],
};

/** Builder's persisted column keys, by column count (builder-template.ts). */
const COLUMN_KEYS: string[][] = [
  [],
  ["main"],
  ["left", "right"],
  ["left", "center", "right"],
  ["left", "center", "right", "col4"],
  ["left", "center", "right", "col4", "col5"],
  ["left", "center", "right", "col4", "col5", "col6"],
];

export const MAX_COLUMNS = 6;
/** Boxes may touch or overlap by this much and still count as separate. */
const OVERLAP_TOLERANCE_PX = 2;
/** A column narrower than this share of the section is decoration (an icon,
 *  a bullet glyph), not a column — the row is read as stacked. */
const MIN_COLUMN_SHARE = 0.1;
/** Two rows' columns "line up" when each pair overlaps by this share of the
 *  narrower one. */
const ALIGN_SHARE = 0.5;

function validBox(box: Box | null | undefined): box is Box {
  return (
    !!box &&
    [box.x, box.y, box.w, box.h].every((n) => Number.isFinite(n)) &&
    box.w >= 2 &&
    box.h >= 2
  );
}

type Positioned = { id: string; box: Box; group: string };
type RawColumn = { x0: number; x1: number; ids: string[]; groups: string[] };
type RawBand = { columns: RawColumn[] };

function sweep<T>(
  items: T[],
  start: (t: T) => number,
  end: (t: T) => number
): T[][] {
  const sorted = [...items].sort((a, b) => start(a) - start(b));
  const groups: T[][] = [];
  let edge = -Infinity;
  for (const item of sorted) {
    if (groups.length && start(item) < edge - OVERLAP_TOLERANCE_PX) {
      groups[groups.length - 1].push(item);
      edge = Math.max(edge, end(item));
    } else {
      groups.push([item]);
      edge = end(item);
    }
  }
  return groups;
}

function columnsOf(group: Positioned[]): RawColumn[] {
  return sweep(group, (p) => p.box.x, (p) => p.box.x + p.box.w).map((col) => ({
    x0: Math.min(...col.map((p) => p.box.x)),
    x1: Math.max(...col.map((p) => p.box.x + p.box.w)),
    ids: col.map((p) => p.id),
    groups: Array.from(new Set(col.map((p) => p.group))).sort(),
  }));
}

/** Same cards, column for column — the condition for two rows to merge. */
function sameGroups(a: RawBand, b: RawBand): boolean {
  return a.columns.every((ca, i) => ca.groups.join("\u0000") === b.columns[i].groups.join("\u0000"));
}

function unionGroups(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).sort();
}

function stacked(band: RawBand): RawBand {
  const all = band.columns;
  return {
    columns: [
      {
        x0: Math.min(...all.map((c) => c.x0)),
        x1: Math.max(...all.map((c) => c.x1)),
        ids: all.flatMap((c) => c.ids),
        groups: all.reduce<string[]>((acc, c) => unionGroups(acc, c.groups), []),
      },
    ],
  };
}

function aligned(a: RawBand, b: RawBand): boolean {
  if (a.columns.length !== b.columns.length || a.columns.length < 2) return false;
  return a.columns.every((ca, i) => {
    const cb = b.columns[i];
    const overlap = Math.min(ca.x1, cb.x1) - Math.max(ca.x0, cb.x0);
    const narrower = Math.min(ca.x1 - ca.x0, cb.x1 - cb.x0);
    return narrower > 0 && overlap >= narrower * ALIGN_SHARE;
  });
}

export function planSectionGrid(items: GridItem[]): SectionGrid {
  const positioned: Positioned[] = items
    .filter((it) => validBox(it.box))
    .map((it) => ({ id: it.id, box: it.box as Box, group: it.group || "" }));

  const cells = new Map<string, Cell>();
  if (positioned.length < 2) {
    for (const it of items) cells.set(it.id, { band: 0, col: 0 });
    return { cells, bands: [{ columns: [{ x0: 0, x1: 1 }] }] };
  }

  const left = Math.min(...positioned.map((p) => p.box.x));
  const right = Math.max(...positioned.map((p) => p.box.x + p.box.w));
  const span = Math.max(1, right - left);

  // 1–2. Bands, then columns inside each band.
  let bands: RawBand[] = sweep(positioned, (p) => p.box.y, (p) => p.box.y + p.box.h).map(
    (group) => ({ columns: columnsOf(group) })
  );

  // 3a. Sliver columns mean "decoration beside text", not a grid.
  bands = bands.map((band) =>
    band.columns.length > 1 &&
    band.columns.some((c) => (c.x1 - c.x0) / span < MIN_COLUMN_SHARE)
      ? stacked(band)
      : band
  );

  // 3b. Wider than Builder allows: wrap into even rows (8 → 4 + 4).
  bands = bands.flatMap((band) => {
    const n = band.columns.length;
    if (n <= MAX_COLUMNS) return [band];
    const rows = Math.ceil(n / MAX_COLUMNS);
    const per = Math.ceil(n / rows);
    const out: RawBand[] = [];
    for (let i = 0; i < n; i += per) out.push({ columns: band.columns.slice(i, i + per) });
    return out;
  });

  // 3c. Merge runs: stacked after stacked, and rows whose columns line up —
  // as long as each column holds the same cards (GridItem.group). Content
  // with no cards has one empty group everywhere, so it merges as it always
  // did; a 2x2 grid of cards stays two rows of two (task 86bce9wx3).
  const merged: RawBand[] = [];
  for (const band of bands) {
    const prev = merged[merged.length - 1];
    if (prev && prev.columns.length === 1 && band.columns.length === 1 && sameGroups(prev, band)) {
      merged[merged.length - 1] = stacked({ columns: [...prev.columns, ...band.columns] });
    } else if (prev && aligned(prev, band) && sameGroups(prev, band)) {
      merged[merged.length - 1] = {
        columns: prev.columns.map((c, i) => ({
          x0: Math.min(c.x0, band.columns[i].x0),
          x1: Math.max(c.x1, band.columns[i].x1),
          ids: [...c.ids, ...band.columns[i].ids],
          groups: unionGroups(c.groups, band.columns[i].groups),
        })),
      };
    } else {
      merged.push(band);
    }
  }

  merged.forEach((band, b) =>
    band.columns.forEach((col, c) => col.ids.forEach((id) => cells.set(id, { band: b, col: c })))
  );

  // Unpositioned items ride with their neighbour in document order: the one
  // before, or — at the very start — the first positioned one after.
  let carry: Cell | null = null;
  const pending: string[] = [];
  for (const it of items) {
    const cell = cells.get(it.id);
    if (cell) {
      for (const id of pending) cells.set(id, cell);
      pending.length = 0;
      carry = cell;
    } else if (carry) {
      cells.set(it.id, carry);
    } else {
      pending.push(it.id);
    }
  }
  for (const id of pending) cells.set(id, { band: 0, col: 0 });

  return {
    cells,
    bands: merged.map((band) => ({ columns: band.columns.map(({ x0, x1 }) => ({ x0, x1 })) })),
  };
}

/** The Builder layout whose track ratios are closest to these widths. */
export function chooseLayout(widths: number[]): string {
  const n = widths.length;
  if (n <= 1) return "single";
  const total = widths.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const shares = widths.map((w) => Math.max(0, w) / total);
  let best = "";
  let bestScore = Infinity;
  for (const [layout, ratios] of Object.entries(LAYOUT_RATIOS)) {
    if (ratios.length !== n) continue;
    const sum = ratios.reduce((a, b) => a + b, 0);
    const score = ratios.reduce((acc, r, i) => acc + (r / sum - shares[i]) ** 2, 0);
    if (score < bestScore) {
      bestScore = score;
      best = layout;
    }
  }
  return best || "single";
}

/** Builder's column keys for a layout with this many columns. */
export function columnKeys(count: number): string[] {
  return COLUMN_KEYS[Math.max(1, Math.min(MAX_COLUMNS, count))].slice();
}

/**
 * Lay freshly mapped sections over a page's current ones (the --apply
 * runner, scripts/site_import_map.mjs, on a re-import). A mapped section
 * whose id is already on the page replaces it in place unless the hash guard
 * protects it; a NEW id goes straight after the mapped section that precedes
 * it in mapping order — so the extra rows a split section gains
 * (`<id>b<band>`) land beside their first row, not at the bottom of the page.
 * New ids with nothing on the page before them go last.
 */
export function mergeMappedSections<T extends { id: string }>(
  currentSections: T[],
  mappedSections: T[],
  protectedIds: Set<string>
): T[] {
  const mappedById = new Map(mappedSections.map((s) => [s.id, s]));
  const currentIds = new Set(currentSections.map((s) => s.id));
  const followers = new Map<string, T[]>();
  const unanchored: T[] = [];
  let anchor: string | null = null;
  for (const s of mappedSections) {
    if (currentIds.has(s.id)) {
      anchor = s.id;
      followers.set(anchor, []);
    } else if (anchor) {
      (followers.get(anchor) as T[]).push(s);
    } else {
      unanchored.push(s);
    }
  }
  const merged: T[] = [];
  for (const s of currentSections) {
    const replace = mappedById.has(s.id) && !protectedIds.has(s.id);
    merged.push(replace ? (mappedById.get(s.id) as T) : s);
    for (const follower of followers.get(s.id) || []) merged.push(follower);
  }
  merged.push(...unanchored);
  return merged;
}
