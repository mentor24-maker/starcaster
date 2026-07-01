"use client";

import { useId, useState } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import {
  BACKGROUND_STYLE_PRESETS,
  getBuilderBackgroundLayerOpacity,
  getBuilderBackgroundStyle,
  normalizeBuilderAssetUrl
} from "@/lib/builder-template";
import { clampBuilderOpacity } from "@/lib/builder-hex-color";
import { BuilderEditorPopup } from "./builder-editor-popup";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorPickerContent } from "./builder-theme-color-picker-content";

const buttonBackgroundModes = [
  { value: "color", label: "Color" },
  { value: "gradient", label: "Gradient" },
  { value: "image", label: "Image" },
  { value: "style", label: "Style" }
] as const;

type ButtonBackgroundMode = (typeof buttonBackgroundModes)[number]["value"];

type BuilderButtonBackgroundPickerProps = {
  background: BackgroundSettings;
  onChange: (background: BackgroundSettings) => void;
  onChooseImage?: () => void;
  onUploadImage?: (file: File | null) => void;
  themeColors?: Array<{ label: string; hex: string }>;
  /** Popup title (e.g. "Page Background" in theme Styles). */
  dialogTitle?: string;
};

export function BuilderButtonBackgroundPicker({
  background,
  onChange,
  onChooseImage,
  onUploadImage,
  themeColors = [],
  dialogTitle = "Background",
}: BuilderButtonBackgroundPickerProps) {
  const popupId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const activeMode: ButtonBackgroundMode =
    background.mode === "none" ? "color" : (background.mode as ButtonBackgroundMode);
  const opacity = clampBuilderOpacity(background.opacity);
  const swatchBaseStyle =
    getBuilderBackgroundStyle(background) ?? {
      background: background.color || "#214c71"
    };
  const layerOpacity = getBuilderBackgroundLayerOpacity(background);
  const swatchStyle = layerOpacity < 1 ? { ...swatchBaseStyle, opacity: layerOpacity } : swatchBaseStyle;

  function commitBackground(patch: Partial<BackgroundSettings>) {
    const nextMode =
      patch.mode ??
      (background.mode === "none" ? activeMode : background.mode);
    onChange({
      ...background,
      ...patch,
      mode: nextMode
    });
  }

  function setMode(mode: ButtonBackgroundMode) {
    if (mode === background.mode) {
      return;
    }

    if (mode === "color") {
      onChange({
        mode: "color",
        color: background.color || "#214c71",
        color2: background.color2 || "#eaf4ff",
        imageUrl: "",
        styleKey: "",
        opacity
      });
      return;
    }

    if (mode === "gradient") {
      onChange({
        mode: "gradient",
        color: background.color || "#214c71",
        color2: background.color2 || "#eaf4ff",
        imageUrl: "",
        styleKey: "",
        opacity
      });
      return;
    }

    if (mode === "image") {
      onChange({
        mode: "image",
        color: background.color || "#214c71",
        color2: background.color2 || "#eaf4ff",
        imageUrl: background.imageUrl,
        styleKey: "",
        opacity
      });
      return;
    }

    onChange({
      mode: "style",
      color: background.color || "#214c71",
      color2: background.color2 || "#eaf4ff",
      imageUrl: "",
      styleKey: background.styleKey || "",
      opacity
    });
  }

  return (
    <div className="builder-button-background-picker">
      <button
        aria-controls={popupId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="builder-button-background-swatch"
        onClick={() => setIsOpen((current) => !current)}
        style={swatchStyle}
        title="Edit button background"
        type="button"
      />
      {isOpen ? (
        <BuilderEditorPopup
          ariaLabel="Button background"
          className="builder-theme-color-popup"
          id={popupId}
          onClose={() => setIsOpen(false)}
          title={dialogTitle}
        >
          <div className="builder-button-background-mode-tabs" role="tablist" aria-label={`${dialogTitle} type`}>
            {buttonBackgroundModes.map((mode) => (
              <button
                key={mode.value}
                aria-selected={activeMode === mode.value}
                className={
                  activeMode === mode.value
                    ? "builder-button-background-mode-tab builder-button-background-mode-tab-active"
                    : "builder-button-background-mode-tab"
                }
                onClick={() => setMode(mode.value)}
                role="tab"
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="builder-button-background-popup-body">
            {activeMode === "color" ? (
              <BuilderThemeColorPickerContent
                fallback="#214c71"
                themeColors={themeColors}
                value={background.color}
                onChange={(color) => commitBackground({ color, mode: "color" })}
              />
            ) : null}

            {activeMode === "gradient" ? (
              <>
                <BuilderSettingRow label="Color 1" fullWidth>
                  <BuilderThemeColorPickerContent
                    fallback="#214c71"
                    themeColors={themeColors}
                    value={background.color}
                    onChange={(color) => commitBackground({ color, mode: "gradient" })}
                  />
                </BuilderSettingRow>
                <BuilderSettingRow label="Color 2" fullWidth>
                  <BuilderThemeColorPickerContent
                    fallback="#eaf4ff"
                    themeColors={themeColors}
                    value={background.color2}
                    onChange={(color2) => commitBackground({ color2, mode: "gradient" })}
                  />
                </BuilderSettingRow>
              </>
            ) : null}

            {activeMode === "image" ? (
              <>
                <BuilderSettingRow label="Image URL" fullWidth>
                  <input
                    type="text"
                    value={background.imageUrl}
                    onChange={(event) =>
                      commitBackground({
                        imageUrl: normalizeBuilderAssetUrl(event.target.value),
                        mode: "image"
                      })
                    }
                    placeholder="https://... or /api/admin/media-file/..."
                  />
                </BuilderSettingRow>
                <div className="builder-media-actions">
                  {onChooseImage ? (
                    <button className="secondary-button builder-gallery-button" onClick={onChooseImage} type="button">
                      Choose From Gallery
                    </button>
                  ) : null}
                  {onUploadImage ? (
                    <label className="secondary-button builder-gallery-button builder-upload-button">
                      <span>Upload To Gallery</span>
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
              </>
            ) : null}

            {activeMode === "style" ? (
              <BuilderSettingRow label="Style" fullWidth>
                <select
                  value={background.styleKey}
                  onChange={(event) =>
                    commitBackground({
                      styleKey: event.target.value as BackgroundSettings["styleKey"],
                      mode: "style"
                    })
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

            <BuilderSettingRow label="Opacity" fullWidth>
              <span className="builder-background-opacity-row">
                <input
                  max={100}
                  min={0}
                  onChange={(event) =>
                    commitBackground({
                      opacity: clampBuilderOpacity(event.target.value),
                      mode: background.mode === "none" ? activeMode : background.mode
                    })
                  }
                  step={1}
                  type="range"
                  value={opacity}
                />
                <span className="builder-background-opacity-value">{opacity}%</span>
              </span>
            </BuilderSettingRow>

            <div className="builder-button-background-popup-actions">
              <button className="submit-button" onClick={() => setIsOpen(false)} type="button">
                Done
              </button>
            </div>

            <BuilderSettingRow label="Reset">
              <button
                className="secondary-button"
                onClick={() =>
                  onChange({
                    mode: "color",
                    color: "#214c71",
                    color2: "#eaf4ff",
                    imageUrl: "",
                    styleKey: "",
                    opacity: 100
                  })
                }
                type="button"
              >
                Default
              </button>
            </BuilderSettingRow>
          </div>
        </BuilderEditorPopup>
      ) : null}
    </div>
  );
}
