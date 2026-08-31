"use client";

import type { CSSProperties } from "react";
import type { BackgroundSettings, BuilderTemplateLayout, BuilderTemplateSection } from "@/lib/builder-template";
import {
  getLayoutColumnPercents,
  getLayoutColumns,
  normalizeSignedOffsetValue,
  seedVideoBackgroundOverlayScreen
} from "@/lib/builder-template";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { layoutOptions } from "./builder-types";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderModuleSpacingFields } from "./builder-spacing-fields";
import { BuilderThemeColorField } from "./builder-theme-color-field";
import { formatColumnName } from "./builder-utils";

type BuilderSectionControlsProps = {
  section: BuilderTemplateSection;
  editorDevice: "browser" | "mobile";
  /** False for the very first row, which has nothing above it to join. */
  canJoinPrevious?: boolean;
  onUpdateSection: (updater: (section: BuilderTemplateSection) => BuilderTemplateSection) => void;
  onOpenSectionBackgroundGallery?: () => void;
  onUploadSectionBackgroundMedia?: (file: File | null) => void;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
  themeColors?: Array<{ label: string; hex: string }>;
};

function updateSectionBackground(
  onUpdateSection: BuilderSectionControlsProps["onUpdateSection"],
  updater: (background: BackgroundSettings) => BackgroundSettings
) {
  onUpdateSection((current) => ({ ...current, background: updater(current.background) }));
}

/**
 * The row's background mode, plus the one thing choosing Video also does:
 * turn the tint on (operator's call, 2026-08-31 — "Default overlay tint ON").
 *
 * It seeds, it never removes. An overlay the operator already configured is
 * left exactly as it is, and switching AWAY from Video does not tear the tint
 * back out — a mode change made for one reason must not silently delete a
 * setting he can see and did not ask about.
 *
 * The tint is a SECTION setting, not part of BackgroundSettings, which is why
 * this lives here rather than inside the background picker: the picker only
 * ever sees the background object.
 */
export function changeSectionBackgroundMode(
  onUpdateSection: BuilderSectionControlsProps["onUpdateSection"],
  mode: BackgroundSettings["mode"]
) {
  onUpdateSection((current) => ({
    ...current,
    background: { ...current.background, mode },
    ...(mode === "video"
      ? { overlayScreen: seedVideoBackgroundOverlayScreen(current.overlayScreen) }
      : {})
  }));
}

export function BuilderSectionControls({
  section,
  editorDevice,
  canJoinPrevious = false,
  onUpdateSection,
  onOpenSectionBackgroundGallery,
  onUploadSectionBackgroundMedia,
  themeBackgroundColor,
  themePrimaryColor,
  themeColors = []
}: BuilderSectionControlsProps) {
  if (editorDevice === "mobile") {
    return (
      <div className="builder-section-settings is-lattice">
        <BuilderSettingRow label="Mobile Layout" fullWidth>
          <select
            value={section.mobileLayout ?? "stack"}
            onChange={(event) =>
              onUpdateSection((current) => ({
                ...current,
                mobileLayout: event.target.value as BuilderTemplateSection["mobileLayout"]
              }))
            }
          >
            <option value="stack">Stack columns</option>
            <option value="keep">Keep columns</option>
            <option value="reverse-stack">Reverse stack</option>
          </select>
        </BuilderSettingRow>
        <div className="builder-mobile-context-note">
          Mobile mode only changes mobile-specific row, cell, and module overrides.
        </div>
      </div>
    );
  }

  const columnKeys = getLayoutColumns(section.layout);
  // What the Column Widths boxes show. Until he sets a complete set, they show
  // the Layout preset's own proportions — so the numbers he starts editing are
  // the widths already on screen, and his first keystroke writes a full set
  // rather than one custom column beside two zeroes.
  const layoutPercents = getLayoutColumnPercents(section.layout);
  const columnWidthValues = columnKeys.map((columnKey, index) => {
    const stored = Number(section.columnWidths?.[columnKey] ?? "0");
    return stored > 0 ? stored : layoutPercents[index] ?? 0;
  });

  return (
    <div className="builder-section-settings is-lattice">
      {/*
       * D8 axes and the W0 lattice, same as a module panel (operator 8/13,
       * "Section editors. Please proceed.").
       *
       * This was one flat grid of 15 label/field pairs in three equal columns.
       * Equal columns meant every field got the same SHARE of the panel
       * regardless of what it held, so a Layout select and a 2-digit padding
       * box were the same width, and `.builder-setting-label` here was allowed
       * to wrap (`white-space: normal`) against L2.
       *
       * Reusing `.builder-schema-panel-column` rather than restyling the old
       * grid is the point: the lattice, the 40px of room, the D9 ordering and
       * `check_panels` all come with it, and a row editor now reads like a
       * module editor (S1 — learn one, know them all).
       */}
      <div className="builder-schema-panel-columns" style={{ "--builder-axis-count": "4" } as CSSProperties}>
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Structure</div>
          <BuilderSettingRow label="Layout">
                    <select
                      value={section.layout}
                      onChange={(event) => {
                        const nextLayout = event.target.value as BuilderTemplateLayout;
                        const allowedColumns = new Set(getLayoutColumns(nextLayout));
                        onUpdateSection((current) => ({
                          ...current,
                          layout: nextLayout,
                          // A new layout has its own columns, so any custom
                          // widths were measured against a row that no longer
                          // exists. Cleared, which puts the row back on the
                          // preset's proportions.
                          columnWidths: Object.fromEntries(
                            getLayoutColumns(nextLayout).map((column) => [column, "0"])
                          ),
                          modules: current.modules.map((module) => ({
                            ...module,
                            column: allowedColumns.has(module.column) ? module.column : getLayoutColumns(nextLayout)[0]
                          }))
                        }));
                      }}
                    >
                      {layoutOptions.map((layout) => (
                        <option key={layout.value} value={layout.value}>
                          {layout.label}
                        </option>
                      ))}
                    </select>
                  </BuilderSettingRow>
          <BuilderSettingRow label="Width">
                    <select
                      value={
                        section.widthMode === "full-width"
                          ? "full-width"
                          : (section.widthPercent ?? "100") === "100"
                            ? "contained"
                            : section.widthPercent ?? "100"
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        onUpdateSection((current) => {
                          if (value === "full-width") {
                            return { ...current, widthMode: "full-width" };
                          }
                          if (value === "contained") {
                            return { ...current, widthMode: "contained", widthPercent: "100" };
                          }
                          return { ...current, widthMode: "contained", widthPercent: value };
                        });
                      }}
                    >
                      <option value="full-width">Full width (edge to edge)</option>
                      <option value="contained">Contained (within page margins)</option>
                      <option value="90">90% (centered)</option>
                      <option value="75">75% (centered)</option>
                      <option value="66">66% (centered)</option>
                      <option value="50">50% (centered)</option>
                    </select>
                  </BuilderSettingRow>
          {canJoinPrevious ? (
                    <BuilderSettingRow label="Share background">
                      <input
                        type="checkbox"
                        checked={section.joinWithPrevious === true}
                        onChange={(event) =>
                          onUpdateSection((current) => ({ ...current, joinWithPrevious: event.target.checked }))
                        }
                        title="Use the background of the row above, so one image or colour spans both rows. This row's own background is set aside while this is ticked."
                      />
                    </BuilderSettingRow>
                  ) : null}
          {columnKeys.length > 1 ? (
            <BuilderSettingRow label="Column Widths">
              <div className="builder-column-width-fields">
                {columnKeys.map((columnKey, index) => (
                  <input
                    key={columnKey}
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={columnWidthValues[index]}
                    title={`Share of the row taken by the ${formatColumnName(columnKey)} column. The numbers do not have to add up to exactly 100 — they are read as proportions.`}
                    onChange={(event) => {
                      const next = columnWidthValues.slice();
                      next[index] = Math.min(100, Math.max(1, Number(event.target.value) || 1));
                      onUpdateSection((current) => ({
                        ...current,
                        columnWidths: Object.fromEntries(
                          columnKeys.map((key, position) => [key, String(next[position])])
                        )
                      }));
                    }}
                  />
                ))}
                <span className="builder-column-width-unit">%</span>
              </div>
            </BuilderSettingRow>
          ) : null}
          {columnKeys.length > 1 ? (
            <BuilderSettingRow label="Column Gap">
              <BuilderNumberSelectControl
                value={section.columnGap ?? "16"}
                min={0}
                max={120}
                step={5}
                fallback="16"
                onChange={(columnGap) => onUpdateSection((current) => ({ ...current, columnGap }))}
              />
            </BuilderSettingRow>
          ) : null}
          <BuilderSettingRow label="Min Height">
            <BuilderNumberSelectControl
              value={section.minHeight ?? "0"}
              min={0}
              max={1200}
              step={10}
              fallback="0"
              onChange={(minHeight) => onUpdateSection((current) => ({ ...current, minHeight }))}
            />
          </BuilderSettingRow>
          {columnKeys.length > 1 ? (
            <BuilderSettingRow label="Match Column Heights">
              <input
                type="checkbox"
                checked={section.equalColumnHeights === "true"}
                title="Stretch every module in this row to the height of the tallest column, so a row of cards has one bottom edge instead of a ragged one."
                onChange={(event) =>
                  onUpdateSection((current) => ({
                    ...current,
                    equalColumnHeights: event.target.checked ? "true" : "false"
                  }))
                }
              />
            </BuilderSettingRow>
          ) : null}
        </div>
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Placement</div>
          <BuilderSettingRow label="Alignment">
                    <select
                      value={section.alignment}
                      onChange={(event) =>
                        onUpdateSection((current) => ({
                          ...current,
                          alignment: event.target.value as "left" | "center" | "right"
                        }))
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </BuilderSettingRow>
          {/*
            The row's spacing, matched per axis with the split one click away
            (E4b) — the same control the module panels and the cell editor
            use, so spacing is one thing to learn everywhere (S1/C8). The
            values live on the section itself rather than in a settings
            record, which is all the adapter below is doing.
          */}
          <BuilderModuleSpacingFields
            box="margin"
            max={160}
            onChange={(values) => onUpdateSection((current) => ({ ...current, ...values }))}
            settings={{
              marginTop: section.marginTop ?? "0",
              marginBottom: section.marginBottom ?? "0",
              marginLeft: section.marginLeft ?? "0",
              marginRight: section.marginRight ?? "0"
            }}
          />
          {/* A row ships with 18px above and below and none at the sides, so
              its two axes start unmatched-looking but each is matched
              WITHIN itself: 18/18 and 0/0. */}
          <BuilderModuleSpacingFields
            box="padding"
            max={160}
            onChange={(values) => onUpdateSection((current) => ({ ...current, ...values }))}
            settings={{
              paddingTop: section.paddingTop ?? "18",
              paddingBottom: section.paddingBottom ?? "18",
              paddingLeft: section.paddingLeft ?? "0",
              paddingRight: section.paddingRight ?? "0"
            }}
            sides={{
              paddingTop: { fallback: "18" },
              paddingBottom: { fallback: "18" }
            }}
          />
          {/* Last on the axis (D9): the fine nudge you reach for after the
              margins and padding are already where you want them. */}
          <BuilderSettingRow label="Vertical Offset">
            <input
              type="number"
              min={-500}
              max={500}
              step={1}
              value={section.verticalOffset ?? "0"}
              title="Slides the row up or down over its neighbours without moving them — positive moves it up, negative moves it down. Use it to overlap the row above."
              onChange={(event) =>
                onUpdateSection((current) => ({
                  ...current,
                  verticalOffset: normalizeSignedOffsetValue(event.target.value, "0")
                }))
              }
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Horizontal Offset">
            <input
              type="number"
              min={-500}
              max={500}
              step={1}
              value={section.horizontalOffset ?? "0"}
              title="Slides the row left or right without moving anything else — positive moves it right, negative moves it left."
              onChange={(event) =>
                onUpdateSection((current) => ({
                  ...current,
                  horizontalOffset: normalizeSignedOffsetValue(event.target.value, "0")
                }))
              }
            />
          </BuilderSettingRow>
        </div>
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Frame</div>
          <BuilderSettingRow label="Row Background">
                    <select
                      value={section.background.mode}
                      onChange={(event) =>
                        changeSectionBackgroundMode(
                          onUpdateSection,
                          event.target.value as BackgroundSettings["mode"]
                        )
                      }
                    >
                      <option value="none">None</option>
                      <option value="color">Color</option>
                      <option value="gradient">Gradient</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="style">Style</option>
                    </select>
                  </BuilderSettingRow>
          <BuilderSettingRow label="Border Width">
                    <BuilderNumberSelectControl
                      value={section.rowBorderWidth ?? "0"}
                      min={0}
                      max={20}
                      fallback="0"
                      onChange={(rowBorderWidth) =>
                        onUpdateSection((current) => ({ ...current, rowBorderWidth }))
                      }
                    />
                  </BuilderSettingRow>
          <BuilderSettingRow label="Border Style">
                    <select
                      disabled={Number(section.rowBorderWidth ?? "0") === 0}
                      value={section.rowBorderStyle ?? "solid"}
                      onChange={(event) =>
                        onUpdateSection((current) => ({ ...current, rowBorderStyle: event.target.value }))
                      }
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                    </select>
                  </BuilderSettingRow>
          <BuilderSettingRow label="Border Color">
                    <BuilderThemeColorField
                      disabled={Number(section.rowBorderWidth ?? "0") === 0}
                      fallback="#000000"
                      themeColors={themeColors}
                      value={section.rowBorderColor ?? ""}
                      onChange={(rowBorderColor) =>
                        onUpdateSection((current) => ({ ...current, rowBorderColor }))
                      }
                    />
                  </BuilderSettingRow>
          <BuilderSettingRow label="Border Radius">
                    <BuilderNumberSelectControl
                      disabled={Number(section.rowBorderWidth ?? "0") === 0}
                      value={section.rowBorderRadius ?? "0"}
                      min={0}
                      max={60}
                      step={5}
                      fallback="0"
                      onChange={(rowBorderRadius) =>
                        onUpdateSection((current) => ({ ...current, rowBorderRadius }))
                      }
                    />
                  </BuilderSettingRow>
        </div>
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Visibility</div>
          <BuilderSettingRow label="Visibility">
                    <div className="builder-radio-group">
                      <label>
                        <input
                          type="radio"
                          name={`section-visibility-${section.id}`}
                          value="public"
                          checked={!section.isPrivate}
                          onChange={() => onUpdateSection((current) => ({ ...current, isPrivate: false }))}
                        />
                        {" "}Public
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`section-visibility-${section.id}`}
                          value="private"
                          checked={section.isPrivate === true}
                          onChange={() => onUpdateSection((current) => ({ ...current, isPrivate: true }))}
                        />
                        {" "}Private
                      </label>
                    </div>
                  </BuilderSettingRow>
          <BuilderSettingRow label="Locked">
                    <input
                      type="checkbox"
                      checked={section.locked === true}
                      onChange={(e) =>
                        onUpdateSection((current) => ({ ...current, locked: e.target.checked }))
                      }
                    />
                  </BuilderSettingRow>
        </div>
      </div>
      <BuilderBackgroundControls
        hideModeRow
        allowVideo
        label="Row Background"
        background={section.background}
        horizontal
        onChange={(updater) => updateSectionBackground(onUpdateSection, updater)}
        onChooseImage={onOpenSectionBackgroundGallery}
        onUploadImage={onUploadSectionBackgroundMedia}
        themeBackgroundColor={themeBackgroundColor}
        themeColors={themeColors}
        themePrimaryColor={themePrimaryColor}
      />
    </div>
  );
}
