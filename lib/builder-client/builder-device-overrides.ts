/**
 * Per-device row styles: what a row looks like on a tablet or a phone, and
 * how an edit made on one of those screens is stored.
 *
 * The rule (Dane, 2026-09-15): a device FOLLOWS the screen above it until a
 * setting is changed there. Desktop → tablet → phone. So a device map stores
 * only the settings that differ from what it would otherwise inherit, and
 * setting a value back to the inherited one removes it rather than pinning it.
 * That is what keeps a later desktop change flowing down to every screen that
 * never asked to be different.
 */
import {
  BUILDER_SECTION_DEVICE_KEY_NORMALIZERS,
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
