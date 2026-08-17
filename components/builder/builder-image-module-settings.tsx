import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import {
  DEFAULT_IMAGE_EFFECT_FREQUENCY,
  DEFAULT_IMAGE_EFFECT_ROTATION_RATE,
  IMAGE_EFFECT_FREQUENCY_OPTIONS,
  IMAGE_EFFECT_OPTIONS,
  IMAGE_EFFECT_ROTATION_RATE_OPTIONS,
  imageEffectBounces,
  imageEffectRotates
} from "./builder-image-effects";
import {
  BuilderSchemaModuleSettings,
  paddingFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderImageModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
  /**
   * The module's OWN panel, as opposed to an image nested inside another
   * editor. Only the standalone panel carries the picture's source, link and
   * gallery buttons: the table-cell editor and the mega-menu feature editor
   * each supply their own, and rendering a second copy here would be two
   * controls for one setting (doctrine E6).
   */
  includeMedia?: boolean;
  onOpenGallery?: () => void;
  onUploadMedia?: (file: File | null) => void;
};

// 5% joined the list 2026-08-17: 10% of a column is 112px on the operator's
// page and ~190px on a full-bleed section, so a decorative graphic had no way
// to be small. `getModuleWidthPercent` clamped anything under 10 back up to
// it, so the floor moved there in the same change.
const SIZE_OPTIONS = ["5", "10", "15", "25", "33", "50", "66", "75", "90", "100"];

/**
 * Shared "prime" image controls, used by the image module and by nested
 * images (e.g. inside table cells), so an image gets the same treatment
 * wherever it lives.
 *
 * REFERENCE IMPLEMENTATION for the settings-editor layout standard —
 * see "Settings editor layout" in docs/MODULE_STANDARDS.md. Controls are
 * sorted onto logical axes (master rule D8, 2026-08-10) — Content /
 * Structure / Frame / Effects, each a titled column — every control declares
 * a width token, and every setting here is honoured by the renderer
 * (`getImageModuleStyle` / `BuilderImagePreview`). The axes replace the
 * old content/layout/style trio plus `panelColumns`: the lone Width
 * select is a column of its own rather than a stranded row (D1/D3).
 *
 * A1 sort (2026-08-10): the border trio — thickness, radius and colour —
 * are theme values, so they moved into Frame's own Advanced section, and
 * Border Color became a `theme-color` override whose themeDefault is its
 * old fallback (A2). Effect stays basic: it is an appearance mode the
 * theme knows nothing about, not an override. Alt text and Width are the
 * module's own settings and stay basic (A4).
 *
 * SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
 * Everything above that "moved into Advanced" now sits LAST on the axis it
 * already names, ordered by D9 (blast radius, descending). The axis
 * assignments and the A2 theme-colour semantics are unchanged — only the
 * collapsing is gone. Kept rather than rewritten: the reasoning is the record.
 *
 * 2026-08-16, operator: "the image module is all out of whack." It was — but
 * not in this file. Four of the module's controls (URL, Link, New Tab, and the
 * gallery buttons) were hand-rolled `<label class="field">` blocks in
 * `builder-module-card.tsx`, and the two Offset rows were a `BuilderSettingRow`
 * grid of their own, so the panel opened with five separate mini-layouts above
 * the three tidy axis columns — each measuring its own label track, none
 * lining up with any other (W0). They are schema fields on the Content axis
 * now, and the offsets moved into the shared chrome strip beside the margins
 * they belong with, which is where the Carousel's already were.
 *
 * The same pass gave Effects its own axis (operator: "we'll probably add more
 * effect settings, so make a column for effects"), and put the first of those
 * settings — Rotation Rate — beside it.
 */
export function BuilderImageModuleSettings({
  module,
  onUpdateModule,
  themeColors = [],
  includeMedia = false,
  onOpenGallery,
  onUploadMedia
}: BuilderImageModuleSettingsProps) {
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "url",
              label: "URL",
              width: "full",
              control: "custom",
              visibleWhen: () => includeMedia,
              rendersVia: "BuilderImagePreview",
              render: (ctx) => (
                <input
                  placeholder="https://..."
                  type="text"
                  value={ctx.settings.url ?? ""}
                  onChange={(event) => ctx.set("url", normalizeBuilderAssetUrl(event.target.value))}
                />
              )
            }
          ],
          [
            {
              key: "media",
              label: "Media",
              width: "full",
              control: "custom",
              bare: true,
              visibleWhen: () => includeMedia && Boolean(onOpenGallery || onUploadMedia),
              render: () => (
                <div className="builder-media-actions">
                  {onOpenGallery ? (
                    <button className="secondary-button builder-gallery-button" onClick={onOpenGallery} type="button">
                      Choose From Gallery
                    </button>
                  ) : null}
                  {onUploadMedia ? (
                    <label className="secondary-button builder-gallery-button builder-upload-button">
                      <span>Upload To Gallery</span>
                      <input
                        accept="image/*,video/*"
                        className="builder-upload-input"
                        type="file"
                        onChange={(event) => {
                          onUploadMedia(event.target.files?.[0] ?? null);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              )
            }
          ],
          [
            {
              key: "linkUrl",
              label: "Link",
              width: "full",
              control: "custom",
              visibleWhen: () => includeMedia,
              rendersVia: "BuilderImagePreview",
              render: (ctx) => (
                <input
                  placeholder="/path-or-url"
                  type="text"
                  value={ctx.settings.linkUrl ?? ""}
                  onChange={(event) => ctx.set("linkUrl", normalizeBuilderAssetUrl(event.target.value))}
                />
              )
            },
            {
              key: "newTab",
              label: "New Tab",
              width: "check",
              control: "checkbox",
              fallback: "false",
              // Beside the Link it gates — a New Tab with nothing to open is
              // the setting nobody can explain (D9).
              visibleWhen: () => includeMedia,
              rendersVia: "BuilderImagePreview"
            }
          ],
          [
            {
              key: "alt",
              label: "Alt text",
              width: "full",
              control: "text",
              placeholder: "Describe the image for screen readers",
              rendersVia: "BuilderImagePreview"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "size",
              label: "Width",
              width: "select-sm",
              control: "select",
              fallback: "100",
              options: SIZE_OPTIONS.map((value) => ({ value, label: `${value}%` })),
              rendersVia: "getImageModuleStyle"
            }
          ],
          // The margin half of W7 comes from the shared chrome (E6 — never a
          // second copy), and so, since 2026-08-16, does the Offset pair.
          // Padding had no control at all until 2026-08-11, so space between
          // the frame and the picture was unreachable: the operator asked to
          // "control all margin and padding around image objects" and only
          // half of that existed.
          paddingFields("getImageModuleStyle")
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "borderThickness",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              max: 24,
              fallback: "0",
              rendersVia: "getImageModuleStyle"
            },
            {
              key: "borderColor",
              label: "Border Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Image border color",
              themeDefault: "#0f4f8f",
              rendersVia: "getImageModuleStyle"
            },
            {
              key: "borderRadius",
              label: "Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 80,
              step: 5,
              fallback: "18",
              rendersVia: "getImageModuleStyle"
            }
          ]
        ],
        // A2 theme overrides. Frame's order is width, colour, then radius (D9).
      },
      {
        // Its own axis as of 2026-08-16, and empty-ish on purpose: the
        // operator expects more effect settings, and each one lands here
        // rather than being wedged in beside the border.
        title: "Effects",
        strips: [
          [
            {
              key: "effect",
              label: "Effect",
              width: "select-md",
              control: "select",
              fallback: "none",
              options: IMAGE_EFFECT_OPTIONS,
              rendersVia: "getImageEffectClassName"
            }
          ],
          [
            {
              key: "effectRotationRate",
              label: "Rotation Rate",
              width: "select-md",
              control: "select",
              fallback: DEFAULT_IMAGE_EFFECT_ROTATION_RATE,
              options: IMAGE_EFFECT_ROTATION_RATE_OPTIONS,
              // Only Spin and Tumbleweed turn. Shown beside the Effect that
              // gates it (D9) rather than greyed out on every other one.
              visibleWhen: (settings) => imageEffectRotates(settings.effect),
              rendersVia: "getImageEffectStyle"
            }
          ],
          [
            {
              key: "effectFrequency",
              label: "Frequency",
              width: "select-md",
              control: "select",
              fallback: DEFAULT_IMAGE_EFFECT_FREQUENCY,
              options: IMAGE_EFFECT_FREQUENCY_OPTIONS,
              // Only Tumbleweed leaves the midline, so only Tumbleweed can be
              // asked how often (D9: gated field beside what gates it).
              visibleWhen: (settings) => imageEffectBounces(settings.effect),
              rendersVia: "getImageEffectStageStyle"
            }
          ]
        ]
      }
    ]
  };

  return (
    <BuilderSchemaModuleSettings
      schema={schema}
      module={module}
      onUpdateModule={onUpdateModule}
      themeColors={themeColors}
    />
  );
}
