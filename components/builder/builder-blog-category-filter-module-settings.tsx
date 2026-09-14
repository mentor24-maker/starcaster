"use client";

import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { BuilderModuleField } from "./builder-module-field";
import { type BuilderThemePalette } from "./builder-theme-color-field";

export type FilterCategory = { id: string; label: string; slug: string };

export function parseFilterCategories(settings: Record<string, string>): FilterCategory[] {
  try {
    const parsed = JSON.parse(settings.categories || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is FilterCategory => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeFilterCategories(cats: FilterCategory[]): string {
  return JSON.stringify(cats);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogCategoryFilterModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const categories = parseFilterCategories(module.settings);

  function persist(next: FilterCategory[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, categories: serializeFilterCategories(next) }
    }));
  }

  function updateCat(id: string, field: keyof FilterCategory, value: string) {
    persist(categories.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  function moveCat(id: string, direction: -1 | 1) {
    const index = categories.findIndex((c) => c.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }

  function removeCat(id: string) {
    persist(categories.filter((c) => c.id !== id));
  }

  function addCat() {
    persist([...categories, { id: `cat-${Date.now()}`, label: "", slug: "" }]);
  }

  const schema: BuilderSettingsSchema = {
    // D8 logical axes: Content / Structure / Text / Frame — the ceiling,
    // reached honestly. The pill's own text colours live on Text (D8:
    // "font, size, weight, transform, text colour"); the box behind it —
    // backgrounds and radius — lives on Frame.
    //
    // Linking fold (A1-A5): the URL param + target page used to sit in a
    // top-level `advanced` group, which rendered a SECOND collapsible below
    // the per-axis Advanced region. They are a destination and its param —
    // Content by D8's table ("what the module shows … links") — so they now
    // live in the Content axis's `advanced`. One Advanced region, and these
    // sit under their own column heading. Same keys and control types.
    //
    // A1 sort (2026-08-10): every colour here is a theme value, as is the
    // pill radius, so each drops into its OWN axis's `advanced` — Active /
    // Inactive under Text, Active BG / Inactive BG / Radius under Frame.
    // Colours become `theme-color` (A2): empty means "follow the theme" and
    // the old fallback is now themeDefault. Font Size stays basic (font SIZE
    // is not theme-backed); Frame's basic row empties, and the axis stays
    // declared so its Advanced controls keep their column.
    //
    // SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
    // Everything above that "moved into Advanced" now sits LAST on the axis it
    // already names, ordered by D9 (blast radius, descending). The axis
    // assignments and the A2 theme-colour semantics are unchanged — only the
    // collapsing is gone. Kept rather than rewritten: the reasoning is the record.
    axes: [
      {
        title: "Content",
        strips: [
          // D9 rung 1: a destination changes what the whole module does, so it
          // leads the Content axis — ahead of the labels it decorates.
          [
            {
              key: "filterParam",
              label: "URL Param",
              width: "text-md",
              control: "custom",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.filterParam ?? "category"}
                  onChange={(e) => set("filterParam", e.target.value)}
                  placeholder="category"
                />
              )
            },
            {
              key: "targetPageUrl",
              label: "Target Page",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "Current page",
              placeholder: "/blog"
            }
          ],
          [
            // C3: was a Yes/No select — same "true"/"false" stored values.
            {
              key: "showAll",
              label: "Show 'All'",
              width: "check",
              control: "checkbox",
              fallback: "true"
            },
            {
              key: "allLabel",
              label: "'All' Label",
              width: "text-md",
              control: "custom",
              visibleWhen: (settings) => (settings.showAll ?? "true") === "true",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.allLabel ?? "All"}
                  onChange={(e) => set("allLabel", e.target.value)}
                  placeholder="All"
                />
              )
            }
          ],
          [
            {
              key: "categories",
              label: "Categories",
              width: "full",
              control: "custom",
              bare: true,
              /* L6a item manager on its own lattice, and the shape panel
                 sweep 12/15 named as belonging to this ticket. It was
                 `.builder-slider-item-card` holding `label.field` boxes — the
                 shape W0 says to RETIRE rather than style, because it stacks a
                 label ABOVE a full-width box and so runs a second label
                 geometry inside a panel whose other columns are on the
                 lattice. Measured at 1440 before this change: the panel's own
                 fields sat at label-width 125 / control-x 125, and every field
                 in here sat at x=0 in two hardcoded 478px tracks.

                 The declaration is what makes it CHECKABLE, and that is the
                 larger half of the fix: check_panels selects item managers on
                 `[data-lattice-pairs]` and `[data-lattice-columns]`, and it
                 separately EXCLUDES `.builder-slider-item-grid` by name — so
                 every pair in here was filtered out of every sweep since the
                 check was written, and each one reported a clean pass over a
                 manager nobody had measured. Carousel's lesson word for word:
                 a manager that opts into neither attribute is not passing, it
                 is absent.

                 `data-lattice-pairs="2"` rather than sweep 12's one-pair-per-
                 row, because this manager's twin is Blog Tag Cloud's, one
                 module along in the same ticket and already on this shape: the
                 same Label + Slug fields, in the same-width axis column,
                 measured at 239px each holding the fixture's
                 `junior-high-performance-academy`. Sweep 12 reached for the
                 stacked variant where the same arithmetic gave 52-94px fields.
                 Two sibling discovery panels with identical managers should
                 not read as two different shapes. */
              render: () => (
                <>
                  <div className="builder-schema-group-title">Categories</div>
                  <div className="builder-cards-panel-fields" data-lattice-pairs="2">
                    {categories.map((cat, index) => (
                      <Fragment key={cat.id}>
                        <div className="builder-card-editor-head">
                          <span className="builder-card-editor-name">{cat.label || `Category ${index + 1}`}</span>
                          <div className="builder-item-grid-actions">
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => moveCat(cat.id, -1)}
                              aria-label={`Move category ${index + 1} up`}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => moveCat(cat.id, 1)}
                              aria-label={`Move category ${index + 1} down`}
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button builder-icon-button-danger"
                              onClick={() => removeCat(cat.id)}
                              aria-label={`Delete category ${index + 1}`}
                              title="Delete category"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <BuilderModuleField label="Label" width="text-md" className="builder-card-field--a">
                          <input
                            type="text"
                            value={cat.label}
                            onChange={(e) => updateCat(cat.id, "label", e.target.value)}
                            placeholder="Technology"
                            aria-label={`Category ${index + 1} label`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Slug" width="text-md" className="builder-card-field--b">
                          <input
                            type="text"
                            value={cat.slug}
                            onChange={(e) => updateCat(cat.id, "slug", e.target.value)}
                            placeholder="technology"
                            aria-label={`Category ${index + 1} slug`}
                          />
                        </BuilderModuleField>
                      </Fragment>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" onClick={addCat}>
                    Add Category
                  </button>
                </>
              )
            }
          ]
        ],
        // D3: one strip, not two single-field rows. Target Page narrowed
        // full → text-md so they can share; placeholder shortened to fit.
      },
      {
        title: "Structure",
        strips: [
      [
        {
          key: "layout",
          label: "Layout",
          width: "select-md",
          control: "select",
          fallback: "pills",
          options: [
            { value: "pills", label: "Pills" },
            { value: "list", label: "List" },
            { value: "dropdown", label: "Dropdown" }
          ]
        },
        {
          key: "alignment",
          label: "Alignment",
          width: "align",
          control: "align",
          ariaLabel: "Category filter alignment",
          fallback: "left"
        },
        { key: "gap", label: "Gap", width: "num", control: "number", min: 4, max: 24, step: 2, fallback: "8" }
      ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            { key: "fontSize", label: "Font Size", width: "num", control: "number", min: 10, max: 20, step: 1, fallback: "13" }
          ],
          [
            { key: "activeColor", label: "Active", width: "color", control: "theme-color", dialogLabel: "Active color", themeDefault: "#0f4f8f" },
            { key: "inactiveColor", label: "Inactive", width: "color", control: "theme-color", dialogLabel: "Inactive color", themeDefault: "#587592" }
          ]
        ],
      },
      {
        title: "Frame",
        strips: [
          [
            { key: "activeBg", label: "Active BG", width: "color", control: "theme-color", dialogLabel: "Active background", themeDefault: "#e8f6fc" },
            { key: "inactiveBg", label: "Inactive BG", width: "color", control: "theme-color", dialogLabel: "Inactive background", themeDefault: "#f0f4f8" }
          ],
          [
            { key: "borderRadius", label: "Radius", width: "num", control: "number", min: 0, max: 32, step: 2, fallback: "20" }
          ]
        ],
      }
    ]
  };

  return (
    <div className="builder-blog-category-filter-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
