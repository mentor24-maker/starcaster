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

  return (
    <div className="builder-blog-post-list-settings">

      {/* General */}
      <div className="builder-blog-post-list-general-row">
        <BuilderSettingRow label="Label">
          <input
            type="text"
            value={module.name}
            onChange={(e) => onUpdateModule((current) => ({ ...current, name: e.target.value }))}
            placeholder="Optional internal label"
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Post Title">
          <input
            type="text"
            value={s.postTitle ?? ""}
            onChange={(e) => set("postTitle", e.target.value)}
            placeholder="Section title"
          />
        </BuilderSettingRow>
        <BuilderSettingRow label="Post Slug">
          <input
            type="text"
            value={s.postSlug ?? ""}
            onChange={(e) => set("postSlug", e.target.value)}
            placeholder=""
          />
        </BuilderSettingRow>
      </div>

      {/* Page Design */}
      <div className="builder-blog-post-list-section-header">Page Design</div>
      <div className="builder-blog-post-list-3col">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "grid"} onChange={(e) => set("layout", e.target.value)}>
              <option value="grid">Grid</option>
              <option value="list">List</option>
              <option value="admin-manager">Admin</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Search bar">
            <select value={s.showSearch ?? "true"} onChange={(e) => set("showSearch", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Category filter">
            <select value={s.showCategoryFilter ?? "true"} onChange={(e) => set("showCategoryFilter", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Columns">
            <select value={s.columns ?? "3"} onChange={(e) => set("columns", e.target.value)}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Date range filter">
            <select value={s.showDateFilter ?? "false"} onChange={(e) => set("showDateFilter", e.target.value)}>
              <option value="false">Hide</option>
              <option value="true">Show</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Author filter">
            <select value={s.showAuthorFilter ?? "true"} onChange={(e) => set("showAuthorFilter", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Posts per page">
            <select value={s.postsPerPage ?? "9"} onChange={(e) => set("postsPerPage", e.target.value)}>
              <option value="3">3</option>
              <option value="6">6</option>
              <option value="9">9</option>
              <option value="12">12</option>
              <option value="18">18</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Popularity filter">
            <select value={s.popularityFilter ?? "false"} onChange={(e) => set("popularityFilter", e.target.value)}>
              <option value="false">Off</option>
              <option value="views">By Views</option>
              <option value="likes">By Likes</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Tag filter">
            <select value={s.showTagFilter ?? "true"} onChange={(e) => set("showTagFilter", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>
      </div>

      {/* Card Design */}
      <div className="builder-blog-post-list-section-header">Card Design</div>
      <div className="builder-blog-post-list-3col">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Card style">
            <select value={s.cardStyle ?? "default"} onChange={(e) => set("cardStyle", e.target.value)}>
              <option value="default">Default</option>
              <option value="bordered">Bordered</option>
              <option value="shadow">Shadow</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Author">
            <select value={s.showAuthor ?? "true"} onChange={(e) => set("showAuthor", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Featured image">
            <select value={s.showFeaturedImage ?? "true"} onChange={(e) => set("showFeaturedImage", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
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

        <div className="builder-button-setting-column">
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
          <BuilderSettingRow label="Excerpt">
            <select value={s.showExcerpt ?? "true"} onChange={(e) => set("showExcerpt", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
          <BuilderSettingRow label="Tags">
            <select value={s.showTags ?? "true"} onChange={(e) => set("showTags", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>
        </div>
      </div>

    </div>
  );
}
