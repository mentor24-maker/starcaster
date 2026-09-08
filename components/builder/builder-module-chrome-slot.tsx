import { createContext, useContext, useLayoutEffect, useRef } from "react";

/**
 * THE CHROME AND THE FIRST SETTINGS COLUMN ARE ONE GRID
 * (ticket 86bbq065f, 2026-09-08. The fix half of 86bbw8643's instrument.)
 *
 * Every module panel is two rectangles stacked on each other — the shared
 * chrome (Label, Background, Alignment, the margins) and the panel's own
 * settings columns — and until now they did not share an edge. Measured on
 * 2026-09-07, 32 of the 35 panels carrying both put their controls on two
 * different vertical lines, from -25px on `image` to +78px on `breadcrumb`.
 *
 * WHY THIS IS A SLOT AND NOT A CSS RULE. Two CSS grids cannot share a track.
 * The house answer to that is `subgrid`, and it is already how Feature Cards
 * and Program List — the only two panels that lined up — do it: their editor
 * owns named `lattice-start / lattice-end` tracks and both halves subgrid onto
 * them. That chain cannot be extended to the other 32, because of what sits
 * between the editor and the first column:
 *
 *     .builder-module-editor            display: grid
 *       └ [the module's settings]       display: block
 *           └ .builder-schema-panel-columns   display: FLEX, wrap
 *               └ .builder-schema-panel-column    display: grid
 *
 * A flex item cannot be a subgrid of a grid two levels above it, so the chain
 * breaks at `.builder-schema-panel-columns` on every one of them. That
 * container is flex on purpose — content-sized columns with the leftover width
 * split between the gaps (operator 8/13), wrapping onto a second row when the
 * panel is narrow. Ten of the 35 already wrap at 1440, and L4/W5 say wrapping
 * outranks the column count, so making it a grid to reconnect the chain would
 * break a higher rule than the one being fixed.
 *
 * So: one box instead of two. The chrome strip is rendered INTO the first
 * settings column and flattened with `display: contents`, which puts its
 * labels and controls on that column's own two tracks. `max-content` then
 * measures the longest label and the longest control across the chrome AND the
 * column at once, which is the whole point — and it is not a new idea here.
 * `social` has always done exactly this by hand, rendering Label, Background,
 * Alignment and the margins as rows of its own Structure column, and it is the
 * only chrome-bearing panel that never measured staggered.
 *
 * WHY A PORTAL RATHER THAN A PROP. The chrome belongs to `BuilderModuleCard`;
 * the columns belong to whichever of the ~47 settings components the module
 * happens to use. Threading a `chrome` prop through all of them is a list that
 * rots — a new settings component that forgot the prop would silently lose the
 * module's Label, Background and margins, and nothing tests CSS here, so it
 * would ship. A slot inverts that: the panel says WHERE the chrome goes, the
 * card decides WHETHER there is one, and **a panel that never renders a slot
 * keeps the chrome exactly where it is today**. The failure mode of forgetting
 * is a panel that stays staggered — visible to `check:panels` — rather than a
 * panel that loses its settings.
 */
export type BuilderModuleChromeSlotRegistrar = (element: HTMLElement, present: boolean) => void;

const BuilderModuleChromeSlotContext = createContext<BuilderModuleChromeSlotRegistrar | null>(null);

export const BuilderModuleChromeSlotProvider = BuilderModuleChromeSlotContext.Provider;

/**
 * Rendered by a settings panel at the END of its first non-empty column — the
 * position the chrome already occupies on 30 of the 35 panels, which are the
 * ones that render their settings first and the shared chrome after.
 *
 * It renders an empty box and nothing else. The chrome itself arrives through
 * a portal from the card, so the React tree (and therefore every event, every
 * `onUpdateModule`) is unchanged; only the DOM parent moves, which is the one
 * thing that has to move for the two halves to be one grid.
 */
export function BuilderModuleChromeSlot() {
  const register = useContext(BuilderModuleChromeSlotContext);
  const ref = useRef<HTMLDivElement | null>(null);

  /*
   * Registered from an effect with the ELEMENT on both edges, rather than from
   * a bare `ref` callback. React hands a ref callback `null` on unmount and
   * says nothing about which node left, so a card holding two slots — a table
   * module whose cell editor renders a schema panel of its own, say — could
   * not tell which one had gone and would clear the wrong one. Passing the
   * element both ways lets the card keep an honest list and pick from it in
   * document order.
   *
   * `useLayoutEffect` because the card portals into whatever this registers,
   * and a portal that lands after paint is a visible jump on every panel open.
   */
  useLayoutEffect(() => {
    const element = ref.current;
    if (!register || !element) return;
    register(element, true);
    return () => register(element, false);
  }, [register]);

  // No provider means no card above this panel — a schema panel rendered
  // somewhere that has no module chrome at all (the row and cell editors).
  // Rendering nothing is right: there is no chrome to receive.
  if (!register) return null;
  return <div className="builder-module-chrome-slot" ref={ref} />;
}
