"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogPostTagsModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-blog-post-tags-settings">

      <BuilderSettingRow label="Tags" fullWidth>
        <input
          type="text"
          value={s.tags ?? ""}
          onChange={(e) => set("tags", e.target.value)}
          placeholder="react, typescript, tutorial"
        />
      </BuilderSettingRow>
      <p style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 12px", lineHeight: 1.4 }}>
        Comma-separated. On a post template these come from the Blog Post module's Taxonomy tab.
      </p>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "pills"} onChange={(e) => set("layout", e.target.value)}>
              <option value="pills">Pills</option>
              <option value="inline">Inline text</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Prefix label">
            <select value={s.showPrefix ?? "true"} onChange={(e) => set("showPrefix", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          {(s.showPrefix ?? "true") === "true" ? (
            <BuilderSettingRow label="Prefix text" fullWidth>
              <input
                type="text"
                value={s.prefix ?? "Tags:"}
                onChange={(e) => set("prefix", e.target.value)}
                placeholder="Tags:"
              />
            </BuilderSettingRow>
          ) : null}

          <BuilderSettingRow label="Link to filter">
            <select value={s.linkToFilter ?? "true"} onChange={(e) => set("linkToFilter", e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </BuilderSettingRow>

          {(s.linkToFilter ?? "true") === "true" ? (
            <>
              <BuilderSettingRow label="URL param" fullWidth>
                <input
                  type="text"
                  value={s.filterParam ?? "tag"}
                  onChange={(e) => set("filterParam", e.target.value)}
                  placeholder="tag"
                />
              </BuilderSettingRow>
              <BuilderSettingRow label="Target page" fullWidth>
                <input
                  type="text"
                  value={s.targetPageUrl ?? ""}
                  onChange={(e) => set("targetPageUrl", e.target.value)}
                  placeholder="Leave blank for current page"
                />
              </BuilderSettingRow>
            </>
          ) : null}
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Tag color">
            <input type="color" value={s.color ?? "#587592"} onChange={(e) => set("color", e.target.value)} />
          </BuilderSettingRow>

          <BuilderSettingRow label="Tag background">
            <input type="color" value={s.bgColor ?? "#f0f4f8"} onChange={(e) => set("bgColor", e.target.value)} />
          </BuilderSettingRow>

          <BuilderSettingRow label="Border radius (px)">
            <input
              type="number" min={0} max={20} step={2}
              value={s.borderRadius ?? "4"}
              onChange={(e) => set("borderRadius", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Font size (px)">
            <input
              type="number" min={10} max={18} step={1}
              value={s.fontSize ?? "12"}
              onChange={(e) => set("fontSize", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Gap (px)">
            <input
              type="number" min={2} max={16} step={2}
              value={s.gap ?? "6"}
              onChange={(e) => set("gap", e.target.value)}
            />
          </BuilderSettingRow>
        </div>
      </div>
    </div>
  );
}
