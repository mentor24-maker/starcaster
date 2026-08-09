"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

const SHOW_HIDE = [
  { value: "true", label: "Show" },
  { value: "false", label: "Hide" }
];

const HIDE_SHOW = [
  { value: "false", label: "Hide" },
  { value: "true", label: "Show" }
];

export function BuilderBlogPostListModuleSettings({ module, onUpdateModule }: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "moduleName",
          label: "Label",
          width: "text-md",
          control: "custom",
          render: ({ module: current }) => (
            <input
              type="text"
              value={current.name}
              onChange={(e) => onUpdateModule((m) => ({ ...m, name: e.target.value }))}
              placeholder="Optional internal label"
            />
          )
        },
        { key: "postTitle", label: "Post Title", width: "text-md", control: "text", placeholder: "Section title" },
        { key: "postSlug", label: "Post Slug", width: "text-md", control: "text" }
      ]
    ],
    layout: [
      [
        {
          key: "layout",
          label: "Layout",
          width: "select-sm",
          control: "select",
          fallback: "grid",
          options: [
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
            { value: "admin-manager", label: "Admin" }
          ]
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
            { value: "3", label: "3" }
          ]
        },
        {
          key: "postsPerPage",
          label: "Posts Per Page",
          width: "select-sm",
          control: "select",
          fallback: "9",
          options: [
            { value: "3", label: "3" },
            { value: "6", label: "6" },
            { value: "9", label: "9" },
            { value: "12", label: "12" },
            { value: "18", label: "18" }
          ]
        }
      ],
      [
        { key: "showSearch", label: "Search Bar", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showCategoryFilter", label: "Category Filter", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showDateFilter", label: "Date Filter", width: "select-sm", control: "select", fallback: "false", options: HIDE_SHOW },
        { key: "showAuthorFilter", label: "Author Filter", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        { key: "showTagFilter", label: "Tag Filter", width: "select-sm", control: "select", fallback: "true", options: SHOW_HIDE },
        {
          key: "popularityFilter",
          label: "Popularity",
          width: "select-md",
          control: "select",
          fallback: "false",
          options: [
            { value: "false", label: "Off" },
            { value: "views", label: "By Views" },
            { value: "likes", label: "By Likes" }
          ]
        }
      ]
    ],
    style: [
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
              Add a Card Manager to any page to edit the card template.
            </div>
          )
        }
      ],
      [
        { key: "cardGap", label: "Card Gap", width: "num", control: "number", min: 8, max: 64, step: 4, fallback: "24" }
      ]
    ]
  };

  return (
    <div className="builder-blog-post-list-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
