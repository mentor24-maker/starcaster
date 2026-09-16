/**
 * Per-device styles for rows and for the cells inside them: what each looks
 * like on a tablet or a phone, and how an edit made on one of those screens
 * is stored.
 *
 * The rule (Dane, 2026-09-15): a device FOLLOWS the screen above it until a
 * setting is changed there. Desktop → tablet → phone. So a device map stores
 * only the settings that differ from what it would otherwise inherit, and
 * setting a value back to the inherited one removes it rather than pinning it.
 * That is what keeps a later desktop change flowing down to every screen that
 * never asked to be different.
 */
import {
  BUILDER_CELL_DEVICE_KEY_NORMALIZERS,
  BUILDER_SECTION_DEVICE_KEY_NORMALIZERS,
  normalizeCellDeviceOverrides,
  normalizeSectionDeviceOverrides,
  type BuilderStyleDevice,
  type BuilderTemplateSection
} from "./builder-template";

/** The editor's three choices. Desktop is the row's own fields. */
export type BuilderEditorStyleDevice = "desktop" | BuilderStyleDevice;

/** Tablet settings apply at this width and below. */
export const BUILDER_TABLET_MAX_WIDTH = 1024;
/** Phone settings apply at this width and below (and win over tablet). */
export const BUILDER_PHONE_MAX_WIDTH = 767;

export const BUILDER_SECTION_DEVICE_KEYS = Object.keys(BUILDER_SECTION_DEVICE_KEY_NORMALIZERS);

export const BUILDER_DEVICE_LABELS: Record<BuilderEditorStyleDevice, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  phone: "Phone"
};

/** The screens whose maps apply to `device`, in the order they apply. */
function deviceChain(device: BuilderEditorStyleDevice): BuilderStyleDevice[] {
  if (device === "tablet") return ["tablet"];
  if (device === "phone") return ["tablet", "phone"];
  return [];
}

/** The screen a device inherits from. */
function parentDevice(device: BuilderStyleDevice): BuilderEditorStyleDevice {
  return device === "phone" ? "tablet" : "desktop";
}

function desktopValues(section: BuilderTemplateSection): Record<string, string> {
  const values: Record<string, string> = {};
  const record = section as unknown as Record<string, unknown>;
  for (const key of BUILDER_SECTION_DEVICE_KEYS) {
    values[key] = key === "hidden" ? "false" : String(record[key] ?? "");
  }
  return values;
}

/** Every device-changeable setting as it applies on `device`. */
export function resolveSectionDeviceValues(
  section: BuilderTemplateSection,
  device: BuilderEditorStyleDevice
): Record<string, string> {
  const values = desktopValues(section);
  for (const step of deviceChain(device)) {
    Object.assign(values, section.deviceOverrides?.[step] ?? {});
  }
  return values;
}

/**
 * The row as it looks on `device` — the same shape the renderer and the
 * settings panel already read, so neither needs to know devices exist.
 */
export function resolveSectionForDevice(
  section: BuilderTemplateSection,
  device: BuilderEditorStyleDevice
): BuilderTemplateSection {
  if (device === "desktop") return section;
  const { hidden: _hidden, ...values } = resolveSectionDeviceValues(section, device);
  return { ...section, ...values } as BuilderTemplateSection;
}

export function isSectionHiddenOnDevice(section: BuilderTemplateSection, device: BuilderEditorStyleDevice) {
  return resolveSectionDeviceValues(section, device).hidden === "true";
}

/** The setting names this device changes itself (not the ones it inherits). */
export function listSectionDeviceOverrideKeys(section: BuilderTemplateSection, device: BuilderEditorStyleDevice) {
  if (device === "desktop") return [];
  return Object.keys(section.deviceOverrides?.[device] ?? {});
}

function withDeviceMap(
  section: BuilderTemplateSection,
  device: BuilderStyleDevice,
  map: Record<string, string>
): BuilderTemplateSection {
  const next = normalizeSectionDeviceOverrides({ ...(section.deviceOverrides ?? {}), [device]: map });
  const { deviceOverrides: _previous, ...rest } = section;
  return next ? { ...rest, deviceOverrides: next } : (rest as BuilderTemplateSection);
}

/**
 * Applies an edit made while looking at `device`.
 *
 * `updater` receives the row as it looks on that device (so the panel's own
 * update functions work unchanged) and returns the edited row. Only settings
 * the edit actually changed are considered: one that now matches what the
 * device inherits is removed from its map, anything else is stored. Changes
 * to settings a device cannot hold are ignored — the panel hides those.
 */
export function writeSectionDeviceEdit(
  section: BuilderTemplateSection,
  device: BuilderEditorStyleDevice,
  updater: (resolved: BuilderTemplateSection) => BuilderTemplateSection
): BuilderTemplateSection {
  if (device === "desktop") return updater(section);

  const before = resolveSectionForDevice(section, device) as unknown as Record<string, unknown>;
  const after = updater(before as unknown as BuilderTemplateSection) as unknown as Record<string, unknown>;
  const inherited = resolveSectionDeviceValues(section, parentDevice(device));
  const map = { ...(section.deviceOverrides?.[device] ?? {}) };

  for (const key of BUILDER_SECTION_DEVICE_KEYS) {
    if (key === "hidden" || after[key] === before[key]) continue;
    const value = BUILDER_SECTION_DEVICE_KEY_NORMALIZERS[key](after[key]);
    if (value === inherited[key]) delete map[key];
    else map[key] = value;
  }

  return withDeviceMap(section, device, map);
}

export function setSectionHiddenOnDevice(
  section: BuilderTemplateSection,
  device: BuilderStyleDevice,
  hidden: boolean
): BuilderTemplateSection {
  const inherited = resolveSectionDeviceValues(section, parentDevice(device));
  const map = { ...(section.deviceOverrides?.[device] ?? {}) };
  const value = hidden ? "true" : "false";
  if (value === inherited.hidden) delete map.hidden;
  else map.hidden = value;
  return withDeviceMap(section, device, map);
}

/** Puts one setting — or, with no key, every setting — back to following. */
export function resetSectionDeviceOverride(
  section: BuilderTemplateSection,
  device: BuilderStyleDevice,
  key?: string
): BuilderTemplateSection {
  if (!key) return withDeviceMap(section, device, {});
  const map = { ...(section.deviceOverrides?.[device] ?? {}) };
  delete map[key];
  return withDeviceMap(section, device, map);
}

/* ------------------------------------------------------------------------ *
 * CELLS
 *
 * The same model one level down (device styles 2 of 4, task 86bc14pey). A
 * cell is not an object in this codebase — every cell setting is a map on the
 * row, keyed by column — so a cell's device map is keyed by device, then by
 * column, then by setting, and these helpers take the column as an argument
 * everywhere the row helpers above take nothing.
 *
 * Background and overlay are deliberately not here: a cell's fill and its
 * tint are one value for every screen.
 * ------------------------------------------------------------------------ */

export const BUILDER_CELL_DEVICE_KEYS = Object.keys(BUILDER_CELL_DEVICE_KEY_NORMALIZERS);

/**
 * A cell setting's DESKTOP value, read exactly the way the renderer and the
 * cell panel read it — including the two older generations of key underneath
 * the four padding sides.
 *
 * Reading it any other way would break the promise this whole file exists
 * for: "set it back to what it inherits and the key goes away" is only true
 * if the inherited value is the one actually being painted. A cell whose
 * padding lives in the 2026-08-11 vertical/horizontal pair would otherwise
 * inherit 0, and every phone edit would be stored as a difference from a
 * number nobody can see.
 */
function cellDesktopValues(section: BuilderTemplateSection, column: string): Record<string, string> {
  const record = section as unknown as Record<string, Record<string, string> | undefined>;
  const legacyPadding = section.cellPadding?.[column] ?? "0";
  const side = (key: string, pair: string, fallback: string) =>
    record[key]?.[column] ?? record[pair]?.[column] ?? fallback;

  return {
    cellPaddingTop: side("cellPaddingTop", "cellVerticalPadding", legacyPadding),
    cellPaddingBottom: side("cellPaddingBottom", "cellVerticalPadding", legacyPadding),
    cellPaddingLeft: side("cellPaddingLeft", "cellHorizontalPadding", legacyPadding),
    cellPaddingRight: side("cellPaddingRight", "cellHorizontalPadding", legacyPadding),
    cellMarginTop: side("cellMarginTop", "cellVerticalMargin", "0"),
    cellMarginBottom: side("cellMarginBottom", "cellVerticalMargin", "0"),
    cellMarginLeft: record.cellMarginLeft?.[column] ?? "0",
    cellMarginRight: record.cellMarginRight?.[column] ?? "0",
    cellBorderWidth: record.cellBorderWidth?.[column] ?? "0",
    cellBorderColor: record.cellBorderColor?.[column] ?? "transparent",
    cellBorderRadius: record.cellBorderRadius?.[column] ?? "0",
    cellBorderStyle: record.cellBorderStyle?.[column] ?? "solid",
    cellHAlign: record.cellHAlign?.[column] ?? "left",
    cellVAlign: record.cellVAlign?.[column] ?? "top",
    hidden: "false"
  };
}

/** Every device-changeable cell setting as it applies to `column` on `device`. */
export function resolveCellDeviceValues(
  section: BuilderTemplateSection,
  column: string,
  device: BuilderEditorStyleDevice
): Record<string, string> {
  const values = cellDesktopValues(section, column);
  /*
   * The cell's old "Hide on Mobile" answers the same question this control
   * asks, so a cell carrying it reads as hidden on Phone — otherwise the
   * checkbox would show unticked beside a column that is demonstrably gone on
   * a phone. It is a SEED, not a pin: a device map that names `hidden` wins
   * below, and `setCellHiddenOnDevice` retires the old field the first time
   * this control is used, so the two can never both be answering.
   */
  if (device === "phone" && section.cellMobileHidden?.[column] === "true") {
    values.hidden = "true";
  }
  for (const step of deviceChain(device)) {
    Object.assign(values, section.cellDeviceOverrides?.[step]?.[column] ?? {});
  }
  return values;
}

export function isCellHiddenOnDevice(
  section: BuilderTemplateSection,
  column: string,
  device: BuilderEditorStyleDevice
) {
  return resolveCellDeviceValues(section, column, device).hidden === "true";
}

/** The cell settings this device changes itself (not the ones it inherits). */
export function listCellDeviceOverrideKeys(
  section: BuilderTemplateSection,
  column: string,
  device: BuilderEditorStyleDevice
) {
  if (device === "desktop") return [];
  return Object.keys(section.cellDeviceOverrides?.[device]?.[column] ?? {});
}

/**
 * The ROW as `device` sees its cells — every column's device values written
 * into the cell maps the renderer and the cell panel already read.
 *
 * A whole section rather than one cell's values, for the same reason
 * `resolveSectionForDevice` returns one: it is the shape both of those
 * already take, so neither has to learn that devices exist. `hidden` is left
 * out because it is not a cell map — it becomes `display:none` in the
 * generated CSS instead.
 */
export function resolveSectionForCellDevice(
  section: BuilderTemplateSection,
  device: BuilderEditorStyleDevice
): BuilderTemplateSection {
  if (device === "desktop") return section;

  const byKey: Record<string, Record<string, string>> = {};
  for (const step of deviceChain(device)) {
    for (const [column, map] of Object.entries(section.cellDeviceOverrides?.[step] ?? {})) {
      for (const [key, value] of Object.entries(map)) {
        if (key === "hidden") continue;
        (byKey[key] ??= {})[column] = value;
      }
    }
  }
  if (Object.keys(byKey).length === 0) return section;

  const record = { ...(section as unknown as Record<string, unknown>) };
  for (const [key, byColumn] of Object.entries(byKey)) {
    record[key] = { ...((record[key] as Record<string, string> | undefined) ?? {}), ...byColumn };
  }
  return record as unknown as BuilderTemplateSection;
}

function withCellDeviceMap(
  section: BuilderTemplateSection,
  device: BuilderStyleDevice,
  column: string,
  map: Record<string, string>
): BuilderTemplateSection {
  const forDevice = { ...(section.cellDeviceOverrides?.[device] ?? {}) };
  if (Object.keys(map).length > 0) forDevice[column] = map;
  else delete forDevice[column];

  const next = normalizeCellDeviceOverrides(
    { ...(section.cellDeviceOverrides ?? {}), [device]: forDevice },
    section.layout
  );
  const { cellDeviceOverrides: _previous, ...rest } = section;
  return next ? { ...rest, cellDeviceOverrides: next } : (rest as BuilderTemplateSection);
}

/**
 * Applies an edit made to ONE cell while looking at `device`.
 *
 * `updater` receives the whole row as that device sees its cells, so the cell
 * panel's own writers (`setCellExtra`, the border callbacks) work unchanged.
 * Only the named column is considered, and only the settings the edit
 * actually changed: one that now matches what the cell inherits is removed
 * from its map, anything else is stored.
 */
export function writeCellDeviceEdit(
  section: BuilderTemplateSection,
  column: string,
  device: BuilderEditorStyleDevice,
  updater: (resolved: BuilderTemplateSection) => BuilderTemplateSection
): BuilderTemplateSection {
  if (device === "desktop") return updater(section);

  const beforeSection = resolveSectionForCellDevice(section, device);
  const afterSection = updater(beforeSection);
  const before = resolveCellDeviceValues(section, column, device);
  const after = cellDesktopValues(afterSection, column);
  const inherited = resolveCellDeviceValues(section, column, parentDevice(device));
  const map = { ...(section.cellDeviceOverrides?.[device]?.[column] ?? {}) };

  for (const key of BUILDER_CELL_DEVICE_KEYS) {
    if (key === "hidden" || after[key] === before[key]) continue;
    const value = BUILDER_CELL_DEVICE_KEY_NORMALIZERS[key](after[key]);
    if (value === inherited[key]) delete map[key];
    else map[key] = value;
  }

  return withCellDeviceMap(section, device, column, map);
}

export function setCellHiddenOnDevice(
  section: BuilderTemplateSection,
  column: string,
  device: BuilderStyleDevice,
  hidden: boolean
): BuilderTemplateSection {
  /*
   * Using this control RETIRES the cell's old "Hide on Mobile" for this
   * column, and that is what keeps unticking the box from doing nothing: the
   * legacy field is read as a phone seed above, so leaving it in place would
   * have the map say "follows desktop" while the old field went on hiding the
   * column. Two fields answering one question is how a control goes dead.
   */
  const base =
    device === "phone" && section.cellMobileHidden?.[column] === "true"
      ? ({
          ...section,
          cellMobileHidden: { ...section.cellMobileHidden, [column]: "false" }
        } as BuilderTemplateSection)
      : section;

  const inherited = resolveCellDeviceValues(base, column, parentDevice(device));
  const map = { ...(base.cellDeviceOverrides?.[device]?.[column] ?? {}) };
  const value = hidden ? "true" : "false";
  if (value === inherited.hidden) delete map.hidden;
  else map.hidden = value;
  return withCellDeviceMap(base, device, column, map);
}

/** Puts one cell setting — or, with no key, all of them — back to following. */
export function resetCellDeviceOverride(
  section: BuilderTemplateSection,
  column: string,
  device: BuilderStyleDevice,
  key?: string
): BuilderTemplateSection {
  if (!key) return withCellDeviceMap(section, device, column, {});
  const map = { ...(section.cellDeviceOverrides?.[device]?.[column] ?? {}) };
  delete map[key];
  return withCellDeviceMap(section, device, column, map);
}
