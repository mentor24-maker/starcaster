import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";
import {
  GAME_FLOATING_IMAGE_DURATION_OPTIONS,
  getGameFloatingImageDurationSelectValue,
  normalizeGameFloatingImageDurationMs
} from "@/lib/game-floating-image-trigger";
import { isGameModuleTrigger } from "@/lib/module-trigger";
import { BuilderModuleOffsetFields } from "./builder-module-offset-fields";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderSchemaModuleSettings,
  paddingFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderFloatingImageModuleSettingsProps = {
  module: BuilderTemplateModule;
  onOpenGallery?: () => void;
  onUploadMedia?: (file: File | null) => void;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const OVERLAY_ANCHOR_OPTIONS = [
  { value: "center", label: "Center" },
  { value: "top-left", label: "Top Left" },
  { value: "top-center", label: "Top Center" },
  { value: "top-right", label: "Top Right" },
  { value: "center-left", label: "Center Left" },
  { value: "center-right", label: "Center Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-center", label: "Bottom Center" },
  { value: "bottom-right", label: "Bottom Right" }
] as const;

const SIZE_OPTIONS = ["10", "15", "25", "33", "50", "66", "75", "90", "100"] as const;

const EFFECT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bounce", label: "Bounce" },
  { value: "fast-bounce", label: "Fast Bounce" },
  { value: "big-bounce", label: "Big Bounce" },
  { value: "spin", label: "Spin" },
  { value: "cruise", label: "Cruise" },
  { value: "tumbleweed", label: "Tumbleweed" }
] as const;

export function BuilderFloatingImageModuleSettings({
  module,
  onOpenGallery,
  onUploadMedia,
  onUpdateModule,
  themeColors = []
}: BuilderFloatingImageModuleSettingsProps) {
  /*
   * D8 axes (2026-08-10): Content / Structure / Placement / Frame. Placement
   * carries BOTH offset systems — the anchor-relative X/Y/Z that positions
   * the overlay on the page, and the module nudge below it — which is
   * exactly why they stay in one block with their hints intact.
   *
   * A1 sort (2026-08-10): that whole offsets block — both systems together,
   * hints and all — moved into Placement's own Advanced section (A5), and
   * the border trio (thickness, radius, colour) into Frame's, with Border
   * Color becoming a `theme-color` override whose themeDefault is its old
   * fallback (A2). Anchor stays basic: it is where the image sits, not a
   * nudge off that spot. Effect stays basic too — an appearance mode, not a
   * theme override. Duration, URL, media, alt text and Size are the
   * module's own settings (A4).
   *
   * SUPERSEDED 2026-08-13 (master rule A0): the Advanced section is retired.
   * Everything above that "moved into Advanced" now sits LAST on the axis it
   * already names, ordered by D9 (blast radius, descending). The axis
   * assignments and the A2 theme-colour semantics are unchanged — only the
   * collapsing is gone. Kept rather than rewritten: the reasoning is the record.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "durationMs",
              label: "Duration",
              width: "select-md",
              control: "custom",
              visibleWhen: (settings) => isGameModuleTrigger(settings),
              rendersVia: "game floating-image trigger runtime",
              render: (ctx) => (
                <select
                  value={getGameFloatingImageDurationSelectValue(ctx.settings)}
                  onChange={(event) =>
                    ctx.set("durationMs", normalizeGameFloatingImageDurationMs(event.target.value))
                  }
                >
                  {GAME_FLOATING_IMAGE_DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )
            }
          ],
          [
            {
              key: "url",
              label: "URL",
              width: "full",
              control: "custom",
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
              visibleWhen: () => Boolean(onOpenGallery || onUploadMedia),
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
              key: "alt",
              label: "Alt Text",
              width: "full",
              control: "text",
              placeholder: "Image description",
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
              label: "Size",
              width: "select-sm",
              control: "select",
              options: SIZE_OPTIONS.map((size) => ({ value: size, label: `${size}%` })),
              fallback: "15",
              rendersVia: "getImageModuleStyle"
            }
          ],
          // A floating image shares the standard image's frame styles, so it
          // reads the same padding keys — exposed here too, or they would be
          // settings the renderer honours and no panel shows (E7).
          paddingFields("getImageModuleStyle")
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "overlayAnchor",
              label: "Anchor",
              width: "select-md",
              control: "select",
              options: [...OVERLAY_ANCHOR_OPTIONS],
              fallback: "center",
              rendersVia: "getImageOverlayStyle"
            }
          ],
          [
            {
              key: "offsetX",
              label: "Offsets",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "getImageOverlayStyle",
              // Anchor-relative placement with directional hints — bespoke rows kept
              // as-is; a num-width strip field has no room for the explanation.
              render: (ctx) => (
                <>
                  <BuilderSettingRow fullWidth label="X Offset">
                    <div className="builder-setting-value-stack">
                      <input
                        type="number"
                        value={ctx.settings.offsetX ?? "0"}
                        onChange={(event) => ctx.set("offsetX", event.target.value)}
                      />
                      <span className="builder-module-offset-hint">Positive moves right; negative moves left.</span>
                    </div>
                  </BuilderSettingRow>
                  <BuilderSettingRow fullWidth label="Y Offset">
                    <div className="builder-setting-value-stack">
                      <input
                        type="number"
                        value={ctx.settings.offsetY ?? "0"}
                        onChange={(event) => ctx.set("offsetY", event.target.value)}
                      />
                      <span className="builder-module-offset-hint">Positive moves up; negative moves down.</span>
                    </div>
                  </BuilderSettingRow>
                  <BuilderSettingRow fullWidth label="Z-Index">
                    <div className="builder-setting-value-stack">
                      <input
                        max={999999}
                        min={-999}
                        step={1}
                        type="number"
                        value={ctx.settings.zIndex ?? "20"}
                        onChange={(event) => ctx.set("zIndex", event.target.value)}
                      />
                      <span className="builder-module-offset-hint">
                        Higher values stack in front (e.g. 50–100 above page content). Lower values stack behind.
                      </span>
                    </div>
                  </BuilderSettingRow>
                  <BuilderModuleOffsetFields
                    horizontalOffset={ctx.settings.horizontalOffset ?? "0"}
                    verticalOffset={ctx.settings.verticalOffset ?? "0"}
                    onHorizontalOffsetChange={(horizontalOffset) => ctx.set("horizontalOffset", horizontalOffset)}
                    onVerticalOffsetChange={(verticalOffset) => ctx.set("verticalOffset", verticalOffset)}
                  />
                </>
              )
            }
          ]
        ],
        // A5: both offset systems are nudges, not everyday placement — they
        // move into Placement's Advanced section together, as one block.
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "effect",
              label: "Effect",
              width: "select-md",
              control: "select",
              options: [...EFFECT_OPTIONS],
              fallback: "none",
              rendersVia: "getImageEffectClassName"
            }
          ],
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
              dialogLabel: "Border Color",
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
              fallback: "18",
              rendersVia: "getImageModuleStyle"
            }
          ]
        ],
        // A2 theme overrides. Frame's order is width, colour, then radius (D9).
      }
    ]
  };

  return (
    <div className="builder-floating-image-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
