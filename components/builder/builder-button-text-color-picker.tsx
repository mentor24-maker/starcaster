"use client";

import { useId, useState } from "react";
import { BuilderEditorPopup } from "./builder-editor-popup";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorField } from "./builder-theme-color-field";

export type ButtonTextColorSettings = {
  color: string;
  hoverColor: string;
};

const textColorTabs = [
  { value: "color", label: "Color" },
  { value: "hover", label: "Hover" }
] as const;

type TextColorTab = (typeof textColorTabs)[number]["value"];

type BuilderButtonTextColorPickerProps = {
  colors: ButtonTextColorSettings;
  onChange: (colors: ButtonTextColorSettings) => void;
  themeColors?: Array<{ label: string; hex: string }>;
};

export function getButtonTextColorSettings(settings: Record<string, string>): ButtonTextColorSettings {
  return {
    color: settings.textColor || "#ffffff",
    hoverColor: settings.textHoverColor || "#ffffff"
  };
}

export function BuilderButtonTextColorPicker({
  colors,
  onChange,
  themeColors = []
}: BuilderButtonTextColorPickerProps) {
  const popupId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TextColorTab>("color");

  return (
    <div className="builder-button-background-picker">
      <button
        aria-controls={popupId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="builder-button-background-swatch"
        onClick={() => setIsOpen((current) => !current)}
        style={{ background: colors.color }}
        title="Edit text color and hover color"
        type="button"
      />
      {isOpen ? (
        <BuilderEditorPopup
          ariaLabel="Button text color"
          id={popupId}
          onClose={() => setIsOpen(false)}
          title="Text Color"
        >
          <div className="builder-button-background-mode-tabs" role="tablist" aria-label="Text color options">
            {textColorTabs.map((tab) => (
              <button
                key={tab.value}
                aria-selected={activeTab === tab.value}
                className={
                  activeTab === tab.value
                    ? "builder-button-background-mode-tab builder-button-background-mode-tab-active"
                    : "builder-button-background-mode-tab"
                }
                onClick={() => setActiveTab(tab.value)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="builder-button-background-popup-body">
            {activeTab === "color" ? (
              <BuilderSettingRow label="Color" fullWidth>
                <BuilderThemeColorField
                  dialogLabel="Button text color"
                  fallback="#ffffff"
                  themeColors={themeColors}
                  value={colors.color}
                  onChange={(color) => onChange({ ...colors, color })}
                />
              </BuilderSettingRow>
            ) : null}
            {activeTab === "hover" ? (
              <BuilderSettingRow label="Hover" fullWidth>
                <BuilderThemeColorField
                  dialogLabel="Button text hover color"
                  fallback="#ffffff"
                  themeColors={themeColors}
                  value={colors.hoverColor}
                  onChange={(hoverColor) => onChange({ ...colors, hoverColor })}
                />
              </BuilderSettingRow>
            ) : null}
          </div>
        </BuilderEditorPopup>
      ) : null}
    </div>
  );
}
