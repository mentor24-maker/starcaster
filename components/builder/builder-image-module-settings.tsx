import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import {
  BuilderThemeColorField,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type BuilderImageModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const SIZE_OPTIONS = ["10", "15", "25", "33", "50", "66", "75", "90", "100"];

const EFFECT_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "bounce", label: "Bounce" },
  { value: "fast-bounce", label: "Fast Bounce" },
  { value: "big-bounce", label: "Big Bounce" },
  { value: "spin", label: "Spin" },
  { value: "cruise", label: "Cruise" },
  { value: "tumbleweed", label: "Tumbleweed" }
];

/**
 * Shared "prime" image controls, used by the image module and by nested
 * images (e.g. inside table cells), so an image gets the same treatment
 * wherever it lives.
 *
 * REFERENCE IMPLEMENTATION for the settings-editor layout standard —
 * see "Settings editor layout" in docs/MODULE_STANDARDS.md. Strips run
 * content → layout → style → advanced, every control declares a width
 * token, and every setting here is honoured by the renderer
 * (`getImageModuleStyle` / `BuilderImagePreview`).
 */
export function BuilderImageModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: BuilderImageModuleSettingsProps) {
  const set = (key: string, value: string) =>
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  return (
    <>
      {/* Content */}
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Alt text" width="full">
          <input
            type="text"
            value={module.settings.alt ?? ""}
            onChange={(event) => set("alt", event.target.value)}
            placeholder="Describe the image for screen readers"
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      {/* Layout */}
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Width" width="select-sm">
          <select value={module.settings.size ?? "100"} onChange={(event) => set("size", event.target.value)}>
            {SIZE_OPTIONS.map((value) => (
              <option key={value} value={value}>{`${value}%`}</option>
            ))}
          </select>
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      {/* Style */}
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Border" width="num">
          <BuilderNumberSelectControl
            value={module.settings.borderThickness ?? "0"}
            min={0}
            max={24}
            fallback="0"
            onChange={(borderThickness) => set("borderThickness", borderThickness)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Radius" width="num">
          <BuilderNumberSelectControl
            value={module.settings.borderRadius ?? "18"}
            min={0}
            max={80}
            fallback="18"
            onChange={(borderRadius) => set("borderRadius", borderRadius)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Border Color" width="color">
          <BuilderThemeColorField
            dialogLabel="Image border color"
            fallback="#0f4f8f"
            themeColors={themeColors}
            value={module.settings.borderColor ?? "#0f4f8f"}
            onChange={(borderColor) => set("borderColor", borderColor)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Effect" width="select-md">
          <select value={module.settings.effect ?? "none"} onChange={(event) => set("effect", event.target.value)}>
            {EFFECT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </BuilderModuleField>
      </BuilderModuleFieldStrip>
    </>
  );
}
