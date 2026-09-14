"use client";

import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField } from "./builder-module-field";
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
    //
    // A1 sort (2026-08-10): nothing here is a theme override, so no axis gets
    // an Advanced section. The module has no colour, border, radius, shadow or
    // font-family control of its own. Card Style stays basic deliberately: it
    // names a card TREATMENT ("Default / Bordered / Shadow"), i.e. a layout
    // mode, not a border or shadow VALUE that second-guesses the theme — if
    // that enum is ever replaced by real border/shadow settings, those move.
    // Card Gap and Image Ratio are structural sizing and stay basic (A4).
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
                // Reads the links made in the Blog Links Manager module
                // (admin-blog-links) with its Relate Checked button. Unlike
                // "Manual selection" below, which is titles and URLs typed
                // into THIS panel, hand-picked links live in the database and
                // one linking serves every page this module sits on.
                { value: "picked", label: "Hand-picked (Blog Links Manager)" },
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
              /*
               * L6a item manager on its own lattice. It was
               * `.builder-slider-item-card` holding `label.field` boxes — the
               * shape W0 says to RETIRE rather than style, because it stacks a
               * label above a full-width box and so runs a SECOND label
               * geometry inside a panel whose other columns are on the lattice.
               * Measured at 1440 before this change: the panel's own fields sat
               * at label-width 125 / control-x 125, and every field in this
               * manager at 0 / 0 with a 429px box. It reuses
               * `.builder-cards-panel-fields` with `data-lattice-pairs="1"` —
               * the same grid and the same CSS Feature Cards, Carousel and the
               * Tag Cloud already use — rather than adding a fourth pattern.
               * The `--stacked` variant, one pair per row: this manager lives
               * inside a narrow AXIS COLUMN rather than in half a 50/50
               * editor, and the 2x2 shape left its text fields 94px wide at
               * both 1440 and 1920 (see the CSS note).
               *
               * The declaration is what makes it CHECKABLE: `check_panels`
               * selects item managers on `[data-lattice-pairs]` and
               * `[data-lattice-columns]`, and this manager declared neither, so
               * every panel sweep since the check was written found nothing to
               * measure here and reported OK.
               */
              render: () => (
                <>
                  <div className="builder-schema-group-title">Posts</div>
                  <div className="builder-cards-panel-fields builder-cards-panel-fields--stacked" data-lattice-pairs="1">
                    {posts.map((post, index) => (
                      <Fragment key={post.id}>
                        <div className="builder-card-editor-head">
                          <span className="builder-card-editor-name">{post.title || `Post ${index + 1}`}</span>
                          <div className="builder-item-grid-actions">
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => movePost(post.id, -1)}
                              aria-label={`Move post ${index + 1} up`}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button"
                              onClick={() => movePost(post.id, 1)}
                              aria-label={`Move post ${index + 1} down`}
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="builder-icon-button builder-icon-button-danger"
                              onClick={() => removePost(post.id)}
                              aria-label={`Delete post ${index + 1}`}
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <BuilderModuleField label="Title" width="text-md" className="builder-card-field--a">
                          <input
                            type="text"
                            value={post.title}
                            onChange={(e) => updatePost(post.id, "title", e.target.value)}
                            placeholder="Post title"
                            aria-label={`Post ${index + 1} title`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="URL" width="text-md" className="builder-card-field--b">
                          <input
                            type="text"
                            value={post.url}
                            onChange={(e) => updatePost(post.id, "url", e.target.value)}
                            placeholder="/blog/post-slug"
                            aria-label={`Post ${index + 1} URL`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Date" width="text-md" className="builder-card-field--a">
                          <input
                            type="text"
                            value={post.date}
                            onChange={(e) => updatePost(post.id, "date", e.target.value)}
                            placeholder="Jun 20, 2026"
                            aria-label={`Post ${index + 1} date`}
                          />
                        </BuilderModuleField>
                        <BuilderModuleField label="Categories" width="text-md" className="builder-card-field--b">
                          <input
                            type="text"
                            value={post.categories}
                            onChange={(e) => updatePost(post.id, "categories", e.target.value)}
                            placeholder="Tech, Design"
                            aria-label={`Post ${index + 1} categories`}
                          />
                        </BuilderModuleField>

                        {/* Too wide for half a row, so it spans to the block's
                            right edge (L8). `--picker` is what pushes the
                            Choose Image button onto that edge instead of
                            leaving it wherever the input ran out. */}
                        <BuilderModuleField
                          label="Image"
                          width="full"
                          className="builder-card-field--wide builder-card-field--picker"
                        >
                          <BuilderImagePickerField value={post.imageUrl} onChange={(url) => updatePost(post.id, "imageUrl", url)} />
                        </BuilderModuleField>
                      </Fragment>
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
