/**
 * Every visual setting the Navigation module has, turned into the CSS custom
 * properties `.site-nav` reads.
 *
 * Why this file exists (operator, 2026-08-11): *"The top menu module currently
 * has no style control. The style controls of the container have no effect,
 * and the menu styles need to be completely overhauled."* Both halves of that
 * were literally true:
 *
 *  - `.site-nav`'s fill, border, radius and shadow were **hardcoded** in
 *    `_builder-react.css`, so nothing in the panel could change them.
 *  - `.site-nav-link`'s `font-weight: 700` was hardcoded too, which meant the
 *    Bold checkbox had been a dead control since it shipped (doctrine E7) —
 *    it set `font-weight` on the `<nav>`, and the link rule overrode the
 *    inherited value on every single link.
 *  - `navPadding` / `navBorderRadius` meant *link* padding and *link* radius
 *    on the live site but were applied to the whole *bar* by the React
 *    preview, so the builder and the published page disagreed about what two
 *    of the module's own controls did.
 *
 * The fix is one function. Every default here reproduces exactly what the
 * hardcoded CSS produced, so an untouched menu renders byte-identically and
 * every value is now editable. Keep it that way: a default that drifts from
 * the CSS fallback moves live tenant menus.
 *
 * Pure and colocated-tested (builder-nav-style.test.ts) because it is the only
 * thing standing between a settings key and what a visitor sees.
 */

import type { CSSProperties } from "react";
import { applyBuilderColorOpacity } from "@/lib/builder-hex-color";

type NavSettings = Record<string, string>;

/**
 * The look `.site-nav` had when it was hardcoded. These are the CSS fallbacks
 * as well — `src/css/_builder-react.css` repeats each one as the second half
 * of its `var()`, so a menu rendered without inline vars (email, a stale
 * bundle) still looks right.
 */
export const NAV_STYLE_DEFAULTS = {
  paddingV: 8,
  paddingH: 8,
  gap: 0,
  barRadius: 26,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#e6ecf2",
  shadow: true,
  shadowX: 0,
  shadowY: 16,
  shadowBlur: 40,
  shadowColor: "#0a4970",
  shadowOpacity: 12,
  linkPaddingV: 0,
  linkPaddingH: 14,
  linkRadius: 18,
  linkHeight: 48,
  fontSize: 16,
  weight: 700,
  letterSpacing: 0,
  underline: "none",
  textTransform: "none",
  hoverEffect: "lift",
  textShadow: false,
  textShadowX: 0,
  textShadowY: 1,
  textShadowBlur: 2,
  textShadowColor: "#000000",
  textShadowOpacity: 35,
  dropdownWidth: 160,
  dropdownRadius: 14,
  dropdownBackground: "#ffffff",
  megaColumns: 3,
  megaWidth: 1040
} as const;

export const NAV_UNDERLINE_MODES = ["none", "always", "hover"] as const;
export const NAV_HOVER_EFFECTS = ["none", "lift", "grow", "fade", "underline"] as const;
export const NAV_TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
export const NAV_BORDER_STYLES = ["solid", "dashed", "dotted", "double", "none"] as const;

export type NavUnderlineMode = (typeof NAV_UNDERLINE_MODES)[number];
export type NavHoverEffect = (typeof NAV_HOVER_EFFECTS)[number];

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** An unset colour follows the theme, so only a non-empty value is emitted. */
function color(value: string | undefined): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const trimmed = String(value ?? "").trim() as T;
  return allowed.includes(trimmed) ? trimmed : fallback;
}

/**
 * Checkboxes are stored as "true"/"false" strings, and an unset one has to be
 * able to mean **on** — the bar's shadow was on before it was controllable,
 * so `navShadow` unset must keep it on or every live menu loses its shadow.
 */
function flag(value: string | undefined, fallback: boolean): boolean {
  const trimmed = String(value ?? "").trim();
  // "on" is the legacy truthy the shared dropShadowFields() control accepts;
  // matching it here keeps the two halves of one checkbox in agreement.
  if (trimmed === "true" || trimmed === "on") return true;
  if (trimmed === "false") return false;
  return fallback;
}

export function isNavMegaMenu(settings: NavSettings): boolean {
  return settings.navDropdownStyle === "mega" && settings.navDirection !== "vertical";
}

/** The bar's own drop shadow, or "none". */
export function getNavBarShadow(settings: NavSettings): string {
  if (!flag(settings.navShadow, NAV_STYLE_DEFAULTS.shadow)) return "none";

  const x = num(settings.navShadowX, NAV_STYLE_DEFAULTS.shadowX, -60, 60);
  const y = num(settings.navShadowY, NAV_STYLE_DEFAULTS.shadowY, -60, 60);
  const blur = num(settings.navShadowBlur, NAV_STYLE_DEFAULTS.shadowBlur, 0, 120);
  const spread = num(settings.navShadowSpread, 0, -40, 40);
  const tint = applyBuilderColorOpacity(
    color(settings.navShadowColor) ?? NAV_STYLE_DEFAULTS.shadowColor,
    num(settings.navShadowOpacity, NAV_STYLE_DEFAULTS.shadowOpacity, 0, 100)
  );

  return `${x}px ${y}px ${blur}px ${spread}px ${tint}`;
}

/** The link text shadow, or "none". */
export function getNavTextShadow(settings: NavSettings): string {
  if (!flag(settings.navTextShadow, NAV_STYLE_DEFAULTS.textShadow)) return "none";

  const x = num(settings.navTextShadowX, NAV_STYLE_DEFAULTS.textShadowX, -20, 20);
  const y = num(settings.navTextShadowY, NAV_STYLE_DEFAULTS.textShadowY, -20, 20);
  const blur = num(settings.navTextShadowBlur, NAV_STYLE_DEFAULTS.textShadowBlur, 0, 40);
  const tint = applyBuilderColorOpacity(
    color(settings.navTextShadowColor) ?? NAV_STYLE_DEFAULTS.textShadowColor,
    num(settings.navTextShadowOpacity, NAV_STYLE_DEFAULTS.textShadowOpacity, 0, 100)
  );

  return `${x}px ${y}px ${blur}px ${tint}`;
}

/**
 * Underline is a mode, not a toggle, because "underline on hover" is the one
 * every real menu wants and a checkbox cannot say it. `always` paints the
 * resting state; `hover` paints only the hovered/focused one.
 */
export function getNavUnderline(settings: NavSettings): { rest: string; hover: string } {
  const mode = oneOf<NavUnderlineMode>(
    settings.navUnderline,
    NAV_UNDERLINE_MODES,
    NAV_STYLE_DEFAULTS.underline as NavUnderlineMode
  );

  return {
    rest: mode === "always" ? "underline" : "none",
    hover: mode === "none" ? "none" : "underline"
  };
}

/**
 * The CSS custom properties (plus the handful of direct properties) that
 * `.site-nav` and its descendants read. Everything the operator can set ends
 * up here — doctrine E7 in one direction, and the reason the settings editor
 * can cite `getNavModuleStyle` as its `rendersVia` in the other.
 */
export function getNavModuleStyle(settings: NavSettings): CSSProperties {
  const underline = getNavUnderline(settings);
  const linkColor = color(settings.navColor);
  const hoverColor = color(settings.navHoverColor);

  return {
    // --- the bar ------------------------------------------------------
    "--site-nav-padding": `${num(settings.navPaddingV, NAV_STYLE_DEFAULTS.paddingV, 0, 60)}px ${num(
      settings.navPaddingH,
      NAV_STYLE_DEFAULTS.paddingH,
      0,
      60
    )}px`,
    "--site-nav-gap": `${num(settings.navGap, NAV_STYLE_DEFAULTS.gap, 0, 40)}px`,
    /*
     * The bar's fill when the Background control is set to None.
     *
     * A set background arrives as a real `background:` declaration from
     * getBuilderBackgroundStyle and beats this, because an inline property
     * outranks a stylesheet rule reading a variable. So this only ever
     * decides what "cleared" looks like — and it has to be transparent, or
     * clearing the control does nothing at all, which is what it did.
     */
    "--site-nav-bg": "transparent",
    "--site-nav-radius": `${num(settings.navBarRadius, NAV_STYLE_DEFAULTS.barRadius, 0, 80)}px`,
    // Three parts rather than one shorthand: the generated
    // `_builder-react.css` already uses `--site-nav-border` for a colour
    // alone, and a name meaning two different things is a trap even when
    // cascade order happens to save you.
    "--site-nav-border-width": `${num(settings.navBorderWidth, NAV_STYLE_DEFAULTS.borderWidth, 0, 20)}px`,
    "--site-nav-border-style": oneOf(
      settings.navBorderStyle,
      NAV_BORDER_STYLES,
      NAV_STYLE_DEFAULTS.borderStyle
    ),
    "--site-nav-border-color": color(settings.navBorderColor) ?? NAV_STYLE_DEFAULTS.borderColor,
    "--site-nav-shadow": getNavBarShadow(settings),

    // --- the links ----------------------------------------------------
    // navPadding / navBorderRadius keep their live-site meaning (the LINK,
    // not the bar). The React preview used to apply both to the <nav>; that
    // is the disagreement this file ends.
    "--site-nav-link-padding": `${num(settings.navLinkPaddingV, NAV_STYLE_DEFAULTS.linkPaddingV, 0, 40)}px ${num(
      settings.navLinkPaddingH,
      NAV_STYLE_DEFAULTS.linkPaddingH,
      0,
      60
    )}px`,
    "--site-nav-link-radius": `${num(settings.navBorderRadius, NAV_STYLE_DEFAULTS.linkRadius, 0, 48)}px`,
    "--site-nav-link-height": `${num(settings.navLinkHeight, NAV_STYLE_DEFAULTS.linkHeight, 24, 96)}px`,
    "--site-nav-link-weight": String(num(settings.navWeight, NAV_STYLE_DEFAULTS.weight, 100, 900)),
    "--site-nav-link-style": flag(settings.navItalic, false) ? "italic" : "normal",
    "--site-nav-link-transform": oneOf(
      settings.navTextTransform,
      NAV_TEXT_TRANSFORMS,
      NAV_STYLE_DEFAULTS.textTransform
    ),
    "--site-nav-link-spacing": `${num(settings.navLetterSpacing, NAV_STYLE_DEFAULTS.letterSpacing, -4, 12)}px`,
    "--site-nav-link-decoration": underline.rest,
    "--site-nav-link-hover-decoration": underline.hover,
    "--site-nav-link-text-shadow": getNavTextShadow(settings),

    /*
     * EVERY COLOUR BELOW IS EMITTED, ALWAYS — even when the operator has
     * cleared it. That is the whole point of this block.
     *
     * Operator, 2026-08-12: "All I want to do is clear the color of the
     * background for the menu as well as the links themselves. The menu has a
     * background setting and I can set it to any color I want. I just can't
     * clear it."
     *
     * He was exactly right, and the reason was here. These used to be left
     * `undefined` when empty, so the CSS `var(--x, <hardcoded>)` fallback
     * painted instead — clearing a setting did not clear anything, it just
     * revealed the colour baked into the stylesheet. Measured before the fix:
     * clearing Background left the bar at rgba(255,255,255,0.74), and the
     * current page's link stayed rgb(10,143,196) no matter what.
     *
     * So an empty value now resolves to `transparent`, which is what "cleared"
     * has to mean, and the CSS fallbacks are only there for a menu rendered
     * without inline vars at all.
     */
    "--site-nav-link-color": linkColor,
    // The label's own fill, at rest. There was no such control and no CSS
    // for it — a link only had a background while you hovered it, which is
    // what the operator meant on 2026-08-11 by having no control over "the
    // background colors of the labels".
    "--site-nav-link-bg": color(settings.navLinkBackground) ?? "transparent",
    "--site-nav-link-hover-color": hoverColor ?? linkColor,
    "--site-nav-link-hover-bg": color(settings.navHoverBackground) ?? "transparent",
    /*
     * The current page follows Text Color unless it is given its own.
     *
     * It used to fall back to a hardcoded blue, which is why setting Text
     * Color to white left the page you were looking at stubbornly blue — the
     * one link on screen that ignored the control (operator, 2026-08-12: "it
     * still won't render the text as white").
     */
    "--site-nav-link-active-color": color(settings.navActiveColor) ?? hoverColor ?? linkColor,
    "--site-nav-link-active-bg":
      color(settings.navActiveBackground) ?? color(settings.navHoverBackground) ?? "transparent",

    // --- the dropdown / mega panel ------------------------------------
    "--site-nav-dropdown-bg": color(settings.navDropdownBackground) ?? NAV_STYLE_DEFAULTS.dropdownBackground,
    "--site-nav-dropdown-color": color(settings.navDropdownTextColor) ?? linkColor,
    "--site-nav-dropdown-radius": `${num(
      settings.navDropdownRadius,
      NAV_STYLE_DEFAULTS.dropdownRadius,
      0,
      40
    )}px`,
    "--site-nav-dropdown-width": `${num(settings.navDropdownWidth, NAV_STYLE_DEFAULTS.dropdownWidth, 100, 480)}px`,
    "--site-nav-mega-width": `${num(settings.navMegaWidth, NAV_STYLE_DEFAULTS.megaWidth, 320, 1600)}px`,

    // --- direct properties --------------------------------------------
    fontSize: `${num(settings.navFontSize, NAV_STYLE_DEFAULTS.fontSize, 10, 48)}px`,
    color: linkColor
  } as CSSProperties;
}

/**
 * Class modifiers for the states CSS cannot reach through a variable —
 * a hover effect is a different `transform`/`opacity` rule, not a value.
 */
export function getNavModuleClassNames(settings: NavSettings): string {
  const effect = oneOf<NavHoverEffect>(
    settings.navHoverEffect,
    NAV_HOVER_EFFECTS,
    NAV_STYLE_DEFAULTS.hoverEffect as NavHoverEffect
  );

  return `site-nav--hover-${effect}`;
}

/** How many mega-panel columns to deal the links into. */
export function getNavMegaColumnCount(settings: NavSettings): number {
  return num(settings.navMegaColumns, NAV_STYLE_DEFAULTS.megaColumns, 1, 5);
}

/** Whether the ▾ indicator is drawn next to a parent link. */
export function showsNavDropdownArrow(settings: NavSettings): boolean {
  return flag(settings.navShowArrow, true);
}
