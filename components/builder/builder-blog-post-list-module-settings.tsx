"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogPostListModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const isGrid = (s.layout ?? "grid") === "grid";

  return (
    <div className="builder-blog-post-list-settings">
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "grid"} onChange={(e) => set("layout", e.target.value)}>
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </select>
          </BuilderSettingRow>

          {isGrid ? (
            <BuilderSettingRow label="Columns">
              <select value={s.columns ?? "3"} onChange={(e) => set("columns", e.target.value)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </BuilderSettingRow>
          ) : null}

          <BuilderSettingRow label="Posts per page">
            <select value={s.postsPerPage ?? "9"} onChange={(e) => set("postsPerPage", e.target.value)}>
              <option value="3">3</option>
              <option value="6">6</option>
              <option value="9">9</option>
              <option value="12">12</option>
              <option value="18">18</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Card gap (px)">
            <input
              type="number"
              min={8}
              max={64}
              step={4}
              value={s.cardGap ?? "24"}
              onChange={(e) => set("cardGap", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Card radius (px)">
            <input
              type="number"
              min={0}
              max={32}
              step={2}
              value={s.cardBorderRadius ?? "12"}
              onChange={(e) => set("cardBorderRadius", e.target.value)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Card style">
            <select value={s.cardStyle ?? "default"} onChange={(e) => set("cardStyle", e.target.value)}>
              <option value="default">Default</option>
              <option value="bordered">Bordered</option>
              <option value="shadow">Shadow</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Featured image">
            <select value={s.showFeaturedImage ?? "true"} onChange={(e) => set("showFeaturedImage", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          {(s.showFeaturedImage ?? "true") === "true" ? (
            <BuilderSettingRow label="Image ratio">
              <select value={s.imageAspectRatio ?? "16:9"} onChange={(e) => set("imageAspectRatio", e.target.value)}>
                <option value="16:9">16:9</option>
                <option value="4:3">4:3</option>
                <option value="3:2">3:2</option>
                <option value="1:1">1:1</option>
              </select>
            </BuilderSettingRow>
          ) : null}

          <BuilderSettingRow label="Excerpt">
            <select value={s.showExcerpt ?? "true"} onChange={(e) => set("showExcerpt", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Author">
            <select value={s.showAuthor ?? "true"} onChange={(e) => set("showAuthor", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Date">
            <select value={s.showDate ?? "true"} onChange={(e) => set("showDate", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Categories">
            <select value={s.showCategories ?? "true"} onChange={(e) => set("showCategories", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>
      </div>

      <BuilderSettingRow label="Read more" fullWidth>
        <select value={s.showReadMore ?? "true"} onChange={(e) => set("showReadMore", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {(s.showReadMore ?? "true") === "true" ? (
        <>
          <BuilderSettingRow label="Read more label" fullWidth>
            <input
              type="text"
              value={s.readMoreLabel ?? "Read More"}
              onChange={(e) => set("readMoreLabel", e.target.value)}
              placeholder="Read More"
            />
          </BuilderSettingRow>
          <BuilderSettingRow label="Post view page URL" fullWidth>
            <input
              type="text"
              value={s.postPageUrl ?? ""}
              onChange={(e) => set("postPageUrl", e.target.value)}
              placeholder="/blog-post  (the page that displays a single post)"
            />
          </BuilderSettingRow>
        </>
      ) : null}

      <BuilderSettingRow label="Filter by category" fullWidth>
        <input
          type="text"
          value={s.filterCategory ?? ""}
          onChange={(e) => set("filterCategory", e.target.value)}
          placeholder="Leave blank to show all posts"
        />
      </BuilderSettingRow>
    </div>
  );
}
