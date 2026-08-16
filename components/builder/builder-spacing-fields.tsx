import { useState } from "react";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField } from "./builder-module-field";

/**
 * Spacing controls that show ONE row per axis until you ask for two —
 * doctrine E4b (docs/MODULE_UI_DOCTRINE.md), operator 2026-08-15:
 *
 *   "reduce the number of options under Placement by having default V Margin,
 *    H Margin, V Padding, H Padding settings. These don't replace the
 *    granularity we already have, it simply assumes left and right and top
 *    and bottom will match… inline icons that can toggle between the default
 *    'assumed match' form and the optional 'separate values' mode."
 *
 * This is a display mode, NOT a data model. Every value still writes the four
 * side keys E4 standardized on (`marginTop`/`marginBottom`/`marginLeft`/
 * `marginRight`, same for padding) — the matched row simply writes both sides
 * of its axis at once. Nothing new is persisted, no renderer changes, and a
 * page saved before today opens on whatever mode its numbers already imply.
 *
 * Which is also why the mode is DERIVED rather than stored: two sides that
 * hold the same number are shown matched; two that differ are shown apart.
 * The only state is one boolean per axis — "the operator asked to split this
 * one" — so the control can never claim two sides match when they do not.
 */

/** One side of a spacing box, and where its value comes from. */
export type BuilderSpacingSide = {
  /** The setting this side reads and writes. */
  key: string;
  /** Label in separate mode — "Top Margin". */
  label: string;
  /**
   * The retired vertical/horizontal key this side falls back to when its own
   * is unset. A module in a table cell never passes through
   * `normalizeBuilderModuleSettingsForType`, so reading the side key alone
   * shows 0 while the page renders the pair it was saved with.
   */
  legacy?: string;
  /** Value assumed when neither key is set. */
  fallback: string;
};

/** Two sides that move together until told otherwise. */
export type BuilderSpacingPairSpec = {
  /** Label in matched mode — "V Margin". */
  pairLabel: string;
  sides: readonly [BuilderSpacingSide, BuilderSpacingSide];
  min: number;
  max: number;
  step: number;
};

/**
 * The four sides of a spacing box, in one fixed order: Top, Bottom, Left,
 * Right. Every object in the Builder — row, cell, module — spells margin and
 * padding this way from 2026-08-11 (operator: "standardize all objects on the
 * Top/Bottom/Left/Right model"). `legacy` is the vertical/horizontal key that
 * side used to come from, read as its fallback so a page that has not been
 * re-saved shows the number it is actually rendering.
 */
export const MODULE_MARGIN_SIDES = [
  { key: "marginTop", label: "Top Margin", legacy: "verticalMargin" },
  { key: "marginBottom", label: "Bottom Margin", legacy: "verticalMargin" },
  { key: "marginLeft", label: "Left Margin", legacy: "horizontalMargin" },
  { key: "marginRight", label: "Right Margin", legacy: "horizontalMargin" }
] as const;

export const MODULE_PADDING_SIDES = [
  { key: "paddingTop", label: "Top Padding", legacy: "verticalPadding" },
  { key: "paddingBottom", label: "Bottom Padding", legacy: "verticalPadding" },
  { key: "paddingLeft", label: "Left Padding", legacy: "horizontalPadding" },
  { key: "paddingRight", label: "Right Padding", legacy: "horizontalPadding" }
] as const;

/**
 * Spacing counts in fives (W8, extended 2026-08-12 — operator: "sizes
 * incremented by 1 that should be 5", on the Slideshow module's margins).
 *
 * A margin that runs 0–160 in ones is 161 options, and the operator was
 * scrolling past 74 numbers to reach 75. Nobody nudges an outer margin by one
 * pixel; the values people actually pick are multiples of five. Button
 * padding (1–50) keeps its 1px steps — that one is the inside of a pill,
 * where a single pixel is visible.
 */
export const MODULE_SPACING_STEP = 5;

/**
 * A spacing box that is not the module's own margin or padding — Navigation's
 * bar padding and its per-link padding, the cell editor's `cell*` keys, the
 * row editor's. Same four sides, same two axes, different key prefix and a
 * qualified noun so two boxes in one panel stay tellable apart.
 */
export type BuilderSpacingBoxSpec = {
  /** Key prefix: `navLinkPadding` → `navLinkPaddingTop`. */
  keyPrefix: string;
  /** Noun in the labels: "Link Padding" → "Top Link Padding" / "V Link Padding". */
  noun: string;
};

export type BuilderSpacingBox = "margin" | "padding" | BuilderSpacingBoxSpec;

export type BuilderSpacingOptions = {
  min?: number;
  max?: number;
  step?: number;
  /**
   * Per-side fallbacks and legacy keys, for a box whose sides do not all
   * default to "0" — the Button module's pill padding ships at 12/24 and
   * falls back to `paddingY`/`paddingX` rather than the retired
   * vertical/horizontal pair.
   */
  sides?: Record<string, { legacy?: string; fallback?: string }>;
};

const SIDE_WORDS = ["Top", "Bottom", "Left", "Right"] as const;

/** The four sides of any box, named and ordered the one way (E4/W7). */
function boxSides(box: BuilderSpacingBox) {
  if (box === "margin") return MODULE_MARGIN_SIDES;
  if (box === "padding") return MODULE_PADDING_SIDES;
  return SIDE_WORDS.map((word) => ({
    key: `${box.keyPrefix}${word}`,
    label: `${word} ${box.noun}`,
    legacy: undefined as string | undefined
  }));
}

/** "Margin" → "V Margin" / "H Margin". */
function boxNoun(box: BuilderSpacingBox) {
  if (box === "margin") return "Margin";
  if (box === "padding") return "Padding";
  return box.noun;
}

/**
 * The two axes of a spacing box — vertical (Top + Bottom) then horizontal
 * (Left + Right), reading the same side order E4 fixed.
 */
export function spacingPairSpecs(
  box: BuilderSpacingBox,
  options: BuilderSpacingOptions = {}
): [BuilderSpacingPairSpec, BuilderSpacingPairSpec] {
  const table = boxSides(box);
  const noun = boxNoun(box);
  const min = options.min ?? 0;
  const max = options.max ?? (box === "margin" ? 80 : 160);
  const step = options.step ?? MODULE_SPACING_STEP;

  const side = (index: number): BuilderSpacingSide => {
    const entry = table[index];
    const override = options.sides?.[entry.key];
    return {
      key: entry.key,
      label: entry.label,
      legacy: override?.legacy ?? entry.legacy,
      fallback: override?.fallback ?? "0"
    };
  };

  return [
    { pairLabel: `V ${noun}`, sides: [side(0), side(1)], min, max, step },
    { pairLabel: `H ${noun}`, sides: [side(2), side(3)], min, max, step }
  ];
}

/** A side's current value: its own key, then its legacy key, then its default. */
export function resolveSpacingSide(
  settings: Record<string, string>,
  side: BuilderSpacingSide
): string {
  const own = settings[side.key];
  if (own !== undefined && own !== "") return own;
  const legacy = side.legacy ? settings[side.legacy] : undefined;
  if (legacy !== undefined && legacy !== "") return legacy;
  return side.fallback;
}

/**
 * Two chain links, joined or broken. Inline SVG rather than a glyph: ⛓ and
 * its friends render at wildly different sizes across fonts, and half of
 * them are emoji-coloured.
 */
function BuilderSpacingLinkIcon({ linked }: { linked: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" height="14" viewBox="0 0 24 24" width="14">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2">
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
        {linked ? <path d="M8 12h8" /> : null}
      </g>
    </svg>
  );
}

type BuilderSpacingPairFieldsProps = {
  spec: BuilderSpacingPairSpec;
  settings: Record<string, string>;
  /** Writes one or both side keys in a single update. */
  onChange: (values: Record<string, string>) => void;
};

/**
 * One axis of a spacing box: a single matched row, or two separate rows.
 *
 * Emits bare `BuilderModuleField`s in a fragment, so the rows join the
 * column's lattice (W0) exactly like every other field. Never wrap these in
 * a div — that is the wrapper that takes one grid cell and knocks the whole
 * column out of its label/control pairing.
 */
export function BuilderSpacingPairFields({ spec, settings, onChange }: BuilderSpacingPairFieldsProps) {
  const [wantsSeparate, setWantsSeparate] = useState(false);
  const [first, second] = spec.sides;
  const firstValue = resolveSpacingSide(settings, first);
  const secondValue = resolveSpacingSide(settings, second);
  // Matched values plus no request to split. Derived, so an undo that pulls
  // the two sides apart shows two rows again on its own.
  const linked = firstValue === secondValue && !wantsSeparate;

  const control = (value: string, onNext: (next: string) => void) => (
    <BuilderNumberSelectControl
      fallback={first.fallback}
      max={spec.max}
      min={spec.min}
      onChange={onNext}
      step={spec.step}
      value={value}
    />
  );

  /**
   * The toggle rides the FIRST row of the axis in both modes — Top, never
   * Bottom. Relinking has to pick a winner, and the row you clicked being
   * the row that survives is the only version of that anyone can predict.
   */
  const toggle = (
    <button
      aria-label={
        linked
          ? `Set ${first.label} and ${second.label} separately`
          : `Match ${first.label} and ${second.label}`
      }
      aria-pressed={linked}
      className="builder-spacing-link-toggle"
      onClick={() => {
        if (linked) {
          setWantsSeparate(true);
          return;
        }
        setWantsSeparate(false);
        // Explicit action, so it writes: the row keeps the number it shows
        // and the other side comes to meet it. Leaving them unequal under a
        // matched label would be the control lying about the page.
        onChange({ [second.key]: firstValue });
      }}
      title={
        linked
          ? `Set ${first.label} and ${second.label} separately`
          : `Match ${first.label} and ${second.label}`
      }
      type="button"
    >
      <BuilderSpacingLinkIcon linked={linked} />
    </button>
  );

  if (linked) {
    return (
      <BuilderModuleField label={spec.pairLabel} width="num">
        {control(firstValue, (next) => onChange({ [first.key]: next, [second.key]: next }))}
        {toggle}
      </BuilderModuleField>
    );
  }

  return (
    <>
      <BuilderModuleField label={first.label} width="num">
        {control(firstValue, (next) => onChange({ [first.key]: next }))}
        {toggle}
      </BuilderModuleField>
      <BuilderModuleField label={second.label} width="num">
        {control(secondValue, (next) => onChange({ [second.key]: next }))}
        {/*
          The toggle's space, kept even on the row that has no toggle. The
          control cell is a shared grid track, so without this the second
          side's dropdown grows into the empty space and sits 28px wider than
          every other number in the column — the stagger W0 exists to stop,
          and one `check_panels` cannot see because it measures the cell
          rather than what is in it.
        */}
        <span aria-hidden="true" className="builder-spacing-link-spacer" />
      </BuilderModuleField>
    </>
  );
}

type BuilderModuleSpacingFieldsProps = BuilderSpacingOptions & {
  box: BuilderSpacingBox;
  settings: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
};

/**
 * A whole spacing box (both axes) for a HAND-WRITTEN strip — the shared
 * module chrome and the panels that copy it. Schema-driven panels get the
 * same rows from `marginFields()` / `paddingFields()`.
 */
export function BuilderModuleSpacingFields({
  box,
  settings,
  onChange,
  ...options
}: BuilderModuleSpacingFieldsProps) {
  return (
    <>
      {spacingPairSpecs(box, options).map((spec) => (
        <BuilderSpacingPairFields key={spec.sides[0].key} onChange={onChange} settings={settings} spec={spec} />
      ))}
    </>
  );
}
