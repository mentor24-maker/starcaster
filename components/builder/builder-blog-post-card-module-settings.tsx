"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogPostCardModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const showImage = (s.showFeaturedImage ?? "true") === "true";
  const showReadMore = (s.showReadMore ?? "true") === "true";

  return (
    <div className="builder-blog-post-card-settings">

      {/* Content */}
      <BuilderSettingRow label="Title" fullWidth>
        <input
          type="text"
          value={s.title ?? ""}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Post title"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Excerpt" fullWidth>
        <textarea
          className="builder-textarea"
          rows={2}
          value={s.excerpt ?? ""}
          onChange={(e) => set("excerpt", e.target.value)}
          placeholder="Short summary shown on the card"
        />
      </BuilderSettingRow>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Author" fullWidth>
            <input
              type="text"
              value={s.author ?? ""}
              onChange={(e) => set("author", e.target.value)}
              placeholder="Author name"
            />
          </BuilderSettingRow>
        </div>
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Date" fullWidth>
            <input
              type="text"
              value={s.date ?? ""}
              onChange={(e) => set("date", e.target.value)}
              placeholder="Jun 20, 2026"
            />
          </BuilderSettingRow>
        </div>
      </div>

      <BuilderSettingRow label="Categories" fullWidth>
        <input
          type="text"
          value={s.categories ?? ""}
          onChange={(e) => set("categories", e.target.value)}
          placeholder="Tech, Design (comma-separated)"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Link URL" fullWidth>
        <input
          type="text"
          value={s.url ?? ""}
          onChange={(e) => set("url", e.target.value)}
          placeholder="/blog/post-slug"
        />
      </BuilderSettingRow>

      {/* Image */}
      <BuilderSettingRow label="Featured image" fullWidth>
        <BuilderImagePickerField
          value={s.imageUrl ?? ""}
          onChange={(url) => set("imageUrl", url)}
          placeholder="Image URL"
        />
      </BuilderSettingRow>

      {/* Layout & style */}
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Card layout">
            <select value={s.cardLayout ?? "vertical"} onChange={(e) => set("cardLayout", e.target.value)}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Card style">
            <select value={s.cardStyle ?? "default"} onChange={(e) => set("cardStyle", e.target.value)}>
              <option value="default">Default</option>
              <option value="bordered">Bordered</option>
              <option value="shadow">Shadow</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Radius (px)">
            <input
              type="number"
              min={0}
              max={32}
              step={2}
              value={s.cardBorderRadius ?? "12"}
              onChange={(e) => set("cardBorderRadius", e.target.value)}
            />
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Image">
            <select value={s.showFeaturedImage ?? "true"} onChange={(e) => set("showFeaturedImage", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          {showImage ? (
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

      {showReadMore ? (
        <BuilderSettingRow label="Read more label" fullWidth>
          <input
            type="text"
            value={s.readMoreLabel ?? "Read More"}
            onChange={(e) => set("readMoreLabel", e.target.value)}
            placeholder="Read More"
          />
        </BuilderSettingRow>
      ) : null}
    </div>
  );
}
