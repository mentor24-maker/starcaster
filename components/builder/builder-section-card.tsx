import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import type {
  BackgroundSettings,
  BuilderCellModuleRecord,
  BuilderPageRecord,
  BuilderProductRecord,
  BuilderTemplateModule,
  BuilderTemplateSection
} from "@/lib/builder-template";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { getLayoutColumns, getLayoutGridTemplate } from "@/lib/builder-template";
import { resolveBuilderDrillDownSurfaceBackground } from "@/lib/builder-drill-down-surface";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
import { BuilderCellStyleSettings } from "./builder-cell-style-settings";
import { cancelBuilderDragIfFormField } from "./builder-drag-utils";
import { BuilderModuleCard } from "./builder-module-card";
import { BuilderSectionControls } from "./builder-section-controls";
import { modulePaletteGroups, modulePaletteItems } from "./builder-types";
import {
  getAlignmentClass,
  getSectionMarginStyle,
  getVerticalMarginStyle
} from "./builder-utils";

type BuilderSectionCardProps = {
  section: BuilderTemplateSection;
  sectionIndex: number;
  editorDevice: "browser" | "mobile";
  isEmailTemplate?: boolean;
  isCollapsed: boolean;
  expandedModuleIds: string[];
  onToggleCollapsed: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onCloneSection: () => void;
  onSaveSection: () => void;
  onUpdateSection: (updater: (section: BuilderTemplateSection) => BuilderTemplateSection) => void;
  onUpdateCellBackground: (column: string, updater: (bg: BackgroundSettings) => BackgroundSettings) => void;
  onUpdateCellPadding: (column: string, value: string) => void;
  onUpdateCellBorderWidth: (column: string, value: string) => void;
  onUpdateCellBorderColor: (column: string, value: string) => void;
  onUpdateCellBorderRadius: (column: string, value: string) => void;
  onToggleModuleExpanded: (moduleId: string) => void;
  onUpdateModule: (moduleId: string, updater: (module: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (moduleId: string, updater: (bg: BackgroundSettings) => BackgroundSettings) => void;
  onMoveModule: (moduleId: string, direction: -1 | 1) => void;
  onDropModule: (
    moduleId: string,
    sourceSectionId: string,
    targetSectionId: string,
    targetColumn: string,
    targetBeforeModuleId?: string
  ) => void;
  onRemoveModule: (moduleId: string) => void;
  onCloneModule: (sectionId: string, moduleId: string) => void;
  onSaveModule: (moduleId: string) => void;
  cellModules: BuilderCellModuleRecord[];
  pages?: BuilderPageRecord[];
  products: BuilderProductRecord[];
  onSaveCellModules: (column: string) => void;
  onInsertCellModule: (column: string, cellModuleId: string) => void;
  onInsertSavedModule: (column: string, cellModuleId: string) => void;
  onOpenGallery: (moduleId: string) => void;
  onOpenRichTextGallery: (moduleId: string, anchor?: BuilderModalAnchor) => void;
  onUploadRichTextGalleryImage?: (file: File) => Promise<string | null>;
  onOpenButtonBackgroundGallery: (moduleId: string) => void;
  onOpenSocialIconGallery: (moduleId: string, itemId: string) => void;
  onUploadMediaForModule: (moduleId: string, file: File | null) => void;
  onUploadButtonBackgroundMedia: (moduleId: string, file: File | null) => void;
  onOpenSectionBackgroundGallery: () => void;
  onUploadSectionBackgroundMedia: (file: File | null) => void;
  onOpenModulePalette: (column: string, anchor?: { x: number; y: number }) => void;
};

function getModulePaletteAnchorFromButton(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

export function BuilderSectionCard({
  section,
  sectionIndex,
  editorDevice,
  isEmailTemplate = false,
  isCollapsed,
  expandedModuleIds,
  onToggleCollapsed,
  onMoveUp,
  onMoveDown,
  onRemove,
  onCloneSection,
  onSaveSection,
  onUpdateSection,
  onUpdateCellBackground,
  onUpdateCellPadding,
  onUpdateCellBorderWidth,
  onUpdateCellBorderColor,
  onUpdateCellBorderRadius,
  onToggleModuleExpanded,
  onUpdateModule,
  onUpdateModuleBackground,
  onMoveModule,
  onDropModule,
  onRemoveModule,
  onCloneModule,
  onSaveModule,
  cellModules,
  pages = [],
  products,
  onSaveCellModules,
  onInsertCellModule,
  onInsertSavedModule,
  onOpenGallery,
  onOpenRichTextGallery,
  onUploadRichTextGalleryImage,
  onOpenButtonBackgroundGallery,
  onOpenSocialIconGallery,
  onUploadMediaForModule,
  onUploadButtonBackgroundMedia,
  onOpenSectionBackgroundGallery,
  onUploadSectionBackgroundMedia,
  onOpenModulePalette
}: BuilderSectionCardProps) {
  const columns = getLayoutColumns(section.layout);
  const savedCells = cellModules.filter((cellModule) => cellModule.modules.length !== 1);
  const savedModules = cellModules.filter((cellModule) => cellModule.modules.length === 1);
  const getSavedModuleOptionLabel = (cellModule: BuilderCellModuleRecord) => {
    const moduleType = cellModule.modules.length === 1 ? cellModule.modules[0]?.type : "";
    const paletteItem = modulePaletteItems.find((item) => item.type === moduleType);
    const paletteGroup = modulePaletteGroups.find((group) => group.value === (paletteItem?.group ?? moduleType));
    const moduleClass = cellModule.moduleClass || paletteGroup?.label || (cellModule.modules.length !== 1 ? "Layout" : "");

    return moduleClass ? `${moduleClass} - ${cellModule.name}` : cellModule.name;
  };
  const [collapsedCellPanels, setCollapsedCellPanels] = useState<Record<string, { styles: boolean; content: boolean }>>({});
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const displayTitle = section.title?.trim() || `Section ${sectionIndex + 1}`;

  function handleTitleClick() {
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }

  function handleTitleBlur() {
    setIsEditingTitle(false);
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Escape") {
      setIsEditingTitle(false);
    }
  }

  const columnModuleMap = useMemo(
    () =>
      Object.fromEntries(columns.map((column) => [column, section.modules.filter((module) => module.column === column)])),
    [columns, section.modules]
  );

  function getCellPanelState(column: string) {
    return collapsedCellPanels[column] ?? { styles: true, content: true };
  }

  function toggleCellPanel(column: string, panel: "styles" | "content") {
    setCollapsedCellPanels((current) => {
      const state = current[column] ?? { styles: true, content: true };
      return {
        ...current,
        [column]: {
          ...state,
          [panel]: !state[panel]
        }
      };
    });
  }

  function getCellStyle(column: string): CSSProperties {
    const borderStyle = (section as unknown as Record<string, Record<string, string>>).cellBorderStyle?.[column] ?? "solid";
    const borderWidth = Number.parseInt(section.cellBorderWidth[column] ?? "0", 10);
    const borderRadius = Number.parseInt(section.cellBorderRadius[column] ?? "24", 10);
    const shadow = (section as unknown as Record<string, Record<string, string>>).cellShadow?.[column] ?? "none";
    const opacity = (section as unknown as Record<string, Record<string, string>>).cellOpacity?.[column];

    const shadowMap: Record<string, string> = {
      none: "none",
      light: "0 2px 8px rgba(0,0,0,0.08)",
      medium: "0 4px 16px rgba(0,0,0,0.14)",
      heavy: "0 8px 32px rgba(0,0,0,0.22)"
    };

    return {
      ...resolveBuilderDrillDownSurfaceBackground(section.cellBackgrounds[column], "column"),
      ...getVerticalMarginStyle(section.cellVerticalMargin?.[column] ?? "0"),
      padding: `${section.cellPadding[column] ?? "18"}px`,
      borderStyle: borderStyle === "none" ? "none" : borderStyle,
      borderWidth: borderStyle === "none" ? 0 : `${Math.max(Number.isFinite(borderWidth) ? borderWidth : 0, 0)}px`,
      borderColor: section.cellBorderColor[column] ?? "transparent",
      borderRadius: `${Math.max(Number.isFinite(borderRadius) ? borderRadius : 24, 0)}px`,
      boxShadow: shadowMap[shadow] ?? "none",
      opacity: opacity ? Number.parseFloat(opacity) : undefined
    };
  }

  function getSectionStyle(): CSSProperties {
    return {
      ...getSectionMarginStyle(section)
    };
  }

  function encodeDragPayload(moduleId: string, column: string) {
    return JSON.stringify({
      moduleId,
      sourceSectionId: section.id,
      sourceColumn: column
    });
  }

  function readDragPayload(event: DragEvent<HTMLElement>) {
    try {
      const raw = event.dataTransfer.getData("application/normie-builder-module");
      return raw ? (JSON.parse(raw) as { moduleId: string; sourceSectionId: string; sourceColumn: string }) : null;
    } catch {
      return null;
    }
  }

  function handleModuleDrop(
    event: DragEvent<HTMLElement>,
    targetColumn: string,
    targetBeforeModuleId?: string
  ) {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (!payload?.moduleId || !payload?.sourceSectionId) return;
    onDropModule(payload.moduleId, payload.sourceSectionId, section.id, targetColumn, targetBeforeModuleId);
  }

  function getCellExtra(column: string, key: string, fallback = "") {
    return (section as unknown as Record<string, Record<string, string>>)[key]?.[column] ?? fallback;
  }

  function setCellExtra(column: string, key: string, value: string) {
    onUpdateSection((current) => ({
      ...current,
      [key]: {
        ...((current as unknown as Record<string, Record<string, string>>)[key] ?? {}),
        [column]: value
      }
    }));
  }

  return (
    <article className="builder-section-card" style={getSectionStyle()}>
      <div aria-expanded={!isCollapsed} className="builder-section-header">
        <div className="builder-section-title">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              className="builder-section-title-input"
              type="text"
              value={section.title ?? ""}
              onChange={(event) =>
                onUpdateSection((current) => ({ ...current, title: event.target.value }))
              }
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              placeholder={`Section ${sectionIndex + 1}`}
              autoFocus
            />
          ) : (
            <button
              className="builder-section-title-label"
              onClick={handleTitleClick}
              title="Click to rename"
              type="button"
            >
              <strong>{displayTitle}</strong>
              <span className="builder-section-title-edit-hint">✎</span>
            </button>
          )}
        </div>
        <div className="builder-section-actions">
          <button aria-label={isCollapsed ? "Expand section" : "Collapse section"} className="builder-icon-button" onClick={onToggleCollapsed} title={isCollapsed ? "Expand section" : "Collapse section"} type="button"><BuilderCollapseIcon expanded={!isCollapsed} /></button>
          <button aria-label="Move section up" className="builder-icon-button" onClick={onMoveUp} title="Move section up" type="button">↑</button>
          <button aria-label="Move section down" className="builder-icon-button" onClick={onMoveDown} title="Move section down" type="button">↓</button>
          <button aria-label="Clone section" className="builder-icon-button" onClick={onCloneSection} title="Clone section" type="button">⧉</button>
          <button aria-label="Save section" className="builder-icon-button" onClick={onSaveSection} title="Save section" type="button">💾</button>
          <button aria-label="Delete section" className="builder-icon-button builder-icon-button-danger" onClick={onRemove} title="Delete section" type="button">✕</button>
        </div>
      </div>

      {!isCollapsed ? (
        <>
          <BuilderSectionControls
            section={section}
            editorDevice={editorDevice}
            onUpdateSection={onUpdateSection}
            onOpenSectionBackgroundGallery={onOpenSectionBackgroundGallery}
            onUploadSectionBackgroundMedia={onUploadSectionBackgroundMedia}
          />

          <div
            className={`builder-columns builder-columns-${columns.length} ${getAlignmentClass(section.alignment)}`}
            style={{ gridTemplateColumns: getLayoutGridTemplate(section.layout) }}
          >
            {columns.map((column) => {
              const columnModules = columnModuleMap[column] ?? [];
              const cellPanels = getCellPanelState(column);
              return (
                <div
                  className="builder-column-card"
                  key={column}
                  style={getCellStyle(column)}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={(event) => handleModuleDrop(event, column)}
                >
                  {columnModules.length > 0 ? (
                    <div className="builder-column-header">
                      <strong>{column}</strong>
                    </div>
                  ) : null}

                  <div className="builder-cell-panel">
                    <BuilderCellPanelHeader
                      isCollapsed={cellPanels.styles}
                      onToggle={() => toggleCellPanel(column, "styles")}
                      panelName={editorDevice === "mobile" ? "Mobile styles" : "Styles"}
                      title={editorDevice === "mobile" ? "Mobile" : "Styles"}
                    />

                    {!cellPanels.styles ? (
                      <BuilderCellStyleSettings
                        column={column}
                        section={section}
                        editorDevice={editorDevice}
                        onUpdateCellBackground={onUpdateCellBackground}
                        onUpdateCellPadding={onUpdateCellPadding}
                        onUpdateCellBorderWidth={onUpdateCellBorderWidth}
                        onUpdateCellBorderColor={onUpdateCellBorderColor}
                        onUpdateCellBorderRadius={onUpdateCellBorderRadius}
                        onSetCellExtra={setCellExtra}
                        getCellExtra={getCellExtra}
                      />
                    ) : null}
                  </div>

                  <div className="builder-cell-panel">
                    <BuilderCellPanelHeader
                      isCollapsed={cellPanels.content}
                      headingActions={
                        <button
                          className="submit-button admin-blog-add-button builder-panel-heading-button"
                          disabled={columnModules.length === 0}
                          onClick={() => onSaveCellModules(column)}
                          type="button"
                        >
                          Save Cell
                        </button>
                      }
                      onToggle={() => toggleCellPanel(column, "content")}
                      panelName="Content"
                      title="Content"
                    />

                    {!cellPanels.content ? (
                      <>
                        <div className="builder-cell-repository-actions">
                          <label className="builder-cell-repository-dropdown">
                            <select
                              defaultValue=""
                              onChange={(event) => {
                                const cellModuleId = event.target.value;
                                if (!cellModuleId) return;
                                onInsertCellModule(column, cellModuleId);
                                event.target.value = "";
                              }}
                            >
                              <option disabled value="">
                                Saved Cells
                              </option>
                              {savedCells.map((cellModule) => (
                                <option key={cellModule.id} value={cellModule.id}>
                                  {getSavedModuleOptionLabel(cellModule)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="builder-cell-repository-dropdown">
                            <select
                              defaultValue=""
                              onChange={(event) => {
                                const cellModuleId = event.target.value;
                                if (!cellModuleId) return;
                                onInsertSavedModule(column, cellModuleId);
                                event.target.value = "";
                              }}
                            >
                              <option disabled value="">
                                Saved Modules
                              </option>
                              {savedModules.map((cellModule) => (
                                <option key={cellModule.id} value={cellModule.id}>
                                  {getSavedModuleOptionLabel(cellModule)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {columnModules.length === 0 ? (
                          <button
                            className="builder-column-empty-button"
                            onClick={(event) => onOpenModulePalette(column, getModulePaletteAnchorFromButton(event.currentTarget))}
                            type="button"
                          >
                            <span className="builder-column-empty-plus">+</span>
                          </button>
                        ) : (
                          <div className="builder-module-list">
                            {columnModules.map((module, moduleIndex) => (
                              <div
                                className="builder-module-stack-item"
                                key={module.id}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  event.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(event) => handleModuleDrop(event, column, module.id)}
                              >
                                <BuilderModuleCard
                                  isEmailTemplate={isEmailTemplate}
                                  module={module}
                                  pages={pages}
                                  products={products}
                                  sectionId={section.id}
                                  editorDevice={editorDevice}
                                  isExpanded={expandedModuleIds.includes(module.id)}
                                  onToggleExpanded={() => onToggleModuleExpanded(module.id)}
                                  onUpdateModule={(updater) => onUpdateModule(module.id, updater)}
                                  onUpdateModuleBackground={(updater) => onUpdateModuleBackground(module.id, updater)}
                                  onMoveUp={() => onMoveModule(module.id, -1)}
                                  onMoveDown={() => onMoveModule(module.id, 1)}
                                  onRemove={() => onRemoveModule(module.id)}
                                  onClone={() => onCloneModule(section.id, module.id)}
                                  onSaveModule={() => onSaveModule(module.id)}
                                  onOpenGallery={() => onOpenGallery(module.id)}
                                  onOpenRichTextGallery={(anchor) => onOpenRichTextGallery(module.id, anchor)}
                                  onUploadRichTextGalleryImage={onUploadRichTextGalleryImage}
                                  onOpenButtonBackgroundGallery={() => onOpenButtonBackgroundGallery(module.id)}
                                  onOpenSocialIconGallery={(itemId) => onOpenSocialIconGallery(module.id, itemId)}
                                  onUploadMedia={(file) => onUploadMediaForModule(module.id, file)}
                                  onUploadButtonBackgroundMedia={(file) => onUploadButtonBackgroundMedia(module.id, file)}
                                  onModuleDragStart={(event) => {
                                    if (cancelBuilderDragIfFormField(event)) {
                                      return;
                                    }

                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData(
                                      "application/normie-builder-module",
                                      encodeDragPayload(module.id, column)
                                    );
                                  }}
                                />
                                {moduleIndex === columnModules.length - 1 ? (
                                  <button
                                    aria-label="Add module"
                                    className="builder-column-add-circle builder-column-add-button-inline"
                                    onClick={(event) =>
                                      onOpenModulePalette(column, getModulePaletteAnchorFromButton(event.currentTarget))
                                    }
                                    type="button"
                                  >
                                    +
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </article>
  );
}
