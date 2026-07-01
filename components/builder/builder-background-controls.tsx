import { useState } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import {
  BACKGROUND_STYLE_PRESETS,
  createDefaultBackgroundSettings,
  normalizeBuilderAssetUrl
} from "@/lib/builder-template";
import { BuilderGalleryModal } from "./builder-gallery-modal";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorField } from "./builder-theme-color-field";

type BuilderBackgroundControlsProps = {
  label: string;
  background: BackgroundSettings;
  onChange: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onChooseImage?: () => void;
  onUploadImage?: (file: File | null) => void;
  compact?: boolean;
  horizontal?: boolean;
  hideModeRow?: boolean;
  hideClear?: boolean;
  /** When false, compact row uses the outer `label` on the mode field only (e.g. Page Details). */
  showColorFieldLabel?: boolean;
  /** Theme palette — used to seed defaults when the user first picks a mode (not shell background). */
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
  themeColors?: Array<{ label: string; hex: string }>;
};

export function BuilderBackgroundControls({
  label,
  background,
  onChange,
  onChooseImage,
  onUploadImage,
  compact = false,
  horizontal = false,
  hideModeRow = false,
  hideClear = false,
  showColorFieldLabel = true,
  themeBackgroundColor,
  themePrimaryColor,
  themeColors = []
}: BuilderBackgroundControlsProps) {
  const [isFallbackGalleryOpen, setIsFallbackGalleryOpen] = useState(false);

  function handleModeChange(newMode: BackgroundSettings["mode"]) {
    onChange((current) => {
      const next = { ...current, mode: newMode };
      if (newMode === "color" && themeBackgroundColor) {
        next.color = themeBackgroundColor;
      } else if (newMode === "gradient") {
        if (themePrimaryColor) next.color = themePrimaryColor;
        next.color2 = "#ffffff";
      }
      return next;
    });
  }

  // When no external gallery callback is wired (e.g. cell/page/poll
  // backgrounds), fall back to the standard self-contained gallery picker so
  // backgrounds are chosen the same way as every other image.
  function renderBackgroundGalleryAction() {
    if (onChooseImage) {
      return (
        <button className="secondary-button builder-gallery-button" onClick={onChooseImage} type="button">
          Choose Background Image
        </button>
      );
    }

    return (
      <button
        className="secondary-button builder-gallery-button"
        onClick={() => setIsFallbackGalleryOpen(true)}
        type="button"
      >
        Choose From Gallery
      </button>
    );
  }

  const fallbackGallery = isFallbackGalleryOpen ? (
    <BuilderGalleryModal
      isUploading={false}
      onSelectImage={(path) => {
        onChange((current) => ({ ...current, imageUrl: normalizeBuilderAssetUrl(path) }));
        setIsFallbackGalleryOpen(false);
      }}
      onClose={() => setIsFallbackGalleryOpen(false)}
    />
  ) : null;

  if (horizontal) {
    return (
      <div className="builder-background-controls builder-background-controls-horizontal">
        {!hideModeRow ? (
          <BuilderSettingRow label={label} fullWidth>
            <select
              value={background.mode}
              onChange={(event) => handleModeChange(event.target.value as BackgroundSettings["mode"])}
            >
              <option value="none">None</option>
              <option value="color">Color</option>
              <option value="gradient">Gradient</option>
              <option value="image">Image</option>
              <option value="style">Style</option>
            </select>
          </BuilderSettingRow>
        ) : null}

        {background.mode === "color" || background.mode === "gradient" ? (
          <BuilderSettingRow label="Primary color" fullWidth>
            <BuilderThemeColorField
              fallback="#ffffff"
              themeColors={themeColors}
              value={background.color}
              opacity={background.opacity}
              onChangeOpacity={(opacity) => onChange((current) => ({ ...current, opacity }))}
              onClear={() => onChange((current) => ({ ...current, mode: "none" }))}
              onChange={(color) =>
                onChange((current) => ({
                  ...current,
                  color
                }))
              }
            />
          </BuilderSettingRow>
        ) : null}

        {background.mode === "gradient" ? (
          <BuilderSettingRow label="Secondary color" fullWidth>
            <BuilderThemeColorField
              fallback="#eaf4ff"
              themeColors={themeColors}
              value={background.color2}
              onChange={(color2) =>
                onChange((current) => ({
                  ...current,
                  color2
                }))
              }
            />
          </BuilderSettingRow>
        ) : null}

        {background.mode === "style" ? (
          <BuilderSettingRow label="Style" fullWidth>
            <select
              value={background.styleKey}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  styleKey: event.target.value as BackgroundSettings["styleKey"]
                }))
              }
            >
              <option value="">Choose a style</option>
              {BACKGROUND_STYLE_PRESETS.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </BuilderSettingRow>
        ) : null}

        {background.mode === "image" ? (
          <>
            <BuilderSettingRow label="Background image URL" fullWidth>
              <input
                type="text"
                value={background.imageUrl}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    imageUrl: normalizeBuilderAssetUrl(event.target.value)
                  }))
                }
                placeholder="https://... or /api/admin/media-file/..."
              />
            </BuilderSettingRow>
            <div className="builder-media-actions">
              {renderBackgroundGalleryAction()}
              {onUploadImage ? (
                <label className="secondary-button builder-gallery-button builder-upload-button">
                  <span>Upload Background</span>
                  <input
                    className="builder-upload-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      onUploadImage(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
            {fallbackGallery}
          </>
        ) : null}

        {!hideClear && background.mode !== "none" ? (
          <BuilderSettingRow label="Clear background">
            <button
              className="secondary-button"
              onClick={() => onChange(() => createDefaultBackgroundSettings())}
              type="button"
            >
              Clear
            </button>
          </BuilderSettingRow>
        ) : null}
      </div>
    );
  }

  return (
    <div className="builder-background-controls">
      <div className={compact ? "builder-background-inline-row" : undefined}>
        <label className="field">
          <span>{label}</span>
          <select
            value={background.mode}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                mode: event.target.value as BackgroundSettings["mode"]
              }))
            }
          >
            <option value="none">None</option>
            <option value="color">Color</option>
            <option value="gradient">Gradient</option>
            <option value="image">Image</option>
            <option value="style">Style</option>
          </select>
        </label>

        {background.mode === "color" || background.mode === "gradient" ? (
          <label className="field builder-background-inline-color-field">
            {showColorFieldLabel ? <span>Primary color</span> : null}
            <BuilderThemeColorField
              fallback="#ffffff"
              themeColors={themeColors}
              value={background.color}
              opacity={background.opacity}
              onChangeOpacity={(opacity) => onChange((current) => ({ ...current, opacity }))}
              onClear={() => onChange((current) => ({ ...current, mode: "none" }))}
              onChange={(color) =>
                onChange((current) => ({
                  ...current,
                  color
                }))
              }
            />
          </label>
        ) : null}

        {background.mode === "gradient" ? (
          <label className="field builder-background-inline-color-field">
            <span>Secondary color</span>
            <BuilderThemeColorField
              fallback="#eaf4ff"
              themeColors={themeColors}
              value={background.color2}
              onChange={(color2) =>
                onChange((current) => ({
                  ...current,
                  color2
                }))
              }
            />
          </label>
        ) : null}

        {background.mode === "style" ? (
          <label className="field builder-background-inline-style-field">
            <span>Style</span>
            <select
              value={background.styleKey}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  styleKey: event.target.value as BackgroundSettings["styleKey"]
                }))
              }
            >
              <option value="">Choose a style</option>
              {BACKGROUND_STYLE_PRESETS.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!hideClear && background.mode !== "none" ? (
          <div className="builder-background-inline-action">
            <button
              className="secondary-button"
              onClick={() => onChange(() => createDefaultBackgroundSettings())}
              type="button"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {background.mode === "image" ? (
        <div className="builder-section-background-controls">
          <label className="field">
            <span>Background image URL</span>
            <input
              type="text"
              value={background.imageUrl}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  imageUrl: normalizeBuilderAssetUrl(event.target.value)
                }))
              }
              placeholder="https://... or /api/admin/media-file/..."
            />
          </label>
          <div className="builder-media-actions">
            {renderBackgroundGalleryAction()}
            {onUploadImage ? (
              <label className="secondary-button builder-gallery-button builder-upload-button">
                <span>Upload Background</span>
                <input
                  className="builder-upload-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    onUploadImage(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
          {fallbackGallery}
        </div>
      ) : null}
    </div>
  );
}
