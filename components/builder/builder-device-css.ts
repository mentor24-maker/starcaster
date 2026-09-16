import type { CSSProperties } from "react";
import type { BuilderStyleDevice, BuilderTemplateSection } from "@/lib/builder-template";
import {
  BUILDER_PHONE_MAX_WIDTH,
  BUILDER_TABLET_MAX_WIDTH,
  isCellHiddenOnDevice,
  isSectionHiddenOnDevice,
  listCellDeviceOverrideKeys,
  listSectionDeviceOverrideKeys,
  resolveSectionForCellDevice,
  resolveSectionForDevice
} from "@/lib/builder-device-overrides";

/**
 * The CSS that makes a row — or one COLUMN of a row — look different on a
 * tablet or a phone.
 *
 * Inline styles are what the renderer paints with, and an inline style cannot
 * say "only below 1024px" — so the renderer hands this file the SAME style
 * builder it uses for desktop, runs it on the row as each device sees it, and
 * emits only the declarations that came out different. Reusing the builder is
 * the point: a device rule can never disagree with how desktop computes the
 * same value.
 *
 * `!important` is required, not a shortcut: without it the inline desktop
 * value outranks every rule here and nothing changes on a phone.
 *
 * Phone rules are emitted twice — under a media query for the live site, and
 * under `.builder-preview-device-mobile` for the preview's phone frame, which
 * is a narrow box on a wide screen and so never matches a media query.
 *
 * ROWS AND CELLS SHARE ALL OF THAT, which is why the cell slice generalized
 * this file rather than copying it (task 86bc14pey). The only things that
 * differ per surface are *which* map says a device has settings, *how* the
 * row resolves for that device, and what a property's neutral value is when
 * the device stops producing one — so those three are the `DeviceSurface`
 * below and everything else is written once.
 */

/** What a device CSS surface has to be able to answer. */
type DeviceSurface = {
  /** Does this device carry settings of its own? */
  hasOwnSettings: (device: BuilderStyleDevice) => boolean;
  /** The row as it is on desktop — what every device rule is a difference from. */
  desktop: BuilderTemplateSection;
  /** The row as this device sees the thing being styled. */
  resolve: (device: BuilderStyleDevice) => BuilderTemplateSection;
  /** Is the thing being styled left out on this device? */
  isHidden: (device: BuilderStyleDevice) => boolean;
  /**
   * What to write when desktop sets a property and the device's style builder
   * produced nothing for it (the value went back to its default). A custom
   * property is set to `initial`, which makes `var(--x, fallback)` use its
   * fallback — the same as not setting it. The others name their neutral
   * value explicitly, because `initial` on a plain property would also
   * discard what the stylesheet sets.
   */
  neutral: (property: string, resolved: BuilderTemplateSection) => string;
  /** The element's display when nothing else sets one — used to un-hide. */
  defaultDisplay: string;
};

/** The neutral values every surface shares. Returns "" when it has no opinion. */
function sharedNeutral(property: string): string {
  if (property.startsWith("--")) return "initial";
  switch (property) {
    case "maxWidth":
      return "none";
    case "transform":
      return "none";
    case "position":
      return "relative";
    case "zIndex":
      return "auto";
    case "border":
      return "none";
    case "borderRadius":
      return "0px";
    default:
      return "";
  }
}

function toCssProperty(property: string) {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function declarationsFor(
  desktop: CSSProperties,
  device: CSSProperties,
  resolved: BuilderTemplateSection,
  surface: DeviceSurface,
  hidden: boolean,
  unhide = false
): string[] {
  const desktopRecord = desktop as Record<string, unknown>;
  const deviceRecord = device as Record<string, unknown>;
  const declarations: string[] = [];
  const properties = new Set([...Object.keys(desktopRecord), ...Object.keys(deviceRecord)]);

  for (const property of properties) {
    const before = desktopRecord[property];
    const after = deviceRecord[property];
    if (after === undefined && before === undefined) continue;
    if (after !== undefined && String(after) === String(before)) continue;
    const value = after === undefined ? surface.neutral(property, resolved) : String(after);
    declarations.push(`${toCssProperty(property)}:${value} !important`);
  }

  if (hidden) declarations.push("display:none !important");
  // A phone that un-hides something its tablet hid: the tablet rule also
  // matches at phone widths, so the element's own display has to be written
  // back.
  else if (unhide) {
    declarations.push(`display:${String(desktopRecord.display ?? surface.defaultDisplay)} !important`);
  }
  return declarations;
}

/** Characters that could close the selector or the style element. */
function safeScope(scope: string) {
  return scope.replace(/["\\<>]/g, "");
}

export const BUILDER_DEVICE_SCOPE_ATTRIBUTE = "data-builder-device-scope";

function buildDeviceCss(
  surface: DeviceSurface,
  scope: string,
  styleOf: (section: BuilderTemplateSection) => CSSProperties
): string {
  const hasTablet = surface.hasOwnSettings("tablet");
  const hasPhone = hasTablet || surface.hasOwnSettings("phone");
  if (!hasPhone) return "";

  const selector = `[${BUILDER_DEVICE_SCOPE_ATTRIBUTE}="${safeScope(scope)}"]`;
  const desktop = styleOf(surface.desktop);
  const rules: string[] = [];

  if (hasTablet) {
    const resolved = surface.resolve("tablet");
    const declarations = declarationsFor(
      desktop,
      styleOf(resolved),
      resolved,
      surface,
      surface.isHidden("tablet")
    );
    if (declarations.length) {
      rules.push(`@media (max-width:${BUILDER_TABLET_MAX_WIDTH}px){${selector}{${declarations.join(";")}}}`);
    }
  }

  const resolvedPhone = surface.resolve("phone");
  const phone = declarationsFor(
    desktop,
    styleOf(resolvedPhone),
    resolvedPhone,
    surface,
    surface.isHidden("phone"),
    surface.isHidden("tablet")
  );
  if (phone.length) {
    rules.push(`@media (max-width:${BUILDER_PHONE_MAX_WIDTH}px){${selector}{${phone.join(";")}}}`);
    rules.push(`.builder-preview-device-mobile ${selector}{${phone.join(";")}}`);
  }

  return rules.join("\n");
}

export function buildSectionDeviceCss(
  section: BuilderTemplateSection,
  scope: string,
  styleOf: (section: BuilderTemplateSection) => CSSProperties
): string {
  if (!section.deviceOverrides) return "";

  return buildDeviceCss(
    {
      hasOwnSettings: (device) => listSectionDeviceOverrideKeys(section, device).length > 0,
      desktop: section,
      resolve: (device) => resolveSectionForDevice(section, device),
      isHidden: (device) => isSectionHiddenOnDevice(section, device),
      neutral: (property, resolved) => {
        // A row's own side margins are the one place `initial` is wrong: a
        // full-width row pulls itself out by the theme's inline padding, and
        // discarding that would leave it contained instead of flush.
        if (property === "marginLeft" || property === "marginRight") {
          return resolved.widthMode === "full-width"
            ? "calc(0px - var(--bx-theme-padding-inline, 0px))"
            : "0px";
        }
        return sharedNeutral(property) || "initial";
      },
      defaultDisplay: "block"
    },
    scope,
    styleOf
  );
}

/**
 * The same, for ONE column of a row.
 *
 * `styleOf` is the renderer's column-style builder already bound to this
 * column, so what it is handed is a whole row with that column's device
 * values written into the cell maps — which is exactly the shape it reads on
 * desktop.
 */
export function buildCellDeviceCss(
  section: BuilderTemplateSection,
  column: string,
  scope: string,
  styleOf: (section: BuilderTemplateSection) => CSSProperties
): string {
  if (!section.cellDeviceOverrides) return "";

  return buildDeviceCss(
    {
      hasOwnSettings: (device) => listCellDeviceOverrideKeys(section, column, device).length > 0,
      desktop: section,
      resolve: (device) => resolveSectionForCellDevice(section, device),
      isHidden: (device) => isCellHiddenOnDevice(section, column, device),
      neutral: (property, _resolved) => {
        switch (property) {
          // A column is `display: grid` in the stylesheet, and only the
          // alignment style ever gives it another one. `initial` here would
          // resolve to `inline` and collapse the whole column.
          case "display":
            return "grid";
          case "marginTop":
          case "marginBottom":
          case "marginLeft":
          case "marginRight":
            return "0px";
          default:
            return sharedNeutral(property) || "initial";
        }
      },
      defaultDisplay: "grid"
    },
    scope,
    styleOf
  );
}
