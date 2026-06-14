"use client";

import type { BackgroundSettings, BuilderTemplateLayout, BuilderTemplateSection } from "@/lib/builder-template";
import { getLayoutColumns } from "@/lib/builder-template";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { layoutOptions } from "./builder-types";
import { BuilderSettingRow } from "./builder-setting-row";

type BuilderSectionControlsProps = {
  section: BuilderTemplateSection;
  editorDevice: "browser" | "mobile";
  onUpdateSection: (updater: (section: BuilderTemplateSection) => BuilderTemplateSection) => void;
  onOpenSectionBackgroundGallery?: () => void;
  onUploadSectionBackgroundMedia?: (file: File | null) => void;
};

function updateSectionBackground(
  onUpdateSection: BuilderSectionControlsProps["onUpdateSection"],
  updater: (background: BackgroundSettings) => BackgroundSettings
) {
  onUpdateSection((current) => ({ ...current, background: updater(current.background) }));
}

export function BuilderSectionControls({
  section,
  editorDevice,
  onUpdateSection,
  onOpenSectionBackgroundGallery,
  onUploadSectionBackgroundMedia
}: BuilderSectionControlsProps) {
  if (editorDevice === "mobile") {
    return (
      <div className="builder-section-settings">
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

  return (
    <div className="builder-section-settings">
      <div className="builder-section-settings-grid">
        <BuilderSettingRow label="Layout">
          <select
            value={section.layout}
            onChange={(event) => {
              const nextLayout = event.target.value as BuilderTemplateLayout;
              const allowedColumns = new Set(getLayoutColumns(nextLayout));
              onUpdateSection((current) => ({
                ...current,
                layout: nextLayout,
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
        <BuilderSettingRow label="Row Background">
          <select
            value={section.background.mode}
            onChange={(event) =>
              updateSectionBackground(onUpdateSection, (current) => ({
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
        </BuilderSettingRow>
        <BuilderSettingRow label="Top Margin">
          <BuilderNumberSelectControl
            value={section.marginTop ?? "0"}
            min={0}
            max={160}
            fallback="0"
            onChange={(marginTop) =>
              onUpdateSection((current) => ({
                ...current,
                marginTop
              }))
            }
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Bottom Margin">
          <BuilderNumberSelectControl
            value={section.marginBottom ?? "0"}
            min={0}
            max={160}
            fallback="0"
            onChange={(marginBottom) =>
              onUpdateSection((current) => ({
                ...current,
                marginBottom
              }))
            }
          />
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
          <input
            type="color"
            disabled={Number(section.rowBorderWidth ?? "0") === 0}
            value={/^#[0-9a-f]{6}$/i.test(section.rowBorderColor ?? "") ? section.rowBorderColor : "#000000"}
            onChange={(event) =>
              onUpdateSection((current) => ({ ...current, rowBorderColor: event.target.value }))
            }
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Border Radius">
          <BuilderNumberSelectControl
            disabled={Number(section.rowBorderWidth ?? "0") === 0}
            value={section.rowBorderRadius ?? "0"}
            min={0}
            max={60}
            fallback="0"
            onChange={(rowBorderRadius) =>
              onUpdateSection((current) => ({ ...current, rowBorderRadius }))
            }
          />
        </BuilderSettingRow>
      </div>
      <BuilderBackgroundControls
        hideModeRow
        label="Row Background"
        background={section.background}
        horizontal
        onChange={(updater) => updateSectionBackground(onUpdateSection, updater)}
        onChooseImage={onOpenSectionBackgroundGallery}
        onUploadImage={onUploadSectionBackgroundMedia}
      />
    </div>
  );
}
