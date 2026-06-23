"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogPostCreateModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-blog-post-create-settings">

      {/* Form header */}
      <BuilderSettingRow label="Show form title">
        <select value={s.showFormTitle ?? "true"} onChange={(e) => set("showFormTitle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {(s.showFormTitle ?? "true") === "true" ? (
        <BuilderSettingRow label="Form title" fullWidth>
          <input
            type="text"
            value={s.formTitle ?? "Create New Post"}
            onChange={(e) => set("formTitle", e.target.value)}
            placeholder="Create New Post"
          />
        </BuilderSettingRow>
      ) : null}

      {/* Submit buttons */}
      <BuilderSettingRow label="Publish button" fullWidth>
        <input
          type="text"
          value={s.submitLabel ?? "Publish Post"}
          onChange={(e) => set("submitLabel", e.target.value)}
          placeholder="Publish Post"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Draft button" fullWidth>
        <input
          type="text"
          value={s.draftLabel ?? "Save as Draft"}
          onChange={(e) => set("draftLabel", e.target.value)}
          placeholder="Save as Draft"
        />
      </BuilderSettingRow>

      {/* Default status + status picker */}
      <BuilderSettingRow label="Default status">
        <select value={s.defaultStatus ?? "draft"} onChange={(e) => set("defaultStatus", e.target.value)}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </BuilderSettingRow>

      <BuilderSettingRow label="Let author change status">
        <select value={s.allowStatusChange ?? "true"} onChange={(e) => set("allowStatusChange", e.target.value)}>
          <option value="true">Yes</option>
          <option value="false">No (uses default)</option>
        </select>
      </BuilderSettingRow>

      {/* Fields */}
      <div className="builder-breadcrumb-items-label" style={{ marginTop: 12, marginBottom: 6 }}>
        Fields to show
      </div>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Slug">
            <select value={s.showSlug ?? "true"} onChange={(e) => set("showSlug", e.target.value)}>
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

          <BuilderSettingRow label="Excerpt">
            <select value={s.showExcerpt ?? "true"} onChange={(e) => set("showExcerpt", e.target.value)}>
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Author field">
            <select value={s.showAuthorField ?? "false"} onChange={(e) => set("showAuthorField", e.target.value)}>
              <option value="false">Hide (use logged-in user)</option>
              <option value="true">Show</option>
            </select>
          </BuilderSettingRow>
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Categories">
            <select value={s.showCategories ?? "true"} onChange={(e) => set("showCategories", e.target.value)}>
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

          <BuilderSettingRow label="SEO fields">
            <select value={s.showSeoFields ?? "false"} onChange={(e) => set("showSeoFields", e.target.value)}>
              <option value="false">Hide</option>
              <option value="true">Show</option>
            </select>
          </BuilderSettingRow>
        </div>
      </div>

      {/* Post-submit behavior */}
      <div className="builder-breadcrumb-items-label" style={{ marginTop: 12, marginBottom: 6 }}>
        After submit
      </div>

      <BuilderSettingRow label="Success message" fullWidth>
        <input
          type="text"
          value={s.successMessage ?? "Post created successfully."}
          onChange={(e) => set("successMessage", e.target.value)}
          placeholder="Post created successfully."
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Redirect to" fullWidth>
        <input
          type="text"
          value={s.redirectAfterCreate ?? ""}
          onChange={(e) => set("redirectAfterCreate", e.target.value)}
          placeholder="/admin/posts  (leave blank to stay on this page)"
        />
      </BuilderSettingRow>

      {/* Styling */}
      <BuilderSettingRow label="Accent color">
        <input
          type="color"
          value={s.accentColor ?? "#0f4f8f"}
          onChange={(e) => set("accentColor", e.target.value)}
        />
      </BuilderSettingRow>
    </div>
  );
}
