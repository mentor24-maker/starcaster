import type { ReactNode } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup, type BuilderModuleAlignment } from "./builder-alignment-icon-group";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip, type BuilderModuleFieldWidth } from "./builder-module-field";
import { BuilderThemeColorField, type BuilderThemePalette } from "./builder-theme-color-field";

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
 * Groups render in doctrine order (E3) no matter how the object is written:
 * content → layout → style → advanced. `advanced` renders inside
 * `<details class="hanging-details">`.
 */
export type BuilderSettingsSchema = {
  content?: BuilderSchemaStrip[];
  layout?: BuilderSchemaStrip[];
  style?: BuilderSchemaStrip[];
  advanced?: BuilderSchemaStrip[];
};

const GROUP_ORDER = ["content", "layout", "style", "advanced"] as const;

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
    { key: "horizontalMargin", label: "H Margin", width: "num", control: "number", min: 0, max, fallback: "0", rendersVia },
    { key: "verticalMargin", label: "V Margin", width: "num", control: "number", min: 0, max, fallback: "0", rendersVia }
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

  return (
    <>
      {GROUP_ORDER.map((group) => {
        const strips = schema[group];
        if (!strips?.length) return null;
        if (group === "advanced") {
          return (
            <details className="hanging-details" key={group}>
              <summary>{advancedLabel}</summary>
              {renderStrips(strips, ctx)}
            </details>
          );
        }
        return <div key={group}>{renderStrips(strips, ctx)}</div>;
      })}
    </>
  );
}
