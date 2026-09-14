"use client";

import { useEffect, useState } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { LATEST_POSTS_MAX_COUNT, parseStringList } from "@/lib/blog-latest-posts";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

type PickOption = { value: string; label: string };

/*
 * Tags carry a count of PUBLISHED posts, and only those are offered: Delray has
 * ~97 tags on no published post at all, and ticking one of them builds a row
 * that can never show anything. A tag already saved on the module stays listed
 * whatever its count, so the panel never hides a filter that is in effect.
 */
function useBlogPickOptions(): { tags: PickOption[] | null; categories: PickOption[] | null } {
  const [tags, setTags] = useState<PickOption[] | null>(null);
  const [categories, setCategories] = useState<PickOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const headers = starcasterScopedHeaders();
    fetch("/api/blog/tags", { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list: Array<{ tag?: string; livePostCount?: number }> = Array.isArray(d?.tags) ? d.tags : [];
        setTags(
          list
            .filter((t) => t.tag && (t.livePostCount ?? 0) > 0)
            .map((t) => ({ value: String(t.tag), label: `${t.tag} (${t.livePostCount})` }))
        );
      })
      .catch(() => { if (!cancelled) setTags([]); });
    fetch("/api/blog/categories", { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list: Array<{ id?: string; name?: string }> = Array.isArray(d?.categories) ? d.categories : [];
        setCategories(list.filter((c) => c.id).map((c) => ({ value: String(c.id), label: String(c.name || c.id) })));
      })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, []);
  return { tags, categories };
}

function PickList({
  options,
  selected,
  emptyText,
  onChange
}: {
  options: PickOption[] | null;
  selected: string[];
  emptyText: string;
  onChange: (next: string[]) => void;
}) {
  if (options === null) return <div className="builder-latest-posts-picklist-empty">Loading…</div>;
  const known = new Set(options.map((o) => o.value.toLowerCase()));
  // A saved choice the list no longer offers (renamed, or no longer on a
  // published post) is still listed, so it can be seen and unticked.
  const all = [
    ...options,
    ...selected.filter((v) => !known.has(v.toLowerCase())).map((v) => ({ value: v, label: `${v} (no published posts)` }))
  ];
  if (all.length === 0) return <div className="builder-latest-posts-picklist-empty">{emptyText}</div>;
  const chosen = new Set(selected.map((v) => v.toLowerCase()));
  return (
    <div className="builder-latest-posts-picklist">
      {all.map((option) => {
        const checked = chosen.has(option.value.toLowerCase());
        return (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(
                  checked
                    ? selected.filter((v) => v.toLowerCase() !== option.value.toLowerCase())
                    : [...selected, option.value]
                )
              }
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function BuilderBlogLatestPostsModuleSettings({ module, onUpdateModule }: Props) {
  const { tags, categories } = useBlogPickOptions();
  const filtering = (settings: Record<string, string>) => settings.latestPosts === "false";

  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "title",
              label: "Heading",
              width: "text-md",
              control: "text",
              placeholder: "Optional heading above the row",
              rendersVia: "BlogLatestPostsPreview heading"
            },
            {
              key: "postSlug",
              label: "Post Page",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "slug",
              noneLabel: "Site's post page",
              placeholder: "blog-post",
              rendersVia: "BlogLatestPostsPreview postPageUrl"
            }
          ],
          [
            {
              key: "latestPosts",
              label: "Latest posts",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "selectLatestPosts"
            }
          ],
          [
            {
              key: "filterTags",
              label: "Tags",
              width: "full",
              control: "custom",
              visibleWhen: filtering,
              render: ({ settings, set }) => (
                <PickList
                  options={tags}
                  selected={parseStringList(settings.filterTags)}
                  emptyText="No tag is on a published post yet."
                  onChange={(next) => set("filterTags", JSON.stringify(next))}
                />
              )
            }
          ],
          [
            {
              key: "filterCategories",
              label: "Categories",
              width: "full",
              control: "custom",
              visibleWhen: filtering,
              render: ({ settings, set }) => (
                <PickList
                  options={categories}
                  selected={parseStringList(settings.filterCategories)}
                  emptyText="This site has no categories yet."
                  onChange={(next) => set("filterCategories", JSON.stringify(next))}
                />
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
              key: "count",
              label: "Posts",
              width: "num",
              control: "number",
              min: 1,
              max: LATEST_POSTS_MAX_COUNT,
              step: 1,
              fallback: "3"
            },
            {
              key: "columns",
              label: "Columns",
              width: "select-sm",
              control: "select",
              fallback: "3",
              options: [
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" }
              ]
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "cardManagerNote",
              label: "Note",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <div className="builder-blog-post-list-card-manager-note">
                  Card content, layout, and style are set in the <strong>Card Manager</strong> module.
                </div>
              )
            }
          ],
          [
            { key: "cardGap", label: "Card Gap", width: "num", control: "number", min: 8, max: 64, step: 4, fallback: "24" }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-latest-posts-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
