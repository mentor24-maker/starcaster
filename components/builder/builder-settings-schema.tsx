import type { CSSProperties, ReactNode } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup, type BuilderModuleAlignment } from "./builder-alignment-icon-group";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderProjectDataPicker } from "./builder-project-data-picker";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip, type BuilderModuleFieldWidth } from "./builder-module-field";
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
         * A THEME OVERRIDE (master rule A1): empty means "follow the
         * theme", and the control shows the theme's value with a reset.
         * These belong in the `advanced` group — the theme should be the
         * path of least resistance, not something every panel invites you
         * to override up front.
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
 *   Text        typography — font, size, weight, transform, text colour
 *   Placement   alignment, padding, margin, offsets
 *   Frame       border width/radius/colour, shadow
 *   Behavior    triggers, destinations, params (usually `advanced` instead)
 *
 * Four axes is the ceiling; a module that genuinely needs a fifth is a
 * design question for the operator, so the generator throws rather than
 * silently rendering a cramped fifth column.
 */
export type BuilderSchemaAxis = {
  title: string;
  strips: BuilderSchemaStrip[];
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
 * The H+V margin pair, always together and adjacent — doctrine E4 by
 * construction. Spread the result into a layout strip:
 *   [{ ... }, ...marginFields("getModuleMarginStyle")]
 * Only for modules whose renderer honours BOTH keys; wiring a control to a
 * setting nothing reads violates E7 (see the heading/current-poll debt note
 * in scripts/check_ui_doctrine.cjs).
 */
export function marginFields(rendersVia: string, max = 80): BuilderSchemaField[] {
  return [
    { key: "verticalMargin", label: "Vertical Margin", width: "num", control: "number", min: 0, max, fallback: "0", rendersVia },
    { key: "horizontalMargin", label: "Horizontal Margin", width: "num", control: "number", min: 0, max, fallback: "0", rendersVia }
  ];
}

/**
 * The four spacing controls, with the only names they are allowed to have
 * (master rule W7, operator 8/10): Vertical Margin, Horizontal Margin,
 * Vertical Padding, Horizontal Padding. Pass only the keys a module
 * actually honours — a control wired to nothing is a C6 violation.
 */
export function spacingFields(
  rendersVia: string,
  keys: Partial<{
    verticalMargin: string;
    horizontalMargin: string;
    verticalPadding: string;
    horizontalPadding: string;
  }>,
  max = 160
): BuilderSchemaField[] {
  const labels: Record<string, string> = {
    verticalMargin: "Vertical Margin",
    horizontalMargin: "Horizontal Margin",
    verticalPadding: "Vertical Padding",
    horizontalPadding: "Horizontal Padding"
  };
  return (["verticalMargin", "horizontalMargin", "verticalPadding", "horizontalPadding"] as const)
    .filter((name) => keys[name])
    .map((name) => ({
      key: keys[name] as string,
      label: labels[name],
      width: "num" as const,
      control: "number" as const,
      min: 0,
      max,
      fallback: "0",
      rendersVia
    }));
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
      return <div key={stripIndex}>{bare.render(ctx)}</div>;
    }
    return (
      <BuilderModuleFieldStrip key={stripIndex}>
        {visible.map((field, fieldIndex) => (
          <BuilderModuleField key={field.control === "custom" ? `custom-${fieldIndex}` : field.key} label={field.label} width={field.width}>
            {renderControl(field, ctx)}
          </BuilderModuleField>
        ))}
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
      onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }))
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
            if (!visible.length) return <div className="builder-schema-panel-column" key={axis.title} />;
            return (
              <div className="builder-schema-panel-column" key={axis.title}>
                <div className="builder-schema-group-title">{axis.title}</div>
                {renderStrips(visible, ctx)}
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
