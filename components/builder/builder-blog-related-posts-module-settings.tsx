"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderSettingRow } from "./builder-setting-row";

export type RelatedPost = {
  id: string;
  title: string;
  imageUrl: string;
  url: string;
  date: string;
  categories: string;
};

export function parseRelatedPosts(settings: Record<string, string>): RelatedPost[] {
  try {
    const parsed = JSON.parse(settings.manualPosts || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is RelatedPost => x && typeof x.title === "string");
  } catch {
    return [];
  }
}

function serializeRelatedPosts(posts: RelatedPost[]): string {
  return JSON.stringify(posts);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogRelatedPostsModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;
  const isManual = s.matchBy === "manual";
  const posts = parseRelatedPosts(s);
  const isGrid = (s.layout ?? "grid") === "grid";

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function persistPosts(next: RelatedPost[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, manualPosts: serializeRelatedPosts(next) }
    }));
  }

  function updatePost(id: string, field: keyof RelatedPost, value: string) {
    persistPosts(posts.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  function movePost(id: string, direction: -1 | 1) {
    const index = posts.findIndex((p) => p.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= posts.length) return;
    const next = [...posts];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persistPosts(next);
  }

  function removePost(id: string) {
    persistPosts(posts.filter((p) => p.id !== id));
  }

  function addPost() {
    persistPosts([
      ...posts,
      { id: `related-${Date.now()}`, title: "", imageUrl: "", url: "", date: "", categories: "" }
    ]);
  }

  return (
    <div className="builder-blog-related-posts-settings">

      {/* Section heading */}
      <BuilderSettingRow label="Show title">
        <select value={s.showTitle ?? "true"} onChange={(e) => set("showTitle", e.target.value)}>
          <option value="true">Show</option>
          <option value="false">Hide</option>
        </select>
      </BuilderSettingRow>

      {(s.showTitle ?? "true") === "true" ? (
        <BuilderSettingRow label="Title text" fullWidth>
          <input
            type="text"
            value={s.title ?? "You Might Also Like"}
            onChange={(e) => set("title", e.target.value)}
            placeholder="You Might Also Like"
          />
        </BuilderSettingRow>
      ) : null}

      {/* Source */}
      <BuilderSettingRow label="Match by" fullWidth>
        <select value={s.matchBy ?? "categories"} onChange={(e) => set("matchBy", e.target.value)}>
          <option value="categories">Categories</option>
          <option value="tags">Tags</option>
          <option value="both">Categories + Tags</option>
          <option value="manual">Manual selection</option>
        </select>
      </BuilderSettingRow>

      {!isManual ? (
        <BuilderSettingRow label="Posts to show">
          <select value={s.count ?? "3"} onChange={(e) => set("count", e.target.value)}>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </BuilderSettingRow>
      ) : null}

      {/* Layout */}
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
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </BuilderSettingRow>
          ) : null}

          <BuilderSettingRow label="Card gap (px)">
            <input
              type="number"
              min={8}
              max={48}
              step={4}
              value={s.cardGap ?? "20"}
              onChange={(e) => set("cardGap", e.target.value)}
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
          <BuilderSettingRow label="Image">
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
            <select value={s.showExcerpt ?? "false"} onChange={(e) => set("showExcerpt", e.target.value)}>
              <option value="false">Hide</option>
              <option value="true">Show</option>
            </select>
          </BuilderSettingRow>

          <BuilderSettingRow label="Author">
            <select value={s.showAuthor ?? "false"} onChange={(e) => set("showAuthor", e.target.value)}>
              <option value="false">Hide</option>
              <option value="true">Show</option>
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

      {/* Manual post list */}
      {isManual ? (
        <>
          <div className="builder-breadcrumb-items-label" style={{ marginTop: 12 }}>
            Posts
          </div>
          <div className="builder-slider-items">
            {posts.map((post, index) => (
              <div key={post.id} className="builder-slider-item-card">
                <div className="builder-slider-item-header">
                  <strong>{post.title || `Post ${index + 1}`}</strong>
                  <div className="builder-section-actions">
                    <button type="button" className="builder-icon-button" onClick={() => movePost(post.id, -1)} title="Move up">↑</button>
                    <button type="button" className="builder-icon-button" onClick={() => movePost(post.id, 1)} title="Move down">↓</button>
                    <button type="button" className="builder-icon-button builder-icon-button-danger" onClick={() => removePost(post.id)} title="Remove">✕</button>
                  </div>
                </div>
                <div className="builder-slider-item-grid">
                  <label className="field">
                    <span>Title</span>
                    <input type="text" value={post.title} onChange={(e) => updatePost(post.id, "title", e.target.value)} placeholder="Post title" />
                  </label>
                  <label className="field">
                    <span>URL</span>
                    <input type="text" value={post.url} onChange={(e) => updatePost(post.id, "url", e.target.value)} placeholder="/blog/post-slug" />
                  </label>
                  <label className="field">
                    <span>Date</span>
                    <input type="text" value={post.date} onChange={(e) => updatePost(post.id, "date", e.target.value)} placeholder="Jun 20, 2026" />
                  </label>
                  <label className="field">
                    <span>Categories</span>
                    <input type="text" value={post.categories} onChange={(e) => updatePost(post.id, "categories", e.target.value)} placeholder="Tech, Design" />
                  </label>
                  <label className="field builder-slider-item-grid-full">
                    <span>Image</span>
                    <BuilderImagePickerField value={post.imageUrl} onChange={(url) => updatePost(post.id, "imageUrl", url)} />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="secondary-button" onClick={addPost}>
            Add Post
          </button>
        </>
      ) : null}
    </div>
  );
}
