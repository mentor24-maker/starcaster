import { useState } from "react";
import { eligibleNavParents, navDepthOf } from "@/lib/builder-nav-mega";
import { NAV_STYLE_DEFAULTS } from "@/lib/builder-nav-style";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import {
  BuilderSchemaModuleSettings,
  dropShadowFields,
  dropShadowIsOn,
  marginFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { getModuleBackgroundSettings } from "./builder-utils";
import type { BuilderThemePalette } from "./builder-theme-color-field";

/**
 * Navigation settings editor.
 *
 * Rebuilt on the schema generator 2026-08-11, at the operator's direction:
 * *"The top menu module currently has no style control. The style controls of
 * the container have no effect, and the menu styles need to be completely
 * overhauled."*
 *
 * D8 axes, in the order he asked for them:
 * **Structure / Placement / Text / Border**. "Border" rather than the
 * canonical "Frame" is his word for this module — the axis holds the bar's
 * border, its radius and its shadow, and he named it while looking at it.
 *
 * What changed beyond the layout:
 *  - the control that said "Dropdown" is now **Menu Type**, first in
 *    Structure, because it decides what every control under it means;
 *  - the mega-panel controls sit under a **Dropdown** sub-heading instead of
 *    trailing off the end of Structure unlabelled;
 *  - Placement gained the standard set (alignment, H+V margin, H+V padding,
 *    H+V offset) — the module had alignment, one padding pair and a lone
 *    vertical margin;
 *  - Text gained weight, italic, underline, transform, letter spacing, a
 *    hover effect and a text shadow. **Bold became Weight** because Bold was
 *    a dead control: it set `font-weight` on the `<nav>` and the link rule
 *    hardcoded 700 over it (doctrine E7). `normalizeBuilderModuleSettingsForType`
 *    migrates the old key;
 *  - Border is new outright — width, style, colour, bar radius, link radius
 *    and a full drop shadow, all of it previously hardcoded in CSS.
 *
 * Everything renders through `getNavModuleStyle` (lib/builder-client/builder-nav-style.ts),
 * which is where the defaults live and where they are tested against the CSS
 * fallbacks. That single `rendersVia` is the E7 paper trail for this panel.
 *
 * Live tenant sites run this module, so `list` remains the default dropdown
 * style and every default reproduces the old hardcoded look exactly — a
 * restyle must not move an existing menu.
 */

type NavItem = {
  id: string;
  label: string;
  href: string;
  parentId?: string;
  width?: string;
  /** Mega-panel feature tile — top-level items only. See ClickUp 86bbafg38. */
  featureImage?: string;
  featureHeading?: string;
};

function parseNavItems(settings: Record<string, string>): NavItem[] {
  try {
    const items = JSON.parse(settings.navItems || "[]");
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: String(raw.id || `nav-${index + 1}`),
        label: String(raw.label || ""),
        href: String(raw.href || raw.url || ""),
        ...(raw.parentId ? { parentId: String(raw.parentId) } : {}),
        ...(raw.width ? { width: String(raw.width) } : {}),
        ...(raw.featureImage ? { featureImage: normalizeBuilderAssetUrl(raw.featureImage) } : {}),
        ...(raw.featureHeading ? { featureHeading: String(raw.featureHeading) } : {})
      };
    });
  } catch {
    return [];
  }
}

function serializeNavItems(items: NavItem[]) {
  return JSON.stringify(items);
}

/** Every setting on this panel reaches the page through one helper. */
const RENDERS_VIA = "getNavModuleStyle (builder-nav-style.ts)";

const isVerticalMenu = (settings: Record<string, string>) => settings.navDirection === "vertical";
const isMegaMenu = (settings: Record<string, string>) =>
  settings.navDropdownStyle === "mega" && !isVerticalMenu(settings);
const isListMenu = (settings: Record<string, string>) => !isMegaMenu(settings);

export function BuilderNavigationModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: import("@/lib/builder-template").BackgroundSettings) => import("@/lib/builder-template").BackgroundSettings) => void;
  themeColors?: BuilderThemePalette;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
}) {
  const [styleCollapsed, setStyleCollapsed] = useState(false);
  const [linksCollapsed, setLinksCollapsed] = useState(false);
  const items = parseNavItems(module.settings);
  const topLevelWidthTotal = items
    .filter((i) => !i.parentId)
    .reduce((sum, i) => sum + (parseFloat(i.width ?? "") || 0), 0);

  function persist(nextItems: NavItem[]) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, navItems: serializeNavItems(nextItems) } }));
  }
  function updateItem(id: string, updates: Partial<NavItem>) {
    persist(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }
  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }
  function removeItem(id: string) { persist(items.filter((item) => item.id !== id)); }
  function addItem() {
    persist([...items, { id: `nav-${Date.now()}-${items.length + 1}`, label: "", href: "" }]);
  }

  /**
   * The parent picker used to offer only top-level items and disable itself
   * on anything that already had children — so a three-level menu could not
   * be built here at all, even though the "Levels" control offers 3 and the
   * importer can produce three tiers. A mega panel needs that third level
   * (level 2 = column headings, level 3 = the links in each column), so the
   * rule is now a real depth check. Logic and tests live in
   * lib/builder-client/builder-nav-mega.ts.
   */
  const depthOf = (item: NavItem) => navDepthOf(items, item);
  const eligibleParents = (item: NavItem) => eligibleNavParents(items, item) as NavItem[];

  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Structure",
        strips: [
          [
            {
              // Was labelled "Dropdown". It is the first thing to decide and
              // it renames everything below it, so it leads the column.
              key: "navDropdownStyle",
              label: "Menu Type",
              width: "select-md",
              control: "select",
              fallback: "list",
              options: [
                { value: "list", label: "List" },
                { value: "mega", label: "Mega Panel" }
              ],
              visibleWhen: (settings) => !isVerticalMenu(settings),
              rendersVia: "NavigationModulePreview"
            }
          ],
          [
            {
              key: "navDirection",
              label: "Direction",
              width: "select-md",
              control: "select",
              fallback: "horizontal",
              options: [
                { value: "horizontal", label: "Horizontal" },
                { value: "vertical", label: "Vertical" }
              ],
              rendersVia: "NavigationModulePreview"
            }
          ],
          [
            {
              key: "navLevels",
              label: "Levels",
              width: "num",
              control: "number",
              min: 1,
              max: 3,
              fallback: "2",
              rendersVia: "NavigationModulePreview"
            }
          ],
          [
            {
              key: "navMegaWidth",
              label: "Panel Width",
              width: "num",
              control: "number",
              min: 320,
              max: 1600,
              step: 40,
              fallback: String(NAV_STYLE_DEFAULTS.megaWidth),
              visibleWhen: isMegaMenu,
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navItemSizing",
              label: "Sizing",
              width: "select-md",
              control: "select",
              fallback: "auto",
              options: [
                { value: "auto", label: "Auto" },
                { value: "equal", label: "Equal" },
                { value: "custom", label: "Custom" }
              ],
              rendersVia: "NavigationModulePreview"
            }
          ],
          [
            {
              key: "navGap",
              label: "Item Gap",
              width: "num",
              control: "number",
              min: 0,
              max: 40,
              fallback: String(NAV_STYLE_DEFAULTS.gap),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "background",
              label: "Background",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "NavigationModulePreview",
              render: () => (
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                  themeBackgroundColor={themeBackgroundColor}
                  themeColors={themeColors}
                  themePrimaryColor={themePrimaryColor}
                />
              )
            }
          ]
        ],
        sections: [
          {
            title: "Dropdown",
            strips: [
              [
                {
                  key: "navMegaColumns",
                  label: "Columns",
                  width: "num",
                  control: "number",
                  min: 1,
                  max: 5,
                  fallback: String(NAV_STYLE_DEFAULTS.megaColumns),
                  visibleWhen: isMegaMenu,
                  rendersVia: "buildMegaColumns (builder-nav-mega.ts)"
                }
              ],
              [
                {
                  // A mega panel is sized by Panel Width; a list dropdown by
                  // this. Only one of the two is ever on screen.
                  key: "navDropdownWidth",
                  label: "Menu Width",
                  width: "num",
                  control: "number",
                  min: 100,
                  max: 480,
                  step: 10,
                  fallback: String(NAV_STYLE_DEFAULTS.dropdownWidth),
                  visibleWhen: isListMenu,
                  rendersVia: RENDERS_VIA
                }
              ],
              [
                {
                  key: "navDropdownRadius",
                  label: "Radius",
                  width: "num",
                  control: "number",
                  min: 0,
                  max: 40,
                  fallback: String(NAV_STYLE_DEFAULTS.dropdownRadius),
                  rendersVia: RENDERS_VIA
                }
              ],
              [
                {
                  key: "navDropdownBackground",
                  label: "Panel Fill",
                  width: "color",
                  control: "color",
                  dialogLabel: "Dropdown panel background",
                  fallback: NAV_STYLE_DEFAULTS.dropdownBackground,
                  rendersVia: RENDERS_VIA
                }
              ],
              [
                {
                  // A6: a text colour is basic wherever it lives. This one
                  // was in Advanced, where nobody found it.
                  key: "navDropdownTextColor",
                  label: "Panel Text",
                  width: "color",
                  control: "theme-color",
                  themeDefault: "#334861",
                  dialogLabel: "Dropdown link color",
                  rendersVia: RENDERS_VIA
                }
              ],
              [
                {
                  // List only: a mega panel's arrow is its open/close button,
                  // not decoration — hiding it would strand every sub-link on
                  // a phone, where the panel opens by tapping it.
                  key: "navShowArrow",
                  label: "Arrow",
                  width: "check",
                  control: "checkbox",
                  fallback: "true",
                  visibleWhen: isListMenu,
                  rendersVia: "NavigationModulePreview"
                }
              ]
            ]
          }
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              // Positions the items INSIDE the bar. The module box has no
              // separate alignment worth offering — the bar fills its column.
              key: "navAlignment",
              label: "Alignment",
              width: "align",
              control: "align",
              fallback: "center",
              ariaLabel: "Menu item alignment inside the nav",
              rendersVia: "NavigationModulePreview"
            }
          ],
          ...marginFields("getModuleOuterSpacingStyle", 160).map((field) => [field]),
          [
            {
              key: "navPaddingV",
              label: "Vertical Padding",
              width: "num",
              control: "number",
              min: 0,
              max: 60,
              fallback: String(NAV_STYLE_DEFAULTS.paddingV),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navPaddingH",
              label: "Horizontal Padding",
              width: "num",
              control: "number",
              min: 0,
              max: 60,
              fallback: String(NAV_STYLE_DEFAULTS.paddingH),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              // W7 names the four spacing controls for a module's OWN box —
              // taken above by the bar. This pair is the padding inside each
              // link, a different quantity (same judgement call as Table's
              // "Cell Padding"), so it carries a qualified name.
              key: "navLinkPaddingV",
              label: "Link V Padding",
              width: "num",
              control: "number",
              min: 0,
              max: 40,
              fallback: String(NAV_STYLE_DEFAULTS.linkPaddingV),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navLinkPaddingH",
              label: "Link H Padding",
              width: "num",
              control: "number",
              min: 0,
              max: 60,
              fallback: String(NAV_STYLE_DEFAULTS.linkPaddingH),
              rendersVia: RENDERS_VIA
            }
          ],
          // D9 puts the finest adjustment last on its axis. A0 retired the
          // Advanced section these two used to sit in (A3, withdrawn) —
          // sorting last is how a nudge is de-emphasised now.
          [
            {
              key: "verticalOffset",
              label: "Vertical Offset",
              width: "num",
              control: "number",
              min: -100,
              max: 100,
              step: 5,
              fallback: "0",
              rendersVia: "getModuleNudgeTransform (builder-utils.ts)"
            }
          ],
          [
            {
              key: "horizontalOffset",
              label: "Horizontal Offset",
              width: "num",
              control: "number",
              min: -100,
              max: 100,
              step: 5,
              fallback: "0",
              rendersVia: "getModuleNudgeTransform (builder-utils.ts)"
            }
          ]
        ]
      },
      {
        title: "Text",
        /*
         * A6, in the operator's words (8/11): "Don't put text color under
         * Advanced. That is basic. Hover effects, dropshadows, etc. are
         * advance." Colour and the label's own fill were both in Advanced
         * and both read as missing — he reported having no control over
         * "the background colors of the labels ... and the font color".
         */
        strips: [
          [
            {
              key: "navFontSize",
              label: "Font",
              width: "num",
              control: "number",
              min: 10,
              max: 48,
              fallback: String(NAV_STYLE_DEFAULTS.fontSize),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              // Replaces the Bold checkbox, which never reached the links.
              key: "navWeight",
              label: "Weight",
              width: "select-sm",
              control: "select",
              fallback: String(NAV_STYLE_DEFAULTS.weight),
              options: [
                { value: "300", label: "Light" },
                { value: "400", label: "Regular" },
                { value: "500", label: "Medium" },
                { value: "600", label: "Semibold" },
                { value: "700", label: "Bold" },
                { value: "800", label: "Heavy" }
              ],
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navUnderline",
              label: "Underline",
              width: "select-md",
              control: "select",
              fallback: "none",
              options: [
                { value: "none", label: "Never" },
                { value: "always", label: "Always" },
                { value: "hover", label: "On Hover" }
              ],
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navItalic",
              label: "Italic",
              width: "check",
              control: "checkbox",
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navTextTransform",
              label: "Case",
              width: "select-md",
              control: "select",
              fallback: "none",
              options: [
                { value: "none", label: "As typed" },
                { value: "uppercase", label: "UPPERCASE" },
                { value: "lowercase", label: "lowercase" },
                { value: "capitalize", label: "Capitalize" }
              ],
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navLetterSpacing",
              label: "Spacing",
              width: "num",
              control: "number",
              min: -4,
              max: 12,
              fallback: String(NAV_STYLE_DEFAULTS.letterSpacing),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navLinkHeight",
              label: "Link Height",
              width: "num",
              control: "number",
              min: 24,
              max: 96,
              step: 2,
              fallback: String(NAV_STYLE_DEFAULTS.linkHeight),
              rendersVia: RENDERS_VIA
            }
          ],
          /*
           * The effect layer, sorted after the colours per D9 rather than
           * hidden behind a collapse (A0 retired Advanced). A7 puts the TEXT
           * shadow on this axis and the bar's BOX shadow on Border — two
           * different shadows, which is why dropShadowFields() takes a
           * key prefix.
           */
          [
            {
              key: "navColor",
              label: "Text Color",
              width: "color",
              control: "theme-color",
              themeDefault: "#163a5e",
              dialogLabel: "Menu text color",
              rendersVia: RENDERS_VIA
            }
          ],

          [
            {
              // New. A link had no resting background and no CSS for one,
              // so the labels could not be coloured at all.
              key: "navLinkBackground",
              label: "Label Fill",
              width: "color",
              control: "theme-color",
              themeDefault: "transparent",
              dialogLabel: "Menu label background",
              rendersVia: RENDERS_VIA
            }
          ],

          [
            {
              key: "navHoverColor",
              label: "Hover Text",
              width: "color",
              control: "theme-color",
              themeDefault: "#0a8fc4",
              dialogLabel: "Menu hover text color",
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navHoverBackground",
              label: "Hover Fill",
              width: "color",
              control: "theme-color",
              themeDefault: "#d0f0fb",
              dialogLabel: "Menu hover background color",
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navActiveColor",
              label: "Current Text",
              width: "color",
              control: "theme-color",
              themeDefault: "#0a8fc4",
              dialogLabel: "Current page link color",
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              // New. The current page's pill WAS the hover fill, with no
              // control of its own — one label in every menu looked
              // different and nothing could change it.
              key: "navActiveBackground",
              label: "Current Fill",
              width: "color",
              control: "theme-color",
              themeDefault: "#d0f0fb",
              dialogLabel: "Current page background",
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navHoverEffect",
              label: "Hover",
              width: "select-md",
              control: "select",
              fallback: NAV_STYLE_DEFAULTS.hoverEffect,
              options: [
                { value: "none", label: "None" },
                { value: "lift", label: "Lift" },
                { value: "grow", label: "Grow" },
                { value: "fade", label: "Fade" },
                { value: "underline", label: "Underline Slide" }
              ],
              rendersVia: "getNavModuleClassNames (builder-nav-style.ts)"
            }
          ],
          ...dropShadowFields(RENDERS_VIA, {
            prefix: "navTextShadow",
            label: "Text Shadow",
            range: { offset: 20, blur: 40 },
            defaults: {
              x: String(NAV_STYLE_DEFAULTS.textShadowX),
              y: String(NAV_STYLE_DEFAULTS.textShadowY),
              blur: String(NAV_STYLE_DEFAULTS.textShadowBlur),
              color: NAV_STYLE_DEFAULTS.textShadowColor
            }
          }).map((field) => [field]),
          [
            {
              key: "navTextShadowOpacity",
              label: "Shadow Opacity",
              width: "num",
              control: "number",
              min: 0,
              max: 100,
              step: 5,
              fallback: String(NAV_STYLE_DEFAULTS.textShadowOpacity),
              visibleWhen: (settings) => dropShadowIsOn(settings, "navTextShadow", false),
              rendersVia: RENDERS_VIA
            }
          ]
        ]
      },
      {
        title: "Border",
        strips: [
          [
            {
              key: "navBorderWidth",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              max: 20,
              fallback: String(NAV_STYLE_DEFAULTS.borderWidth),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navBorderStyle",
              label: "Style",
              width: "select-md",
              control: "select",
              fallback: NAV_STYLE_DEFAULTS.borderStyle,
              options: [
                { value: "solid", label: "Solid" },
                { value: "dashed", label: "Dashed" },
                { value: "dotted", label: "Dotted" },
                { value: "double", label: "Double" },
                { value: "none", label: "None" }
              ],
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navBorderColor",
              label: "Border Color",
              width: "color",
              control: "color",
              dialogLabel: "Menu border color",
              fallback: NAV_STYLE_DEFAULTS.borderColor,
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navBarRadius",
              label: "Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 80,
              fallback: String(NAV_STYLE_DEFAULTS.barRadius),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              // Keeps the legacy key: on live sites navBorderRadius has
              // always meant the LINK, and only the React preview ever put
              // it on the bar. Renaming it here would move real menus.
              key: "navBorderRadius",
              label: "Link Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 48,
              fallback: String(NAV_STYLE_DEFAULTS.linkRadius),
              rendersVia: RENDERS_VIA
            }
          ],
          // A7: the BOX shadow the bar casts, last on the axis (D9).
          // `defaultOn` because the bar had this shadow before anything could
          // switch it off — an absent setting has to keep meaning "on" or
          // every live menu goes flat.
          ...dropShadowFields(RENDERS_VIA, {
            prefix: "navShadow",
            label: "Drop Shadow",
            defaultOn: true,
            range: { offset: 60, blur: 120 },
            defaults: {
              x: String(NAV_STYLE_DEFAULTS.shadowX),
              y: String(NAV_STYLE_DEFAULTS.shadowY),
              blur: String(NAV_STYLE_DEFAULTS.shadowBlur),
              color: NAV_STYLE_DEFAULTS.shadowColor
            }
          }).map((field) => [field]),
          [
            {
              key: "navShadowSpread",
              label: "Shadow Spread",
              width: "num",
              control: "number",
              min: -40,
              max: 40,
              fallback: "0",
              visibleWhen: (settings) => dropShadowIsOn(settings, "navShadow", true),
              rendersVia: RENDERS_VIA
            }
          ],
          [
            {
              key: "navShadowOpacity",
              label: "Shadow Opacity",
              width: "num",
              control: "number",
              min: 0,
              max: 100,
              step: 5,
              fallback: String(NAV_STYLE_DEFAULTS.shadowOpacity),
              visibleWhen: (settings) => dropShadowIsOn(settings, "navShadow", true),
              rendersVia: RENDERS_VIA
            }
          ]
        ]
      }
    ]
  };

  return (
    <>
      <div className="builder-cell-panel">
        <BuilderCellPanelHeader
          title="Style"
          isCollapsed={styleCollapsed}
          onToggle={() => setStyleCollapsed((c) => !c)}
        />
        {!styleCollapsed && (
          <div className="builder-nav-style-body">
            <BuilderSchemaModuleSettings
              schema={schema}
              module={module}
              onUpdateModule={onUpdateModule}
              themeColors={themeColors}
            />
          </div>
        )}
      </div>

      <div className="builder-cell-panel">
        <BuilderCellPanelHeader
          title="Links"
          isCollapsed={linksCollapsed}
          onToggle={() => setLinksCollapsed((c) => !c)}
        />
        {!linksCollapsed && (
          <>
            <div className="builder-nav-items-header builder-nav-item-row">
              <div className="builder-nav-item-fields">
                <span>Parent Page</span>
                <span>Page Name</span>
                <span>Slug</span>
                {module.settings.navItemSizing === "custom" && <span className="builder-nav-item-width-wrap">Width</span>}
              </div>
              <span className="builder-nav-items-header-action">Action</span>
            </div>
            <div className="builder-nav-items">
              {items.map((item, index) => {
                const isCustomSizing = module.settings.navItemSizing === "custom";
                const parentOptions = eligibleParents(item);
                return (
                  <div key={item.id} className="builder-nav-item-row">
                    <div className="builder-nav-item-fields">
                      <select
                        className="builder-nav-item-parent-select"
                        value={item.parentId ?? ""}
                        onChange={(e) => updateItem(item.id, { parentId: e.target.value || undefined })}
                      >
                        <option value="">Top level</option>
                        {parentOptions.map((parent) => (
                          <option key={parent.id} value={parent.id}>
                            {`${"— ".repeat(depthOf(parent))}${parent.label || `Link ${items.indexOf(parent) + 1}`}`}
                          </option>
                        ))}
                      </select>
                      <input type="text" className="builder-nav-item-label" value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} placeholder={`Link ${index + 1}`} />
                      <input type="text" className="builder-nav-item-href" value={item.href} onChange={(e) => updateItem(item.id, { href: e.target.value })} placeholder="/path-or-url" />
                      {isCustomSizing && (
                        <div className="builder-nav-item-width-wrap">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            className="builder-nav-item-width"
                            value={item.width ?? ""}
                            disabled={Boolean(item.parentId)}
                            onChange={(e) => updateItem(item.id, { width: e.target.value })}
                            placeholder={item.parentId ? "" : "0"}
                            title="Width percentage for this top-level link"
                          />
                          {!item.parentId && <span className="builder-nav-item-width-unit">%</span>}
                        </div>
                      )}
                    </div>
                    <div className="builder-nav-item-actions">
                      <button type="button" className="builder-icon-button" aria-label="Move Up" onClick={() => moveItem(item.id, -1)}>↑</button>
                      <button type="button" className="builder-icon-button" aria-label="Move Down" onClick={() => moveItem(item.id, 1)}>↓</button>
                      <button type="button" className="builder-icon-button builder-icon-button-danger" aria-label="Delete" onClick={() => removeItem(item.id)}>✕</button>
                    </div>
                    {isMegaMenu(module.settings)
                      && !item.parentId
                      && items.some((i) => i.parentId === item.id) && (
                      <details className="hanging-details builder-nav-item-feature">
                        <summary>Feature tile</summary>
                        <BuilderModuleFieldStrip>
                          <BuilderModuleField label="Image" width="full">
                            <BuilderImagePickerField
                              value={item.featureImage ?? ""}
                              onChange={(featureImage) => updateItem(item.id, { featureImage })}
                            />
                          </BuilderModuleField>
                          <BuilderModuleField label="Heading" width="text-md">
                            <input
                              type="text"
                              value={item.featureHeading ?? ""}
                              onChange={(e) => updateItem(item.id, { featureHeading: e.target.value })}
                              placeholder="Visit Delray Tennis"
                            />
                          </BuilderModuleField>
                        </BuilderModuleFieldStrip>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
            {module.settings.navItemSizing === "custom" && (
              <div className={`builder-nav-width-total${topLevelWidthTotal > 100 ? " builder-nav-width-total-over" : ""}`}>
                Total: {Math.round(topLevelWidthTotal * 10) / 10}%
                {topLevelWidthTotal > 100 && " — over 100%"}
              </div>
            )}
            <button type="button" className="secondary-button builder-nav-add-link-button" onClick={addItem}>+ Add Link</button>
          </>
        )}
      </div>
    </>
  );
}
