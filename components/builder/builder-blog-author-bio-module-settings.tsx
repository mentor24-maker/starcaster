"use client";

import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField } from "./builder-module-field";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

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
  const links = parseSocialLinks(module.settings);

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

  const schema: BuilderSettingsSchema = {
    // D8 logical axes: Content / Structure. The social-link manager
    // dominates the panel, so it stays in the first (leftmost) axis with
    // the rest of what the module shows; only the arrangement controls
    // move out. Two axes is the honest count — no axis was invented to
    // reach four.
    //
    // A1 sort (2026-08-10): nothing here overrides a theme value, so this
    // panel has no Advanced section. The module carries no colours, borders
    // or shadows at all; Photo Shape and Photo Size are structural sizing,
    // which the criteria keep basic.
    axes: [
      {
        title: "Content",
        strips: [
      // Name + Title share one strip at content-sized widths (D1/W3) —
      // they were two stacked full-width rows.
      [
        { key: "name", label: "Name", width: "text-md", control: "text", placeholder: "Author name" },
        { key: "title", label: "Title / Role", width: "text-md", control: "text", placeholder: "Senior Editor" }
      ],
      [{ key: "bio", label: "Bio", width: "full", control: "textarea", rows: 3, placeholder: "A short bio about the author" }],
      [
        {
          key: "avatarUrl",
          label: "Photo",
          width: "full",
          control: "custom",
          render: ({ settings, set }) => (
            <BuilderImagePickerField
              value={settings.avatarUrl ?? ""}
              onChange={(url) => set("avatarUrl", url)}
              placeholder="Photo URL"
            />
          )
        }
      ],
      [
        {
          key: "socialLinks",
          label: "Social Links",
          width: "full",
          control: "custom",
          bare: true,
          /*
           * L6a item manager on its own lattice. It was
           * `.builder-slider-item-card` holding `label.field` boxes — the shape
           * W0 says to RETIRE rather than style, because it stacks a label
           * above a full-width box and so runs a SECOND label geometry inside a
           * panel whose other columns are on the lattice. Measured at 1440
           * before this change: the panel's own fields sat at label-width 125 /
           * control-x 125, and this manager's two columns at 0 and 257. It
           * reuses `.builder-cards-panel-fields` with `data-lattice-pairs="1"`
           * — the same CSS Feature Cards, Carousel and the Tag Cloud use, in
           * its `--stacked` variant, because this manager sits inside a narrow
           * axis column rather than in half a 50/50 editor (see the CSS note).
           *
           * The declaration is what makes it CHECKABLE: `check_panels` selects
           * item managers on `[data-lattice-pairs]` and
           * `[data-lattice-columns]`, and this one declared neither — and its
           * old shape, `.builder-slider-item-grid`, is a class `check_panels`
           * EXPLICITLY EXCLUDES from measurement, so every sweep since the
           * check was written reported OK here without ever looking inside it.
           */
          render: () => (
            <>
              <div className="builder-schema-group-title">Social links</div>
              <div className="builder-cards-panel-fields builder-cards-panel-fields--stacked" data-lattice-pairs="1">
                {links.map((link, index) => {
                  const platformLabel = SOCIAL_PLATFORMS.find((p) => p.value === link.platform)?.label ?? link.platform;
                  return (
                    <Fragment key={link.id}>
                      <div className="builder-card-editor-head">
                        <span className="builder-card-editor-name">{platformLabel}</span>
                        <div className="builder-item-grid-actions">
                          <button
                            type="button"
                            className="builder-icon-button builder-icon-button-danger"
                            onClick={() => removeLink(link.id)}
                            aria-label={`Delete social link ${index + 1}`}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <BuilderModuleField label="Platform" width="select-md" className="builder-card-field--a">
                        <select
                          value={link.platform}
                          onChange={(e) => updateLink(link.id, "platform", e.target.value)}
                          aria-label={`Social link ${index + 1} platform`}
                        >
                          {SOCIAL_PLATFORMS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </BuilderModuleField>
                      <BuilderModuleField label="URL" width="text-md" className="builder-card-field--b">
                        <input
                          type="text"
                          value={link.url}
                          onChange={(e) => updateLink(link.id, "url", e.target.value)}
                          placeholder="https://..."
                          aria-label={`Social link ${index + 1} URL`}
                        />
                      </BuilderModuleField>
                    </Fragment>
                  );
                })}
              </div>
              <button type="button" className="secondary-button" onClick={addLink}>
                Add Social Link
              </button>
            </>
          )
        }
      ]
        ]
      },
      // Layout + photo shape/size share one strip (D1/D3) — the Layout
      // select sat orphaned in its own group, one row above them.
      {
        title: "Structure",
        strips: [
      [
        {
          key: "layout",
          label: "Layout",
          width: "select-md",
          control: "select",
          fallback: "horizontal",
          options: [
            { value: "horizontal", label: "Horizontal (photo left)" },
            { value: "vertical", label: "Vertical (photo above)" }
          ]
        },
        {
          key: "avatarShape",
          label: "Photo Shape",
          width: "select-md",
          control: "select",
          fallback: "circle",
          options: [
            { value: "circle", label: "Circle" },
            { value: "rounded", label: "Rounded" },
            { value: "square", label: "Square" }
          ]
        },
        { key: "avatarSize", label: "Photo Size", width: "num", control: "number", min: 40, max: 200, step: 8, fallback: "80" }
      ]
        ]
      }
    ]
  };

  return (
    <div className="builder-blog-author-bio-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
