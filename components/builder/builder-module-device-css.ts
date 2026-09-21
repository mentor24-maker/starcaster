import type { CSSProperties } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BUILDER_PHONE_MAX_WIDTH,
  BUILDER_TABLET_MAX_WIDTH
} from "@/lib/builder-device-overrides";
import {
  hasModuleDeviceOverrides,
  listModuleDeviceChainKeys,
  listModuleDeviceKeys,
  resolveModuleDeviceValues,
  resolveModuleSettingsForDevice,
  type BuilderEditorStyleDevice
} from "@/lib/builder-module-device-overrides";
import { getModuleNudgeTransform, getTextModuleWidthStyle } from "./builder-utils";

/**
 * The CSS that makes ONE MODULE look different on a tablet or a phone.
 *
 * A module's styles are inline, and an inline style cannot say "only below
 * 1024px" — so this emits a scoped rule per device carrying only the
 * settings that came out different from desktop. `!important` is required,
 * not a shortcut: without it the inline desktop value outranks every rule
 * here and nothing changes on a phone.
 *
 * WHY THIS IS NOT `buildSectionDeviceCss` WITH A DIFFERENT ARGUMENT. A row
 * puts every device-changeable style on ONE element, so the row's generator
 * can run the renderer's own style builder twice and diff the two objects. A
 * module's styles land on THREE elements: the margins and the alignment on
 * the wrapper, the width and the nudge on the module's own root, the font
 * size deeper still on the three types that have one. There is no single
 * style object to diff, so this maps each device KEY to the declarations and
 * the element it belongs on. The invariant the diff bought is kept by hand
 * where it matters: `size` and the nudge are computed by the very helpers
 * the renderer uses (`getTextModuleWidthStyle`, `getModuleNudgeTransform`),
 * so a device rule cannot disagree with how desktop computes the same value.
 *
 * Phone rules are emitted twice — under a media query for the live site, and
 * under `.builder-preview-device-mobile` for the preview's phone frame, which
 * is a narrow box on a wide screen and so never matches a media query.
 */

export const BUILDER_MODULE_DEVICE_SCOPE_ATTRIBUTE = "data-builder-module-device-scope";

/**
 * The scope attribute is repeated so the rules outrank the pre-device mobile
 * stylesheet, which is class-based and therefore more specific than a single
 * attribute. The tallest thing to clear is
 * `.builder-react-root .builder-preview-device-mobile .builder-preview-heading:not(...)`
 * at (0,4,0) — three repeats plus a descendant class reaches (0,5,0). It is
 * spelled out here rather than fixed with a `.builder-react-root` prefix
 * because a published tenant page has no such wrapper.
 */
const SCOPE_REPEATS = 3;

/** Characters that could close the selector or the style element. */
function safeScope(scope: string) {
  return scope.replace(/["\\<>]/g, "");
}

function scopeSelector(scope: string) {
  return `[${BUILDER_MODULE_DEVICE_SCOPE_ATTRIBUTE}="${safeScope(scope)}"]`.repeat(SCOPE_REPEATS);
}

function toCssProperty(property: string) {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function declarations(style: CSSProperties): string[] {
  return Object.entries(style as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([property, value]) => `${toCssProperty(property)}:${String(value)} !important`);
}

/** Where each group of declarations goes, relative to the module's scope. */
type TargetSuffix =
  | ""
  | " > *"
  | " > *, SCOPE > * *"
  | " .builder-preview-poll-category-list-items"
  | typeof HEADING_INLINE_SIZED;

/**
 * The pieces of a heading that carry a size of their OWN — a word the rich
 * text toolbar sized, which it writes as `<span style="font-size: 88px">`.
 * An inline style beats a size set on the heading, so a device font size that
 * lands only on the heading changes nothing a visitor can see: Delray's hero
 * headline had every word sized that way, and its Phone Font Size did nothing
 * while "Champions" split mid-word on a phone (86bc3xrhz). They follow the
 * heading instead. Colour and weight on the same span are untouched.
 */
const HEADING_INLINE_SIZED = ' > * [style*="font-size"]';

/** Font size lands on a different element for each of the three types. */
function fontSizeTarget(type: string): TargetSuffix | null {
  if (type === "heading") return " > *";
  if (type === "headline-rotator") return " > *, SCOPE > * *";
  if (type === "poll-category-list") return " .builder-preview-poll-category-list-items";
  return null;
}

/**
 * The declarations one device wants, grouped by the element they land on.
 *
 * A key is written when its resolved value differs from desktop's AND the
 * value came from a device map — `listModuleDeviceChainKeys`. Both halves
 * matter. The first keeps a module that follows desktop emitting nothing at
 * all; the second keeps a module's pre-device `mobileHidden` /
 * `mobileAlignment` / `mobileFontSize` out of these rules entirely, because
 * they already reach the page through their own stylesheet at their own
 * width. Without it, one unrelated tablet margin re-emits a legacy font size
 * at 767px with `!important` on it and a live page moves (review round 1).
 */
function deviceDeclarations(
  module: BuilderTemplateModule,
  device: BuilderEditorStyleDevice
): { byTarget: Map<TargetSuffix, string[]>; hidden: boolean } {
  const type = String(module.type);
  const desktop = resolveModuleDeviceValues(module.settings, type, "desktop");
  const values = resolveModuleDeviceValues(module.settings, type, device);
  const fromADevice = listModuleDeviceChainKeys(module.settings, device);
  const changed = new Set(
    listModuleDeviceKeys(type).filter((key) => fromADevice.has(key) && values[key] !== desktop[key])
  );
  const byTarget = new Map<TargetSuffix, string[]>();
  const add = (target: TargetSuffix, style: CSSProperties) => {
    const lines = declarations(style);
    if (!lines.length) return;
    byTarget.set(target, [...(byTarget.get(target) ?? []), ...lines]);
  };

  const wrapper: CSSProperties = {};
  for (const side of ["Top", "Bottom", "Left", "Right"] as const) {
    const key = `margin${side}`;
    if (changed.has(key)) (wrapper as Record<string, string>)[key] = `${values[key]}px`;
  }
  if (changed.has("alignment")) {
    // The same two declarations the pre-device `mobileAlignment` class writes,
    // so a page carrying the old field and a page carrying `phone.alignment`
    // align identically.
    const alignment = values.alignment;
    wrapper.justifyItems = alignment === "center" ? "center" : alignment === "right" ? "end" : "stretch";
    wrapper.textAlign = alignment as CSSProperties["textAlign"];
  }
  add("", wrapper);

  const resolved = resolveModuleSettingsForDevice(module.settings, type, device);
  const root: CSSProperties = {};
  if (changed.has("alignment")) {
    /*
     * AND on the module's own root, because that is where DESKTOP declares it.
     * `.builder-react-root .is-align-center .builder-preview-heading` sets
     * `justify-self: center; text-align: center` on the CHILD, and a child's
     * own `justify-self` beats the parent's `justify-items` while its own
     * `text-align` beats an inherited one. Writing only the wrapper made the
     * override work in exactly one direction — left to centre moved, centre
     * back to left did not (review round 1, measured in a browser at 420px).
     * `auto` is the child's neutral: the stylesheet declares nothing on the
     * child for `is-align-left`, so the wrapper's `justify-items` decides.
     */
    const alignment = values.alignment;
    root.justifySelf = alignment === "center" ? "center" : alignment === "right" ? "end" : "auto";
    root.textAlign = alignment as CSSProperties["textAlign"];
  }
  if (changed.has("horizontalOffset") || changed.has("verticalOffset")) {
    const transform = getModuleNudgeTransform(resolved);
    root.transform = transform ?? "none";
    root.position = transform ? "relative" : "static";
    if (type === "heading") {
      // `getHeadingModuleStyle` pulls the following content up by the nudge so
      // a raised heading does not leave a gap. Desktop writes those margins
      // inline, so a device that changes the nudge has to rewrite them too or
      // the desktop compensation is left behind. A heading's own base is
      // `margin: 0`, which is why writing both sides here is safe.
      const offsetY = Number.parseInt(values.verticalOffset, 10) || 0;
      root.marginTop = transform && offsetY < 0 ? `${Math.abs(offsetY)}px` : "0px";
      root.marginBottom = transform && offsetY > 0 ? `-${offsetY}px` : "0px";
    }
  }
  if (type === "heading") {
    if (changed.has("lineHeight")) root.lineHeight = values.lineHeight;
    if (changed.has("letterSpacing")) root.letterSpacing = `${values.letterSpacing}px`;
  }
  if (changed.has("size")) {
    const width = getTextModuleWidthStyle(resolved);
    Object.assign(root, {
      width: width?.width ?? "auto",
      maxWidth: "100%",
      marginLeft: width?.marginLeft ?? "0px",
      marginRight: width?.marginRight ?? "0px"
    });
  }
  add(" > *", root);

  if (changed.has("fontSize")) {
    const target = fontSizeTarget(type);
    if (target) add(target, { fontSize: `${values.fontSize}px` });
    if (type === "heading") add(HEADING_INLINE_SIZED, { fontSize: "inherit" });
  }

  // `changed` already carries both halves: desktop `hidden` is always "false",
  // so a key here means a DEVICE asked for the hide. A module carrying only
  // `mobileHidden` emits no display rule and goes on hiding at 900px as it did.
  return { byTarget, hidden: changed.has("hidden") };
}

/**
 * `prefix` is empty for the live-site media queries and
 * `.builder-preview-device-mobile ` for the preview's phone frame, which is a
 * narrow box on a wide screen and so matches no media query of its own.
 */
function ruleBlock(scope: string, byTarget: Map<TargetSuffix, string[]>, prefix = ""): string {
  const selector = `${prefix}${scopeSelector(scope)}`;
  return [...byTarget.entries()]
    .map(([suffix, lines]) => `${selector}${suffix.split("SCOPE").join(selector)}{${lines.join(";")}}`)
    .join("");
}

export function buildModuleDeviceCss(module: BuilderTemplateModule, scope: string): string {
  // Legacy-only pages emit nothing: `mobileHidden`/`mobileAlignment`/
  // `mobileFontSize` are still rendered by the stylesheet classes they always
  // were, at the width they always were. Slice 4 harmonises those widths; a
  // module nobody has opened on a phone must not move before then.
  if (!hasModuleDeviceOverrides(module.settings)) return "";

  const selector = scopeSelector(scope);
  const tablet = deviceDeclarations(module, "tablet");
  const phone = deviceDeclarations(module, "phone");
  const rules: string[] = [];

  const tabletBlock = ruleBlock(scope, tablet.byTarget);
  if (tabletBlock) {
    rules.push(`@media (max-width:${BUILDER_TABLET_MAX_WIDTH}px){${tabletBlock}}`);
    // The preview's Tablet frame is a box on a wide screen, like the phone
    // frame, so it needs its own copy — rows already emit one
    // (`builder-device-css.ts`). Without it a module's Tablet setting showed
    // nowhere the operator could look before publishing.
    rules.push(ruleBlock(scope, tablet.byTarget, ".builder-preview-device-tablet "));
  }
  if (tablet.hidden) {
    // A tablet hide normally applies at phone width too, because a phone
    // follows its tablet. When the phone shows the module again the hide is
    // confined to the tablet BAND instead of being undone by a second
    // `display` declaration — there is no one value to undo it TO (a module
    // in an equal-height row is `display:flex`, everywhere else it is block).
    const query = phone.hidden
      ? `(max-width:${BUILDER_TABLET_MAX_WIDTH}px)`
      : `(min-width:${BUILDER_PHONE_MAX_WIDTH + 1}px) and (max-width:${BUILDER_TABLET_MAX_WIDTH}px)`;
    rules.push(`@media ${query}{${selector}{display:none !important}}`);
    rules.push(`.builder-preview-device-tablet ${selector}{display:none !important}`);
  }

  const frame = ".builder-preview-device-mobile ";
  const hideRule = (prefix: string) => (phone.hidden ? `${prefix}${selector}{display:none !important}` : "");
  const phoneBlock = `${ruleBlock(scope, phone.byTarget)}${hideRule("")}`;
  if (phoneBlock) {
    rules.push(`@media (max-width:${BUILDER_PHONE_MAX_WIDTH}px){${phoneBlock}}`);
    rules.push(`${ruleBlock(scope, phone.byTarget, frame)}${hideRule(frame)}`);
  }

  return rules.join("\n");
}
