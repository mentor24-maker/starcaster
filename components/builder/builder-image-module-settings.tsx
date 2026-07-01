import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderInlineNumberSelect, BuilderInlineNumberSelectRow } from "./builder-inline-number-select";
import {
  BuilderThemeColorField,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type BuilderImageModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

/**
 * Shared "prime" image controls (alt, size, border, effect) used by both the
 * top-level image module and nested image modules (e.g. inside table cells), so
 * an image gets the same robust treatment wherever it lives.
 */
export function BuilderImageModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: BuilderImageModuleSettingsProps) {
  return (
    <>
      <label className="field">
        <span>Alt text</span>
        <input
          type="text"
          value={module.settings.alt ?? ""}
          onChange={(event) =>
            onUpdateModule((current) => ({ ...current, settings: { ...current.settings, alt: event.target.value } }))
          }
          placeholder="Image description"
        />
      </label>
      <div className="builder-image-controls-grid">
        <label className="field">
          <span>Size</span>
          <select
            value={module.settings.size ?? "100"}
            onChange={(event) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, size: event.target.value } }))
            }
          >
            <option value="10">10%</option>
            <option value="15">15%</option>
            <option value="25">25%</option>
            <option value="33">33%</option>
            <option value="50">50%</option>
            <option value="66">66%</option>
            <option value="75">75%</option>
            <option value="90">90%</option>
            <option value="100">100%</option>
          </select>
        </label>
        <BuilderInlineNumberSelectRow>
          <BuilderInlineNumberSelect
            label="Border thickness"
            value={module.settings.borderThickness ?? "0"}
            min={0}
            max={24}
            fallback="0"
            onChange={(borderThickness) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, borderThickness } }))
            }
          />
          <BuilderInlineNumberSelect
            label="Border radius"
            value={module.settings.borderRadius ?? "18"}
            min={0}
            max={80}
            fallback="18"
            onChange={(borderRadius) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, borderRadius } }))
            }
          />
        </BuilderInlineNumberSelectRow>
        <label className="field">
          <span>Border color</span>
          <BuilderThemeColorField
            dialogLabel="Image border color"
            fallback="#0f4f8f"
            themeColors={themeColors}
            value={module.settings.borderColor ?? "#0f4f8f"}
            onChange={(borderColor) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, borderColor } }))
            }
          />
        </label>
        <label className="field">
          <span>Effect</span>
          <select
            value={module.settings.effect ?? "none"}
            onChange={(event) =>
              onUpdateModule((current) => ({ ...current, settings: { ...current.settings, effect: event.target.value } }))
            }
          >
            <option value="none">None</option>
            <option value="bounce">Bounce</option>
            <option value="fast-bounce">Fast Bounce</option>
            <option value="big-bounce">Big Bounce</option>
            <option value="spin">Spin</option>
            <option value="cruise">Cruise</option>
            <option value="tumbleweed">Tumbleweed</option>
          </select>
        </label>
      </div>
    </>
  );
}
