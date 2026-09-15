import type { CSSProperties } from "react";
import type { BuilderTemplateSection } from "@/lib/builder-template";
import {
  BUILDER_PHONE_MAX_WIDTH,
  BUILDER_TABLET_MAX_WIDTH,
  isSectionHiddenOnDevice,
  listSectionDeviceOverrideKeys,
  resolveSectionForDevice
} from "@/lib/builder-device-overrides";

/**
 * The CSS that makes a row look different on a tablet or a phone.
 *
 * A row's styles are inline, and an inline style cannot say "only below
 * 1024px" — so the renderer hands this function the SAME style builder it
 * uses for desktop, runs it on the row as each device sees it, and emits only
 * the declarations that came out different. Reusing the builder is the point:
 * a device rule can never disagree with how desktop computes the same value.
 *
 * `!important` is required, not a shortcut: without it the inline desktop
 * value outranks every rule here and nothing changes on a phone.
 *
 * Phone rules are emitted twice — under a media query for the live site, and
 * under `.builder-preview-device-mobile` for the preview's phone frame, which
 * is a narrow box on a wide screen and so never matches a media query.
 */

/**
 * What to write when desktop sets a property and the device's style builder
 * produced nothing for it (the value went back to its default). A custom
 * property is set to `initial`, which makes `var(--x, fallback)` use its
 * fallback — the same as not setting it. The others name their neutral value
 * explicitly, because `initial` on a plain property would also discard what
 * the stylesheet sets (a full-width row's negative side margin, for one).
 */
function resetValue(property: string, resolved: BuilderTemplateSection): string {
  if (property.startsWith("--")) return "initial";
  switch (property) {
    case "marginLeft":
    case "marginRight":
      return resolved.widthMode === "full-width" ? "calc(0px - var(--bx-theme-padding-inline, 0px))" : "0px";
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
      return "initial";
  }
}

function toCssProperty(property: string) {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function declarationsFor(
  desktop: CSSProperties,
  device: CSSProperties,
  resolved: BuilderTemplateSection,
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
    const value = after === undefined ? resetValue(property, resolved) : String(after);
    declarations.push(`${toCssProperty(property)}:${value} !important`);
  }

  if (hidden) declarations.push("display:none !important");
  // A phone that un-hides a row its tablet hid: the tablet rule also matches
  // at phone widths, so the row's own display has to be written back.
  else if (unhide) declarations.push(`display:${String(desktopRecord.display ?? "block")} !important`);
  return declarations;
}

/** Characters that could close the selector or the style element. */
function safeScope(scope: string) {
  return scope.replace(/["\\<>]/g, "");
}

export const BUILDER_DEVICE_SCOPE_ATTRIBUTE = "data-builder-device-scope";

export function buildSectionDeviceCss(
  section: BuilderTemplateSection,
  scope: string,
  styleOf: (section: BuilderTemplateSection) => CSSProperties
): string {
  if (!section.deviceOverrides) return "";

  const hasTablet = listSectionDeviceOverrideKeys(section, "tablet").length > 0;
  const hasPhone = hasTablet || listSectionDeviceOverrideKeys(section, "phone").length > 0;
  if (!hasPhone) return "";

  const selector = `[${BUILDER_DEVICE_SCOPE_ATTRIBUTE}="${safeScope(scope)}"]`;
  const desktop = styleOf(section);
  const rules: string[] = [];

  if (hasTablet) {
    const resolved = resolveSectionForDevice(section, "tablet");
    const declarations = declarationsFor(desktop, styleOf(resolved), resolved, isSectionHiddenOnDevice(section, "tablet"));
    if (declarations.length) {
      rules.push(`@media (max-width:${BUILDER_TABLET_MAX_WIDTH}px){${selector}{${declarations.join(";")}}}`);
    }
  }

  const resolvedPhone = resolveSectionForDevice(section, "phone");
  const phone = declarationsFor(
    desktop,
    styleOf(resolvedPhone),
    resolvedPhone,
    isSectionHiddenOnDevice(section, "phone"),
    isSectionHiddenOnDevice(section, "tablet")
  );
  if (phone.length) {
    rules.push(`@media (max-width:${BUILDER_PHONE_MAX_WIDTH}px){${selector}{${phone.join(";")}}}`);
    rules.push(`.builder-preview-device-mobile ${selector}{${phone.join(";")}}`);
  }

  return rules.join("\n");
}
