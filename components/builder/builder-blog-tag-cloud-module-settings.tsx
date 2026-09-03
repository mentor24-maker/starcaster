"use client";

import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { BuilderModuleField } from "./builder-module-field";
import type { BuilderThemePalette } from "./builder-theme-color-field";
import { parseCloudTags, resolveTagCloudSource, serializeCloudTags, type CloudTag } from "@/lib/blog-tag-cloud";

/**
 * Re-exported so the Builder canvas card keeps its existing import. The
 * definitions moved to lib/builder-client/blog-tag-cloud.ts, which the LIVE
 * renderer reads too — the panel, the canvas and the tenant site had three
 * copies of these rules and disagreed about most of them.
 */
export { parseCloudTags };
export type { CloudTag };

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogTagCloudModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const tags = parseCloudTags(module.settings);
  const isCloud = (module.settings.layout ?? "cloud") === "cloud";

  function persist(next: CloudTag[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, tags: serializeCloudTags(next) }
    }));
  }

  function updateTag(id: string, field: keyof CloudTag, value: string | number) {
    persist(tags.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }

  function moveTag(id: string, direction: -1 | 1) {
    const index = tags.findIndex((t) => t.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= tags.length) return;
    const next = [...tags];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  }

  function removeTag(id: string) {
    persist(tags.filter((t) => t.id !== id));
  }

  function addTag() {
    persist([...tags, { id: `tag-${Date.now()}`, label: "", slug: "", count: 1 }]);
  }

  const schema: BuilderSettingsSchema = {
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Structure / Text /
    // Frame. Same keys, fallbacks, options and visibleWhen rules — only the
    // column each control sits in changed. Alignment rides with Layout on
    // Structure rather than opening a fifth Placement axis for one select;
    // four is the ceiling. Gap sits on Frame with the pill background.
    //
    // Linking fold (A1-A5): the old top-level "Linking" group made a SECOND
    // collapsible below the per-axis Advanced region. Its controls are a
    // destination and its URL param — Content by D8's table ("what the module
    // shows … links") — so they now live in the Content axis's `advanced`.
    // The panel has exactly one Advanced region, and these sit under their
    // own column heading. Same keys, control types and rendersVia.
    //
    // A1 sort (2026-08-10): the three colours moved to their own axis's
    // Advanced section — Tag Color and Active Color under Text, Tag Bg under
    // Frame — and each became a `theme-color` override whose themeDefault is
    // its old fallback (A2). Min/Max Font are font SIZES, not theme-backed, so
    // they stay basic; Gap keeps its name and its place (W7 exempts it).
    // Layout, Alignment, Counts and the tag manager are the module's own
    // settings and stay basic (A4).
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
          // The module's own heading. It replaces the generic `content`/text
          // slot every module carries, which this one rendered nowhere — an
          // operator typing into it saw the words vanish on publish. Empty by
          // default, and omitted from the markup entirely when empty, so no
          // existing page gains a stray heading.
          [
            {
              key: "title",
              label: "Title",
              width: "text-md",
              control: "text",
              fallback: "",
              placeholder: "Browse by tag",
              rendersVia: "BlogTagCloudPreview"
            }
          ],
          /*
           * D9 rung 1, and it outranks the destination below: this decides
           * where the module's content COMES FROM, which is the largest blast
           * radius on the panel.
           *
           * "Blog tags" reads the tenant's real tags from `/api/blog/tags` —
           * the derived list the Blog Links manager shows, with post counts.
           * Deliberately NOT `/api/messaging/tags`: Messaging Topics and Tags
           * are a different feature, and pointing a blog widget at them is
           * what put "No tags found. Add tags in the Messaging section." on a
           * public tenant page.
           */
          [
            {
              key: "tagSource",
              label: "Tags From",
              width: "select-md",
              control: "select",
              options: [
                { value: "auto", label: "Blog tags (automatic)" },
                { value: "manual", label: "Custom list" }
              ],
              fallback: "auto",
              rendersVia: "BlogTagCloudPreview"
            }
          ],
          // D9 rung 1: a destination changes what the whole module does, so it
          // leads the Content axis — ahead of the labels it decorates.
          [
            {
              key: "filterParam",
              label: "URL Param",
              width: "text-md",
              control: "custom",
              rendersVia: "builder-template.ts blog-tag-cloud renderer",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.filterParam ?? "tag"}
                  onChange={(e) => set("filterParam", e.target.value)}
                  placeholder="tag"
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
              placeholder: "/blog",
              rendersVia: "builder-template.ts blog-tag-cloud renderer"
            }
          ],
          // Counts sits with the other Content settings rather than after the
          // manager. Rendered last it came out UNDER the "Add Tag" button,
          // reading as a control of the tag list instead of a setting of the
          // module.
          [
            {
              key: "showCounts",
              label: "Counts",
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "BlogTagCloudPreview"
            }
          ],
          [
            {
              key: "tags",
              label: "Tags",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "BlogTagCloudPreview",
              /*
               * Hidden under "Blog tags", never cleared. The typed list stays
               * in `settings.tags` exactly as it was, so switching to Blog
               * tags and back loses nothing an operator curated.
               */
              visibleWhen: (settings) => resolveTagCloudSource(settings) === "manual",
              render: () => (
                /* L6a item manager on its own lattice. It was
                   `.builder-slider-item-card` holding `label.field` boxes —
                   the shape W0 says to RETIRE rather than style, because it
                   stacks a label above a full-width box and so runs a second
                   label geometry inside a panel whose other columns are on the
                   lattice. It reuses `.builder-cards-panel-fields` with
                   `data-lattice-pairs="2"`, the same grid and the same CSS
                   Feature Cards and Carousel already use, rather than adding a
                   third pattern.

                   The declaration is what makes it CHECKABLE: check_panels
                   selects item managers on `[data-lattice-pairs]` and
                   `[data-lattice-columns]`, and this manager declared neither,
                   so every panel sweep since the check was written found
                   nothing to measure here and reported OK. */
                <>
                  <div className="builder-schema-group-title">Tags</div>
                  <div className="builder-cards-panel-fields" data-lattice-pairs="2">
                    {tags.map((tag, index) => (
                      <Fragment key={tag.id}>
                        <div className="builder-card-editor-head">
                          <span className="builder-card-editor-name">{tag.label || `Tag ${index + 1}`}</span>
                          <div className="builder-item-grid-actions">
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => moveTag(tag.id, -1)}
                              aria-label={`Move tag ${index + 1} up`}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => moveTag(tag.id, 1)}
                              aria-label={`Move tag ${index + 1} down`}
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button builder-icon-button-danger"
                              onClick={() => removeTag(tag.id)}
                              aria-label={`Delete tag ${index + 1}`}
                              title="Delete tag"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <BuilderModuleField label="Label" width="text-md" className="builder-card-field--a">
                          <input
                            type="text"
                            value={tag.label}
                            onChange={(e) => updateTag(tag.id, "label", e.target.value)}
                            placeholder="react"
                            aria-label={`Tag ${index + 1} label`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Slug" width="text-md" className="builder-card-field--b">
                          <input
                            type="text"
                            value={tag.slug}
                            onChange={(e) => updateTag(tag.id, "slug", e.target.value)}
                            placeholder="react"
                            aria-label={`Tag ${index + 1} slug`}
                          />
                        </BuilderModuleField>
                        {isCloud ? (
                          <BuilderModuleField label="Count" width="num" className="builder-card-field--a">
                            <input
                              type="number"
                              min={1}
                              max={999}
                              value={tag.count ?? 1}
                              onChange={(e) => updateTag(tag.id, "count", parseInt(e.target.value, 10) || 1)}
                              aria-label={`Tag ${index + 1} count`}
                            />
                          </BuilderModuleField>
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" onClick={addTag}>
                    Add Tag
                  </button>
                </>
              )
            }
          ]
        ],
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "layout",
              label: "Layout",
              width: "auto",
              control: "select",
              options: [
                { value: "cloud", label: "Cloud (sized by count)" },
                { value: "pills", label: "Pills (uniform)" },
                { value: "list", label: "List" }
              ],
              fallback: "cloud",
              rendersVia: "BlogTagCloudPreview"
            },
            {
              key: "alignment",
              label: "Alignment",
              width: "select-md",
              control: "select",
              options: [
                { value: "left", label: "Left" },
                { value: "center", label: "Center" }
              ],
              fallback: "left",
              rendersVia: "BlogTagCloudPreview"
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            {
              key: "minFontSize",
              label: "Min Font",
              width: "num",
              control: "number",
              min: 10,
              max: 18,
              step: 1,
              fallback: "12",
              rendersVia: "BlogTagCloudPreview",
              visibleWhen: (settings) => (settings.layout ?? "cloud") === "cloud"
            },
            {
              key: "maxFontSize",
              label: "Max Font",
              width: "num",
              control: "number",
              min: 14,
              max: 36,
              step: 2,
              fallback: "22",
              rendersVia: "BlogTagCloudPreview",
              visibleWhen: (settings) => (settings.layout ?? "cloud") === "cloud"
            }
          ],
          [
            {
              key: "inactiveColor",
              label: "Tag Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Tag color",
              themeDefault: "#587592",
              rendersVia: "BlogTagCloudPreview"
            },
            {
              key: "activeColor",
              label: "Active Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Active tag color",
              themeDefault: "#0f4f8f",
              rendersVia: "BlogTagCloudPreview"
            }
          ]
        ],
        // A2 theme overrides; colour sorts after size on Text (D9).
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "gap",
              label: "Gap",
              width: "num",
              control: "number",
              min: 4,
              max: 24,
              step: 2,
              fallback: "8",
              rendersVia: "BlogTagCloudPreview"
            }
          ],
          [
            {
              key: "inactiveBg",
              label: "Tag Bg",
              width: "color",
              control: "theme-color",
              dialogLabel: "Tag background",
              themeDefault: "#f0f4f8",
              rendersVia: "BlogTagCloudPreview"
            }
          ]
        ],
        // A2 theme override; colour sorts after the spacing on Frame (D9).
      }
    ]
  };

  return (
    <div className="builder-blog-tag-cloud-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
