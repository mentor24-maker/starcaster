/**
 * A WRAPPED AXIS COLUMN SHARES THE FIELD EDGE OF THE COLUMN ABOVE IT
 * (ticket 86bbzzv49, 2026-09-20).
 *
 * `.is-lattice .builder-schema-panel-columns` is a wrapping flex row: every
 * axis column is sized to its own content (W0, per column) and the slack goes
 * into the gaps. When the panel is too narrow for one line, a column drops to
 * a second line and lands flush left — directly under the first column. Each
 * column sizes its label track to its OWN longest label, so the two stacked
 * columns start their fields at two different x positions: Messaging Topic
 * List at 1440 put Frame's controls 57px left of Content's, one under the
 * other. That is the operator's 2026-08-13 sentence ("the column width varies
 * arbitrarily between the Settings fields and the Layout fields") arriving by
 * the one route the chrome-seam fix did not cover.
 *
 * WHY THIS IS SCRIPT AND NOT CSS. Which column lands under which depends on
 * the window width, so no stylesheet rule can name the pair. Subgrid — the
 * house mechanism for sharing tracks — needs the two boxes to be items of one
 * grid, and a flex line break is not a grid row. So the layout is measured and
 * the narrower label track of each stacked pair is given a floor equal to the
 * wider one (`--lattice-stack-label`, read by the column's grid in
 * `_builder-react-overrides.css`). The columns keep sizing to their content;
 * the floor only ever widens a label track, never narrows one.
 *
 * THE PLAN IS ALWAYS DRAWN FROM THE NATURAL LAYOUT. Every pass clears the
 * floors first and measures the columns as they would sit without them, so
 * the result is a function of the content and the width alone and cannot
 * feed back into itself: running it twice gives the same answer.
 */

export interface StackedColumnBox {
  /** Viewport x of the column's content box (after padding and border). */
  left: number;
  /** Viewport y of the column's border box — columns on one flex line share it. */
  top: number;
  /** Width of the column's label track as it lays out with no floor. */
  label: number;
}

/** Two edges within this many px are the same edge (sub-pixel rounding). */
const SAME_EDGE = 2;

/** Which line (0 = top) each column sits on, by its top edge. */
export function lineIndexes(boxes: StackedColumnBox[]): number[] {
  const tops: number[] = [];
  for (const top of [...boxes.map((b) => b.top)].sort((a, b) => a - b)) {
    if (!tops.length || top - tops[tops.length - 1] > SAME_EDGE) tops.push(top);
  }
  return boxes.map((b) => tops.findIndex((t) => Math.abs(b.top - t) <= SAME_EDGE));
}

/**
 * The label-track floor each column needs so every column stacked under
 * another starts its fields where that one does. `null` means "no floor":
 * the column is not stacked with anything, or it already has the widest
 * label track in its stack.
 *
 * A stack is a chain of columns on consecutive lines sharing a left edge —
 * three lines deep is one stack of three, not two pairs, or the middle column
 * could be asked to take two different floors.
 */
export function planStackedColumnLabels(boxes: StackedColumnBox[]): (number | null)[] {
  const lines = lineIndexes(boxes);
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  boxes.forEach((box, i) => {
    if (lines[i] <= 0) return;
    const above = boxes.findIndex(
      (other, j) => lines[j] === lines[i] - 1 && Math.abs(other.left - box.left) <= SAME_EDGE
    );
    if (above >= 0) parent[find(i)] = find(above);
  });

  // Where each stack's fields should start: the furthest-right control edge
  // among its members. Absolute x rather than track width, so a column that
  // sits a pixel off its partner still lands its fields on the same line.
  const edge = new Map<number, number>();
  const size = new Map<number, number>();
  boxes.forEach((box, i) => {
    const root = find(i);
    edge.set(root, Math.max(edge.get(root) ?? -Infinity, box.left + box.label));
    size.set(root, (size.get(root) ?? 0) + 1);
  });

  return boxes.map((box, i) => {
    const root = find(i);
    if ((size.get(root) ?? 0) < 2) return null;
    const floor = (edge.get(root) as number) - box.left;
    return floor - box.label > 0.5 ? floor : null;
  });
}

/* ------------------------------------------------------------------------ */
/* The DOM half                                                              */
/* ------------------------------------------------------------------------ */

const FLOOR = "--lattice-stack-label";
const CONTAINER = ".is-lattice .builder-schema-panel-columns";

function axisColumns(container: Element): HTMLElement[] {
  return [...container.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains("builder-schema-panel-column")
  );
}

/** First track of a column's grid, in px — or null if it has no tracks of its own. */
function labelTrack(column: HTMLElement): number | null {
  const style = getComputedStyle(column);
  if (style.display !== "grid" && style.display !== "inline-grid") return null;
  // A subgrid column (Feature Cards, Program List) shares the editor's tracks
  // already and has none of its own to floor.
  if (/^\s*subgrid/.test(style.gridTemplateColumns)) return null;
  const px = /(-?[\d.]+)px/.exec(style.gridTemplateColumns);
  return px ? Number(px[1]) : null;
}

function measure(columns: HTMLElement[]): (StackedColumnBox | null)[] {
  return columns.map((column) => {
    const rect = column.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const label = labelTrack(column);
    if (label === null) return null;
    const style = getComputedStyle(column);
    const left = rect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
    return { left, top: rect.top, label };
  });
}

function lineSignature(columns: HTMLElement[]): string {
  return lineIndexes(columns.map((c) => ({ left: 0, top: c.getBoundingClientRect().top, label: 0 }))).join(",");
}

/** One container: clear, measure the natural layout, apply the floors. */
export function alignStackedColumns(container: Element): void {
  const columns = axisColumns(container);
  for (const column of columns) column.style.removeProperty(FLOOR);
  if (columns.length < 2) return;

  const measured = measure(columns);
  const present = measured.map((box, i) => (box ? i : -1)).filter((i) => i >= 0);
  if (present.length < 2) return;

  const plan = planStackedColumnLabels(present.map((i) => measured[i] as StackedColumnBox));
  const lines = lineIndexes(present.map((i) => measured[i] as StackedColumnBox));
  const natural = lineSignature(columns);

  const apply = (keep: (k: number) => boolean) => {
    plan.forEach((floor, k) => {
      const column = columns[present[k]];
      if (floor !== null && keep(k)) column.style.setProperty(FLOOR, `${floor}px`);
      else column.style.removeProperty(FLOOR);
    });
  };

  /*
   * NEVER BREAK A LINE TO LINE A COLUMN UP. Widening a column on an upper
   * line can push its line past the panel's edge and wrap one MORE column —
   * trading a 57px step for a worse layout. So if the floors change which
   * line any column sits on, the upper columns give theirs back (a floor on
   * the bottom of a stack only moves what is below it), and if even that
   * reflows, nothing is floored: the natural layout is the safe answer.
   */
  apply(() => true);
  if (lineSignature(columns) === natural) return;
  const bottomLine = Math.max(...lines);
  apply((k) => lines[k] === bottomLine);
  if (lineSignature(columns) === natural) return;
  apply(() => false);
}

let installed = false;

/**
 * Keep every lattice panel's stacked columns aligned, for the life of the
 * page. Idempotent — each panel family calls it on mount, and the first call
 * wins. Deliberately page-wide rather than per panel: seven components render
 * `.builder-schema-panel-columns`, and a panel that forgot to opt in would be
 * the exact silent gap this exists to close.
 */
export function installStackedColumnAlignment(): void {
  if (installed || typeof document === "undefined" || typeof ResizeObserver === "undefined") return;
  installed = true;

  const watched = new WeakSet<Element>();
  let frame = 0;

  const run = () => {
    frame = 0;
    for (const container of document.querySelectorAll(CONTAINER)) {
      if (!watched.has(container)) {
        watched.add(container);
        resize.observe(container);
      }
      alignStackedColumns(container);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };

  // Our own floor writes resize the columns; that re-runs once, finds the
  // same plan, writes the same values, and settles — the plan is drawn from
  // the natural layout, so it cannot chase itself.
  const resize = new ResizeObserver(schedule);
  window.addEventListener("resize", schedule);

  // A panel opening, a field appearing, a label changing: anything inside a
  // lattice panel. Mutations elsewhere (the canvas, typing) are ignored.
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".is-lattice") || [...record.addedNodes].some((n) => n instanceof Element && (n.matches(".is-lattice") || n.querySelector(".is-lattice")))) {
        schedule();
        return;
      }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  schedule();
}
