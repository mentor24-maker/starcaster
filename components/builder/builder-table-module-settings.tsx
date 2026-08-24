"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import type {
  BackgroundSettings,
  BuilderPageRecord,
  BuilderTemplateModule
} from "@/lib/builder-template";
import { createEmptyModule, isPlainTextVariant, normalizeBuilderAssetUrl } from "@/lib/builder-template";
import {
  cloneTableCellModule,
  countCellModulesOutside,
  parseTableData,
  serializeTableData,
  type ParsedTableData
} from "@/lib/builder-table-data";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderButtonModuleSettings } from "./builder-button-module-settings";
import { BuilderCenteredModal } from "./builder-centered-modal";
import { BuilderCollapseIcon } from "./builder-collapse-icon";
import { BuilderHeadingModuleSettings } from "./builder-heading-module-settings";
import { BuilderImageModuleSettings } from "./builder-image-module-settings";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField } from "./builder-module-field";
import { BuilderModulePaletteModal } from "./builder-module-palette-modal";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import {
  BuilderSchemaModuleSettings,
  marginFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderSimpleTextModuleSettings } from "./builder-simple-text-module-settings";
import { type BuilderThemePalette } from "./builder-theme-color-field";
import { PLAIN_TEXT_PLACEHOLDER, type ModulePaletteGroup, type ModulePaletteItem } from "./builder-types";
import { getModuleAlignment, getModuleBackgroundSettings } from "./builder-utils";

/**
 * Categories a table cell cannot host: another table (nested grids), and the
 * two form modules whose submit flow needs to own the section it sits in.
 */
const TABLE_CELL_EXCLUDED_PALETTE_GROUPS: ModulePaletteGroup[] = ["table", "contact-form", "crm-form"];

const MAX_COLUMNS = 10;
const MAX_ROWS = 100;

/**
 * Max Width presets (C1 — a dropdown of knowable values, not a free-form
 * number), with "Full width" as the None option (empty string, which is what
 * the renderer reads as unconstrained).
 */
const MAX_WIDTH_PRESETS = ["400", "500", "600", "700", "800", "900", "1000", "1200", "1400"];

/* ---------- Table cell module list ---------- */

function TableCellModules({
  cellKey,
  modules,
  pages = [],
  themeColors = [],
  renderCellPreview,
  onUpdate
}: {
  cellKey: string;
  modules: BuilderTemplateModule[];
  pages?: BuilderPageRecord[];
  themeColors?: BuilderThemePalette;
  renderCellPreview: (module: BuilderTemplateModule) => ReactNode;
  onUpdate: (cellKey: string, modules: BuilderTemplateModule[]) => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteGroup, setPaletteGroup] = useState<ModulePaletteGroup | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function addModule(item: ModulePaletteItem) {
    const mod = createEmptyModule(item.type, "");
    const newMod = { ...mod, name: item.name, text: item.text, settings: { ...mod.settings, ...item.settings } };
    onUpdate(cellKey, [...modules, newMod]);
    closePalette();
  }

  function closePalette() {
    setPaletteOpen(false);
    setPaletteGroup(null);
  }

  function removeModule(id: string) {
    onUpdate(cellKey, modules.filter((m) => m.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function moveModule(id: string, direction: -1 | 1) {
    const index = modules.findIndex((m) => m.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= modules.length) return;
    const nextModules = [...modules];
    const [moved] = nextModules.splice(index, 1);
    nextModules.splice(targetIndex, 0, moved);
    onUpdate(cellKey, nextModules);
  }

  function updateModuleField(id: string, field: string, value: string) {
    onUpdate(cellKey, modules.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  }

  function updateModuleSettings(id: string, updates: Record<string, string>) {
    onUpdate(
      cellKey,
      modules.map((m) =>
        m.id === id ? { ...m, settings: { ...m.settings, ...updates } } : m
      )
    );
  }

  function updateCellModule(id: string, updater: (current: BuilderTemplateModule) => BuilderTemplateModule) {
    onUpdate(cellKey, modules.map((m) => (m.id === id ? updater(m) : m)));
  }

  return (
    <div className="builder-table-cell-modules" onClick={(e) => e.stopPropagation()}>
      {modules.map((mod) => (
        <div key={mod.id} className="builder-table-cell-module">
          <div className="builder-table-cell-module-header">
            <button
              aria-expanded={editingId === mod.id}
              type="button"
              className="builder-table-cell-module-toggle"
              onClick={() => setEditingId(editingId === mod.id ? null : mod.id)}
            >
              <span className="builder-table-cell-module-label">{mod.name || mod.type}</span>
              <span className="builder-collapse-chevron"><BuilderCollapseIcon expanded={editingId === mod.id} /></span>
            </button>
            <button type="button" className="builder-icon-button" onClick={() => moveModule(mod.id, -1)} title="Move up">↑</button>
            <button type="button" className="builder-icon-button" onClick={() => moveModule(mod.id, 1)} title="Move down">↓</button>
            <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeModule(mod.id)} title="Remove">✕</button>
          </div>
          <div className="builder-table-cell-module-preview">{renderCellPreview(mod)}</div>
          {editingId === mod.id && (
            <BuilderCenteredModal
              title={mod.name || mod.type}
              onClose={() => setEditingId(null)}
            >
            <div className="builder-table-cell-module-editor is-lattice">
              {/*
                * W0: the cell editor's own fields go in a lattice column like
                * any other panel. They were bare `label.field` pairs — label
                * stacked above a full-width box — which is how drilling into
                * an image inside a table cell reached a modal the lattice had
                * never touched (operator 8/12).
                */}
              <div className="builder-schema-panel-columns" style={{ "--builder-axis-count": "1" } as CSSProperties}>
                <div className="builder-schema-panel-column">
                  {/* "Module" rather than "Content": the nested panel below
                      brings its own Content axis, and two Content headings a
                      few hundred pixels apart read as a bug. */}
                  <div className="builder-schema-group-title">Module</div>
                  <BuilderModuleField label="Module label" width="text-md">
                    <input type="text" value={mod.name} onChange={(e) => updateModuleField(mod.id, "name", e.target.value)} placeholder="Internal label" />
                  </BuilderModuleField>

                  {(mod.type === "text" || mod.type === "heading") && (
                    <BuilderSettingRow label="Alignment" fullWidth>
                      <BuilderAlignmentIconGroup
                        value={getModuleAlignment(mod.settings)}
                        onChange={(alignment) => updateModuleSettings(mod.id, { alignment })}
                      />
                    </BuilderSettingRow>
                  )}

                  {mod.type === "text" && (
                    <BuilderModuleField label="Content" width="full">
                      {/* Simple Text (PR #154) renders no <p>, so it edits as plain
                          text — a rich-text editor here would inject the markup the
                          variant exists to avoid. */}
                      {isPlainTextVariant(mod.settings) ? (
                        <textarea
                          className="builder-textarea"
                          value={mod.text}
                          onChange={(event) => updateModuleField(mod.id, "text", event.target.value)}
                          placeholder={PLAIN_TEXT_PLACEHOLDER}
                          rows={3}
                        />
                      ) : (
                        <BuilderRichTextEditor value={mod.text} onChange={(value) => updateModuleField(mod.id, "text", value)} />
                      )}
                    </BuilderModuleField>
                  )}

                  {mod.type === "quote" && (
                    <BuilderModuleField label="Content" width="full">
                      <textarea className="builder-textarea" value={mod.text} onChange={(e) => updateModuleField(mod.id, "text", e.target.value)} placeholder="Enter content" rows={2} />
                    </BuilderModuleField>
                  )}

                  {mod.type === "image" && (
                    <>
                      <BuilderModuleField label="Media URL" width="full">
                        <BuilderImagePickerField
                          value={mod.settings.url ?? ""}
                          onChange={(url) => updateModuleSettings(mod.id, { url })}
                        />
                      </BuilderModuleField>
                      <BuilderSettingRow label="Alignment" fullWidth>
                        <BuilderAlignmentIconGroup
                          value={getModuleAlignment(mod.settings)}
                          onChange={(alignment) => updateModuleSettings(mod.id, { alignment })}
                        />
                      </BuilderSettingRow>
                      <BuilderModuleField label="Link" width="full">
                        <div className="builder-image-link-row">
                          {pages.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) updateModuleSettings(mod.id, { linkUrl: e.target.value });
                              }}
                            >
                              <option value="">— Page —</option>
                              {pages.map((p) => (
                                <option key={p.id} value={`/${p.slug}`}>{p.name}</option>
                              ))}
                            </select>
                          )}
                          <input
                            type="text"
                            value={mod.settings.linkUrl ?? ""}
                            onChange={(e) => updateModuleSettings(mod.id, { linkUrl: normalizeBuilderAssetUrl(e.target.value) })}
                            placeholder="/path-or-url"
                          />
                        </div>
                      </BuilderModuleField>
                      <BuilderModuleField label="New Tab" width="check">
                        <input
                          type="checkbox"
                          checked={mod.settings.newTab === "true"}
                          onChange={(e) => updateModuleSettings(mod.id, { newTab: e.target.checked ? "true" : "false" })}
                        />
                      </BuilderModuleField>
                    </>
                  )}
                </div>
              </div>

              {mod.type === "heading" ? (
                <BuilderHeadingModuleSettings
                  compact
                  module={mod}
                  themeColors={themeColors}
                  onUpdateModule={(updater) => {
                    onUpdate(cellKey, modules.map((item) => (item.id === mod.id ? updater(item) : item)));
                  }}
                />
              ) : null}

              {mod.type === "text" && isPlainTextVariant(mod.settings) ? (
                <BuilderSimpleTextModuleSettings
                  compact
                  module={mod}
                  themeColors={themeColors}
                  onUpdateModule={(updater) => {
                    onUpdate(cellKey, modules.map((item) => (item.id === mod.id ? updater(item) : item)));
                  }}
                />
              ) : null}

              {/* The cell button gets the SAME panel as a button in a
                  section — it used to get four hand-rolled fields (label,
                  link, two colours) and nothing else, so a button dropped in
                  a table cell had no padding, no border, no alignment, no
                  margins and no size. Doctrine E1/C8: one editor per module
                  type, wherever the module lives. */}
              {mod.type === "button" ? (
                <BuilderButtonModuleSettings
                  compact
                  module={mod}
                  themeColors={themeColors}
                  onUpdateModule={(updater) => updateCellModule(mod.id, updater)}
                />
              ) : null}

              {mod.type === "image" ? (
                <BuilderImageModuleSettings
                  module={mod}
                  themeColors={themeColors}
                  onUpdateModule={(updater) => updateCellModule(mod.id, updater)}
                />
              ) : null}
            </div>
            </BuilderCenteredModal>
          )}
        </div>
      ))}
      <div className="builder-table-cell-add-wrap">
        <button
          type="button"
          className="builder-table-cell-add"
          onClick={(e) => {
            e.stopPropagation();
            if (paletteOpen) {
              closePalette();
            } else {
              setPaletteGroup(null);
              setPaletteOpen(true);
            }
          }}
          title="Add module to this cell"
        >
          ⊕
        </button>
        {paletteOpen && (
          <BuilderModulePaletteModal
            activeGroup={paletteGroup}
            excludeGroups={TABLE_CELL_EXCLUDED_PALETTE_GROUPS}
            onSelectGroup={setPaletteGroup}
            onSelectItem={addModule}
            onClose={closePalette}
          />
        )}
      </div>
    </div>
  );
}

type BuilderTableModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (module: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  renderCellPreview: (module: BuilderTemplateModule) => ReactNode;
  pages?: BuilderPageRecord[];
  themeColors?: BuilderThemePalette;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

/**
 * Table — extracted from builder-module-card.tsx and put on the schema
 * generator (2026-08-11). It was one of six editors still hand-rolled inside
 * that file, so the whole D8 axis sweep of 2026-08-10 passed it by; the
 * screenshot that prompted this showed a panel with no axis headings at all.
 *
 * D8 axes: Structure / Placement / Frame. The grid itself renders BELOW the
 * axes at full width, under its own "Content" heading — it is wide bespoke UI
 * (D7), and squeezing a multi-column editable table into a quarter-width axis
 * column would crop it (L4).
 *
 * Rules closed here, each a FAIL in docs/UI_RULES_AUDIT.md §3:
 *  - S1  the editor is schema-generated, in its own file
 *  - S2  the universal Background / Alignment / margin chrome exists at last —
 *        table was `isTableModule ? null` in the chrome ternary and offered
 *        NONE of it, while the renderer honoured margins the whole time (C7)
 *  - C8  the shared BuilderBackgroundControls, not the button-only picker
 *  - W3  Max Width is a preset dropdown (C1), not a stretched number input
 *  - T3  rows carry delete as well as clone
 *
 * A1 sort: nothing moves to Advanced. Border width/colour are the module's
 * own settings with a hardcoded `#cccccc` fallback, not theme-backed values —
 * making them theme overrides (A2) needs a theme border token that does not
 * exist yet. If D8's open Themes question lands, the Frame axis empties and
 * this drops to two axes.
 *
 * W7 judgement call, flagged for the operator: "Cell Padding" keeps its name.
 * W7 fixes the four spacing labels for a module's OWN box; this one is the
 * padding inside every cell, a different quantity, and renaming it "Vertical
 * Padding" would need the renderer to grow a second key.
 */
export function BuilderTableModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  renderCellPreview,
  pages = [],
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: BuilderTableModuleSettingsProps) {
  const td = parseTableData(module.settings);
  const colCount = td.headers.length;

  function persist(newTd: ParsedTableData) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, tableData: serializeTableData(newTd) } }));
  }

  /** Cells outside the kept region, dropped and re-keyed in one pass. */
  function keepRegion(keptColumns: number, keptRows: number): ParsedTableData["cells"] {
    const nextCells: ParsedTableData["cells"] = {};
    for (const [key, mods] of Object.entries(td.cells)) {
      const [rawRow, rawCol] = key.split("-");
      const row = Number.parseInt(rawRow, 10);
      const col = Number.parseInt(rawCol, 10);
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
      if (row < keptRows && col < keptColumns) nextCells[key] = mods;
    }
    return nextCells;
  }

  /**
   * Shrinking the grid throws content away, and the count control can drop
   * several columns at once where the old ± buttons dropped one per click —
   * so it says what is about to be lost first.
   */
  function confirmShrink(keptColumns: number, keptRows: number): boolean {
    const lost = countCellModulesOutside(td, keptColumns, keptRows);
    if (lost === 0) return true;
    return window.confirm(
      `That removes ${lost} module${lost === 1 ? "" : "s"} from the cells being deleted. Continue?`
    );
  }

  function setColumnCount(next: string) {
    const target = Math.min(MAX_COLUMNS, Math.max(1, Number.parseInt(next, 10) || 1));
    if (target === colCount) return;

    if (target > colCount) {
      const headers = [...td.headers];
      while (headers.length < target) headers.push(`Column ${headers.length + 1}`);
      persist({ ...td, headers });
      return;
    }

    if (!confirmShrink(target, td.rowCount)) return;
    persist({ headers: td.headers.slice(0, target), cells: keepRegion(target, td.rowCount), rowCount: td.rowCount });
  }

  function setRowCount(next: string) {
    const target = Math.min(MAX_ROWS, Math.max(1, Number.parseInt(next, 10) || 1));
    if (target === td.rowCount) return;

    if (target > td.rowCount) {
      persist({ ...td, rowCount: target });
      return;
    }

    if (!confirmShrink(colCount, target)) return;
    persist({ ...td, cells: keepRegion(colCount, target), rowCount: target });
  }

  function cloneRow(rowIndex: number) {
    if (td.rowCount >= MAX_ROWS) return;

    const nextCells: ParsedTableData["cells"] = {};

    for (const [key, modules] of Object.entries(td.cells)) {
      const [rawRow, rawCol] = key.split("-");
      const sourceRow = Number.parseInt(rawRow, 10);

      if (!Number.isFinite(sourceRow)) {
        nextCells[key] = modules;
        continue;
      }

      if (sourceRow <= rowIndex) {
        nextCells[key] = modules;
      } else {
        nextCells[`${sourceRow + 1}-${rawCol}`] = modules;
      }
    }

    for (let col = 0; col < colCount; col++) {
      const sourceModules = td.cells[`${rowIndex}-${col}`] || [];
      nextCells[`${rowIndex + 1}-${col}`] = sourceModules.map((mod, moduleIndex) =>
        cloneTableCellModule(mod, `${rowIndex + 1}-${col}-${moduleIndex}`)
      );
    }

    persist({ ...td, cells: nextCells, rowCount: td.rowCount + 1 });
  }

  /** T3 — a CRUD row carries its full action set; clone alone was half of it. */
  function deleteRow(rowIndex: number) {
    if (td.rowCount <= 1) return;

    const inRow = td.headers.reduce((total, _, col) => total + (td.cells[`${rowIndex}-${col}`]?.length ?? 0), 0);
    if (inRow > 0 && !window.confirm(`Delete row ${rowIndex + 1} and the ${inRow} module${inRow === 1 ? "" : "s"} in it?`)) {
      return;
    }

    const nextCells: ParsedTableData["cells"] = {};
    for (const [key, modules] of Object.entries(td.cells)) {
      const [rawRow, rawCol] = key.split("-");
      const row = Number.parseInt(rawRow, 10);
      if (!Number.isFinite(row)) continue;
      if (row === rowIndex) continue;
      nextCells[row < rowIndex ? key : `${row - 1}-${rawCol}`] = modules;
    }

    persist({ ...td, cells: nextCells, rowCount: td.rowCount - 1 });
  }

  function updateHeader(index: number, value: string) {
    const newHeaders = [...td.headers];
    newHeaders[index] = value;
    persist({ ...td, headers: newHeaders });
  }

  function updateCellModules(cellKey: string, modules: BuilderTemplateModule[]) {
    persist({ ...td, cells: { ...td.cells, [cellKey]: modules } });
  }

  const storedMaxWidth = module.settings.tableMaxWidth ?? "";
  const maxWidthOptions = MAX_WIDTH_PRESETS.includes(storedMaxWidth) || storedMaxWidth === ""
    ? MAX_WIDTH_PRESETS
    : [...MAX_WIDTH_PRESETS, storedMaxWidth].sort((a, b) => Number(a) - Number(b));

  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Structure",
        strips: [
          [
            {
              key: "tableColumns",
              label: "Columns",
              width: "num",
              control: "custom",
              rendersVia: "TableModulePreview",
              render: () => (
                <select
                  className="builder-number-select-control"
                  value={String(colCount)}
                  onChange={(event) => setColumnCount(event.target.value)}
                >
                  {Array.from({ length: MAX_COLUMNS }, (_, i) => String(i + 1)).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              )
            },
            {
              key: "tableRows",
              label: "Rows",
              width: "num",
              control: "custom",
              rendersVia: "TableModulePreview",
              render: () => (
                <select
                  className="builder-number-select-control"
                  value={String(td.rowCount)}
                  onChange={(event) => setRowCount(event.target.value)}
                >
                  {Array.from({ length: MAX_ROWS }, (_, i) => String(i + 1)).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              )
            }
          ],
          [
            {
              key: "showColumnHeads",
              label: "Column Heads",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "TableModulePreview"
            }
          ],
          [
            {
              key: "tableMaxWidth",
              label: "Max Width",
              width: "select-md",
              control: "custom",
              rendersVia: "TableModulePreview",
              render: (ctx) => (
                <select
                  value={ctx.settings.tableMaxWidth ?? ""}
                  onChange={(event) => ctx.set("tableMaxWidth", event.target.value)}
                >
                  <option value="">Full width</option>
                  {maxWidthOptions.map((option) => (
                    <option key={option} value={option}>{option}px</option>
                  ))}
                </select>
              )
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "alignment",
              label: "Alignment",
              width: "align",
              control: "align",
              ariaLabel: "Table alignment",
              rendersVia: "TableModulePreview"
            }
          ],
          [...marginFields("getModuleOuterSpacingStyle", 160)],
          [
            {
              key: "cellPadding",
              label: "Cell Padding",
              width: "num",
              control: "number",
              min: 2,
              max: 24,
              fallback: "8",
              rendersVia: "TableModulePreview"
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "borderWidth",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              // Matches normalizeBuilderModuleSettingsForType's 0–24 clamp. The
              // old control stopped at 6, so a module normalized above that had
              // a value its own editor could not show — and picking any option
              // silently wrote the value down.
              max: 24,
              fallback: "1",
              rendersVia: "TableModulePreview"
            },
            {
              key: "borderColor",
              label: "Border Color",
              width: "color",
              control: "color",
              dialogLabel: "Table border color",
              fallback: "#cccccc",
              rendersVia: "TableModulePreview"
            }
          ],
          [
            {
              key: "background",
              label: "Background",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "TableModulePreview",
              render: () => (
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                  themeBackgroundColor={themeBackgroundColor}
                  themeColors={themeColors}
                  themePrimaryColor={themePrimaryColor}
                />
              )
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-table-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />

      <div className="builder-schema-group-title">Content</div>
      <div className="builder-table-editor-scroll">
        {/* L6a, titled-column grid shape. This manager IS a spreadsheet — the
            column titles are the operator's own table headers — so one
            labelled block per item would be absurd for it. `data-lattice-
            columns` puts it under check_panels the way the Navigation Links
            list is: n counts every titled column including the Row actions
            column, and the check then holds it to rendering rows, putting n
            cells on each line, one offset and one width per column, and each
            title sitting over the column it titles.

            Being a real <table>, it shares its tracks by construction rather
            than by two containers agreeing — which is the failure the Links
            list spent months with. */}
        <table
          className="builder-table-editor builder-table-editor-modules"
          data-lattice-columns={td.headers.length + 1}
        >
          <thead>
            <tr>
              <th className="builder-table-row-action-heading">Row</th>
              {td.headers.map((h, i) => (
                <th key={i}>
                  <input type="text" value={h} onChange={(e) => updateHeader(i, e.target.value)} placeholder={`Header ${i + 1}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: td.rowCount }, (_, ri) => (
              <tr key={ri}>
                <td className="builder-table-row-actions">
                  <button type="button" className="builder-icon-button" onClick={() => cloneRow(ri)} disabled={td.rowCount >= MAX_ROWS} title="Clone row">
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="builder-icon-button builder-icon-button-danger"
                    onClick={() => deleteRow(ri)}
                    disabled={td.rowCount <= 1}
                    title="Delete row"
                  >
                    ✕
                  </button>
                </td>
                {td.headers.map((_, ci) => (
                  <td key={ci} className="builder-table-editor-cell">
                    <TableCellModules
                      cellKey={`${ri}-${ci}`}
                      modules={td.cells[`${ri}-${ci}`] || []}
                      pages={pages}
                      themeColors={themeColors}
                      renderCellPreview={renderCellPreview}
                      onUpdate={updateCellModules}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
