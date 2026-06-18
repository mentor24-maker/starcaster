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
  linkHover: "#0f4f8f"
} as const;

export function BuilderThemeTypographySettings({ theme, onChange }: BuilderThemeTypographySettingsProps) {
  const { fonts, colors, scale } = theme.typography;

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

  function updateScale(key: "baseSize" | "ratio" | "baseLineHeight", value: number) {
    onChange((current) => ({
      ...current,
      typography: {
        ...current.typography,
        scale: { ...current.typography.scale, [key]: value }
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
        {(["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((h) => (
          <BuilderSettingRow key={h} label={`${h.toUpperCase()} size (px)`}>
            <input
              type="number"
              min={8}
              max={200}
              step={1}
              value={scale[h] || ""}
              placeholder="Auto"
              onChange={(event) => {
                const val = Number.parseInt(event.target.value, 10) || 0;
                onChange((current) => ({
                  ...current,
                  typography: {
                    ...current.typography,
                    scale: { ...current.typography.scale, [h]: val }
                  }
                }));
              }}
            />
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
