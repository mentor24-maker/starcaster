import { useState } from "react";
import { eligibleNavParents, navDepthOf } from "@/lib/builder-nav-mega";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup, type BuilderModuleAlignment } from "./builder-alignment-icon-group";
import { BuilderCellPanelHeader } from "./builder-cell-panel-header";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderThemeColorField } from "./builder-theme-color-field";

/**
 * Navigation settings editor.
 *
 * Extracted from builder-module-card.tsx (doctrine §4 prerequisite 2,
 * docs/MODULE_UI_DOCTRINE.md) — it lived inline there, which put it outside
 * the reach of every editor-level check. Behaviour is unchanged on purpose:
 * live tenant sites run this module, and `list` is the default dropdown
 * style; a restyle must not move an existing menu.
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

function parseNavPadding(navPadding: string): { v: number; h: number } {
  const parts = (navPadding || "").trim().split(/\s+/);
  const v = parseInt(parts[0]) || 8;
  const h = parts.length > 1 ? parseInt(parts[1]) || 12 : v;
  return { v, h };
}

export function BuilderNavigationModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: Array<{ label: string; hex: string }>;
}) {
  const [styleCollapsed, setStyleCollapsed] = useState(false);
  const [linksCollapsed, setLinksCollapsed] = useState(false);
  const items = parseNavItems(module.settings);
  const { v: padV, h: padH } = parseNavPadding(module.settings.navPadding ?? "");
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
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }
  function updatePadding(v: number, h: number) {
    updateSetting("navPadding", `${v}px ${h}px`);
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
            {/*
              D8 axes (operator's own grouping for this module, 8/10):
              Structure / Text / Placement / Frame. Same controls, same
              keys — only which column they live in changed. Frame holds
              just Radius today and empties entirely when border settings
              move to Themes, at which point this drops to three axes.

              F13 dedupe note kept: this module ALSO wears the universal
              chrome (Background / Alignment / H+V Margin). navMarginH was
              dead and was removed; the duplicate Background block was
              removed. "Menu Alignment"/"Menu V Margin" are NOT duplicates
              — they position items INSIDE the nav, not the module box.
            */}
            <div className="builder-schema-panel-columns">
              <div className="builder-schema-panel-column">
                <div className="builder-schema-group-title">Structure</div>
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Direction" width="select-md">
                    <select
                      value={module.settings.navDirection ?? "horizontal"}
                      onChange={(e) => updateSetting("navDirection", e.target.value)}
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </BuilderModuleField>
                  <BuilderModuleField label="Levels" width="num">
                    <BuilderNumberSelectControl
                      value={module.settings.navLevels ?? "2"}
                      min={1} max={3} fallback="2"
                      onChange={(v) => updateSetting("navLevels", v)}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Sizing" width="select-md">
                    <select
                      value={module.settings.navItemSizing ?? "auto"}
                      onChange={(e) => updateSetting("navItemSizing", e.target.value)}
                    >
                      <option value="auto">Auto</option>
                      <option value="equal">Equal</option>
                      <option value="custom">Custom</option>
                    </select>
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>
                {module.settings.navDirection !== "vertical" && (
                  <BuilderModuleFieldStrip>
                    <BuilderModuleField label="Dropdown" width="select-md">
                      <select
                        value={module.settings.navDropdownStyle ?? "list"}
                        onChange={(e) => updateSetting("navDropdownStyle", e.target.value)}
                      >
                        <option value="list">List</option>
                        <option value="mega">Mega Panel</option>
                      </select>
                    </BuilderModuleField>
                    {module.settings.navDropdownStyle === "mega" && (
                      <>
                        <BuilderModuleField label="Columns" width="num">
                          <BuilderNumberSelectControl
                            value={module.settings.navMegaColumns ?? "3"}
                            min={1} max={5} fallback="3"
                            onChange={(v) => updateSetting("navMegaColumns", v)}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Panel Width" width="num">
                          <BuilderNumberSelectControl
                            value={module.settings.navMegaWidth ?? "1040"}
                            min={320} max={1600} step={40} fallback="1040"
                            onChange={(v) => updateSetting("navMegaWidth", v)}
                          />
                        </BuilderModuleField>
                      </>
                    )}
                  </BuilderModuleFieldStrip>
                )}
              </div>

              <div className="builder-schema-panel-column">
                <div className="builder-schema-group-title">Text</div>
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Font" width="num">
                    <BuilderNumberSelectControl
                      value={module.settings.navFontSize ?? "16"}
                      min={10} max={48} fallback="16"
                      onChange={(v) => updateSetting("navFontSize", v)}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Bold" width="check">
                    <input
                      type="checkbox"
                      checked={module.settings.navBold === "true"}
                      onChange={(e) => updateSetting("navBold", e.target.checked ? "true" : "false")}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Color" width="color">
                    <BuilderThemeColorField
                      dialogLabel="Menu text color"
                      fallback="#163a5e"
                      themeColors={themeColors}
                      value={module.settings.navColor ?? ""}
                      onChange={(v) => updateSetting("navColor", v)}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Hover text" width="color">
                    <BuilderThemeColorField
                      dialogLabel="Menu hover text color"
                      fallback="#0a8fc4"
                      themeColors={themeColors}
                      value={module.settings.navHoverColor ?? ""}
                      onChange={(v) => updateSetting("navHoverColor", v)}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Hover bg" width="color">
                    <BuilderThemeColorField
                      dialogLabel="Menu hover background color"
                      fallback="#d0f0fb"
                      themeColors={themeColors}
                      value={module.settings.navHoverBackground ?? ""}
                      onChange={(v) => updateSetting("navHoverBackground", v)}
                    />
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>
              </div>

              <div className="builder-schema-panel-column">
                <div className="builder-schema-group-title">Placement</div>
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Menu Alignment" width="align">
                    <BuilderAlignmentIconGroup
                      value={(module.settings.navAlignment ?? "center") as BuilderModuleAlignment}
                      onChange={(alignment) => updateSetting("navAlignment", alignment)}
                      ariaLabel="Menu item alignment inside the nav"
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Pad V" width="num">
                    <BuilderNumberSelectControl
                      value={String(padV)} min={0} max={40} fallback="8"
                      onChange={(v) => updatePadding(Number(v), padH)}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Pad H" width="num">
                    <BuilderNumberSelectControl
                      value={String(padH)} min={0} max={60} fallback="12"
                      onChange={(v) => updatePadding(padV, Number(v))}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Menu V Margin" width="num">
                    <BuilderNumberSelectControl
                      value={module.settings.navMarginV ?? "0"}
                      min={0} max={80} fallback="0"
                      onChange={(v) => updateSetting("navMarginV", v)}
                    />
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>
              </div>

              <div className="builder-schema-panel-column">
                <div className="builder-schema-group-title">Frame</div>
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Radius" width="num">
                    <BuilderNumberSelectControl
                      value={module.settings.navBorderRadius ?? "0"}
                      min={0} max={48} fallback="0"
                      onChange={(v) => updateSetting("navBorderRadius", v)}
                    />
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>
              </div>
            </div>
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
                    {module.settings.navDropdownStyle === "mega"
                      && module.settings.navDirection !== "vertical"
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
