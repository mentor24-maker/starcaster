import type { BuilderTheme } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import { BUILDER_HEADING_FONTS } from "./builder-utils";

type ThemeUpdater = (updater: (theme: BuilderTheme) => BuilderTheme) => void;

type BuilderThemeTypographySettingsProps = {
  theme: BuilderTheme;
  onChange: ThemeUpdater;
};

/** Common modular-scale ratios; "" = off (headings keep their baseline sizes). */
const SCALE_RATIOS: Array<{ value: string; label: string }> = [
  { value: "", label: "Off" },
  { value: "1.2", label: "Minor third (1.2)" },
  { value: "1.25", label: "Major third (1.25)" },
  { value: "1.333", label: "Perfect fourth (1.333)" },
  { value: "1.5", label: "Perfect fifth (1.5)" }
];

/** Baseline shown in native color inputs when a role is left unset (= inherit). */
const COLOR_PLACEHOLDERS = {
  text: "#214c71",
  heading: "#18324a",
  link: "#0f4f8f",
  linkHover: "#0f4f8f",
  radioAccent: "#0b82d4",
  radioLabel: "#214c71",
  fieldFocus: "#22c55e"
} as const;

export function BuilderThemeTypographySettings({ theme, onChange }: BuilderThemeTypographySettingsProps) {
  const { fonts, colors, scale, forms = {} } = theme.typography;

  function updateFont(role: "heading" | "body", value: string) {
    onChange((current) => ({
      ...current,
      typography: {
        ...current.typography,
        fonts: { ...current.typography.fonts, [role]: value }
      }
    }));
  }

  function updateColor(role: keyof typeof COLOR_PLACEHOLDERS, value: string) {
    onChange((current) => ({
      ...current,
      typography: {
        ...current.typography,
        colors: { ...current.typography.colors, [role]: value }
      }
    }));
  }

  function updateColorFlag(flag: "linkUnderline" | "linkHoverUnderline", value: boolean) {
    onChange((current) => ({
      ...current,
      typography: {
        ...current.typography,
        colors: { ...current.typography.colors, [flag]: value }
      }
    }));
  }

  function updateScale(key: string, value: number) {
    onChange((current) => ({
      ...current,
      typography: {
        ...current.typography,
        scale: { ...current.typography.scale, [key]: value }
      }
    }));
  }

  function updateFormColor(role: keyof Pick<typeof COLOR_PLACEHOLDERS, "radioAccent" | "radioLabel" | "fieldFocus">, value: string) {
    onChange((current) => ({
      ...current,
      typography: {
        ...current.typography,
        forms: { ...(current.typography.forms ?? {}), [role]: value }
      }
    }));
  }

  return (
    <div className="builder-theme-typography">
      <div className="builder-theme-typography-group">
        <h4 className="builder-theme-typography-heading">Fonts</h4>
        <BuilderSettingRow label="Heading font" fullWidth>
          <select value={fonts.heading} onChange={(event) => updateFont("heading", event.target.value)}>
            {BUILDER_HEADING_FONTS.map((font) => (
              <option key={font.key} value={font.key}>
                {font.label}
              </option>
            ))}
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow label="Body font" fullWidth>
          <select value={fonts.body} onChange={(event) => updateFont("body", event.target.value)}>
            {BUILDER_HEADING_FONTS.map((font) => (
              <option key={font.key} value={font.key}>
                {font.label}
              </option>
            ))}
          </select>
        </BuilderSettingRow>
      </div>

      <div className="builder-theme-typography-group">
        <h4 className="builder-theme-typography-heading">Colors</h4>
        {(
          [
            ["text", "Body text"],
            ["heading", "Headings"],
            ["link", "Links"],
            ["linkHover", "Link hover"]
          ] as Array<[keyof typeof COLOR_PLACEHOLDERS, string]>
        ).map(([role, label]) => (
          <BuilderSettingRow key={role} label={label}>
            <span className="builder-theme-color-control">
              <input
                type="color"
                value={colors[role] || COLOR_PLACEHOLDERS[role]}
                onChange={(event) => updateColor(role, event.target.value)}
              />
              {colors[role] ? (
                <button
                  className="builder-theme-color-reset"
                  type="button"
                  onClick={() => updateColor(role, "")}
                >
                  Reset
                </button>
              ) : (
                <span className="builder-theme-color-inherit">Inherit</span>
              )}
            </span>
          </BuilderSettingRow>
        ))}
        <BuilderSettingRow label="Link underline">
          <label className="builder-theme-checkbox-label">
            <input
              type="checkbox"
              checked={colors.linkUnderline !== false}
              onChange={(event) => updateColorFlag("linkUnderline", event.target.checked)}
            />
            <span>Underline links</span>
          </label>
        </BuilderSettingRow>
        <BuilderSettingRow label="Hover underline">
          <label className="builder-theme-checkbox-label">
            <input
              type="checkbox"
              checked={colors.linkHoverUnderline !== false}
              onChange={(event) => updateColorFlag("linkHoverUnderline", event.target.checked)}
            />
            <span>Underline on hover</span>
          </label>
        </BuilderSettingRow>
      </div>

      <div className="builder-theme-typography-group">
        <h4 className="builder-theme-typography-heading">Type scale</h4>
        <BuilderSettingRow label="Base size (px)">
          <input
            type="number"
            min={10}
            max={100}
            step={1}
            value={scale.baseSize || ""}
            placeholder="16"
            onChange={(event) => updateScale("baseSize", Number.parseInt(event.target.value, 10) || 0)}
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Scale ratio">
          <select
            value={scale.ratio ? String(scale.ratio) : ""}
            onChange={(event) => updateScale("ratio", Number.parseFloat(event.target.value) || 0)}
          >
            {SCALE_RATIOS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow label="Line height">
          <input
            type="number"
            min={0.8}
            max={3}
            step={0.05}
            value={scale.baseLineHeight || ""}
            placeholder="1.6"
            onChange={(event) => updateScale("baseLineHeight", Number.parseFloat(event.target.value) || 0)}
          />
        </BuilderSettingRow>
        <div className="builder-theme-scale-col-headers">
          <span className="builder-setting-label" />
          <span className="builder-theme-scale-col-label">Size (px)</span>
          <span className="builder-theme-scale-col-label">Line height</span>
          <span className="builder-theme-scale-col-label">Weight</span>
          <span className="builder-theme-scale-col-label">Top margin (px)</span>
          <span className="builder-theme-scale-col-label">Bottom margin (px)</span>
        </div>
        {(["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((h) => (
          <div key={h} className="builder-theme-scale-dual-row">
            <span className="builder-setting-label">{h.toUpperCase()}</span>
            <input
              type="number"
              min={8}
              max={200}
              step={1}
              value={scale[h] || ""}
              placeholder="Auto"
              onChange={(event) => updateScale(h, Number.parseInt(event.target.value, 10) || 0)}
            />
            <input
              type="number"
              min={0.8}
              max={3}
              step={0.05}
              value={(scale as Record<string, number | undefined>)[`${h}Lh`] || ""}
              placeholder="Auto"
              onChange={(event) => updateScale(`${h}Lh`, Number.parseFloat(event.target.value) || 0)}
            />
            <input
              type="number"
              min={100}
              max={900}
              step={100}
              value={(scale as Record<string, number | undefined>)[`${h}Fw`] || ""}
              placeholder="800"
              onChange={(event) => updateScale(`${h}Fw`, Number.parseInt(event.target.value, 10) || 0)}
            />
            <input
              type="number"
              min={-400}
              max={400}
              step={1}
              value={(scale as Record<string, number | undefined>)[`${h}Mt`] || ""}
              placeholder="Auto"
              onChange={(event) => updateScale(`${h}Mt`, Number.parseInt(event.target.value, 10) || 0)}
            />
            <input
              type="number"
              min={-400}
              max={400}
              step={1}
              value={(scale as Record<string, number | undefined>)[`${h}Mb`] || ""}
              placeholder="Auto"
              onChange={(event) => updateScale(`${h}Mb`, Number.parseInt(event.target.value, 10) || 0)}
            />
          </div>
        ))}
      </div>

      <div className="builder-theme-typography-group">
        <h4 className="builder-theme-typography-heading">Form Controls</h4>
        <p className="builder-theme-typography-note">
          Radio groups and focused inputs in builder forms (e.g. Page Details). Leave unset to inherit palette defaults.
        </p>
        {(
          [
            ["radioAccent", "Radio accent"],
            ["radioLabel", "Radio label"],
            ["fieldFocus", "Field focus ring"]
          ] as Array<[keyof Pick<typeof COLOR_PLACEHOLDERS, "radioAccent" | "radioLabel" | "fieldFocus">, string]>
        ).map(([role, label]) => (
          <BuilderSettingRow key={role} label={label}>
            <span className="builder-theme-color-control">
              <input
                type="color"
                value={forms[role] || COLOR_PLACEHOLDERS[role]}
                onChange={(event) => updateFormColor(role, event.target.value)}
              />
              {forms[role] ? (
                <button
                  className="builder-theme-color-reset"
                  type="button"
                  onClick={() => updateFormColor(role, "")}
                >
                  Reset
                </button>
              ) : (
                <span className="builder-theme-color-inherit">Inherit</span>
              )}
            </span>
          </BuilderSettingRow>
        ))}
      </div>

      <p className="builder-theme-typography-note">
        Theme defaults apply to page content in Preview. Headings and text inherit these unless a
        specific module overrides them.
      </p>
    </div>
  );
}
