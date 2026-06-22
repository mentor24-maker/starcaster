"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderSettingRow } from "./builder-setting-row";
import { useState } from "react";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  richTextGallery?: RichTextGalleryBinding;
};

type Section = "content" | "meta" | "taxonomy" | "seo" | "display";

const SECTION_LABELS: Record<Section, string> = {
  content:  "Content",
  meta:     "Meta",
  taxonomy: "Categories & Tags",
  seo:      "SEO",
  display:  "Display",
};

export function BuilderBlogPostModuleSettings({ module, onUpdateModule, richTextGallery }: Props) {
  const s = module.settings;
  const [section, setSection] = useState<Section>("content");

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function setBody(value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, body: value } }));
  }

  const statusColors: Record<string, string> = {
    draft:     "#8ba9be",
    published: "#1d8a4e",
    archived:  "#a06040",
  };
  const currentStatus = s.status ?? "draft";

  return (
    <div className="builder-blog-post-settings">

      {/* Status badge + section tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: statusColors[currentStatus] ?? "#8ba9be",
          background: statusColors[currentStatus] + "18",
          borderRadius: 4,
          padding: "2px 7px",
        }}>
          {currentStatus}
        </span>
        <select
          value={currentStatus}
          onChange={(e) => set("status", e.target.value)}
          style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid #c9d8e6" }}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className="builder-settings-section-tabs" style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {(Object.keys(SECTION_LABELS) as Section[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: 4,
              border: "1px solid",
              borderColor: section === key ? "#0f4f8f" : "#c9d8e6",
              background: section === key ? "#e8f6fc" : "transparent",
              color: section === key ? "#0f4f8f" : "#587592",
              fontWeight: section === key ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {SECTION_LABELS[key]}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      {section === "content" ? (
        <>
          <BuilderSettingRow label="Title" fullWidth>
            <input
              type="text"
              value={s.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Post title"
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Body" fullWidth>
            <BuilderRichTextEditor
              value={s.body ?? ""}
              onChange={setBody}
              placeholder="Write your post here…"
              {...richTextGallery}
            />
          </BuilderSettingRow>
        </>
      ) : null}

      {/* ── Meta ── */}
      {section === "meta" ? (
        <>
          <BuilderSettingRow label="Slug" fullWidth>
            <input
              type="text"
              value={s.slug ?? ""}
              onChange={(e) => set("slug", e.target.value)}
              placeholder="my-post-title"
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Author" fullWidth>
            <input
              type="text"
              value={s.author ?? ""}
              onChange={(e) => set("author", e.target.value)}
              placeholder="Author name"
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Publish date" fullWidth>
            <input
              type="text"
              value={s.publishDate ?? ""}
              onChange={(e) => set("publishDate", e.target.value)}
              placeholder="Jun 22, 2026"
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Featured image" fullWidth>
            <BuilderImagePickerField
              value={s.featuredImageUrl ?? ""}
              onChange={(url) => set("featuredImageUrl", url)}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="Excerpt" fullWidth>
            <textarea
              value={s.excerpt ?? ""}
              onChange={(e) => set("excerpt", e.target.value)}
              placeholder="A short summary shown in post cards and feeds…"
              rows={3}
              style={{ resize: "vertical" }}
            />
          </BuilderSettingRow>
        </>
      ) : null}

      {/* ── Taxonomy ── */}
      {section === "taxonomy" ? (
        <>
          <BuilderSettingRow label="Categories" fullWidth>
            <input
              type="text"
              value={s.categories ?? ""}
              onChange={(e) => set("categories", e.target.value)}
              placeholder="technology, design, ai"
            />
          </BuilderSettingRow>
          <p style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 12px", lineHeight: 1.4 }}>
            Comma-separated slugs matching your Category Filter module.
          </p>

          <BuilderSettingRow label="Tags" fullWidth>
            <input
              type="text"
              value={s.tags ?? ""}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="react, typescript, tutorial"
            />
          </BuilderSettingRow>
          <p style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 0", lineHeight: 1.4 }}>
            Comma-separated tags.
          </p>
        </>
      ) : null}

      {/* ── SEO ── */}
      {section === "seo" ? (
        <>
          <BuilderSettingRow label="SEO title" fullWidth>
            <input
              type="text"
              value={s.seoTitle ?? ""}
              onChange={(e) => set("seoTitle", e.target.value)}
              placeholder={s.title || "SEO page title"}
            />
          </BuilderSettingRow>

          <BuilderSettingRow label="SEO description" fullWidth>
            <textarea
              value={s.seoDescription ?? ""}
              onChange={(e) => set("seoDescription", e.target.value)}
              placeholder="150–160 character description for search results…"
              rows={3}
              style={{ resize: "vertical" }}
            />
          </BuilderSettingRow>

          {s.seoDescription ? (
            <p style={{
              fontSize: 11,
              color: s.seoDescription.length > 160 ? "#c0392b" : "#1d8a4e",
              margin: "2px 0 0"
            }}>
              {s.seoDescription.length} / 160 characters
            </p>
          ) : null}
        </>
      ) : null}

      {/* ── Display ── */}
      {section === "display" ? (
        <div className="builder-button-setting-columns">
          <div className="builder-button-setting-column">
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

            <BuilderSettingRow label="Author">
              <select value={s.showAuthor ?? "true"} onChange={(e) => set("showAuthor", e.target.value)}>
                <option value="true">Show</option>
                <option value="false">Hide</option>
              </select>
            </BuilderSettingRow>
          </div>
          <div className="builder-button-setting-column">
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

            <BuilderSettingRow label="Tags">
              <select value={s.showTags ?? "false"} onChange={(e) => set("showTags", e.target.value)}>
                <option value="false">Hide</option>
                <option value="true">Show</option>
              </select>
            </BuilderSettingRow>
          </div>
        </div>
      ) : null}
    </div>
  );
}
