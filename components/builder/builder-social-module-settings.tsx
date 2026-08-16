"use client";

import Image from "next/image";
import { Fragment, useState, type DragEvent } from "react";
import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderModuleSpacingFields } from "./builder-spacing-fields";
import { BuilderThemeColorField, type BuilderThemePalette } from "./builder-theme-color-field";
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
  themeColors?: BuilderThemePalette;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

/**
 * The Social module's settings panel.
 *
 * Rebuilt 2026-08-15 on the item-manager shape Feature Cards and Programs
 * already wear (operator: *"update the Social Media module to reflect all the
 * UI rules. It looks pretty rough now"* — and it was: the Label input printed
 * over the word Background, Alignment and both margins shared a row with the
 * "Icon Row" heading behind them, and the panel had two collapsible sub-panels
 * plus a `<details>` for Border & Shadow).
 *
 * What it is now, and why each part:
 *
 *   TWO COLUMNS (D2/L6a) — module settings left, the platform list right,
 *   the same 50/50 editor Feature Cards, Slideshow and Programs use. S1:
 *   learn one manager, know them all.
 *
 *   THE LATTICE (W0) — the settings column is `builder-schema-panel-column`
 *   and the list is `builder-cards-panel-fields`, so labels and controls
 *   land in ONE grid per column and line up by construction rather than by
 *   matching numbers. `data-lattice-pairs="2"` puts the list under
 *   `check_panels`, which is what stops it drifting back.
 *
 *   NO COLLAPSES (A0) — Border & Shadow came out of its `<details>`, and the
 *   Icon Row / Platforms sub-panels are gone. Everything sits on the axis it
 *   belongs to, ordered by blast radius (D9).
 *
 * The settings column is hand-written rather than a `BuilderSettingsSchema`
 * (E1's preference) for the same reason Feature Cards is: the generator lays
 * axes out as a ROW of columns, and this half-width column needs them
 * stacked. The field strips and width tokens are the generator's, so E1/E2
 * still hold; only the arrangement is local.
 *
 * Background and margins stay in this panel rather than coming from the
 * shared module chrome — the arrangement `needsRestoredChrome` documents in
 * builder-module-card.tsx. Rendering both would be two of each control (E6).
 */
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
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function updateSetting(key: string, value: string) {
    updateSettings({ [key]: value });
  }

  /** Several settings in one update — a matched spacing row writes both sides. */
  function updateSettings(values: Record<string, string>) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, ...values }
    }));
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

  function handleItemDragStart(event: DragEvent<HTMLElement>, itemId: string) {
    event.dataTransfer.setData(SOCIAL_ITEM_DRAG_TYPE, itemId);
    event.dataTransfer.effectAllowed = "move";
    setDraggedItemId(itemId);
  }

  function handleItemDragOver(event: DragEvent<HTMLElement>, itemId: string) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (draggedItemId && draggedItemId !== itemId) setDropTargetId(itemId);
  }

  function handleItemDrop(event: DragEvent<HTMLElement>, targetIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData(SOCIAL_ITEM_DRAG_TYPE);
    if (sourceId) moveItemToIndex(sourceId, targetIndex);
    clearDragState();
  }

  function removeItem(id: string) {
    persist(items.filter((item) => item.id !== id));
  }

  function addItem() {
    persist([
      ...items,
      {
        id: `social-${Date.now()}-${items.length + 1}`,
        label: "",
        href: "",
        iconUrl: "",
        backgroundColor: DEFAULT_SOCIAL_ICON_BACKGROUND
      }
    ]);
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
  const iconPreviewSize = Math.max(
    28,
    Math.min(Number.parseInt(module.settings.socialIconSize ?? "44", 10) || 44, 56)
  );

  return (
    <div className="builder-cards-panel">
      <div className="builder-cards-panel-settings builder-schema-panel-column">
        {/* The module's own name and surface, above the axes — the same two
            rows the shared chrome puts at the top of every other panel. */}
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Label" width="text-md">
            <input
              type="text"
              value={module.name}
              onChange={(event) =>
                onUpdateModule((current) => ({ ...current, name: event.target.value }))
              }
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
        <BuilderModuleFieldStrip>
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
        ) : null}

        {/* D9, blast radius descending: the icon's size changes the row most,
            then the space between icons, then the padding around the set,
            then whether the names show at all. */}
        <div className="builder-schema-group-title">Structure</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Icon Size" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialIconSize ?? "44"}
              min={24}
              max={84}
              step={2}
              fallback="44"
              onChange={(value) => updateSetting("socialIconSize", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Gap" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialGap ?? "14"}
              min={6}
              max={32}
              step={2}
              fallback="14"
              onChange={(value) => updateSetting("socialGap", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Row Padding" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialPadding ?? "0"}
              min={0}
              max={80}
              step={4}
              fallback="0"
              onChange={(value) => updateSetting("socialPadding", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Labels" width="check">
            <input
              className="standard-form-checkbox"
              type="checkbox"
              checked={module.settings.socialShowLabels !== "false"}
              onChange={(event) =>
                updateSetting("socialShowLabels", event.target.checked ? "true" : "false")
              }
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>

        <div className="builder-schema-group-title">Placement</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Alignment" width="align">
            <BuilderAlignmentIconGroup
              value={moduleAlignment}
              onChange={(alignment) => updateSetting("alignment", alignment)}
            />
          </BuilderModuleField>
          {/* W7 names and side order, E4b pairing — the same component
              marginFields() gives a generated panel. */}
          <BuilderModuleSpacingFields
            box="margin"
            max={160}
            onChange={updateSettings}
            settings={module.settings}
          />
        </BuilderModuleFieldStrip>

        {/* Frame is the icon's own box: what fills it, what outlines it, how
            round it is, and last (D9) the shadow it casts. A7 files this one
            here rather than on Text because the renderer paints it as a
            `box-shadow` on the icon, not a shadow on any letters.

            Not `dropShadowFields()` (the schema's shared block): that helper
            emits schema fields for a generated panel, and it gates its parts
            behind an on/off flag this module has never had — the renderer
            decides "is there a shadow" from the four numbers themselves, so
            adding the flag would mean a migration for every live footer. */}
        <div className="builder-schema-group-title">Frame</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Icon Fill" width="color">
            <BuilderThemeColorField
              dialogLabel="Icon background color"
              fallback="#ffffff"
              themeColors={themeColors}
              value={module.settings.socialIconBgColor || "#ffffff"}
              onChange={(value) => updateSetting("socialIconBgColor", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Border Color" width="color">
            <BuilderThemeColorField
              dialogLabel="Border color"
              fallback="#000000"
              themeColors={themeColors}
              value={module.settings.socialBorderColor || "#000000"}
              onChange={(value) => updateSetting("socialBorderColor", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Border" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialBorderWidth ?? "0"}
              min={0}
              max={8}
              fallback="0"
              onChange={(value) => updateSetting("socialBorderWidth", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Radius" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialBorderRadius ?? "0"}
              min={0}
              max={50}
              step={5}
              fallback="0"
              onChange={(value) => updateSetting("socialBorderRadius", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Shadow Color" width="color">
            <BuilderThemeColorField
              dialogLabel="Shadow color"
              fallback="#000000"
              themeColors={themeColors}
              value={module.settings.socialShadowColor || "#000000"}
              onChange={(value) => updateSetting("socialShadowColor", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Shadow X" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialShadowX ?? "0"}
              min={-20}
              max={20}
              fallback="0"
              onChange={(value) => updateSetting("socialShadowX", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Shadow Y" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialShadowY ?? "0"}
              min={-20}
              max={20}
              fallback="0"
              onChange={(value) => updateSetting("socialShadowY", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Shadow Blur" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialShadowBlur ?? "0"}
              min={0}
              max={40}
              step={2}
              fallback="0"
              onChange={(value) => updateSetting("socialShadowBlur", value)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Shadow Spread" width="num">
            <BuilderNumberSelectControl
              value={module.settings.socialShadowSpread ?? "0"}
              min={-10}
              max={20}
              fallback="0"
              onChange={(value) => updateSetting("socialShadowSpread", value)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
      </div>

      {/* THE PLATFORM LIST — one grid for the whole list, not a grid per
          platform, which is what makes row 2's fields start where row 1's do
          (W0's mechanism; see the note over `.builder-cards-panel-fields`).
          Each field declares its pair-column: Label and Link identify the
          platform, Fill and Icon dress it. */}
      <div className="builder-cards-panel-items">
        <div className="builder-cards-panel-heading">Platforms</div>
        <div
          className="builder-cards-panel-fields"
          data-lattice-pairs="2"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => handleItemDrop(event, items.length)}
        >
          {items.map((item, index) => {
            const itemName = item.label || `Platform ${index + 1}`;
            const isDragging = draggedItemId === item.id;
            const isDropTarget = dropTargetId === item.id;

            return (
              <Fragment key={item.id}>
                {/* The head row spans the grid, so it is also the drag target:
                    a wrapper around each platform's fields would take one
                    cell and break the shared tracks. */}
                <div
                  className={`builder-card-editor-head${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
                  draggable
                  onDragEnd={clearDragState}
                  onDragLeave={() => setDropTargetId(null)}
                  onDragOver={(event) => handleItemDragOver(event, item.id)}
                  onDragStart={(event) => handleItemDragStart(event, item.id)}
                  onDrop={(event) => handleItemDrop(event, index)}
                  title="Drag to reorder"
                >
                  <span className="builder-card-editor-name">
                    <span aria-hidden="true" className="builder-social-item-grip">⋮⋮</span>
                    {itemName}
                  </span>
                  <div className="builder-item-grid-actions">
                    <button
                      aria-label={`Delete ${itemName}`}
                      className="builder-icon-button builder-icon-button-danger"
                      onClick={() => removeItem(item.id)}
                      title="Delete platform"
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <BuilderModuleField label="Label" width="text-md" className="builder-card-field--a">
                  <input
                    type="text"
                    value={item.label}
                    onChange={(event) => updateItem(item.id, { label: event.target.value })}
                    placeholder={`Platform ${index + 1}`}
                    aria-label={`${itemName} label`}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Link" width="text-md" className="builder-card-field--b">
                  <input
                    type="text"
                    value={item.href}
                    onChange={(event) => updateItem(item.id, { href: event.target.value })}
                    placeholder="https://"
                    aria-label={`${itemName} link`}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Fill" width="color" className="builder-card-field--a">
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
                </BuilderModuleField>
                <BuilderModuleField
                  label="Icon"
                  width="full"
                  className="builder-card-field--wide builder-card-field--picker"
                >
                  {item.iconUrl ? (
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
                  ) : null}
                  <button
                    className="secondary-button builder-social-icon-picker-button"
                    onClick={() => onOpenGallery(item.id)}
                    type="button"
                  >
                    {item.iconUrl ? "Change Icon" : "Choose From Gallery"}
                  </button>
                </BuilderModuleField>
              </Fragment>
            );
          })}
        </div>
        <button className="secondary-button" onClick={addItem} type="button">
          Add Social Icon
        </button>
      </div>
    </div>
  );
}
