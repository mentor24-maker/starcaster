"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
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

/*
 * A1 sort (2026-08-10): reviewed and unchanged. This editor is the post's
 * DATA — body, meta, taxonomy, SEO, and which of those fields the post view
 * shows. It carries no colour, border, radius, shadow or font control, so
 * there is nothing that overrides the theme and nothing to collapse into an
 * Advanced section. (The hex values below are the panel's own chrome — the
 * status badge and the section tabs — not module settings.) Still a
 * hand-rolled tabbed panel rather than a D8 axes schema; that conversion is
 * separate work.
 */
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

  function showHideField(key: string, label: string, fallback: string) {
    return (
      <BuilderModuleField label={label} width="check">
        <input
          type="checkbox"
          checked={(s[key] ?? fallback) === "true"}
          onChange={(e) => set(key, e.target.checked ? "true" : "false")}
        />
      </BuilderModuleField>
    );
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
          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Title" width="full">
              <input
                type="text"
                value={s.title ?? ""}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Post title"
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Body" width="full">
              <BuilderRichTextEditor
                value={s.body ?? ""}
                onChange={setBody}
                placeholder="Write your post here…"
                {...richTextGallery}
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>
        </>
      ) : null}

      {/* ── Meta ── */}
      {section === "meta" ? (
        <>
          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Slug" width="text-md">
              <input
                type="text"
                value={s.slug ?? ""}
                onChange={(e) => set("slug", e.target.value)}
                placeholder="my-post-title"
              />
            </BuilderModuleField>
            <BuilderModuleField label="Author" width="text-md">
              <input
                type="text"
                value={s.author ?? ""}
                onChange={(e) => set("author", e.target.value)}
                placeholder="Author name"
              />
            </BuilderModuleField>
            <BuilderModuleField label="Publish Date" width="text-md">
              <input
                type="text"
                value={s.publishDate ?? ""}
                onChange={(e) => set("publishDate", e.target.value)}
                placeholder="Jun 22, 2026"
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Image" width="full">
              <BuilderImagePickerField
                value={s.featuredImageUrl ?? ""}
                onChange={(url) => set("featuredImageUrl", url)}
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Excerpt" width="full">
              <textarea
                className="builder-textarea"
                value={s.excerpt ?? ""}
                onChange={(e) => set("excerpt", e.target.value)}
                placeholder="A short summary shown in post cards and feeds…"
                rows={3}
                style={{ resize: "vertical" }}
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>
        </>
      ) : null}

      {/* ── Taxonomy ── */}
      {section === "taxonomy" ? (
        <>
          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Categories" width="full">
              <input
                type="text"
                value={s.categories ?? ""}
                onChange={(e) => set("categories", e.target.value)}
                placeholder="technology, design, ai"
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>
          <p style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 12px", lineHeight: 1.4 }}>
            Comma-separated slugs matching your Category Filter module.
          </p>

          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Tags" width="full">
              <input
                type="text"
                value={s.tags ?? ""}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="react, typescript, tutorial"
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>
          <p style={{ fontSize: 11, color: "#8ba9be", margin: "2px 0 0", lineHeight: 1.4 }}>
            Comma-separated tags.
          </p>
        </>
      ) : null}

      {/* ── SEO ── */}
      {section === "seo" ? (
        <>
          <BuilderModuleFieldStrip>
            <BuilderModuleField label="SEO Title" width="full">
              <input
                type="text"
                value={s.seoTitle ?? ""}
                onChange={(e) => set("seoTitle", e.target.value)}
                placeholder={s.title || "SEO page title"}
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          <BuilderModuleFieldStrip>
            <BuilderModuleField label="SEO Description" width="full">
              <textarea
                className="builder-textarea"
                value={s.seoDescription ?? ""}
                onChange={(e) => set("seoDescription", e.target.value)}
                placeholder="150–160 character description for search results…"
                rows={3}
                style={{ resize: "vertical" }}
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

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
        <BuilderModuleFieldStrip>
          {showHideField("showFeaturedImage", "Image", "true")}
          {showHideField("showExcerpt", "Excerpt", "true")}
          {showHideField("showAuthor", "Author", "true")}
          {showHideField("showDate", "Date", "true")}
          {showHideField("showCategories", "Categories", "true")}
          {showHideField("showTags", "Tags", "false")}
        </BuilderModuleFieldStrip>
      ) : null}
    </div>
  );
}
