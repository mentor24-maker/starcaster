"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

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
  const posts = parseRelatedPosts(module.settings);

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

  const schema: BuilderSettingsSchema = {
    // D8 axes (master rule D8, docs/UI_RULES.md): Content / Structure / Frame.
    // Same keys, fallbacks and visibleWhen rules — only the column each
    // control sits in changed. "Match By" keeps its "Posts" count beside it:
    // the count exists only to qualify the match (it hides on manual), so
    // splitting the pair across axes would strand it (D1/D3).
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "showTitle",
              label: "Title",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "title",
              label: "Title Text",
              width: "text-md",
              control: "custom",
              rendersVia: "BlogRelatedPostsPreview",
              visibleWhen: (settings) => (settings.showTitle ?? "true") === "true",
              render: ({ settings, set }) => (
                <input
                  type="text"
                  value={settings.title ?? "You Might Also Like"}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="You Might Also Like"
                />
              )
            }
          ],
          [
            {
              key: "matchBy",
              label: "Match By",
              width: "auto",
              control: "select",
              options: [
                { value: "categories", label: "Categories" },
                { value: "tags", label: "Tags" },
                { value: "both", label: "Categories + Tags" },
                { value: "manual", label: "Manual selection" }
              ],
              fallback: "categories",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "count",
              label: "Posts",
              width: "select-sm",
              control: "select",
              options: [
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" }
              ],
              fallback: "3",
              rendersVia: "BlogRelatedPostsPreview",
              visibleWhen: (settings) => settings.matchBy !== "manual"
            }
          ],
          [
            {
              key: "showFeaturedImage",
              label: "Image",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "showExcerpt",
              label: "Excerpt",
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "showAuthor",
              label: "Author",
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "showDate",
              label: "Date",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "showCategories",
              label: "Categories",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "BlogRelatedPostsPreview"
            }
          ],
          [
            {
              key: "manualPosts",
              label: "Posts",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "BlogRelatedPostsPreview",
              visibleWhen: (settings) => settings.matchBy === "manual",
              render: () => (
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
              )
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "layout",
              label: "Layout",
              width: "select-md",
              control: "select",
              options: [
                { value: "grid", label: "Grid" },
                { value: "list", label: "List" }
              ],
              fallback: "grid",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "columns",
              label: "Columns",
              width: "select-sm",
              control: "select",
              options: [
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" }
              ],
              fallback: "3",
              rendersVia: "BlogRelatedPostsPreview",
              visibleWhen: (settings) => (settings.layout ?? "grid") === "grid"
            },
            {
              key: "cardGap",
              label: "Card Gap",
              width: "num",
              control: "number",
              min: 8,
              max: 48,
              step: 4,
              fallback: "20",
              rendersVia: "BlogRelatedPostsPreview"
            },
            {
              key: "imageAspectRatio",
              label: "Image Ratio",
              width: "select-sm",
              control: "select",
              options: [
                { value: "16:9", label: "16:9" },
                { value: "4:3", label: "4:3" },
                { value: "3:2", label: "3:2" },
                { value: "1:1", label: "1:1" }
              ],
              fallback: "16:9",
              rendersVia: "BlogRelatedPostsPreview",
              visibleWhen: (settings) => (settings.showFeaturedImage ?? "true") === "true"
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "cardStyle",
              label: "Card Style",
              width: "select-md",
              control: "select",
              options: [
                { value: "default", label: "Default" },
                { value: "bordered", label: "Bordered" },
                { value: "shadow", label: "Shadow" }
              ],
              fallback: "default",
              rendersVia: "BlogRelatedPostsPreview"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-related-posts-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
