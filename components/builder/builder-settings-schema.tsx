import type { CSSProperties, ReactNode } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup, type BuilderModuleAlignment } from "./builder-alignment-icon-group";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderProjectDataPicker } from "./builder-project-data-picker";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip, type BuilderModuleFieldWidth } from "./builder-module-field";
import {
  BuilderSpacingPairFields,
  MODULE_MARGIN_SIDES,
  MODULE_PADDING_SIDES,
  spacingPairSpecs,
  type BuilderSpacingBox,
  type BuilderSpacingOptions,
  type BuilderSpacingPairSpec
} from "./builder-spacing-fields";
import {
  BuilderThemeColorControlWithDefault,
  BuilderThemeColorField,
  type BuilderThemePalette
} from "./builder-theme-color-field";

/**
 * Declarative settings schema — doctrine §4 prerequisite 3
 * (docs/MODULE_UI_DOCTRINE.md; proposed in docs/MODULE_SYSTEM_HANDOFF.md §3a).
 *
 * A module DECLARES its settings; the editor is generated. The point is that
 * rules E1 (field strips), E2 (width tokens), E3 (strip order) and E4
 * (H+V margin pairing, via `marginFields`) hold by construction — a
 * schema-driven editor cannot be built out of order or without widths,
 * because the generator owns the markup.
 *
 * Bespoke UI (item managers, rich-text, pickers with their own chrome) drops
 * into a `custom` field, so "this module needs one special control" is never
 * a reason to hand-roll the whole panel.
 */

type SettingsRecord = Record<string, string>;

export type BuilderSchemaFieldContext = {
  module: BuilderTemplateModule;
  settings: SettingsRecord;
  set: (key: string, value: string) => void;
  /**
   * Several settings in ONE update. A matched spacing row writes both of its
   * sides, and two chained `set` calls would be two entries in the undo
   * history for one turn of a dropdown.
   */
  setMany: (values: SettingsRecord) => void;
  themeColors: BuilderThemePalette;
};

type BuilderSchemaFieldBase = {
  /** Settings key this field reads and writes (ignored for `custom`). */
  key: string;
  label: ReactNode;
  /** Width token — doctrine E2. */
  width: BuilderModuleFieldWidth;
  /** Value assumed when the setting is unset. */
  fallback?: string;
  /**
   * The renderer-side consumer (helper or component) that honours this
   * setting — doctrine E7's paper trail. Documentation today; the planned
   * conformance test will assert it.
   */
  rendersVia?: string;
  /** Hide the field when it does not apply (e.g. mega-only controls). */
  visibleWhen?: (settings: SettingsRecord) => boolean;
};

export type BuilderSchemaField = BuilderSchemaFieldBase &
  (
    | { control: "text"; placeholder?: string }
    | { control: "textarea"; rows?: number; placeholder?: string }
    | { control: "select"; options: Array<{ value: string; label: string }> }
    | { control: "number"; min: number; max: number; step?: number }
    | { control: "checkbox"; trueValue?: string; falseValue?: string }
    | { control: "color"; dialogLabel: string }
    | { control: "align"; ariaLabel: string }
    | { control: "image" }
    | {
        /**
         * One axis of a spacing box (E4b): a matched row that writes both
         * sides, with a toggle that splits it into the two side rows. Built
         * by `marginFields()` / `paddingFields()` — a panel never writes one
         * of these by hand, which is how the labels and the side order stay
         * identical everywhere.
         */
        control: "spacing-pair";
        spec: BuilderSpacingPairSpec;
      }
    | {
        /**
         * A THEME OVERRIDE (master rule A1): empty means "follow the
         * theme", and the control shows the theme's value with a reset.
         * Most of these belong in the `advanced` group — the theme should
         * be the path of least resistance, not something every panel
         * invites you to override up front.
         *
         * TEXT COLOUR IS THE EXCEPTION (master rule A6, operator 8/11):
         * it is basic, and it goes on the Text axis with size and weight.
         * The control is the same either way — empty still follows the
         * theme — so being basic does not make it a pre-filled override.
         */
        control: "theme-color";
        /** The value the theme supplies when this setting is empty. */
        themeDefault: string;
        dialogLabel: string;
      }
    | {
        /**
         * Pick from project data (pages / posts / CRM forms) and store the
         * derived value — master rules C1/C2 (fix F6). See
         * builder-project-data-picker.tsx.
         */
        control: "picker";
        source: "pages" | "posts" | "crm-forms";
        valueKind: "path" | "slug" | "id";
        /** Label for the empty-value option ("Current page", "Default"). */
        noneLabel?: string;
        placeholder?: string;
      }
    | {
        control: "custom";
        render: (ctx: BuilderSchemaFieldContext) => ReactNode;
        /**
         * Render the node directly, without the BuilderModuleField label
         * wrapper — for components that carry their own chrome and label
         * (BuilderBackgroundControls, item managers). A bare field must be
         * alone in its strip.
         */
        bare?: boolean;
      }
  );

/** One horizontal strip of fields (wraps when it must — never stretches). */
export type BuilderSchemaStrip = BuilderSchemaField[];

/**
 * A group is either a plain list of strips (the original form — most
 * editors) or an object that adds a visible title and/or distributes its
 * strips across 1–3 equal-width columns.
 *
 * Added 2026-08-09 for master rules D2/D4/D5 (docs/UI_RULES.md): the
 * operator's density rules — "minimize vertical space", "no wasted right
 * side", "rows of 1–3 equal-width columns", "titled groups" — were
 * impossible to express while the generator could only stack strips
 * single-column (the flattening of his 6/28 blog-post-list three-column
 * design was the incident).
 */
export type BuilderSchemaGroup =
  | BuilderSchemaStrip[]
  | {
      /** Visible group heading (D5). Omit for an untitled group. */
      title?: string;
      /**
       * Distribute this group's strips across N equal columns (D4).
       * Strips split into contiguous runs, so declaration order still
       * reads top-to-bottom within each column. Columns wrap to fewer on
       * narrow panels (flex-basis), so nothing crops.
       */
      columns?: 1 | 2 | 3;
      strips: BuilderSchemaStrip[];
    };

/**
 * A logical axis — one titled column of related controls (master rule D8,
 * ratified 2026-08-10). The operator's framing, on Navigation: "the four
 * columns/axes could be Structure / Text / Orientation / Border".
 *
 * Use the canonical titles so a control sits in the same place in every
 * module — that familiarity is the whole point:
 *
 *   Content     what the module shows (text, items, images, links)
 *   Structure   how it is arranged (layout mode, levels, columns, counts)
 *   Text        typography — font, size, weight, transform, colour, TEXT shadow
 *   Placement   alignment, padding, margin, offsets
 *   Frame       border width/radius/colour, BOX shadow
 *   Behavior    triggers, destinations, params (usually `advanced` instead)
 *
 * "Shadow" is split between Text and Frame on purpose (master rule A7):
 * a shadow cast by the letters is typography, a shadow cast by a box is
 * the frame. Read the renderer before filing one — the Heading module's
 * `text-shadow` sat under Frame for a day because this list once said
 * "shadow" unqualified.
 *
 * Four axes is the ceiling; a module that genuinely needs a fifth is a
 * design question for the operator, so the generator throws rather than
 * silently rendering a cramped fifth column. An axis with nothing on it
 * is not an axis — drop it rather than declare a titled empty column.
 */
export type BuilderSchemaAxis = {
  title: string;
  strips: BuilderSchemaStrip[];
  /**
   * Titled sub-sections inside the axis, rendered below its own strips in
   * declaration order. Added 2026-08-11 for Navigation, where the operator
   * asked for a "Dropdown" header partway down the Structure column: the
   * dropdown controls belong to Structure, but they only describe one of
   * the menu types, and an unheaded run of them reads as more of the same.
   *
   * A section whose every field is hidden by `visibleWhen` renders nothing —
   * heading included. Otherwise switching a menu back to List would leave a
   * "Dropdown" heading standing over an empty gap.
   */
  sections?: Array<{ title: string; strips: BuilderSchemaStrip[] }>;
  /**
   * This axis's Advanced controls — theme overrides (A1) and genuinely
   * rare settings. They render in the shared Advanced region BELOW the
   * basic columns, in this axis's own column, so an advanced control
   * sits under the heading it belongs to (operator 8/10: "all controls
   * in the Advanced section should fall under the same columns as the
   * basic settings"). An axis with none contributes no heading.
   */
  advanced?: BuilderSchemaStrip[];
};

export const MAX_AXES = 4;

/**
 * Groups render in doctrine order (E3) no matter how the object is written:
 * content → layout → style → advanced. `advanced` renders inside
 * `<details class="hanging-details">`.
 */
export type BuilderSettingsSchema = {
  /**
   * Logical axes (D8) — each becomes a column, in declaration order.
   * Supersedes the content/layout/style trio for converted modules;
   * `advanced` still renders below, full width.
   */
  axes?: BuilderSchemaAxis[];
  content?: BuilderSchemaGroup;
  layout?: BuilderSchemaGroup;
  style?: BuilderSchemaGroup;
  advanced?: BuilderSchemaGroup;
  /**
   * Arrange the top-level GROUPS side by side (D2): each inner array is
   * one column of group names, columns left→right — so doctrine order
   * (E3) reads left-to-right instead of top-to-bottom. Groups not named
   * render stacked below the columns; `advanced` always renders last,
   * full width. This is the mechanism that restores the operator's 6/28
   * blog-post-list three-column layout.
   *
   * Omitted, the generator DERIVES a sensible arrangement (see
   * derivePanelColumns) — columns are the default, not an opt-in. Pass
   * `[]` to force the old single-column stack.
   */
  panelColumns?: Array<Array<"content" | "layout" | "style">>;
};

const GROUP_ORDER = ["content", "layout", "style", "advanced"] as const;

type BuilderSchemaGroupName = (typeof GROUP_ORDER)[number];

function normalizeGroup(group: BuilderSchemaGroup | undefined): { title?: string; columns: 1 | 2 | 3; strips: BuilderSchemaStrip[] } | null {
  if (!group) return null;
  const normalized = Array.isArray(group) ? { strips: group, columns: 1 as const } : { columns: 1 as const, ...group };
  if (!normalized.strips?.length) return null;
  return normalized;
}

/**
 * A group is "wide" when squeezing it into a column would hurt: it holds a
 * `full`-width field (long text, textarea) or a bare custom block (item
 * managers, notes). Wide groups keep the full panel width; only narrow
 * groups become columns.
 */
function groupIsWide(group: BuilderSchemaGroup | undefined): boolean {
  const normalized = normalizeGroup(group);
  if (!normalized) return false;
  return normalized.strips.some((strip) =>
    strip.some((field) => field.width === "full" || (field.control === "custom" && field.bare))
  );
}

/**
 * Columns by default (master rule D2 — "no wasted right side").
 *
 * Written 2026-08-10 after the operator, looking at a panel that still hugged
 * the left edge, pointed out the obvious: the layout wave had BUILT the
 * column capability and then applied it to 8 panels out of 38. An opt-in
 * layout rule gets forgotten; a default cannot be. Explicit `panelColumns`
 * still wins, and genuinely wide groups stay full width.
 */
type DerivedBlock =
  | { kind: "columns"; names: Array<"content" | "layout" | "style"> }
  | { kind: "full"; name: "content" | "layout" | "style" };

function derivePanelBlocks(schema: BuilderSettingsSchema): DerivedBlock[] {
  const blocks: DerivedBlock[] = [];
  let run: Array<"content" | "layout" | "style"> = [];

  // Doctrine order is not negotiable (E3): walk content → layout → style and
  // group CONSECUTIVE narrow groups into a columns row. A wide group flushes
  // the run and takes the full width in its own place, so nothing is ever
  // reordered to make columns happen.
  const flush = () => {
    if (run.length >= 2) blocks.push({ kind: "columns", names: run });
    else if (run.length === 1) blocks.push({ kind: "full", name: run[0] });
    run = [];
  };

  for (const name of ["content", "layout", "style"] as const) {
    if (!normalizeGroup(schema[name])) continue;
    if (groupIsWide(schema[name])) {
      flush();
      blocks.push({ kind: "full", name });
      continue;
    }
    run.push(name);
  }
  flush();

  return blocks;
}


/**
 * How many settings in a group are currently overriding the theme — a
 * theme-override field counts when it holds a value (empty means "follow
 * the theme"). Drives the Advanced summary badge (master rule A1).
 */
export function countThemeOverrides(strips: BuilderSchemaStrip[], settings: SettingsRecord): number {
  return strips
    .flat()
    .filter((field) => field.control === "theme-color" && (settings[field.key] ?? "") !== "")
    .length;
}

/** Split strips into N contiguous runs — order reads down each column. */
function splitIntoColumns(strips: BuilderSchemaStrip[], columns: number): BuilderSchemaStrip[][] {
  const out: BuilderSchemaStrip[][] = [];
  const per = Math.ceil(strips.length / columns);
  for (let i = 0; i < strips.length; i += per) out.push(strips.slice(i, i + per));
  return out;
}

/**
 * The side tables and the pair control live in `builder-spacing-fields.tsx`
 * now — they are shared with the hand-written strips (the module chrome and
 * the panels that copy it), and importing the generator from there would be
 * a cycle. Re-exported so every existing `from "./builder-settings-schema"`
 * import keeps working.
 */
export {
  MODULE_MARGIN_SIDES,
  MODULE_PADDING_SIDES,
  MODULE_SPACING_STEP,
  spacingPairSpecs,
  BuilderModuleSpacingFields,
  BuilderSpacingPairFields,
  resolveSpacingSide
} from "./builder-spacing-fields";

/**
 * A module's margin controls, always together and in side order — doctrine
 * E4/E4b by construction. Spread the result into a layout strip:
 *   [{ ... }, ...marginFields("getModuleOuterSpacingStyle")]
 * Only for modules whose renderer honours the keys; wiring a control to a
 * setting nothing reads violates E7.
 *
 * Two fields, not four: each is one AXIS of the box, which renders as a
 * single matched row (V Margin) or splits into its two sides on the row's
 * own toggle (E4b). The four side keys are unchanged — see
 * builder-spacing-fields.tsx.
 */
export function marginFields(
  rendersVia: string,
  max = 80,
  options: BuilderSpacingOptions = {}
): BuilderSchemaField[] {
  return spacingFields("margin", rendersVia, { max, ...options });
}

/** A module's padding controls, same shape as `marginFields`. */
export function paddingFields(
  rendersVia: string,
  max = 160,
  options: BuilderSpacingOptions = {}
): BuilderSchemaField[] {
  return spacingFields("padding", rendersVia, { max, ...options });
}

/**
 * The matched rows for ANY spacing box, including one that is not the
 * module's own margin or padding — Navigation's bar padding and its per-link
 * padding both come through here, so a nav panel's four boxes all behave the
 * same way.
 */
export function spacingFields(
  box: BuilderSpacingBox,
  rendersVia: string,
  options: BuilderSpacingOptions = {}
): BuilderSchemaField[] {
  return spacingPairSpecs(box, options).map((spec) => ({
    // The first side's key names the field: it is the one a matched row
    // writes first, and it keeps React keys and `visibleWhen` callers on a
    // real settings key rather than an invented one.
    key: spec.sides[0].key,
    label: spec.pairLabel,
    width: "num" as const,
    control: "spacing-pair" as const,
    spec,
    rendersVia
  }));
}

/**
 * A drop shadow is on for both the current value and the legacy `"on"`.
 *
 * `prefix` names which shadow — a module may have more than one (Navigation
 * casts a `box-shadow` from the bar and a `text-shadow` from the links, and
 * A7 files those on different axes). `defaultOn` is for a shadow that was
 * painted before it was controllable: the menu bar's, which must stay on
 * when the setting is absent or every live menu loses it.
 */
export function dropShadowIsOn(
  settings: SettingsRecord,
  prefix = "dropShadow",
  defaultOn = false
): boolean {
  const value = settings[prefix];
  if (value === undefined || value === "") return defaultOn;
  return value === "true" || value === "on";
}

/**
 * The drop-shadow controls, as ordinary schema fields (master rule C8 — one
 * control for one concept, everywhere).
 *
 * They used to come from `BuilderButtonDropShadowSettings`, a bespoke block
 * built for the Button panel's full width: a two-column grid of
 * label/value rows. Dropped into an axis column it laid out as Colour · Y /
 * X · Blur — scrambled reading order, and Blur's input sat outside the
 * panel entirely, unreachable (operator, 2026-08-11: "the dropshadow
 * controls are currently unusable"). Real fields carry width tokens, so
 * they wrap instead of overflowing (E2/W1).
 *
 * The toggle is a `custom` checkbox rather than a plain `checkbox` field
 * for one reason: headings saved before this control wrote `"on"`, and a
 * declarative checkbox would render those unchecked while the page still
 * painted the shadow.
 */
export function dropShadowFields(
  rendersVia: string,
  options: {
    visibleWhen?: (settings: SettingsRecord) => boolean;
    /**
     * Key prefix, for a module with more than one shadow. `dropShadow` (the
     * default) keeps every existing caller on its existing keys; Navigation
     * passes `navShadow` for the bar and `navTextShadow` for the links.
     */
    prefix?: string;
    /** Overrides "Drop Shadow" when a panel carries two of these. */
    label?: string;
    /** On when the setting is absent — for a shadow that predates its control. */
    defaultOn?: boolean;
    /** Per-part overrides, so a bar shadow can reach further than a letter's. */
    range?: { offset?: number; blur?: number };
    defaults?: { x?: string; y?: string; blur?: string; color?: string };
  } = {}
): BuilderSchemaField[] {
  const gate = options.visibleWhen ?? (() => true);
  const prefix = options.prefix ?? "dropShadow";
  const defaultOn = options.defaultOn ?? false;
  const offset = options.range?.offset ?? 20;
  const blur = options.range?.blur ?? 30;
  const defaults = options.defaults ?? {};
  const detailVisible = (settings: SettingsRecord) =>
    gate(settings) && dropShadowIsOn(settings, prefix, defaultOn);

  return [
    {
      key: prefix,
      label: options.label ?? "Drop Shadow",
      width: "check",
      control: "custom",
      rendersVia,
      visibleWhen: gate,
      render: (ctx) => (
        <input
          type="checkbox"
          checked={dropShadowIsOn(ctx.settings, prefix, defaultOn)}
          onChange={(event) => ctx.set(prefix, event.target.checked ? "true" : "false")}
        />
      )
    },
    {
      key: `${prefix}Color`,
      label: "Shadow Color",
      width: "color",
      control: "color",
      dialogLabel: "Drop shadow color",
      fallback: defaults.color ?? "#000000",
      rendersVia,
      visibleWhen: detailVisible
    },
    {
      key: `${prefix}X`,
      label: "Shadow X",
      width: "num",
      control: "number",
      min: -offset,
      max: offset,
      fallback: defaults.x ?? "3",
      rendersVia,
      visibleWhen: detailVisible
    },
    {
      key: `${prefix}Y`,
      label: "Shadow Y",
      width: "num",
      control: "number",
      min: -offset,
      max: offset,
      fallback: defaults.y ?? "3",
      rendersVia,
      visibleWhen: detailVisible
    },
    {
      key: `${prefix}Blur`,
      label: "Shadow Blur",
      width: "num",
      control: "number",
      min: 0,
      max: blur,
      fallback: defaults.blur ?? "2",
      rendersVia,
      visibleWhen: detailVisible
    }
  ];
}

function renderControl(field: BuilderSchemaField, ctx: BuilderSchemaFieldContext): ReactNode {
  const value = ctx.settings[field.key] ?? field.fallback ?? "";
  switch (field.control) {
    case "text":
      return (
        <input
          type="text"
          value={ctx.settings[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => ctx.set(field.key, event.target.value)}
        />
      );
    case "textarea":
      return (
        <textarea
          className="builder-textarea"
          rows={field.rows ?? 3}
          value={ctx.settings[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => ctx.set(field.key, event.target.value)}
        />
      );
    case "select":
      return (
        <select value={value} onChange={(event) => ctx.set(field.key, event.target.value)}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    case "number":
      return (
        <BuilderNumberSelectControl
          value={value}
          min={field.min}
          max={field.max}
          step={field.step}
          fallback={field.fallback ?? String(field.min)}
          onChange={(next) => ctx.set(field.key, next)}
        />
      );
    case "checkbox": {
      const trueValue = field.trueValue ?? "true";
      return (
        <input
          type="checkbox"
          checked={value === trueValue}
          onChange={(event) => ctx.set(field.key, event.target.checked ? trueValue : field.falseValue ?? "false")}
        />
      );
    }
    case "color":
      return (
        <BuilderThemeColorField
          dialogLabel={field.dialogLabel}
          fallback={field.fallback}
          themeColors={ctx.themeColors}
          value={value}
          onChange={(hex) => ctx.set(field.key, hex)}
          /*
           * Every colour in a panel can be emptied again (master rule C9,
           * 2026-08-12). The picker has always supported a Clear button; the
           * generator simply never passed one, so a colour could be set and
           * never unset — "I can set it to any color I want. I just can't
           * clear it." An empty value renders as transparent.
           */
          onClear={() => ctx.set(field.key, "")}
        />
      );
    case "align":
      return (
        <BuilderAlignmentIconGroup
          value={(value || "left") as BuilderModuleAlignment}
          onChange={(alignment) => ctx.set(field.key, alignment)}
          ariaLabel={field.ariaLabel}
        />
      );
    case "image":
      return (
        <BuilderImagePickerField
          value={ctx.settings[field.key] ?? ""}
          onChange={(url) => ctx.set(field.key, url)}
        />
      );
    case "theme-color":
      return (
        <BuilderThemeColorControlWithDefault
          dialogLabel={field.dialogLabel}
          defaultColor={field.themeDefault}
          themeColors={ctx.themeColors}
          hint="theme"
          value={ctx.settings[field.key] ?? ""}
          onChange={(next) => ctx.set(field.key, next)}
        />
      );
    case "picker":
      return (
        <BuilderProjectDataPicker
          source={field.source}
          valueKind={field.valueKind}
          noneLabel={field.noneLabel}
          placeholder={field.placeholder}
          ariaLabel={typeof field.label === "string" ? field.label : undefined}
          value={ctx.settings[field.key] ?? field.fallback ?? ""}
          onChange={(next) => ctx.set(field.key, next)}
        />
      );
    case "custom":
      return field.render(ctx);
    case "spacing-pair":
      // Handled in renderStrips — a spacing pair emits its OWN fields (one
      // row or two), so it cannot be wrapped in a single BuilderModuleField.
      return null;
  }
}

function renderStrips(strips: BuilderSchemaStrip[], ctx: BuilderSchemaFieldContext) {
  return strips.map((strip, stripIndex) => {
    const visible = strip.filter((field) => !field.visibleWhen || field.visibleWhen(ctx.settings));
    if (!visible.length) return null;
    const bare = visible.find((field) => field.control === "custom" && field.bare);
    if (bare && bare.control === "custom") {
      if (visible.length > 1) {
        throw new Error(`Schema strip ${stripIndex}: a bare custom field must be alone in its strip`);
      }
      // Named so the lattice (W0) can flatten it. An unclassed wrapper here
      // landed in the column grid as a single cell and knocked every row
      // after it out of its label/control pairing — visible as Frame's
      // Background dropping onto its own line below its label.
      return <div className="builder-schema-bare" key={stripIndex}>{bare.render(ctx)}</div>;
    }
    return (
      <BuilderModuleFieldStrip key={stripIndex}>
        {visible.map((field, fieldIndex) =>
          // A spacing pair renders one row or two, so it supplies its own
          // fields rather than sitting inside one (E4b).
          field.control === "spacing-pair" ? (
            <BuilderSpacingPairFields
              key={field.key}
              onChange={ctx.setMany}
              settings={ctx.settings}
              spec={field.spec}
            />
          ) : (
            <BuilderModuleField key={field.control === "custom" ? `custom-${fieldIndex}` : field.key} label={field.label} width={field.width}>
              {renderControl(field, ctx)}
            </BuilderModuleField>
          )
        )}
      </BuilderModuleFieldStrip>
    );
  });
}

type BuilderSchemaModuleSettingsProps = {
  schema: BuilderSettingsSchema;
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
  /** Label on the advanced <details>; "Advanced" unless a clearer word exists. */
  advancedLabel?: string;
};

export function BuilderSchemaModuleSettings({
  schema,
  module,
  onUpdateModule,
  themeColors = [],
  advancedLabel = "Advanced"
}: BuilderSchemaModuleSettingsProps) {
  const ctx: BuilderSchemaFieldContext = {
    module,
    settings: module.settings,
    themeColors,
    set: (key, value) =>
      onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } })),
    setMany: (values) =>
      onUpdateModule((current) => ({ ...current, settings: { ...current.settings, ...values } }))
  };

  function renderGroup(name: BuilderSchemaGroupName) {
    const group = normalizeGroup(schema[name]);
    if (!group) return null;
    if (name === "advanced") {
      // Advanced is where THEME OVERRIDES live (master rule A1). It is
      // collapsed, so an override could hide silently and leave the
      // operator wondering why a themed restyle skipped this module —
      // the summary therefore says how many settings are currently
      // overriding the theme.
      const overrides = countThemeOverrides(group.strips, ctx.settings);
      return (
        <details className="hanging-details builder-schema-advanced" key={name}>
          <summary>
            {group.title ?? advancedLabel}
            {overrides > 0 ? (
              <span className="builder-schema-override-count">
                {overrides} overriding the theme
              </span>
            ) : null}
          </summary>
          {renderStrips(group.strips, ctx)}
        </details>
      );
    }
    const body =
      group.columns > 1 ? (
        <div className="builder-schema-group-columns">
          {splitIntoColumns(group.strips, group.columns).map((columnStrips, index) => (
            <div className="builder-schema-group-column" key={index}>
              {renderStrips(columnStrips, ctx)}
            </div>
          ))}
        </div>
      ) : (
        renderStrips(group.strips, ctx)
      );
    return (
      <div key={name}>
        {group.title ? <div className="builder-schema-group-title">{group.title}</div> : null}
        {body}
      </div>
    );
  }

  // Axes (D8) win when declared: each is a column, in declaration order.
  if (schema.axes?.length) {
    if (schema.axes.length > MAX_AXES) {
      throw new Error(
        `Settings schema declares ${schema.axes.length} axes (${schema.axes
          .map((axis) => axis.title)
          .join(", ")}). The ceiling is ${MAX_AXES} — a fifth axis is a design question for the operator, not a cramped column.`
      );
    }
    const axes = schema.axes;
    const visibleStrips = (strips: BuilderSchemaStrip[] | undefined) =>
      (strips ?? []).filter((strip) =>
        strip.some((field) => !field.visibleWhen || field.visibleWhen(ctx.settings))
      );

    // The Advanced region uses the SAME column track count as the basic
    // row, so an advanced control sits under its own axis heading rather
    // than in a separate full-width block (operator 8/10).
    const axisCount = axes.length;
    const advancedByAxis = axes.map((axis) => visibleStrips(axis.advanced));
    const hasAdvanced = advancedByAxis.some((strips) => strips.length > 0);
    const overrides = advancedByAxis.reduce(
      (total, strips) => total + countThemeOverrides(strips, ctx.settings),
      0
    );
    const trackStyle = { "--builder-axis-count": String(axisCount) } as CSSProperties;

    return (
      <>
        <div className="builder-schema-panel-columns" style={trackStyle}>
          {axes.map((axis) => {
            const visible = visibleStrips(axis.strips);
            const sections = (axis.sections ?? [])
              .map((section) => ({ title: section.title, strips: visibleStrips(section.strips) }))
              .filter((section) => section.strips.length > 0);
            if (!visible.length && !sections.length) {
              return <div className="builder-schema-panel-column" key={axis.title} />;
            }
            return (
              <div className="builder-schema-panel-column" key={axis.title}>
                <div className="builder-schema-group-title">{axis.title}</div>
                {renderStrips(visible, ctx)}
                {sections.map((section) => (
                  <div className="builder-schema-axis-section" key={section.title}>
                    <div className="builder-schema-group-subtitle">{section.title}</div>
                    {renderStrips(section.strips, ctx)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {hasAdvanced ? (
          <details className="hanging-details builder-schema-advanced">
            <summary>
              {advancedLabel}
              {overrides > 0 ? (
                <span className="builder-schema-override-count">{overrides} overriding the theme</span>
              ) : null}
            </summary>
            <div className="builder-schema-panel-columns" style={trackStyle}>
              {axes.map((axis, index) => {
                const strips = advancedByAxis[index];
                // Only axes WITH advanced controls get a heading; the rest
                // hold their column position so the grid stays aligned.
                if (!strips.length) return <div className="builder-schema-panel-column" key={axis.title} />;
                return (
                  <div className="builder-schema-panel-column" key={axis.title}>
                    <div className="builder-schema-group-title">{axis.title}</div>
                    {renderStrips(strips, ctx)}
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}

        {renderGroup("advanced")}
      </>
    );
  }

  function renderColumns(names: Array<"content" | "layout" | "style">, key: string | number) {
    return (
      <div className="builder-schema-panel-columns" key={key}>
        {names.map((name) => (
          <div className="builder-schema-panel-column" key={name}>
            {renderGroup(name)}
          </div>
        ))}
      </div>
    );
  }

  // An explicit panelColumns keeps its documented shape: the named columns
  // first, then anything unnamed, then advanced.
  if (schema.panelColumns) {
    const columnNames = schema.panelColumns.flat();
    const stacked = GROUP_ORDER.filter(
      (name) => name === "advanced" || !columnNames.includes(name as Exclude<BuilderSchemaGroupName, "advanced">)
    );
    return (
      <>
        {schema.panelColumns.length ? (
          <div className="builder-schema-panel-columns">
            {schema.panelColumns.map((names, index) => (
              <div className="builder-schema-panel-column" key={index}>
                {names.map((name) => renderGroup(name))}
              </div>
            ))}
          </div>
        ) : null}
        {stacked.map((name) => renderGroup(name))}
      </>
    );
  }

  return (
    <>
      {derivePanelBlocks(schema).map((block, index) =>
        block.kind === "columns" ? renderColumns(block.names, index) : renderGroup(block.name)
      )}
      {renderGroup("advanced")}
    </>
  );
}
