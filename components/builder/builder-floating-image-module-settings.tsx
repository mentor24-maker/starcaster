import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import {
  GAME_FLOATING_IMAGE_DURATION_OPTIONS,
  getGameFloatingImageDurationSelectValue,
  normalizeGameFloatingImageDurationMs
} from "@/lib/game-floating-image-trigger";
import { isGameModuleTrigger } from "@/lib/module-trigger";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type BuilderFloatingImageModuleSettingsProps = {
  module: BuilderTemplateModule;
  onOpenGallery?: () => void;
  onUploadMedia?: (file: File | null) => void;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const OVERLAY_ANCHOR_OPTIONS = [
  { value: "center", label: "Center" },
  { value: "top-left", label: "Top Left" },
  { value: "top-center", label: "Top Center" },
  { value: "top-right", label: "Top Right" },
  { value: "center-left", label: "Center Left" },
  { value: "center-right", label: "Center Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-center", label: "Bottom Center" },
  { value: "bottom-right", label: "Bottom Right" }
] as const;

const SIZE_OPTIONS = ["10", "15", "25", "33", "50", "66", "75", "100"] as const;

const EFFECT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bounce", label: "Bounce" },
  { value: "fast-bounce", label: "Fast Bounce" },
  { value: "big-bounce", label: "Big Bounce" },
  { value: "spin", label: "Spin" },
  { value: "cruise", label: "Cruise" },
  { value: "tumbleweed", label: "Tumbleweed" }
] as const;

export function BuilderFloatingImageModuleSettings({
  module,
  onOpenGallery,
  onUploadMedia,
  onUpdateModule,
  themeColors = []
}: BuilderFloatingImageModuleSettingsProps) {
  const durationValue = getGameFloatingImageDurationSelectValue(module.settings);
  const showGameDuration = isGameModuleTrigger(module.settings);

  function updateSettings(updates: Record<string, string>) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, ...updates }
    }));
  }

  return (
    <div className="builder-floating-image-module-settings">
      {showGameDuration ? (
        <BuilderSettingRow fullWidth label="Duration">
          <select
            value={durationValue}
            onChange={(event) =>
              updateSettings({ durationMs: normalizeGameFloatingImageDurationMs(event.target.value) })
            }
          >
            {GAME_FLOATING_IMAGE_DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </BuilderSettingRow>
      ) : null}

      <BuilderSettingRow fullWidth label="URL">
        <input
          placeholder="https://..."
          type="text"
          value={module.settings.url ?? ""}
          onChange={(event) =>
            updateSettings({ url: normalizeBuilderAssetUrl(event.target.value) })
          }
        />
      </BuilderSettingRow>

      {onOpenGallery || onUploadMedia ? (
        <BuilderSettingRow fullWidth label="Media">
          <div className="builder-media-actions">
            {onOpenGallery ? (
              <button className="secondary-button builder-gallery-button" onClick={onOpenGallery} type="button">
                Choose From Gallery
              </button>
            ) : null}
            {onUploadMedia ? (
              <label className="secondary-button builder-gallery-button builder-upload-button">
                <span>Upload To Gallery</span>
                <input
                  accept="image/*,video/*"
                  className="builder-upload-input"
                  type="file"
                  onChange={(event) => {
                    onUploadMedia(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
        </BuilderSettingRow>
      ) : null}

      <BuilderSettingRow fullWidth label="Alt Text">
        <input
          placeholder="Image description"
          type="text"
          value={module.settings.alt ?? ""}
          onChange={(event) => updateSettings({ alt: event.target.value })}
        />
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="Size">
        <select
          value={module.settings.size ?? "15"}
          onChange={(event) => updateSettings({ size: event.target.value })}
        >
          {SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}%
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="Anchor">
        <select
          value={module.settings.overlayAnchor ?? "center"}
          onChange={(event) => updateSettings({ overlayAnchor: event.target.value })}
        >
          {OVERLAY_ANCHOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="Border Thickness">
        <BuilderNumberSelectControl
          fallback="0"
          max={24}
          min={0}
          value={module.settings.borderThickness ?? "0"}
          onChange={(borderThickness) => updateSettings({ borderThickness })}
        />
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="Border Radius">
        <BuilderNumberSelectControl
          fallback="18"
          max={80}
          min={0}
          value={module.settings.borderRadius ?? "18"}
          onChange={(borderRadius) => updateSettings({ borderRadius })}
        />
      </BuilderSettingRow>

      <BuilderThemeColorSettingRow
        fullWidth
        fallback="#0f4f8f"
        label="Border Color"
        themeColors={themeColors}
        value={module.settings.borderColor ?? "#0f4f8f"}
        onChange={(borderColor) => updateSettings({ borderColor })}
      />

      <BuilderSettingRow fullWidth label="Effect">
        <select
          value={module.settings.effect ?? "none"}
          onChange={(event) => updateSettings({ effect: event.target.value })}
        >
          {EFFECT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="X Offset">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            value={module.settings.offsetX ?? "0"}
            onChange={(event) => updateSettings({ offsetX: event.target.value })}
          />
          <span className="builder-module-offset-hint">Positive moves right; negative moves left.</span>
        </div>
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="Y Offset">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            value={module.settings.offsetY ?? "0"}
            onChange={(event) => updateSettings({ offsetY: event.target.value })}
          />
          <span className="builder-module-offset-hint">Positive moves up; negative moves down.</span>
        </div>
      </BuilderSettingRow>

      <BuilderSettingRow fullWidth label="Z-Index">
        <div className="builder-setting-value-stack">
          <input
            max={999999}
            min={-999}
            step={1}
            type="number"
            value={module.settings.zIndex ?? "20"}
            onChange={(event) => updateSettings({ zIndex: event.target.value })}
          />
          <span className="builder-module-offset-hint">
            Higher values stack in front (e.g. 50–100 above page content). Lower values stack behind.
          </span>
        </div>
      </BuilderSettingRow>

      <BuilderModuleOffsetFields
        horizontalOffset={module.settings.horizontalOffset ?? "0"}
        verticalOffset={module.settings.verticalOffset ?? "0"}
        onHorizontalOffsetChange={(horizontalOffset) => updateSettings({ horizontalOffset })}
        onVerticalOffsetChange={(verticalOffset) => updateSettings({ verticalOffset })}
      />
    </div>
  );
}
