"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogSearchResultsModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  return (
    <div className="builder-blog-search-results-settings">
      <BuilderSettingRow label="Search param" fullWidth>
        <input
          type="text"
          value={s.searchParam ?? "search"}
          onChange={(e) => set("searchParam", e.target.value)}
          placeholder="search"
        />
      </BuilderSettingRow>
      <div className="builder-module-runtime-note">
        <p>Must match the search param on the paired <strong>Blog Search</strong> module.</p>
      </div>

      <BuilderSettingRow label="Post page URL" fullWidth>
        <input
          type="text"
          value={s.postPageUrl ?? ""}
          onChange={(e) => set("postPageUrl", e.target.value)}
          placeholder="/blog-post-view"
        />
      </BuilderSettingRow>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Max results">
            <input
              type="number"
              min={1}
              max={200}
              value={s.limit ?? "50"}
              onChange={(e) => set("limit", e.target.value)}
              style={{ width: 72 }}
            />
          </BuilderSettingRow>
        </div>
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Thumbnail width">
            <input
              type="number"
              min={60}
              max={240}
              value={s.thumbWidth ?? "120"}
              onChange={(e) => set("thumbWidth", e.target.value)}
              style={{ width: 72 }}
            />
          </BuilderSettingRow>
        </div>
      </div>

      <BuilderSettingRow label="Empty state message" fullWidth>
        <input
          type="text"
          value={s.emptyMessage ?? "No posts found."}
          onChange={(e) => set("emptyMessage", e.target.value)}
          placeholder="No posts found."
        />
      </BuilderSettingRow>
    </div>
  );
}
