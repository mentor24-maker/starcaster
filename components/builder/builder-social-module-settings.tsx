"use client";

import Image from "next/image";
import { useState, type DragEvent } from "react";
import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderSettingRow } from "./builder-setting-row";
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

const SOCIAL_ITEM_DRAG_TYPE = "application/normie-builder-social-item";

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
};

export function BuilderSocialModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  onOpenGallery
}: BuilderSocialModuleSettingsProps) {
  const moduleAlignment = getModuleAlignment(module.settings);
  const items = parseSocialItems(module.settings);
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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

  return (
    <div className="builder-social-module-settings">
      <BuilderBackgroundControls
        label="Background"
        background={getModuleBackgroundSettings(module.settings)}
        horizontal
        onChange={onUpdateModuleBackground}
      />

      <BuilderSettingRow label="Alignment">
        <BuilderAlignmentIconGroup
          value={moduleAlignment}
          onChange={(alignment) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, alignment }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Vertical Margin">
        <BuilderNumberSelectControl
          value={module.settings.verticalMargin ?? "0"}
          min={0}
          max={160}
          fallback="0"
          onChange={(verticalMargin) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, verticalMargin }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Icon Size">
        <BuilderNumberSelectControl
          value={module.settings.socialIconSize ?? "44"}
          min={24}
          max={84}
          step={2}
          fallback="44"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialIconSize: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Gap">
        <BuilderNumberSelectControl
          value={module.settings.socialGap ?? "14"}
          min={6}
          max={32}
          step={2}
          fallback="14"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialGap: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Padding">
        <BuilderNumberSelectControl
          value={module.settings.socialPadding ?? "0"}
          min={0}
          max={80}
          step={4}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialPadding: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Show Labels">
        <input
          type="checkbox"
          checked={module.settings.socialShowLabels !== "false"}
          onChange={(event) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialShowLabels: event.target.checked ? "true" : "false" }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Icon BG Color">
        <input
          type="color"
          value={module.settings.socialIconBgColor || "#ffffff"}
          onChange={(event) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialIconBgColor: event.target.value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Border Color">
        <input
          type="color"
          value={module.settings.socialBorderColor || "#000000"}
          onChange={(event) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialBorderColor: event.target.value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Border Width">
        <BuilderNumberSelectControl
          value={module.settings.socialBorderWidth ?? "0"}
          min={0}
          max={8}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialBorderWidth: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Border Shape">
        <BuilderNumberSelectControl
          value={module.settings.socialBorderRadius ?? "0"}
          min={0}
          max={50}
          step={5}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialBorderRadius: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Shadow Color">
        <input
          type="color"
          value={module.settings.socialShadowColor || "#000000"}
          onChange={(event) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialShadowColor: event.target.value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Shadow X">
        <BuilderNumberSelectControl
          value={module.settings.socialShadowX ?? "0"}
          min={-20}
          max={20}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialShadowX: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Shadow Y">
        <BuilderNumberSelectControl
          value={module.settings.socialShadowY ?? "0"}
          min={-20}
          max={20}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialShadowY: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Shadow Blur">
        <BuilderNumberSelectControl
          value={module.settings.socialShadowBlur ?? "0"}
          min={0}
          max={40}
          step={2}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialShadowBlur: value }
            }))
          }
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Shadow Spread">
        <BuilderNumberSelectControl
          value={module.settings.socialShadowSpread ?? "0"}
          min={-10}
          max={20}
          fallback="0"
          onChange={(value) =>
            onUpdateModule((current) => ({
              ...current,
              settings: { ...current.settings, socialShadowSpread: value }
            }))
          }
        />
      </BuilderSettingRow>

      <div
        className="builder-social-module-items"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => handleItemDrop(event, items.length)}
      >
        {items.map((item, index) => {
          const panelTitle = item.label || `Network ${index + 1}`;
          const isCollapsed = isItemCollapsed(item.id);
          const isDragging = draggedItemId === item.id;
          const isDropTarget = dropTargetId === item.id;
          const iconPreviewSize = Math.max(32, Number.parseInt(module.settings.socialIconSize ?? "44", 10) || 44);

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
                    aria-label="Drag social platform"
                    className="builder-module-drag-handle builder-social-item-drag-handle"
                    draggable
                    onDragStart={(event) => handleItemDragStart(event, item.id)}
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </div>
                }
                headingActions={
                  <button
                    type="button"
                    className="builder-icon-button builder-icon-button-danger"
                    onClick={() => removeItem(item.id)}
                    title="Delete icon"
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
                  <BuilderSettingRow label="Label" fullWidth>
                    <input type="text" value={item.label} onChange={(event) => updateItem(item.id, { label: event.target.value })} />
                  </BuilderSettingRow>
                  <BuilderSettingRow label="Link" fullWidth>
                    <input
                      type="text"
                      value={item.href}
                      onChange={(event) => updateItem(item.id, { href: event.target.value })}
                      placeholder="https://..."
                    />
                  </BuilderSettingRow>
                  <BuilderSettingRow label="Background" fullWidth>
                    <input
                      type="text"
                      value={item.backgroundColor}
                      onChange={(event) => updateItem(item.id, { backgroundColor: event.target.value })}
                      onBlur={(event) =>
                        updateItem(item.id, {
                          backgroundColor: normalizeSocialIconBackgroundColor(event.target.value)
                        })
                      }
                      placeholder="#ffffff"
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
                    fullWidth
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

      <button type="button" className="secondary-button" onClick={addItem}>
        Add Social Icon
      </button>
    </div>
  );
}
