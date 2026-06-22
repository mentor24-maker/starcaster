"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderSettingRow } from "./builder-setting-row";

export type AuthorSocialLink = { id: string; platform: string; url: string };

const SOCIAL_PLATFORMS = [
  { value: "website",   label: "Website" },
  { value: "twitter",   label: "X / Twitter" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook",  label: "Facebook" },
  { value: "youtube",   label: "YouTube" },
  { value: "tiktok",    label: "TikTok" },
  { value: "threads",   label: "Threads" },
  { value: "bluesky",   label: "Bluesky" },
];

export function parseSocialLinks(settings: Record<string, string>): AuthorSocialLink[] {
  try {
    const parsed = JSON.parse(settings.socialLinks || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is AuthorSocialLink => x && typeof x.url === "string");
  } catch {
    return [];
  }
}

function serializeSocialLinks(links: AuthorSocialLink[]): string {
  return JSON.stringify(links);
}

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogAuthorBioModuleSettings({ module, onUpdateModule }: Props) {
  const s = module.settings;
  const links = parseSocialLinks(s);

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function persistLinks(next: AuthorSocialLink[]) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, socialLinks: serializeSocialLinks(next) }
    }));
  }

  function updateLink(id: string, field: keyof AuthorSocialLink, value: string) {
    persistLinks(links.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  function removeLink(id: string) {
    persistLinks(links.filter((l) => l.id !== id));
  }

  function addLink() {
    persistLinks([...links, { id: `social-${Date.now()}`, platform: "website", url: "" }]);
  }

  return (
    <div className="builder-blog-author-bio-settings">

      {/* Identity */}
      <BuilderSettingRow label="Name" fullWidth>
        <input
          type="text"
          value={s.name ?? ""}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Author name"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Title / role" fullWidth>
        <input
          type="text"
          value={s.title ?? ""}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Senior Editor"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Bio" fullWidth>
        <textarea
          className="builder-textarea"
          rows={3}
          value={s.bio ?? ""}
          onChange={(e) => set("bio", e.target.value)}
          placeholder="A short bio about the author"
        />
      </BuilderSettingRow>

      {/* Avatar */}
      <BuilderSettingRow label="Photo" fullWidth>
        <BuilderImagePickerField
          value={s.avatarUrl ?? ""}
          onChange={(url) => set("avatarUrl", url)}
          placeholder="Photo URL"
        />
      </BuilderSettingRow>

      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Photo shape">
            <select value={s.avatarShape ?? "circle"} onChange={(e) => set("avatarShape", e.target.value)}>
              <option value="circle">Circle</option>
              <option value="rounded">Rounded</option>
              <option value="square">Square</option>
            </select>
          </BuilderSettingRow>
        </div>
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Photo size (px)">
            <input
              type="number"
              min={40}
              max={200}
              step={8}
              value={s.avatarSize ?? "80"}
              onChange={(e) => set("avatarSize", e.target.value)}
            />
          </BuilderSettingRow>
        </div>
      </div>

      <BuilderSettingRow label="Layout">
        <select value={s.layout ?? "horizontal"} onChange={(e) => set("layout", e.target.value)}>
          <option value="horizontal">Horizontal (photo left)</option>
          <option value="vertical">Vertical (photo above)</option>
        </select>
      </BuilderSettingRow>

      {/* Social links */}
      <div className="builder-breadcrumb-items-label" style={{ marginTop: 12 }}>Social links</div>
      <div className="builder-slider-items">
        {links.map((link) => {
          const platformLabel = SOCIAL_PLATFORMS.find((p) => p.value === link.platform)?.label ?? link.platform;
          return (
            <div key={link.id} className="builder-slider-item-card">
              <div className="builder-slider-item-header">
                <strong>{platformLabel}</strong>
                <div className="builder-section-actions">
                  <button
                    type="button"
                    className="builder-icon-button builder-icon-button-danger"
                    onClick={() => removeLink(link.id)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="builder-slider-item-grid">
                <label className="field">
                  <span>Platform</span>
                  <select value={link.platform} onChange={(e) => updateLink(link.id, "platform", e.target.value)}>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>URL</span>
                  <input
                    type="text"
                    value={link.url}
                    onChange={(e) => updateLink(link.id, "url", e.target.value)}
                    placeholder="https://..."
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="secondary-button" onClick={addLink}>
        Add Social Link
      </button>
    </div>
  );
}
