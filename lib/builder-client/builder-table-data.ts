import { createEmptyModule, type BuilderTemplateModule } from "./builder-template";

/**
 * The Table module's grid, parsed out of the `tableData` settings string.
 *
 * ONE parser, deliberately. Until 2026-08-11 there were two: the editor's
 * (which migrated the legacy `rows: string[][]` format into cell modules) and
 * the preview/published renderer's (which did not) — so a table saved before
 * the cell-modules rewrite still edited correctly and published EMPTY. Both
 * now call this.
 */
export type ParsedTableData = {
  headers: string[];
  cells: Record<string, BuilderTemplateModule[]>;
  rowCount: number;
};

export function parseTableData(settings: Record<string, string>): ParsedTableData {
  try {
    const data = JSON.parse(settings.tableData || "{}");
    const headers: string[] = Array.isArray(data.headers) ? data.headers : [];

    if (data.cells && typeof data.rowCount === "number") {
      const cells: Record<string, BuilderTemplateModule[]> = {};
      for (const [key, mods] of Object.entries(data.cells)) {
        cells[key] = Array.isArray(mods) ? (mods as BuilderTemplateModule[]) : [];
      }
      return { headers, cells, rowCount: data.rowCount };
    }

    // Legacy format: rows of plain strings, before cells could hold modules.
    if (Array.isArray(data.rows)) {
      const cells: Record<string, BuilderTemplateModule[]> = {};
      for (let ri = 0; ri < data.rows.length; ri++) {
        const row = data.rows[ri];
        if (!Array.isArray(row)) continue;
        for (let ci = 0; ci < row.length; ci++) {
          const text = String(row[ci] || "");
          if (text) {
            const mod = createEmptyModule("text", "");
            mod.text = text;
            mod.name = "Text";
            cells[`${ri}-${ci}`] = [mod];
          }
        }
      }
      return { headers, cells, rowCount: data.rows.length };
    }

    return { headers, cells: {}, rowCount: Math.max(Number(data.rowCount) || 0, 1) };
  } catch {
    return { headers: [], cells: {}, rowCount: 1 };
  }
}

export function serializeTableData(td: ParsedTableData): string {
  return JSON.stringify({ headers: td.headers, cells: td.cells, rowCount: td.rowCount });
}

export function cloneTableCellModule(module: BuilderTemplateModule, suffix: string): BuilderTemplateModule {
  return {
    ...module,
    id: `${module.type}-${Date.now()}-${suffix}`,
    settings: { ...module.settings }
  };
}

/** How many cells in the region about to be removed still hold modules. */
export function countCellModulesOutside(
  td: ParsedTableData,
  keptColumns: number,
  keptRows: number
): number {
  let count = 0;
  for (const [key, mods] of Object.entries(td.cells)) {
    const [rawRow, rawCol] = key.split("-");
    const row = Number.parseInt(rawRow, 10);
    const col = Number.parseInt(rawCol, 10);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    if (row >= keptRows || col >= keptColumns) count += mods.length;
  }
  return count;
}
