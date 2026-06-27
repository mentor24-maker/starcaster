"use client";

import { useState, type ReactNode } from "react";
import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderButtonBackgroundPicker } from "./builder-button-background-picker";
import {
  borderStyleOptions,
  BuilderButtonBorderColorPicker,
  getButtonBorderSettings,
  type ButtonBorderColorSettings
} from "./builder-button-border-picker";
import { BuilderButtonDropShadowSettings } from "./builder-button-drop-shadow-settings";
import {
  BuilderButtonTextColorPicker,
  getButtonTextColorSettings,
  type ButtonTextColorSettings
} from "./builder-button-text-color-picker";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  applyButtonBackgroundSettings,
  getButtonBackgroundSettings,
  getModuleAlignment
} from "./builder-utils";
import {
  BUILDER_EMAIL_CONFIRMATION_URL_TOKEN,
  BUILDER_EMAIL_MERGE_TOKENS
} from "@/lib/builder-email-template";

type BuilderButtonDesignSettingsProps = {
  module: BuilderTemplateModule;
  isEmailTemplate?: boolean;
  themeColors?: Array<{ label: string; hex: string }>;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onOpenButtonBackgroundGallery?: () => void;
  onUploadButtonBackgroundMedia?: (file: File | null) => void;
};

type ButtonDesignPanel = "button" | "border" | "text";

function ButtonDesignSection({
  title,
  isCollapsed,
  onToggle,
  children
}: {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="builder-button-design-panel builder-cell-panel">
      <BuilderCellPanelHeader isCollapsed={isCollapsed} onToggle={onToggle} panelName={title} title={title} />
      {!isCollapsed ? <div className="builder-button-design-fields">{children}</div> : null}
    </div>
  );
}

export function BuilderButtonDesignSettings({
  module,
  isEmailTemplate = false,
  themeColors = [],
  onUpdateModule,
  onOpenButtonBackgroundGallery,
  onUploadButtonBackgroundMedia
}: BuilderButtonDesignSettingsProps) {
  const settings = module.settings;
  const border = getButtonBorderSettings(settings);
  const borderDisabled = border.style === "none";
  const moduleAlignment = getModuleAlignment(settings);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<ButtonDesignPanel, boolean>>({
    button: true,
    border: true,
    text: true
  });

  function togglePanel(panel: ButtonDesignPanel) {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function updateButtonBackground(background: BackgroundSettings) {
    onUpdateModule((current) => ({
      ...current,
      settings: applyButtonBackgroundSettings(current.settings, background)
    }));
  }

  function updateButtonBorder(border: ButtonBorderColorSettings) {
    onUpdateModule((current) => ({
      ...current,
      settings: {
        ...current.settings,
        borderStyle: border.style,
        borderColor: border.color
      }
    }));
  }

  function updateButtonTextColors(colors: ButtonTextColorSettings) {
    onUpdateModule((current) => ({
      ...current,
      settings: {
        ...current.settings,
        textColor: colors.color,
        textHoverColor: colors.hoverColor
      }
    }));
  }

  return (
    <div className="builder-button-design-sections">
      <ButtonDesignSection
        title="Button"
        isCollapsed={collapsedPanels.button}
        onToggle={() => togglePanel("button")}
      >
        <BuilderSettingRow label="Button label" fullWidth>
          <input
            type="text"
            value={module.text}
            onChange={(event) =>
              onUpdateModule((current) => ({ ...current, text: event.target.value }))
            }
            placeholder="Button text"
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Link" fullWidth>
          <input
            type="text"
            value={settings.href ?? ""}
            onChange={(event) => updateSetting("href", event.target.value)}
            placeholder={isEmailTemplate ? "{{ .ConfirmationURL }}" : "/path-or-url"}
          />
        </BuilderSettingRow>
        {isEmailTemplate ? (
          <div className="builder-email-merge-token-row">
            <p className="builder-email-merge-token-copy">
              Use Supabase merge tokens in the link — do not hand-build verify URLs or paste raw tokens.
            </p>
            <div className="builder-email-merge-token-actions">
              <button
                className="secondary-button"
                onClick={() => updateSetting("href", BUILDER_EMAIL_CONFIRMATION_URL_TOKEN)}
                type="button"
              >
                Use Confirmation URL
              </button>
              {BUILDER_EMAIL_MERGE_TOKENS.filter((entry) => entry.token !== BUILDER_EMAIL_CONFIRMATION_URL_TOKEN).map((entry) => (
                <button
                  className="secondary-button"
                  key={entry.token}
                  onClick={() => updateSetting("href", entry.token)}
                  type="button"
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="builder-button-setting-columns">
          <div className="builder-button-setting-column">
            <BuilderSettingRow label="Background">
              <BuilderButtonBackgroundPicker
                background={getButtonBackgroundSettings(settings)}
                onChange={updateButtonBackground}
                onChooseImage={onOpenButtonBackgroundGallery}
                onUploadImage={onUploadButtonBackgroundMedia}
                themeColors={themeColors}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Hover">
              <input
                type="color"
                value={settings.buttonHoverColor ?? "#0f4f8f"}
                onChange={(event) => updateSetting("buttonHoverColor", event.target.value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Size">
              <select
                value={settings.buttonSize ?? "medium"}
                onChange={(event) => updateSetting("buttonSize", event.target.value)}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </BuilderSettingRow>
            <BuilderSettingRow label="Alignment">
              <BuilderAlignmentIconGroup
                value={moduleAlignment}
                onChange={(alignment) => updateSetting("alignment", alignment)}
              />
            </BuilderSettingRow>
          </div>
          <div className="builder-button-setting-column">
            <BuilderSettingRow label="V Padding">
              <BuilderNumberSelectControl
                value={settings.paddingY ?? "12"}
                min={1}
                max={50}
                fallback="12"
                onChange={(value) => updateSetting("paddingY", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="H Padding">
              <BuilderNumberSelectControl
                value={settings.paddingX ?? "24"}
                min={1}
                max={50}
                fallback="24"
                onChange={(value) => updateSetting("paddingX", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="V Margin">
              <BuilderNumberSelectControl
                value={settings.verticalMargin ?? "0"}
                min={0}
                max={160}
                fallback="0"
                onChange={(value) => updateSetting("verticalMargin", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="H Margin">
              <BuilderNumberSelectControl
                value={settings.horizontalMargin ?? "0"}
                min={0}
                max={160}
                fallback="0"
                onChange={(value) => updateSetting("horizontalMargin", value)}
              />
            </BuilderSettingRow>
          </div>
        </div>
      </ButtonDesignSection>

      <ButtonDesignSection
        title="Border"
        isCollapsed={collapsedPanels.border}
        onToggle={() => togglePanel("border")}
      >
        <div className="builder-button-border-grid">
          <BuilderSettingRow label="Width">
            <BuilderNumberSelectControl
              value={settings.borderWidth ?? "2"}
              min={0}
              max={12}
              fallback="2"
              onChange={(value) => updateSetting("borderWidth", value)}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Color">
            <BuilderButtonBorderColorPicker
              border={border}
              borderWidth={settings.borderWidth ?? "2"}
              borderRadius={settings.borderRadius ?? "0"}
              disabled={borderDisabled}
              onChange={updateButtonBorder}
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Style">
            <select
              value={border.style}
              onChange={(event) =>
                updateButtonBorder({
                  ...border,
                  style: event.target.value as ButtonBorderColorSettings["style"]
                })
              }
            >
              {borderStyleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Radius">
            <BuilderNumberSelectControl
              value={settings.borderRadius ?? "0"}
              min={0}
              max={80}
              fallback="0"
              onChange={(value) => updateSetting("borderRadius", value)}
            />
          </BuilderSettingRow>
        </div>
      </ButtonDesignSection>

      <ButtonDesignSection
        title="Text"
        isCollapsed={collapsedPanels.text}
        onToggle={() => togglePanel("text")}
      >
        <div className="builder-button-setting-columns">
          <div className="builder-button-setting-column">
            <BuilderSettingRow label="Size">
              <input
                type="number"
                min={10}
                max={72}
                step={1}
                value={settings.fontSize ?? ""}
                placeholder="Auto"
                onChange={(event) => updateSetting("fontSize", event.target.value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Color">
              <BuilderButtonTextColorPicker
                colors={getButtonTextColorSettings(settings)}
                onChange={updateButtonTextColors}
              />
            </BuilderSettingRow>
          </div>
          <div className="builder-button-setting-column">
            <BuilderSettingRow label="Bold">
              <select
                value={settings.bold ?? "true"}
                onChange={(event) => updateSetting("bold", event.target.value)}
              >
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </BuilderSettingRow>
            <BuilderSettingRow label="Italic">
              <select
                value={settings.italic ?? "false"}
                onChange={(event) => updateSetting("italic", event.target.value)}
              >
                <option value="false">Off</option>
                <option value="true">On</option>
              </select>
            </BuilderSettingRow>
            <BuilderSettingRow label="Underline">
              <select
                value={settings.underline ?? "false"}
                onChange={(event) => updateSetting("underline", event.target.value)}
              >
                <option value="false">Off</option>
                <option value="true">On</option>
              </select>
            </BuilderSettingRow>
          </div>
        </div>
        <BuilderButtonDropShadowSettings settings={settings} onUpdateSetting={updateSetting} />
      </ButtonDesignSection>
    </div>
  );
}
