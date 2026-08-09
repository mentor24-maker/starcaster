"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

export type CloudTag = { id: string; label: string; slug: string; count?: number };

export function parseCloudTags(settings: Record<string, string>): CloudTag[] {
  try {
    const parsed = JSON.parse(settings.tags || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is CloudTag => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

function serializeCloudTags(tags: CloudTag[]): string {
  return JSON.stringify(tags);
}

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
    content: [
      [
        {
          key: "tags",
          label: "Tags",
          width: "full",
          control: "custom",
          bare: true,
          rendersVia: "BlogTagCloudPreview",
          render: () => (
            <>
              <div className="builder-breadcrumb-items-label" style={{ marginTop: 12 }}>Tags</div>
              <div className="builder-slider-items">
                {tags.map((tag, index) => (
                  <div key={tag.id} className="builder-slider-item-card">
                    <div className="builder-slider-item-header">
                      <strong>{tag.label || `Tag ${index + 1}`}</strong>
                      <div className="builder-section-actions">
                        <button type="button" className="builder-icon-button" onClick={() => moveTag(tag.id, -1)}>↑</button>
                        <button type="button" className="builder-icon-button" onClick={() => moveTag(tag.id, 1)}>↓</button>
                        <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removeTag(tag.id)}>✕</button>
                      </div>
                    </div>
                    <div className="builder-slider-item-grid">
                      <label className="field">
                        <span>Label</span>
                        <input
                          type="text"
                          value={tag.label}
                          onChange={(e) => updateTag(tag.id, "label", e.target.value)}
                          placeholder="react"
                        />
                      </label>
                      <label className="field">
                        <span>Slug</span>
                        <input
                          type="text"
                          value={tag.slug}
                          onChange={(e) => updateTag(tag.id, "slug", e.target.value)}
                          placeholder="react"
                        />
                      </label>
                      {isCloud ? (
                        <label className="field">
                          <span>Count / weight</span>
                          <input
                            type="number" min={1} max={999}
                            value={tag.count ?? 1}
                            onChange={(e) => updateTag(tag.id, "count", parseInt(e.target.value, 10) || 1)}
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>
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
    layout: [
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
        },
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
      ]
    ],
    style: [
      [
        {
          key: "showCounts",
          label: "Counts",
          width: "select-md",
          control: "select",
          options: [
            { value: "false", label: "Hide" },
            { value: "true", label: "Show" }
          ],
          fallback: "false",
          rendersVia: "BlogTagCloudPreview"
        },
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
          control: "color",
          dialogLabel: "Tag color",
          fallback: "#587592",
          rendersVia: "BlogTagCloudPreview"
        },
        {
          key: "inactiveBg",
          label: "Tag Bg",
          width: "color",
          control: "color",
          dialogLabel: "Tag background",
          fallback: "#f0f4f8",
          rendersVia: "BlogTagCloudPreview"
        },
        {
          key: "activeColor",
          label: "Active Color",
          width: "color",
          control: "color",
          dialogLabel: "Active tag color",
          fallback: "#0f4f8f",
          rendersVia: "BlogTagCloudPreview"
        }
      ]
    ],
    advanced: [
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
        }
      ],
      [
        {
          key: "targetPageUrl",
          label: "Target Page",
          width: "full",
          control: "text",
          placeholder: "Leave blank to filter on the current page",
          rendersVia: "builder-template.ts blog-tag-cloud renderer"
        }
      ]
    ]
  };

  return (
    <div className="builder-blog-tag-cloud-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
        advancedLabel="Linking"
      />
    </div>
  );
}
