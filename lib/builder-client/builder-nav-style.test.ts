import { describe, expect, it } from "vitest";
import {
  NAV_STYLE_DEFAULTS,
  getNavBarShadow,
  getNavMegaColumnCount,
  getNavMegaPlacement,
  getNavModuleClassNames,
  getNavModuleStyle,
  getNavTextShadow,
  getNavUnderline,
  isNavMegaMenu,
  showsNavDropdownArrow
} from "@/lib/builder-nav-style";

const style = (settings: Record<string, string> = {}) =>
  getNavModuleStyle(settings) as unknown as Record<string, string | undefined>;

describe("getNavModuleStyle — an untouched menu keeps the look it had when the CSS was hardcoded", () => {
  it("reproduces the old bar", () => {
    const vars = style();

    expect(vars["--site-nav-padding"]).toBe("8px 8px 8px 8px");
    expect(vars["--site-nav-radius"]).toBe("26px");
    expect(vars["--site-nav-border-width"]).toBe("1px");
    expect(vars["--site-nav-border-style"]).toBe("solid");
    expect(vars["--site-nav-border-color"]).toBe("#e6ecf2");
    expect(vars["--site-nav-shadow"]).toBe("0px 16px 40px 0px rgba(10, 73, 112, 0.12)");
  });

  it("reproduces the old links", () => {
    const vars = style();

    expect(vars["--site-nav-link-padding"]).toBe("0px 14px 0px 14px");
    expect(vars["--site-nav-link-radius"]).toBe("18px");
    expect(vars["--site-nav-link-weight"]).toBe("700");
    expect(vars["--site-nav-link-decoration"]).toBe("none");
    expect(vars["--site-nav-link-transform"]).toBe("none");
    expect(vars.fontSize).toBe("16px");
  });

  it("leaves every theme-backed colour undefined so the theme decides", () => {
    const vars = style();

    expect(vars["--site-nav-link-color"]).toBeUndefined();
    expect(vars["--site-nav-link-hover-color"]).toBeUndefined();
    expect(vars["--site-nav-link-active-color"]).toBeUndefined();
    expect(vars.color).toBeUndefined();
  });

  it("keeps every default in step with the CSS fallbacks", () => {
    // The CSS repeats these as `var(--x, <fallback>)`. If a default moves
    // here and not there, an email or a stale bundle renders a different menu.
    expect(NAV_STYLE_DEFAULTS.paddingV).toBe(8);
    expect(NAV_STYLE_DEFAULTS.barRadius).toBe(26);
    expect(NAV_STYLE_DEFAULTS.linkPaddingH).toBe(14);
    expect(NAV_STYLE_DEFAULTS.linkRadius).toBe(18);
    expect(NAV_STYLE_DEFAULTS.weight).toBe(700);
  });
});

describe("getNavModuleStyle — the controls that used to do nothing", () => {
  it("weight reaches the links, which is what Bold never managed", () => {
    expect(style({ navWeight: "400" })["--site-nav-link-weight"]).toBe("400");
    expect(style({ navWeight: "900" })["--site-nav-link-weight"]).toBe("900");
  });

  it("bar padding and link padding are separate quantities", () => {
    const vars = style({
      navPaddingTop: "20",
      navPaddingBottom: "20",
      navPaddingLeft: "30",
      navPaddingRight: "30",
      navLinkPaddingTop: "6",
      navLinkPaddingBottom: "6",
      navLinkPaddingLeft: "22",
      navLinkPaddingRight: "22"
    });

    expect(vars["--site-nav-padding"]).toBe("20px 30px 20px 30px");
    expect(vars["--site-nav-link-padding"]).toBe("6px 22px 6px 22px");
  });

  it("bar radius and link radius are separate quantities", () => {
    const vars = style({ navBarRadius: "0", navBorderRadius: "4" });

    expect(vars["--site-nav-radius"]).toBe("0px");
    expect(vars["--site-nav-link-radius"]).toBe("4px");
  });

  it("a zero border really removes the border", () => {
    expect(style({ navBorderWidth: "0" })["--site-nav-border-width"]).toBe("0px");
  });

  it("honours border style and colour", () => {
    const vars = style({ navBorderWidth: "3", navBorderStyle: "dashed", navBorderColor: "#ff0000" });

    expect(vars["--site-nav-border-width"]).toBe("3px");
    expect(vars["--site-nav-border-style"]).toBe("dashed");
    expect(vars["--site-nav-border-color"]).toBe("#ff0000");
  });

  it("clamps out-of-range numbers instead of emitting them", () => {
    expect(style({ navFontSize: "900" }).fontSize).toBe("48px");
    expect(style({ navBarRadius: "-10" })["--site-nav-radius"]).toBe("0px");
    expect(style({ navMegaWidth: "99999" })["--site-nav-mega-width"]).toBe("1600px");
  });

  it("falls back rather than emitting NaN for junk", () => {
    expect(style({ navFontSize: "abc" }).fontSize).toBe("16px");
    expect(style({ navPaddingTop: "", navPaddingLeft: "" })["--site-nav-padding"]).toBe("8px 8px 8px 8px");
  });
});

describe("the colours that had no control at all", () => {
  it("gives the labels a resting fill — there was neither a setting nor a CSS rule", () => {
    expect(style({ navLinkBackground: "#0b2a4a" })["--site-nav-link-bg"]).toBe("#0b2a4a");
  });

  it("gives the current page its own fill instead of silently borrowing hover's", () => {
    expect(style({ navActiveBackground: "#ffcc00" })["--site-nav-link-active-bg"]).toBe("#ffcc00");
  });

  it("still falls back to the hover fill, which is what the current page always was", () => {
    expect(style({ navHoverBackground: "#00ff00" })["--site-nav-link-active-bg"]).toBe("#00ff00");
  });

  it("lets the current page differ from hover once both are set", () => {
    const vars = style({ navHoverBackground: "#00ff00", navActiveBackground: "#ff0000" });

    expect(vars["--site-nav-link-hover-bg"]).toBe("#00ff00");
    expect(vars["--site-nav-link-active-bg"]).toBe("#ff0000");
  });
});

describe("clearing a colour actually clears it", () => {
  /*
   * The operator, 2026-08-12: "All I want to do is clear the color of the
   * background for the menu as well as the links themselves ... I can set it
   * to any color I want. I just can't clear it." He was right, and these are
   * the four measurements that were wrong before the fix.
   */
  it("emits transparent for an unset bar background, not nothing", () => {
    // Nothing emitted meant the stylesheet's hardcoded white pill showed
    // through, so the Background control only ever worked one way.
    expect(style()["--site-nav-bg"]).toBe("transparent");
  });

  it("emits transparent for an unset label fill", () => {
    expect(style()["--site-nav-link-bg"]).toBe("transparent");
  });

  it("emits transparent for an unset hover fill", () => {
    expect(style()["--site-nav-link-hover-bg"]).toBe("transparent");
  });

  it("emits transparent for an unset current-page fill", () => {
    expect(style()["--site-nav-link-active-bg"]).toBe("transparent");
  });

  it("clears a fill that HAD been set, once the value is emptied again", () => {
    expect(style({ navLinkBackground: "" })["--site-nav-link-bg"]).toBe("transparent");
    expect(style({ navActiveBackground: "", navHoverBackground: "" })["--site-nav-link-active-bg"])
      .toBe("transparent");
  });

  it("still lets a colour be set — the direction that always worked", () => {
    expect(style({ navLinkBackground: "#123456" })["--site-nav-link-bg"]).toBe("#123456");
  });
});

describe("Text Color reaches every link, including the one you are standing on", () => {
  it("gives the current page the text colour when it has none of its own", () => {
    // This is "it still won't render the text as white": the active link
    // ended at a hardcoded blue and ignored the control completely.
    expect(style({ navColor: "#ffffff" })["--site-nav-link-active-color"]).toBe("#ffffff");
  });

  it("gives hover the text colour too", () => {
    expect(style({ navColor: "#ffffff" })["--site-nav-link-hover-color"]).toBe("#ffffff");
  });

  it("lets the current page override it when asked", () => {
    const vars = style({ navColor: "#ffffff", navActiveColor: "#ff0000" });
    expect(vars["--site-nav-link-color"]).toBe("#ffffff");
    expect(vars["--site-nav-link-active-color"]).toBe("#ff0000");
  });

  it("leaves all three to the theme when nothing is set", () => {
    const vars = style();
    expect(vars["--site-nav-link-color"]).toBeUndefined();
    expect(vars["--site-nav-link-hover-color"]).toBeUndefined();
    expect(vars["--site-nav-link-active-color"]).toBeUndefined();
  });
});

describe("Item Gap", () => {
  /*
   * Operator, 2026-08-12: "The Item Gap setting ... doesn't seem to be
   * working. I have worked the gap up from 5 to 10 to 20 and don't see any
   * change." Measured: the variable carried every value correctly and landed
   * on `.site-nav`, whose children are the hamburger toggle and the items
   * wrapper — not the links. The measured space between items was 4px at
   * every setting. The variable was right; the box was wrong.
   */
  it("carries the number the operator set", () => {
    expect(style({ navGap: "20" })["--site-nav-gap"]).toBe("20px");
    expect(style({ navGap: "0" })["--site-nav-gap"]).toBe("0px");
  });

  it("defaults to the 4px the item list has always rendered", () => {
    // Not 0: the default has to match what the hardcoded rule produced, or
    // moving the variable onto the item list would close up every live menu.
    expect(style()["--site-nav-gap"]).toBe("4px");
    expect(NAV_STYLE_DEFAULTS.gap).toBe(4);
  });

  it("clamps rather than emitting something the layout cannot use", () => {
    expect(style({ navGap: "999" })["--site-nav-gap"]).toBe("40px");
    expect(style({ navGap: "-5" })["--site-nav-gap"]).toBe("0px");
    expect(style({ navGap: "abc" })["--site-nav-gap"]).toBe("4px");
  });
});

describe("getNavUnderline", () => {
  it("defaults to no underline in either state", () => {
    expect(getNavUnderline({})).toEqual({ rest: "none", hover: "none" });
  });

  it("always underlines both states", () => {
    expect(getNavUnderline({ navUnderline: "always" })).toEqual({ rest: "underline", hover: "underline" });
  });

  it("hover underlines only the hovered state", () => {
    expect(getNavUnderline({ navUnderline: "hover" })).toEqual({ rest: "none", hover: "underline" });
  });

  it("ignores a value that is not a mode", () => {
    expect(getNavUnderline({ navUnderline: "sometimes" })).toEqual({ rest: "none", hover: "none" });
  });
});

describe("getNavBarShadow", () => {
  it("stays on when the setting was never touched — a live menu keeps its shadow", () => {
    expect(getNavBarShadow({})).toBe("0px 16px 40px 0px rgba(10, 73, 112, 0.12)");
  });

  it("turns off only when explicitly switched off", () => {
    expect(getNavBarShadow({ navShadow: "false" })).toBe("none");
  });

  it("builds a custom shadow from its parts", () => {
    expect(
      getNavBarShadow({
        navShadow: "true",
        navShadowX: "-4",
        navShadowY: "8",
        navShadowBlur: "12",
        navShadowSpread: "2",
        navShadowColor: "#000000",
        navShadowOpacity: "50"
      })
    ).toBe("-4px 8px 12px 2px rgba(0, 0, 0, 0.5)");
  });

  it("emits a solid colour at full opacity", () => {
    expect(getNavBarShadow({ navShadowColor: "#123456", navShadowOpacity: "100" }))
      .toBe("0px 16px 40px 0px #123456");
  });
});

describe("getNavTextShadow", () => {
  it("is off until asked for", () => {
    expect(getNavTextShadow({})).toBe("none");
    expect(getNavTextShadow({ navTextShadow: "false" })).toBe("none");
  });

  it("builds one from its parts", () => {
    expect(
      getNavTextShadow({
        navTextShadow: "true",
        navTextShadowX: "1",
        navTextShadowY: "2",
        navTextShadowBlur: "3",
        navTextShadowColor: "#000000",
        navTextShadowOpacity: "40"
      })
    ).toBe("1px 2px 3px rgba(0, 0, 0, 0.4)");
  });
});

describe("hover effect, mega mode and arrows", () => {
  it("defaults to the lift the CSS always did", () => {
    expect(getNavModuleClassNames({})).toBe("site-nav--hover-lift");
  });

  it("names the chosen effect", () => {
    expect(getNavModuleClassNames({ navHoverEffect: "grow" })).toBe("site-nav--hover-grow");
    expect(getNavModuleClassNames({ navHoverEffect: "none" })).toBe("site-nav--hover-none");
  });

  it("falls back for an unknown effect rather than emitting a class no CSS matches", () => {
    expect(getNavModuleClassNames({ navHoverEffect: "explode" })).toBe("site-nav--hover-lift");
  });

  it("treats mega as horizontal-only — a vertical menu has no panel to open", () => {
    expect(isNavMegaMenu({ navDropdownStyle: "mega" })).toBe(true);
    expect(isNavMegaMenu({ navDropdownStyle: "mega", navDirection: "vertical" })).toBe(false);
    expect(isNavMegaMenu({ navDropdownStyle: "list" })).toBe(false);
  });

  it("clamps the mega column count to what the grid can draw", () => {
    expect(getNavMegaColumnCount({})).toBe(3);
    expect(getNavMegaColumnCount({ navMegaColumns: "9" })).toBe(5);
    expect(getNavMegaColumnCount({ navMegaColumns: "0" })).toBe(1);
  });

  it("shows the dropdown arrow unless it is switched off", () => {
    expect(showsNavDropdownArrow({})).toBe(true);
    expect(showsNavDropdownArrow({ navShowArrow: "false" })).toBe(false);
  });
});

/*
 * Operator, 2026-08-13: the sub level had no type of its own ("it uses the same
 * font settings for the main menu as the sub menu") and the Border axis reached
 * the bar only. These cover both halves of the fix, and — the part that matters
 * on live tenant menus — that neither one moves a menu nobody has touched.
 */
describe("the sub level's own type", () => {
  it("emits nothing while every Sub control is unset, so each panel keeps its own look", () => {
    const vars = style();

    expect(vars["--site-nav-dropdown-size"]).toBeUndefined();
    expect(vars["--site-nav-dropdown-weight"]).toBeUndefined();
    expect(vars["--site-nav-dropdown-transform"]).toBeUndefined();
    expect(vars["--site-nav-dropdown-spacing"]).toBeUndefined();
  });

  it("emits only the controls that were set", () => {
    const vars = style({ navDropdownWeight: "600" });

    expect(vars["--site-nav-dropdown-weight"]).toBe("600");
    expect(vars["--site-nav-dropdown-size"]).toBeUndefined();
  });

  it("emits each control in the unit its CSS declaration expects", () => {
    const vars = style({
      navDropdownFontSize: "13",
      navDropdownWeight: "500",
      navDropdownTextTransform: "uppercase",
      navDropdownLetterSpacing: "2"
    });

    expect(vars["--site-nav-dropdown-size"]).toBe("13px");
    expect(vars["--site-nav-dropdown-weight"]).toBe("500");
    expect(vars["--site-nav-dropdown-transform"]).toBe("uppercase");
    expect(vars["--site-nav-dropdown-spacing"]).toBe("2px");
  });

  it("clamps a size or spacing typed outside the range the control offers", () => {
    expect(style({ navDropdownFontSize: "900" })["--site-nav-dropdown-size"]).toBe("48px");
    expect(style({ navDropdownLetterSpacing: "-40" })["--site-nav-dropdown-spacing"]).toBe("-4px");
  });

  it("falls back to no transform rather than emitting a value CSS would drop", () => {
    expect(style({ navDropdownTextTransform: "sideways" })["--site-nav-dropdown-transform"]).toBe(
      "none"
    );
  });
});

describe("the drop-down panel's own border", () => {
  it("defaults to the hairline a list dropdown has always drawn", () => {
    const vars = style();

    expect(vars["--site-nav-dropdown-border-width"]).toBe("1px");
    expect(vars["--site-nav-dropdown-border-style"]).toBe("solid");
    expect(vars["--site-nav-dropdown-border-color"]).toBe("rgba(9, 16, 24, 0.08)");
  });

  it("defaults to none for a mega panel, which has never had a border", () => {
    expect(style({ navDropdownStyle: "mega" })["--site-nav-dropdown-border-width"]).toBe("0px");
  });

  it("treats a vertical mega menu as a list, the same way the panel itself does", () => {
    const vars = style({ navDropdownStyle: "mega", navDirection: "vertical" });

    expect(vars["--site-nav-dropdown-border-width"]).toBe("1px");
  });

  it("takes the operator's values over either default", () => {
    const vars = style({
      navDropdownStyle: "mega",
      navDropdownBorderWidth: "3",
      navDropdownBorderStyle: "dashed",
      navDropdownBorderColor: "#ff0000"
    });

    expect(vars["--site-nav-dropdown-border-width"]).toBe("3px");
    expect(vars["--site-nav-dropdown-border-style"]).toBe("dashed");
    expect(vars["--site-nav-dropdown-border-color"]).toBe("#ff0000");
  });

  it("leaves the bar's own border untouched — the two axes are separate", () => {
    const vars = style({ navDropdownBorderWidth: "6" });

    expect(vars["--site-nav-border-width"]).toBe("1px");
    expect(vars["--site-nav-dropdown-border-width"]).toBe("6px");
  });
});

describe("Panel Placement (navMegaPlacement)", () => {
  it("defaults to the original behaviour — centred on the hovered item", () => {
    expect(getNavMegaPlacement({})).toBe("item");
    expect(getNavModuleClassNames({ navDropdownStyle: "mega" })).toBe(
      "site-nav--hover-lift site-nav--mega-place-item"
    );
  });

  it("names each placement so the CSS variant can match it", () => {
    for (const placement of ["menu", "right", "left"] as const) {
      expect(getNavMegaPlacement({ navMegaPlacement: placement })).toBe(placement);
      expect(
        getNavModuleClassNames({ navDropdownStyle: "mega", navMegaPlacement: placement })
      ).toBe(`site-nav--hover-lift site-nav--mega-place-${placement}`);
    }
  });

  it("falls back for an unknown value rather than emitting a class no CSS matches", () => {
    expect(getNavMegaPlacement({ navMegaPlacement: "sideways" })).toBe("item");
  });

  it("stays off a non-mega menu — a list drop-down has no panel to place", () => {
    expect(getNavModuleClassNames({ navMegaPlacement: "menu" })).toBe("site-nav--hover-lift");
    expect(
      getNavModuleClassNames({ navDropdownStyle: "mega", navDirection: "vertical", navMegaPlacement: "menu" })
    ).toBe("site-nav--hover-lift");
  });
});

describe("the toggle pull-back var (--site-nav-link-padding-right)", () => {
  it("repeats the shorthand's right side so CSS can subtract it", () => {
    expect(style()["--site-nav-link-padding-right"]).toBe("14px");
    expect(style({ navLinkPaddingRight: "5" })["--site-nav-link-padding-right"]).toBe("5px");
  });

  it("stays in step with the shorthand itself", () => {
    const vars = style({ navLinkPaddingRight: "22" });
    expect(vars["--site-nav-link-padding"]).toBe("0px 22px 0px 14px");
    expect(vars["--site-nav-link-padding-right"]).toBe("22px");
  });
});

describe("the bridge var (--site-nav-padding-bottom)", () => {
  it("repeats the bar padding shorthand's bottom side so CSS can span it", () => {
    expect(style()["--site-nav-padding-bottom"]).toBe("8px");
    expect(style({ navPaddingBottom: "7" })["--site-nav-padding-bottom"]).toBe("7px");
    expect(style({ navPaddingBottom: "7" })["--site-nav-padding"]).toBe("8px 8px 7px 8px");
  });
});
