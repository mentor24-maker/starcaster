"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import {
  BACKGROUND_STYLE_PRESETS,
  getBuilderBackgroundStyle,
  normalizeBuilderAssetUrl
} from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

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
};

export function BuilderButtonBackgroundPicker({
  background,
  onChange,
  onChooseImage,
  onUploadImage
}: BuilderButtonBackgroundPickerProps) {
  const popupId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const activeMode: ButtonBackgroundMode =
    background.mode === "none" ? "color" : (background.mode as ButtonBackgroundMode);
  const swatchStyle =
    getBuilderBackgroundStyle(background) ?? {
      background: background.color || "#214c71"
    };

  function updateBackground(updater: (current: BackgroundSettings) => BackgroundSettings) {
    onChange(updater(background));
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
        styleKey: ""
      });
      return;
    }

    if (mode === "gradient") {
      onChange({
        mode: "gradient",
        color: background.color || "#214c71",
        color2: background.color2 || "#eaf4ff",
        imageUrl: "",
        styleKey: ""
      });
      return;
    }

    if (mode === "image") {
      onChange({
        mode: "image",
        color: background.color || "#214c71",
        color2: background.color2 || "#eaf4ff",
        imageUrl: background.imageUrl,
        styleKey: ""
      });
      return;
    }

    onChange({
      mode: "style",
      color: background.color || "#214c71",
      color2: background.color2 || "#eaf4ff",
      imageUrl: "",
      styleKey: background.styleKey || ""
    });
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="builder-button-background-picker" ref={rootRef}>
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
        <div className="builder-button-background-popup" id={popupId} role="dialog" aria-label="Button background">
          <div className="builder-button-background-mode-tabs" role="tablist" aria-label="Background type">
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
              <BuilderSettingRow label="Color" fullWidth>
                <input
                  type="color"
                  value={background.color}
                  onChange={(event) =>
                    updateBackground((current) => ({ ...current, color: event.target.value }))
                  }
                />
              </BuilderSettingRow>
            ) : null}

            {activeMode === "gradient" ? (
              <>
                <BuilderSettingRow label="Color 1" fullWidth>
                  <input
                    type="color"
                    value={background.color}
                    onChange={(event) =>
                      updateBackground((current) => ({ ...current, color: event.target.value }))
                    }
                  />
                </BuilderSettingRow>
                <BuilderSettingRow label="Color 2" fullWidth>
                  <input
                    type="color"
                    value={background.color2}
                    onChange={(event) =>
                      updateBackground((current) => ({ ...current, color2: event.target.value }))
                    }
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
                      updateBackground((current) => ({
                        ...current,
                        imageUrl: normalizeBuilderAssetUrl(event.target.value)
                      }))
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
                    updateBackground((current) => ({
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

            <BuilderSettingRow label="Reset">
              <button
                className="secondary-button"
                onClick={() =>
                  onChange({
                    mode: "color",
                    color: "#214c71",
                    color2: "#eaf4ff",
                    imageUrl: "",
                    styleKey: ""
                  })
                }
                type="button"
              >
                Default
              </button>
            </BuilderSettingRow>
          </div>
        </div>
      ) : null}
    </div>
  );
}
