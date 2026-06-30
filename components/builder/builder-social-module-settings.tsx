"use client";

import Image from "next/image";
import { useState, type DragEvent } from "react";
import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
import {
  BuilderInlineNumberSelect,
  BuilderInlineNumberSelectRow,
  BuilderNumberSelectControl
} from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorField,
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";
import {
  DEFAULT_SOCIAL_ICON_BACKGROUND,
  normalizeSocialIconBackgroundColor
} from "@/lib/social-icon-background";
import { getModuleAlignment, getModuleBackgroundSettings } from "./builder-utils";

type SocialItem = {
  id: string;
  label: string;
  href: string;
  iconUrl: string;
  backgroundColor: string;
};

const SOCIAL_ITEM_DRAG_TYPE = "application/starcaster-builder-social-item";

function parseSocialItems(settings: Record<string, string>): SocialItem[] {
  try {
    const items = JSON.parse(settings.socialItems || "[]");
    if (!Array.isArray(items)) return [];

    return items.map((raw, index) => ({
      id: String(raw.id || `social-${index + 1}`),
      label: String(raw.label || ""),
      href: String(raw.href || ""),
      iconUrl: String(raw.iconUrl || ""),
      backgroundColor: normalizeSocialIconBackgroundColor(raw.backgroundColor)
    }));
  } catch {
    return [];
  }
}

function serializeSocialItems(items: SocialItem[]) {
  return JSON.stringify(
    items.map((item) => ({
      ...item,
      backgroundColor: normalizeSocialIconBackgroundColor(item.backgroundColor)
    }))
  );
}

type BuilderSocialModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onOpenGallery: (itemId: string) => void;
  themeColors?: Array<{ label: string; hex: string }>;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

export function BuilderSocialModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  onOpenGallery,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: BuilderSocialModuleSettingsProps) {
  const moduleAlignment = getModuleAlignment(module.settings);
  const items = parseSocialItems(module.settings);
  const [iconRowCollapsed, setIconRowCollapsed] = useState(false);
  const [platformsCollapsed, setPlatformsCollapsed] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function isItemCollapsed(id: string) {
    return collapsedItems[id] ?? true;
  }

  function toggleItem(id: string) {
    setCollapsedItems((current) => ({ ...current, [id]: !isItemCollapsed(id) }));
  }

  function persist(nextItems: SocialItem[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, socialItems: serializeSocialItems(nextItems) }
    }));
  }

  function updateItem(id: string, updates: Partial<SocialItem>) {
    persist(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function moveItemToIndex(sourceId: string, targetIndex: number) {
    const sourceIndex = items.findIndex((item) => item.id === sourceId);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex > items.length) return;

    const nextItems = [...items];
    const [moved] = nextItems.splice(sourceIndex, 1);
    const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    nextItems.splice(adjustedIndex, 0, moved);
    persist(nextItems);
  }

  function clearDragState() {
    setDraggedItemId(null);
    setDropTargetId(null);
  }

  function handleItemDragStart(event: DragEvent<HTMLDivElement>, itemId: string) {
    event.dataTransfer.setData(SOCIAL_ITEM_DRAG_TYPE, itemId);
    event.dataTransfer.effectAllowed = "move";
    setDraggedItemId(itemId);
  }

  function handleItemDragOver(event: DragEvent<HTMLDivElement>, itemId: string) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (draggedItemId && draggedItemId !== itemId) {
      setDropTargetId(itemId);
    }
  }

  function handleItemDrop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData(SOCIAL_ITEM_DRAG_TYPE);
    if (!sourceId) {
      clearDragState();
      return;
    }
    moveItemToIndex(sourceId, targetIndex);
    clearDragState();
  }

  function removeItem(id: string) {
    persist(items.filter((item) => item.id !== id));
    setCollapsedItems((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function addItem() {
    const id = `social-${Date.now()}-${items.length + 1}`;
    persist([
      ...items,
      {
        id,
        label: "",
        href: "",
        iconUrl: "",
        backgroundColor: DEFAULT_SOCIAL_ICON_BACKGROUND
      }
    ]);
    setCollapsedItems((current) => ({ ...current, [id]: false }));
  }

  function handleBackgroundModeChange(newMode: BackgroundSettings["mode"]) {
    onUpdateModuleBackground((current) => {
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

  const moduleBackground = getModuleBackgroundSettings(module.settings);

  return (
    <div className="builder-social-module-settings">
      <div className="builder-social-module-layout">
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Label" width="label">
            <input
              type="text"
              value={module.name}
              onChange={(event) =>
                onUpdateModule((current) => ({ ...current, name: event.target.value }))
              }
            />
          </BuilderModuleField>
          <BuilderModuleField label="Background" width="select-md">
            <select
              value={moduleBackground.mode}
              onChange={(event) =>
                handleBackgroundModeChange(event.target.value as BackgroundSettings["mode"])
              }
            >
              <option value="none">None</option>
              <option value="color">Color</option>
              <option value="gradient">Gradient</option>
              <option value="image">Image</option>
              <option value="style">Style</option>
            </select>
          </BuilderModuleField>
        </BuilderModuleFieldStrip>

        {moduleBackground.mode !== "none" ? (
          <div className="builder-module-background-details">
            <BuilderBackgroundControls
              hideModeRow
              horizontal
              label="Background"
              background={moduleBackground}
              onChange={onUpdateModuleBackground}
              themeBackgroundColor={themeBackgroundColor}
              themeColors={themeColors}
              themePrimaryColor={themePrimaryColor}
            />
          </div>
        ) : null}

        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Alignment" width="align">
            <BuilderAlignmentIconGroup
              value={moduleAlignment}
              onChange={(alignment) => updateSetting("alignment", alignment)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="H Margin" width="num">
            <BuilderNumberSelectControl
              value={module.settings.horizontalMargin ?? "0"}
              min={0}
              max={160}
              fallback="0"
              onChange={(horizontalMargin) => updateSetting("horizontalMargin", horizontalMargin)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="V Margin" width="num">
            <BuilderNumberSelectControl
              value={module.settings.verticalMargin ?? "0"}
              min={0}
              max={160}
              fallback="0"
              onChange={(verticalMargin) => updateSetting("verticalMargin", verticalMargin)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
      </div>

      <div className="builder-cell-panel builder-social-module-panel">
        <BuilderCellPanelHeader
          isCollapsed={iconRowCollapsed}
          onToggle={() => setIconRowCollapsed((current) => !current)}
          panelName="Icon Row"
          title="Icon Row"
        />
        {!iconRowCollapsed ? (
          <div className="builder-social-module-panel-body">
            <BuilderInlineNumberSelectRow>
              <BuilderInlineNumberSelect
                label="Icon Size"
                value={module.settings.socialIconSize ?? "44"}
                min={24}
                max={84}
                step={2}
                fallback="44"
                onChange={(value) => updateSetting("socialIconSize", value)}
              />
              <BuilderInlineNumberSelect
                label="Gap"
                value={module.settings.socialGap ?? "14"}
                min={6}
                max={32}
                step={2}
                fallback="14"
                onChange={(value) => updateSetting("socialGap", value)}
              />
              <BuilderInlineNumberSelect
                label="Padding"
                value={module.settings.socialPadding ?? "0"}
                min={0}
                max={80}
                step={4}
                fallback="0"
                onChange={(value) => updateSetting("socialPadding", value)}
              />
            </BuilderInlineNumberSelectRow>
            <div className="builder-module-form-row">
              <BuilderSettingRow label="Labels">
                <input
                  className="standard-form-checkbox"
                  type="checkbox"
                  checked={module.settings.socialShowLabels !== "false"}
                  onChange={(event) =>
                    updateSetting("socialShowLabels", event.target.checked ? "true" : "false")
                  }
                />
              </BuilderSettingRow>
              <BuilderThemeColorSettingRow
                dialogLabel="Icon background color"
                fallback="#ffffff"
                label="Icon BG"
                themeColors={themeColors}
                value={module.settings.socialIconBgColor || "#ffffff"}
                onChange={(socialIconBgColor) => updateSetting("socialIconBgColor", socialIconBgColor)}
              />
            </div>
          </div>
        ) : null}
      </div>

      <details className="hanging-details builder-social-advanced-details">
        <summary>Border &amp; Shadow</summary>
        <div className="builder-social-advanced-details-body">
          <div className="builder-module-form-row">
            <BuilderThemeColorSettingRow
              dialogLabel="Border color"
              fallback="#000000"
              label="Border Color"
              themeColors={themeColors}
              value={module.settings.socialBorderColor || "#000000"}
              onChange={(socialBorderColor) => updateSetting("socialBorderColor", socialBorderColor)}
            />
            <BuilderSettingRow label="Border Width">
              <BuilderNumberSelectControl
                value={module.settings.socialBorderWidth ?? "0"}
                min={0}
                max={8}
                fallback="0"
                onChange={(value) => updateSetting("socialBorderWidth", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Radius">
              <BuilderNumberSelectControl
                value={module.settings.socialBorderRadius ?? "0"}
                min={0}
                max={50}
                step={5}
                fallback="0"
                onChange={(value) => updateSetting("socialBorderRadius", value)}
              />
            </BuilderSettingRow>
            <BuilderThemeColorSettingRow
              dialogLabel="Shadow color"
              fallback="#000000"
              label="Shadow Color"
              themeColors={themeColors}
              value={module.settings.socialShadowColor || "#000000"}
              onChange={(socialShadowColor) => updateSetting("socialShadowColor", socialShadowColor)}
            />
            <BuilderSettingRow label="Shadow X">
              <BuilderNumberSelectControl
                value={module.settings.socialShadowX ?? "0"}
                min={-20}
                max={20}
                fallback="0"
                onChange={(value) => updateSetting("socialShadowX", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Shadow Y">
              <BuilderNumberSelectControl
                value={module.settings.socialShadowY ?? "0"}
                min={-20}
                max={20}
                fallback="0"
                onChange={(value) => updateSetting("socialShadowY", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Shadow Blur">
              <BuilderNumberSelectControl
                value={module.settings.socialShadowBlur ?? "0"}
                min={0}
                max={40}
                step={2}
                fallback="0"
                onChange={(value) => updateSetting("socialShadowBlur", value)}
              />
            </BuilderSettingRow>
            <BuilderSettingRow label="Spread">
              <BuilderNumberSelectControl
                value={module.settings.socialShadowSpread ?? "0"}
                min={-10}
                max={20}
                fallback="0"
                onChange={(value) => updateSetting("socialShadowSpread", value)}
              />
            </BuilderSettingRow>
          </div>
        </div>
      </details>

      <div className="builder-cell-panel builder-social-module-panel">
        <BuilderCellPanelHeader
          isCollapsed={platformsCollapsed}
          onToggle={() => setPlatformsCollapsed((current) => !current)}
          panelName={`Platforms (${items.length})`}
          title="Platforms"
        />
        {!platformsCollapsed ? (
          <div className="builder-social-module-panel-body">
            <div
              className="builder-social-module-items"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => handleItemDrop(event, items.length)}
            >
              {items.map((item, index) => {
                const panelTitle = item.label || `Platform ${index + 1}`;
                const isCollapsed = isItemCollapsed(item.id);
                const isDragging = draggedItemId === item.id;
                const isDropTarget = dropTargetId === item.id;
                const iconPreviewSize = Math.max(
                  32,
                  Number.parseInt(module.settings.socialIconSize ?? "44", 10) || 44
                );

                return (
                  <div
                    key={item.id}
                    className={`builder-social-module-item-card builder-cell-panel${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
                    onDragEnd={clearDragState}
                    onDragLeave={() => setDropTargetId(null)}
                    onDragOver={(event) => handleItemDragOver(event, item.id)}
                    onDrop={(event) => handleItemDrop(event, index)}
                  >
                    <BuilderCellPanelHeader
                      leadingActions={
                        <div
                          aria-label="Drag"
                          className="builder-module-drag-handle builder-social-item-drag-handle"
                          draggable
                          onDragStart={(event) => handleItemDragStart(event, item.id)}
                          title="Drag Platform"
                        >
                          ⋮⋮
                        </div>
                      }
                      headingActions={
                        <button
                          aria-label="Delete"
                          className="builder-icon-button builder-icon-button-danger"
                          onClick={() => removeItem(item.id)}
                          title="Delete"
                          type="button"
                        >
                          ✕
                        </button>
                      }
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleItem(item.id)}
                      panelName={panelTitle}
                      title={panelTitle}
                    />
                    {!isCollapsed ? (
                      <div className="builder-social-module-item-settings">
                        <BuilderSettingRow label="Label">
                          <input
                            type="text"
                            value={item.label}
                            onChange={(event) => updateItem(item.id, { label: event.target.value })}
                          />
                        </BuilderSettingRow>
                        <BuilderSettingRow label="Link">
                          <input
                            type="text"
                            value={item.href}
                            onChange={(event) => updateItem(item.id, { href: event.target.value })}
                          />
                        </BuilderSettingRow>
                        <BuilderSettingRow label="Background">
                          <BuilderThemeColorField
                            dialogLabel="Platform icon background"
                            fallback={DEFAULT_SOCIAL_ICON_BACKGROUND}
                            themeColors={themeColors}
                            value={item.backgroundColor || DEFAULT_SOCIAL_ICON_BACKGROUND}
                            onChange={(backgroundColor) =>
                              updateItem(item.id, {
                                backgroundColor: normalizeSocialIconBackgroundColor(backgroundColor)
                              })
                            }
                          />
                        </BuilderSettingRow>
                        <BuilderSettingRow
                          label={
                            item.iconUrl ? (
                              <span
                                className="builder-social-item-icon-preview"
                                style={{ width: `${iconPreviewSize}px`, height: `${iconPreviewSize}px` }}
                              >
                                <Image
                                  alt={item.label || "Selected icon"}
                                  height={iconPreviewSize}
                                  src={normalizeBuilderAssetUrl(item.iconUrl)}
                                  unoptimized
                                  width={iconPreviewSize}
                                />
                              </span>
                            ) : (
                              "Icon"
                            )
                          }
                        >
                          <button
                            className="secondary-button builder-social-icon-picker-button"
                            onClick={() => onOpenGallery(item.id)}
                            type="button"
                          >
                            {item.iconUrl ? "Change Icon" : "Choose From Gallery"}
                          </button>
                        </BuilderSettingRow>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <button className="secondary-button builder-social-add-button" onClick={addItem} type="button">
              Add Social Icon
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
