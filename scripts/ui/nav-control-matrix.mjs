/**
 * Every control on the Navigation panel, and a value that must visibly change
 * the page. Shared by the fixture renderer and the checker so the two can
 * never test different things.
 *
 * `base` adds whatever settings the control needs to be applicable at all
 * (a mega-only control needs a mega menu). `hover` marks a control whose
 * effect only exists in the hovered state. `note` records a known caveat.
 */
export const NAV_BASE = {
  /*
   * Shaped so every control has something to act on. Two of these were
   * learned the hard way on the first sweep run, where the fixture — not the
   * code — was what made a control look dead:
   *   - a "/" item, so ONE link carries `site-nav-link-active`. Without it
   *     the current-page controls have no element to colour and read as
   *     broken.
   *   - eight children under Play, so 3 columns and 5 columns are actually
   *     distinguishable. With two children both deal to two columns.
   */
  navItems: JSON.stringify([
    { id: "home", label: "Home", href: "/" },
    { id: "play", label: "Play", href: "/play" },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`, label: `Program ${i + 1}`, href: `/p${i}`, parentId: "play",
    })),
    { id: "learn", label: "Learn", href: "/learn" },
    { id: "about", label: "About", href: "/about" },
  ]),
};

export const CONTROLS = [
  // --- Structure ---
  { key: "navDropdownStyle", value: "mega", label: "Menu Type" },
  { key: "navDirection", value: "vertical", label: "Direction" },
  { key: "navLevels", value: "1", label: "Levels" },
  { key: "navMegaWidth", value: "1600", label: "Panel: Width (mega)", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navItemSizing", value: "equal", label: "Sizing" },
  { key: "navGap", value: "36", label: "Item Gap" },
  { key: "backgroundMode", value: "color", label: "Background", extra: { backgroundColor: "#123456" } },

  // --- Dropdown ---
  { key: "navMegaColumns", value: "5", label: "Columns", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownWidth", value: "420", label: "Panel: Width (list)" },
  { key: "navDropdownRadius", value: "36", label: "Panel: Radius" },
  { key: "navDropdownRadius", value: "36", label: "Panel: Radius (mega)",
    id: "navDropdownRadiusMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownBackground", value: "#8a2be2", label: "Panel: Background" },
  { key: "navDropdownBackground", value: "#8a2be2", label: "Panel: Background (mega)",
    id: "navDropdownBackgroundMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownTextColor", value: "#ff4500", label: "Panel: Text Color" },
  // The same control in the other menu type — mega links carry neither
  // `site-nav-link` nor `site-nav-dropdown-item`, so they take a different
  // path through the cascade and need their own check.
  { key: "navDropdownTextColor", value: "#ff4500", label: "Panel: Text Color (mega)",
    id: "navDropdownTextColorMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navShowArrow", value: "false", label: "Arrow" },

  /*
   * The sub level's own type and frame (2026-08-13). Every one is swept
   * TWICE, list and mega, for the reason above: the two panels reach these
   * variables through different selectors, and a control that moves one and
   * not the other is exactly the bug being fixed. Sweeping only the default
   * (list) menu would have missed the whole mega half.
   */
  { key: "navDropdownFontSize", value: "24", label: "Panel: Size" },
  { key: "navDropdownFontSize", value: "24", label: "Panel: Size (mega)",
    id: "navDropdownFontSizeMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownWeight", value: "400", label: "Panel: Weight" },
  { key: "navDropdownWeight", value: "700", label: "Panel: Weight (mega)",
    id: "navDropdownWeightMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownTextTransform", value: "uppercase", label: "Panel: Case" },
  { key: "navDropdownTextTransform", value: "uppercase", label: "Panel: Case (mega)",
    id: "navDropdownTextTransformMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownLetterSpacing", value: "6", label: "Panel: Spacing" },
  { key: "navDropdownLetterSpacing", value: "6", label: "Panel: Spacing (mega)",
    id: "navDropdownLetterSpacingMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownBorderWidth", value: "8", label: "Panel: Border" },
  { key: "navDropdownBorderWidth", value: "8", label: "Panel: Border (mega)",
    id: "navDropdownBorderWidthMega", base: { navDropdownStyle: "mega" }, open: true },
  { key: "navDropdownBorderStyle", value: "dashed", label: "Panel: Style",
    base: { navDropdownBorderWidth: "8" } },
  { key: "navDropdownBorderStyle", value: "dashed", label: "Panel: Style (mega)",
    id: "navDropdownBorderStyleMega",
    base: { navDropdownStyle: "mega", navDropdownBorderWidth: "8" }, open: true },
  { key: "navDropdownBorderColor", value: "#ff00ff", label: "Panel: Border Color",
    base: { navDropdownBorderWidth: "8" } },
  { key: "navDropdownBorderColor", value: "#ff00ff", label: "Panel: Border Color (mega)",
    id: "navDropdownBorderColorMega",
    base: { navDropdownStyle: "mega", navDropdownBorderWidth: "8" }, open: true },

  /*
   * The four remaining Panel controls are single-mode by construction, so a
   * second sweep would render the same menu twice: Columns and Width (mega)
   * only exist on a mega panel, Width (list) and Arrow only on a list
   * drop-down. Everything else in the part is swept both ways above.
   */

  // --- Placement ---
  { key: "navAlignment", value: "right", label: "Alignment" },
  /*
   * Four sides each, since PR 183 standardised every object on
   * Top/Bottom/Left/Right. The V/H pairs this list used to name are gone —
   * and the sweep would have reported them dead, correctly, which is the
   * point: a renamed key looks exactly like a broken control from here.
   */
  { key: "marginTop", value: "56", label: "Margin Top" },
  { key: "marginBottom", value: "56", label: "Margin Bottom" },
  { key: "marginLeft", value: "56", label: "Margin Left" },
  { key: "marginRight", value: "56", label: "Margin Right" },
  { key: "navPaddingTop", value: "44", label: "Padding Top" },
  { key: "navPaddingBottom", value: "44", label: "Padding Bottom" },
  { key: "navPaddingLeft", value: "44", label: "Padding Left" },
  { key: "navPaddingRight", value: "44", label: "Padding Right" },
  { key: "navLinkPaddingTop", value: "28", label: "Link Padding Top" },
  { key: "navLinkPaddingBottom", value: "28", label: "Link Padding Bottom" },
  { key: "navLinkPaddingLeft", value: "48", label: "Link Padding Left" },
  { key: "navLinkPaddingRight", value: "48", label: "Link Padding Right" },
  { key: "verticalOffset", value: "40", label: "Vertical Offset" },
  { key: "horizontalOffset", value: "40", label: "Horizontal Offset" },

  // --- Text ---
  { key: "navFontSize", value: "34", label: "Font" },
  { key: "navWeight", value: "300", label: "Weight" },
  { key: "navUnderline", value: "always", label: "Underline" },
  { key: "navItalic", value: "true", label: "Italic" },
  { key: "navTextTransform", value: "uppercase", label: "Case" },
  { key: "navLetterSpacing", value: "9", label: "Spacing" },
  { key: "navLinkHeight", value: "92", label: "Link Height" },
  { key: "navColor", value: "#8a2be2", label: "Text Color" },
  { key: "navLinkBackground", value: "#8a2be2", label: "Label Fill" },
  { key: "navHoverColor", value: "#8a2be2", label: "Hover Text", hover: true },
  { key: "navHoverBackground", value: "#8a2be2", label: "Hover Fill", hover: true },
  { key: "navActiveColor", value: "#8a2be2", label: "Current Page Text" },
  { key: "navActiveBackground", value: "#8a2be2", label: "Current Fill" },
  { key: "navHoverEffect", value: "grow", label: "Hover Effect", hover: true },
  { key: "navTextShadow", value: "true", label: "Text Shadow" },
  { key: "navTextShadowColor", value: "#8a2be2", label: "Text Shadow Color", base: { navTextShadow: "true" } },
  { key: "navTextShadowX", value: "14", label: "Text Shadow X", base: { navTextShadow: "true" } },
  { key: "navTextShadowY", value: "14", label: "Text Shadow Y", base: { navTextShadow: "true" } },
  { key: "navTextShadowBlur", value: "22", label: "Text Shadow Blur", base: { navTextShadow: "true" } },
  { key: "navTextShadowOpacity", value: "100", label: "Text Shadow Opacity", base: { navTextShadow: "true" } },

  // --- Border ---
  { key: "navBorderWidth", value: "14", label: "Border" },
  { key: "navBorderStyle", value: "dashed", label: "Style", base: { navBorderWidth: "6" } },
  { key: "navBorderColor", value: "#8a2be2", label: "Border Color", base: { navBorderWidth: "6" } },
  { key: "navBarRadius", value: "72", label: "Radius" },
  { key: "navBorderRadius", value: "44", label: "Link Radius" },
  { key: "navShadow", value: "false", label: "Drop Shadow" },
  { key: "navShadowColor", value: "#8a2be2", label: "Shadow Color" },
  { key: "navShadowX", value: "48", label: "Shadow X" },
  { key: "navShadowY", value: "48", label: "Shadow Y" },
  { key: "navShadowBlur", value: "110", label: "Shadow Blur" },
  { key: "navShadowSpread", value: "30", label: "Shadow Spread" },
  { key: "navShadowOpacity", value: "100", label: "Shadow Opacity" },
];
