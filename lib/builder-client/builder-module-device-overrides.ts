/**
 * Per-device MODULE styles: what one module looks like on a tablet or a
 * phone, and how an edit made on one of those screens is stored.
 *
 * Same rule as rows (Dane, 2026-09-15, and `builder-device-overrides.ts`):
 * a device FOLLOWS the screen above it until a setting is changed there.
 * Desktop -> tablet -> phone. A device therefore stores only what DIFFERS,
 * and putting a value back to the inherited one removes it rather than
 * pinning it, so a later desktop change still flows down.
 *
 * WHERE IT IS STORED is the one thing that differs from a row. A row carries
 * a typed `deviceOverrides` object; a module's settings are a flat
 * `Record<string, string>` that keeps unknown keys, so a device value is a
 * flat key — `tablet.marginTop`, `phone.fontSize`. Nothing in
 * `normalizeBuilderModuleSettingsForType` or `migrateSpacingPairToSides`
 * rewrites or drops those: the first passes every key through `safeText`,
 * and the second only ever reads and writes the bare `margin*` names.
 *
 * THE LEGACY PHONE FIELDS ARE READ AS PHONE FALLBACKS. `mobileHidden`,
 * `mobileAlignment` and `mobileFontSize` predate this and are already live on
 * real pages, so they sit in the phone chain between tablet and `phone.*` —
 * a page nobody has touched resolves on a phone to exactly what it renders
 * today, and a new `phone.*` value simply wins over the old field.
 *
 * AND USING THE PHONE CONTROL RETIRES THE OLD FIELD IT ANSWERS FOR. Two
 * fields answering one question is how a control goes dead: leaving
 * `mobileHidden` in place has the device map say "follows desktop" while the
 * old field goes on hiding the module, so unticking "Hide on Phone" stores
 * nothing and the box snaps back. Every one of the ten keys had that shape
 * (review round 1, 2026-09-15) — a Phone value put back to desktop's was
 * dropped as redundant and then read straight back off the legacy field. The
 * write clears the field for the key it edits, which is what makes the chain
 * the writer compares against and the chain the reader walks the same chain.
 * Rows and cells retire theirs the same way (`builder-device-overrides.ts`).
 */
import {
  HEADLINE_ROTATOR_DEFAULT_FONT_SIZE
} from "./headline-rotator";
import { POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE } from "./poll-category-list";
import {
  BUILDER_STYLE_DEVICES,
  normalizeBooleanText,
  normalizeSignedOffsetValue,
  normalizeSpacingValue,
  type BuilderStyleDevice,
  type BuilderTemplateModuleType
} from "./builder-template";

export type BuilderModuleSettings = Record<string, string>;

/** The editor's three choices. Desktop is the module's own settings. */
export type BuilderEditorStyleDevice = "desktop" | BuilderStyleDevice;

/**
 * THE MODULE SETTINGS A TABLET OR PHONE MAY CHANGE, and how each is cleaned.
 *
 * Each value passes through the very normalizer its desktop field uses, so a
 * phone can never store what desktop could not. Content settings — text,
 * images, links, colours — are deliberately absent: they stay one value for
 * every screen. `hidden` is the one key with no desktop field.
 */
export const BUILDER_MODULE_DEVICE_KEY_NORMALIZERS: Record<string, (value: unknown) => string> = {
  alignment: (value) => (value === "center" || value === "right" ? value : "left"),
  marginTop: (value) => normalizeSpacingValue(value, "0", 0, 160),
  marginBottom: (value) => normalizeSpacingValue(value, "0", 0, 160),
  marginLeft: (value) => normalizeSpacingValue(value, "0", 0, 160),
  marginRight: (value) => normalizeSpacingValue(value, "0", 0, 160),
  horizontalOffset: (value) => normalizeSignedOffsetValue(value, "0"),
  verticalOffset: (value) => normalizeSignedOffsetValue(value, "0"),
  size: (value) => normalizeSpacingValue(value, "100", 25, 100),
  fontSize: (value) => normalizeSpacingValue(value, "32", 10, 120),
  hidden: (value) => normalizeBooleanText(value)
};

export const BUILDER_MODULE_DEVICE_KEYS = Object.keys(BUILDER_MODULE_DEVICE_KEY_NORMALIZERS);

/** Plain names for the settings a device can change, for the "differs" list. */
export const BUILDER_MODULE_DEVICE_SETTING_NAMES: Record<string, string> = {
  alignment: "Alignment",
  marginTop: "Margin top",
  marginBottom: "Margin bottom",
  marginLeft: "Margin left",
  marginRight: "Margin right",
  horizontalOffset: "Horizontal offset",
  verticalOffset: "Vertical offset",
  size: "Width",
  fontSize: "Font size",
  hidden: "Hidden"
};

/** Only these three carry a font size of their own — and a `mobileFontSize`. */
const FONT_SIZE_TYPES = new Set<string>(["heading", "headline-rotator", "poll-category-list"]);
/** Width % is offered on the Simple/Rich Text module only, as on desktop. */
const WIDTH_TYPES = new Set<string>(["text"]);

/** Each type's own desktop default for a key that has one. */
function fontSizeDefault(type: string) {
  if (type === "headline-rotator") return HEADLINE_ROTATOR_DEFAULT_FONT_SIZE;
  if (type === "poll-category-list") return POLL_CATEGORY_LIST_DEFAULT_FONT_SIZE;
  return "32";
}

/** The keys this module type actually offers, in panel order. */
export function listModuleDeviceKeys(type: BuilderTemplateModuleType | string): string[] {
  return BUILDER_MODULE_DEVICE_KEYS.filter((key) => {
    if (key === "fontSize") return FONT_SIZE_TYPES.has(String(type));
    if (key === "size") return WIDTH_TYPES.has(String(type));
    return true;
  });
}

/** The screens whose values apply to `device`, in the order they apply. */
function deviceChain(device: BuilderEditorStyleDevice): BuilderStyleDevice[] {
  if (device === "tablet") return ["tablet"];
  if (device === "phone") return ["tablet", "phone"];
  return [];
}

/** The screen a device inherits from. */
function parentDevice(device: BuilderStyleDevice): BuilderEditorStyleDevice {
  return device === "phone" ? "tablet" : "desktop";
}

export function moduleDeviceKey(device: BuilderStyleDevice, key: string) {
  return `${device}.${key}`;
}

/**
 * Desktop's own value for every device-changeable key.
 *
 * The margins read the pre-2026-08-11 vertical/horizontal PAIR when a side
 * of its own is unset, exactly as `getFourSideValues` does — otherwise a page
 * that has not been re-saved would see a phone panel full of zeroes beside a
 * page rendering 24px.
 */
function desktopValues(settings: BuilderModuleSettings, type: string): Record<string, string> {
  const normalize = BUILDER_MODULE_DEVICE_KEY_NORMALIZERS;
  return {
    alignment: normalize.alignment(settings.alignment),
    marginTop: normalize.marginTop(settings.marginTop ?? settings.verticalMargin ?? "0"),
    marginBottom: normalize.marginBottom(settings.marginBottom ?? settings.verticalMargin ?? "0"),
    marginLeft: normalize.marginLeft(settings.marginLeft ?? settings.horizontalMargin ?? "0"),
    marginRight: normalize.marginRight(settings.marginRight ?? settings.horizontalMargin ?? "0"),
    horizontalOffset: normalize.horizontalOffset(settings.horizontalOffset ?? "0"),
    verticalOffset: normalize.verticalOffset(settings.verticalOffset ?? "0"),
    size: normalize.size(settings.size ?? "100"),
    fontSize: normalize.fontSize(settings.fontSize || fontSizeDefault(type)),
    hidden: "false"
  };
}

/**
 * The pre-device field that answers for each device key on a phone. One
 * place, because the reader below and the writer at the bottom of this file
 * MUST agree about it: a reader that consults a field the writer cannot
 * clear is a control that does nothing.
 */
const MODULE_LEGACY_PHONE_FIELDS: Record<string, string> = {
  alignment: "mobileAlignment",
  fontSize: "mobileFontSize",
  hidden: "mobileHidden"
};

/**
 * The pre-device phone fields, as a device map. They apply BELOW `phone.*`
 * and ABOVE tablet, which is what makes an untouched page render on a phone
 * exactly as it does today.
 */
function legacyPhoneValues(settings: BuilderModuleSettings): Record<string, string> {
  const values: Record<string, string> = {};
  if (settings[MODULE_LEGACY_PHONE_FIELDS.alignment]) {
    values.alignment = BUILDER_MODULE_DEVICE_KEY_NORMALIZERS.alignment(
      settings[MODULE_LEGACY_PHONE_FIELDS.alignment]
    );
  }
  if (settings[MODULE_LEGACY_PHONE_FIELDS.fontSize]) {
    values.fontSize = BUILDER_MODULE_DEVICE_KEY_NORMALIZERS.fontSize(
      settings[MODULE_LEGACY_PHONE_FIELDS.fontSize]
    );
  }
  if (settings[MODULE_LEGACY_PHONE_FIELDS.hidden] === "true") values.hidden = "true";
  return values;
}

/**
 * The settings with the pre-device phone field for each named key removed.
 *
 * Only on a phone, and only for the keys the operator actually edited: a
 * phone font size must not retire a module's `mobileAlignment` on its way
 * past. A field is DELETED rather than set to a falsy value so a module that
 * never had one does not gain one.
 */
function retireLegacyPhoneFields(
  settings: BuilderModuleSettings,
  device: BuilderEditorStyleDevice,
  keys: string[]
): BuilderModuleSettings {
  if (device !== "phone") return settings;
  const retiring = keys.map((key) => MODULE_LEGACY_PHONE_FIELDS[key]).filter((field) => field && field in settings);
  if (!retiring.length) return settings;
  const next: BuilderModuleSettings = { ...settings };
  for (const field of retiring) delete next[field];
  return next;
}

/** One device's own stored map, read back off the flat keys. */
export function readModuleDeviceMap(
  settings: BuilderModuleSettings,
  device: BuilderStyleDevice
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of BUILDER_MODULE_DEVICE_KEYS) {
    const stored = settings[moduleDeviceKey(device, key)];
    if (stored === undefined || stored === null || stored === "") continue;
    map[key] = BUILDER_MODULE_DEVICE_KEY_NORMALIZERS[key](stored);
  }
  return map;
}

/** Every device-changeable setting as it applies on `device`. */
export function resolveModuleDeviceValues(
  settings: BuilderModuleSettings,
  type: BuilderTemplateModuleType | string,
  device: BuilderEditorStyleDevice
): Record<string, string> {
  const values = desktopValues(settings, String(type));
  for (const step of deviceChain(device)) {
    if (step === "phone") Object.assign(values, legacyPhoneValues(settings));
    Object.assign(values, readModuleDeviceMap(settings, step));
  }
  return values;
}

/**
 * The module's settings as they apply on `device` — the same flat shape the
 * renderer and the settings panel already read, so neither needs to know
 * devices exist. `hidden` is dropped: it is not a settings key.
 */
export function resolveModuleSettingsForDevice(
  settings: BuilderModuleSettings,
  type: BuilderTemplateModuleType | string,
  device: BuilderEditorStyleDevice
): BuilderModuleSettings {
  if (device === "desktop") return settings;
  const { hidden: _hidden, ...values } = resolveModuleDeviceValues(settings, type, device);
  return { ...settings, ...values };
}

export function isModuleHiddenOnDevice(
  settings: BuilderModuleSettings,
  type: BuilderTemplateModuleType | string,
  device: BuilderEditorStyleDevice
) {
  return resolveModuleDeviceValues(settings, type, device).hidden === "true";
}

/** The setting names this device changes ITSELF (not the ones it inherits). */
export function listModuleDeviceOverrideKeys(
  settings: BuilderModuleSettings,
  device: BuilderEditorStyleDevice
): string[] {
  if (device === "desktop") return [];
  return BUILDER_MODULE_DEVICE_KEYS.filter((key) => key in readModuleDeviceMap(settings, device));
}

/**
 * The keys that reach `device` from a DEVICE MAP — its own or one above it —
 * never one supplied by a pre-device phone field.
 *
 * This is what the CSS generator emits for, and the distinction is the whole
 * of review round 1's fourth finding. A module's legacy values already reach
 * the page through the stylesheet classes they always did, at 900px. Treating
 * them as "differs from desktop" had one unrelated `tablet.marginTop` drag a
 * module's `mobileFontSize` into a 767px rule carrying `!important` and a
 * three-repeat selector — so a heading on a live client page, rendering at
 * `clamp(1.35rem, 9vw, 2.35rem)` today, would drop to 18px on a phone because
 * somebody set a tablet margin. The answer is per DEVICE AND KEY, not per
 * module: a device emits for the keys somebody chose on a device, full stop.
 */
export function listModuleDeviceChainKeys(
  settings: BuilderModuleSettings,
  device: BuilderEditorStyleDevice
): Set<string> {
  const keys = new Set<string>();
  for (const step of deviceChain(device)) {
    for (const key of Object.keys(readModuleDeviceMap(settings, step))) keys.add(key);
  }
  return keys;
}

/** True when ANY device carries a setting of its own — the `tablet.`/`phone.` keys only. */
export function hasModuleDeviceOverrides(settings: BuilderModuleSettings) {
  return BUILDER_STYLE_DEVICES.some((device) => listModuleDeviceOverrideKeys(settings, device).length > 0);
}

function withDeviceMap(
  settings: BuilderModuleSettings,
  device: BuilderStyleDevice,
  map: Record<string, string>
): BuilderModuleSettings {
  const next: BuilderModuleSettings = { ...settings };
  for (const key of BUILDER_MODULE_DEVICE_KEYS) delete next[moduleDeviceKey(device, key)];
  for (const [key, value] of Object.entries(map)) next[moduleDeviceKey(device, key)] = value;
  return next;
}

/**
 * Applies an edit made while looking at `device`.
 *
 * `updater` receives the settings as they look on that device (so the panel's
 * own update functions work unchanged) and returns the edited settings. Only
 * settings the edit actually changed are considered: one that now matches
 * what the device inherits is removed from its map, anything else is stored.
 * Changes to settings a device cannot hold are ignored — the panel hides
 * those, and a device must never quietly fork a content setting.
 */
export function writeModuleDeviceEdit(
  settings: BuilderModuleSettings,
  type: BuilderTemplateModuleType | string,
  device: BuilderEditorStyleDevice,
  updater: (resolved: BuilderModuleSettings) => BuilderModuleSettings
): BuilderModuleSettings {
  if (device === "desktop") return updater(settings);

  const before = resolveModuleSettingsForDevice(settings, type, device);
  const after = updater(before);
  const edited = listModuleDeviceKeys(type).filter((key) => key !== "hidden" && after[key] !== before[key]);

  /*
   * The edited keys' pre-device fields go FIRST, and everything below reads
   * the retired settings. That is the whole of review round 1: with
   * `mobileFontSize` still in place, a Phone font size put back to desktop's
   * matched what tablet inherits, was dropped as redundant, and then resolved
   * straight back to the legacy value — so the panel accepted 48 and the page
   * went on rendering 18.
   */
  const base = retireLegacyPhoneFields(settings, device, edited);
  const inherited = resolveModuleDeviceValues(base, type, parentDevice(device));
  const map = readModuleDeviceMap(base, device);

  for (const key of edited) {
    const value = BUILDER_MODULE_DEVICE_KEY_NORMALIZERS[key](after[key]);
    if (value === inherited[key]) delete map[key];
    else map[key] = value;
  }

  return withDeviceMap(base, device, map);
}

export function setModuleHiddenOnDevice(
  settings: BuilderModuleSettings,
  type: BuilderTemplateModuleType | string,
  device: BuilderStyleDevice,
  hidden: boolean
): BuilderModuleSettings {
  /*
   * Ticking or unticking this box retires the module's old `mobileHidden`.
   * Without that, unticking "Hide on Phone" on a page that carries the old
   * field writes nothing at all and the box snaps back — the worst of the
   * round 1 findings, and the one a real client page would hit first.
   */
  const base = retireLegacyPhoneFields(settings, device, ["hidden"]);
  const inherited = resolveModuleDeviceValues(base, type, parentDevice(device));
  const map = readModuleDeviceMap(base, device);
  const value = hidden ? "true" : "false";
  if (value === inherited.hidden) delete map.hidden;
  else map.hidden = value;
  return withDeviceMap(base, device, map);
}

/** Puts one setting — or, with no key, every setting — back to following. */
export function resetModuleDeviceOverride(
  settings: BuilderModuleSettings,
  device: BuilderStyleDevice,
  key?: string
): BuilderModuleSettings {
  if (!key) return withDeviceMap(settings, device, {});
  const map = readModuleDeviceMap(settings, device);
  delete map[key];
  return withDeviceMap(settings, device, map);
}
