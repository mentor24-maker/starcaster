"use client";

import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderModuleField } from "./builder-module-field";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

export type TocItem = { id: string; label: string; anchor: string; depth: 1 | 2 };

export function parseTocItems(settings: Record<string, string>): TocItem[] {
  try {
    const parsed = JSON.parse(settings.items || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is TocItem => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeTocItems(items: TocItem[]): string {
  return JSON.stringify(items);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogTocModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const items = parseTocItems(module.settings);

  function persist(next: TocItem[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, items: serializeTocItems(next) }
    }));
  }

  function updateItem(id: string, field: keyof TocItem, value: string | 1 | 2) {
    persist(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const index = items.findIndex((x) => x.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }

  function removeItem(id: string) {
    persist(items.filter((x) => x.id !== id));
  }

  function addItem(depth: 1 | 2) {
    persist([...items, { id: `toc-${Date.now()}-${items.length}`, label: "", anchor: "", depth }]);
  }

  const schema: BuilderSettingsSchema = {
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Structure / Text.
    // Same keys, fallbacks and visibleWhen rules — only the column each
    // control sits in changed. "Style" (marker) and "Indent H3s" describe how
    // the list is arranged, so they are Structure, not typography.
    //
    // A1 sort (2026-08-10): Link Color is the module's one theme-backed
    // setting, so it moved to Text's own Advanced section as a `theme-color`
    // override whose themeDefault is its old fallback (A2). Font Size is a
    // SIZE, not a theme override, so it stays basic — as do the title, the
    // heading manager and the two Structure selects (A4).
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
          [
            {
              key: "showTitle",
              label: "Title",
              width: "select-md",
              control: "select",
              options: [
                { value: "true", label: "Show" },
                { value: "false", label: "Hide" }
              ],
              fallback: "true",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            },
            {
              key: "title",
              label: "Title Text",
              width: "text-md",
              control: "custom",
              rendersVia: "builder-module-card.tsx blog-toc preview",
              visibleWhen: (settings) => (settings.showTitle ?? "true") === "true",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.title ?? "In This Article"}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="In This Article"
                />
              )
            }
          ],
          [
            {
              key: "items",
              label: "Headings",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "builder-module-card.tsx blog-toc preview",
              /*
               * L6a item manager on its own lattice. It was
               * `.builder-slider-item-card` holding `label.field` boxes — the
               * shape W0 says to RETIRE rather than style — and it carried the
               * worse version of that: every H3 card took `marginLeft: 16` to
               * show its nesting, so this one manager put its fields on TWO
               * x-positions of its own (0 and 16), neither of them the panel's
               * (125). Measured at 1440 before this change.
               *
               * The nesting is said in words instead, in the card's own head
               * row ("H3 · Court fees"), which is where the level already was —
               * and a level that is written rather than indented survives the
               * shared grid. It reuses `.builder-cards-panel-fields` with
               * `data-lattice-pairs="1"` — the same CSS Feature Cards, Carousel
               * and the Tag Cloud use, in its `--stacked` variant, because this
               * manager sits inside a narrow axis column rather than in half a
               * 50/50 editor (see the CSS note).
               *
               * The declaration is what makes it CHECKABLE: `check_panels`
               * selects item managers on `[data-lattice-pairs]` and
               * `[data-lattice-columns]`, and this one declared neither, so
               * every sweep since the check was written reported OK here
               * without ever looking at it.
               */
              render: () => (
                <>
                  <div className="builder-schema-group-title">Headings</div>
                  {/* The group title used to carry this sentence. It says what an
                      H3 DOES in the contents list, which the per-item "H3 · …" head
                      row does not (L7), so it comes back as prose rather than as a
                      longer heading.

                      The second sentence is not decoration. The first version said
                      "the page shows that nesting", and `blog-toc` routes to
                      `BlogModulePlaceholder`, which returns null when `liveSite` is
                      true — a published page renders no table of contents at all
                      today. So the note promised a rendered behaviour that does not
                      exist, which is landmine 17 (a note that overstates is its own
                      bug) and exactly the trap the same sentence was rewritten once
                      already to avoid. Say the limit instead of implying the
                      opposite. Delete that sentence when the module renders live. */}
                  <p className="panel-copy builder-panel-field-note">
                    An H3 belongs to the nearest H2 above it. Indent H3s decides whether
                    the contents list shows that nesting. This module is builder-only for
                    now — a published page does not render a table of contents yet.
                  </p>
                  <div className="builder-cards-panel-fields builder-cards-panel-fields--stacked" data-lattice-pairs="1">
                    {items.map((item, index) => (
                      <Fragment key={item.id}>
                        <div className="builder-card-editor-head">
                          <span className="builder-card-editor-name">
                            {item.depth === 2 ? "H3" : "H2"} · {item.label || `Heading ${index + 1}`}
                          </span>
                          <div className="builder-item-grid-actions">
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => moveItem(item.id, -1)}
                              aria-label={`Move heading ${index + 1} up`}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => moveItem(item.id, 1)}
                              aria-label={`Move heading ${index + 1} down`}
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button builder-icon-button-danger"
                              onClick={() => removeItem(item.id)}
                              aria-label={`Delete heading ${index + 1}`}
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <BuilderModuleField label="Label" width="text-md" className="builder-card-field--a">
                          <input
                            type="text"
                            value={item.label}
                            onChange={(e) => updateItem(item.id, "label", e.target.value)}
                            placeholder="Section heading text"
                            aria-label={`Heading ${index + 1} label`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Anchor ID" width="text-md" className="builder-card-field--b">
                          <input
                            type="text"
                            value={item.anchor}
                            onChange={(e) => updateItem(item.id, "anchor", e.target.value)}
                            placeholder="section-slug"
                            aria-label={`Heading ${index + 1} anchor ID`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Level" width="select-md" className="builder-card-field--a">
                          <select
                            value={item.depth}
                            onChange={(e) => updateItem(item.id, "depth", Number(e.target.value) as 1 | 2)}
                            aria-label={`Heading ${index + 1} level`}
                          >
                            <option value={1}>H2</option>
                            <option value={2}>H3 (sub)</option>
                          </select>
                        </BuilderModuleField>
                      </Fragment>
                    ))}
                  </div>
                  <div className="builder-blog-toc-add-actions">
                    <button type="button" className="secondary-button" onClick={() => addItem(1)}>
                      + H2
                    </button>
                    <button type="button" className="secondary-button" onClick={() => addItem(2)}>
                      + H3
                    </button>
                  </div>
                </>
              )
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "style",
              label: "Style",
              width: "select-md",
              control: "select",
              options: [
                { value: "default", label: "Default" },
                { value: "numbered", label: "Numbered" },
                { value: "dotted", label: "Dotted" }
              ],
              fallback: "default",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            },
            {
              key: "indentSubheadings",
              label: "Indent H3s",
              width: "select-md",
              control: "select",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" }
              ],
              fallback: "true",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            {
              key: "fontSize",
              label: "Font Size",
              width: "num",
              control: "number",
              min: 11,
              max: 20,
              step: 1,
              fallback: "14",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            }
          ],
          [
            {
              key: "color",
              label: "Link Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Link color",
              themeDefault: "#0f4f8f",
              rendersVia: "builder-module-card.tsx blog-toc preview"
            }
          ]
        ],
        // A2 theme override; colour sorts after size on Text (D9).
      }
    ]
  };

  return (
    <div className="builder-blog-toc-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
