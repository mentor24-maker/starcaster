import { useState } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import {
  BACKGROUND_STYLE_PRESETS,
  createDefaultBackgroundSettings,
  normalizeBuilderAssetUrl
} from "@/lib/builder-template";
import { BuilderGalleryModal } from "./builder-gallery-modal";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorField } from "./builder-theme-color-field";

type BuilderBackgroundControlsProps = {
  label: string;
  /**
   * What the MODE picker is called, when that differs from the group's own
   * `label`. The overlay group is one control set worn twice — the same
   * picker choosing a background on one row and a screen painted over it on
   * the next — and "Background Type" sitting inside a group headed Overlay
   * reads as the row's own background. The frozen vanilla builder solved it
   * with `sectionLabel`; this is the same idea with a name that says which
   * label it is. Defaults to `label`, so every existing caller is unchanged.
   */
  modeLabel?: string;
  background: BackgroundSettings;
  onChange: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  onChooseImage?: () => void;
  onUploadImage?: (file: File | null) => void;
  compact?: boolean;
  horizontal?: boolean;
  hideModeRow?: boolean;
  hideClear?: boolean;
  /** When false, compact row uses the outer `label` on the mode field only (e.g. Page Details). */
  showColorFieldLabel?: boolean;
  /** Theme palette — used to seed defaults when the user first picks a mode (not shell background). */
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
  themeColors?: Array<{ label: string; hex: string }>;
  /**
   * Whether Video is offered here. OFF by default, and that default is the
   * whole point: this component is the chrome worn by button backgrounds,
   * module backgrounds, poll pods and the email path, none of which can render
   * a <video>. Opting IN per surface means adding video could not silently put
   * an option in front of an operator that does nothing where he clicked it.
   */
  allowVideo?: boolean;
};

export function BuilderBackgroundControls({
  label,
  modeLabel,
  background,
  onChange,
  onChooseImage,
  onUploadImage,
  compact = false,
  horizontal = false,
  hideModeRow = false,
  hideClear = false,
  showColorFieldLabel = true,
  themeBackgroundColor,
  themePrimaryColor,
  themeColors = [],
  allowVideo = false
}: BuilderBackgroundControlsProps) {
  const [isFallbackGalleryOpen, setIsFallbackGalleryOpen] = useState(false);
  const [openVideoPicker, setOpenVideoPicker] = useState<"clip" | "poster" | null>(null);

  function handleModeChange(newMode: BackgroundSettings["mode"]) {
    onChange((current) => {
      if (newMode === "none") {
        return createDefaultBackgroundSettings();
      }
      const next = { ...current, mode: newMode };
      if (newMode === "color" && themeBackgroundColor) {
        next.color = themeBackgroundColor;
      } else if (newMode === "gradient") {
        if (themePrimaryColor) next.color = themePrimaryColor;
        next.color2 = "#ffffff";
      }
      return next;
    });
  }

  const videoUrl = background.videoUrl ?? "";
  const posterUrl = background.posterUrl ?? "";
  const needsPoster = background.mode === "video" && !posterUrl;

  const videoGallery = openVideoPicker ? (
    <BuilderGalleryModal
      isUploading={false}
      /*
       * FILE KIND, not media category. This was `initialMediaCategory` with
       * "Video"/"Image" until 2026-08-31, and `mediaCategory` is the topical
       * category ("Article Banner", "X Post") — nothing in the library carries
       * "Video" as one. The picker painted the whole gallery and then emptied
       * itself the moment the filter landed: a flash, then a blank shell.
       *
       * Still a starting point, not a lock — the filter bar shows it and
       * Clear brings the whole library back.
       */
      initialKind={openVideoPicker === "clip" ? "video" : "image"}
      onSelectImage={(path) => {
        const url = normalizeBuilderAssetUrl(path);
        onChange((current) =>
          openVideoPicker === "clip"
            ? { ...current, videoUrl: url }
            : { ...current, posterUrl: url }
        );
        setOpenVideoPicker(null);
      }}
      onClose={() => setOpenVideoPicker(null)}
    />
  ) : null;

  /**
   * The Video panel. One definition, rendered by both layouts below, so the
   * horizontal and stacked forms of this component cannot drift into offering
   * different controls — which is exactly what happened to the mode dropdown
   * itself, where a third hand-written copy in builder-section-controls.tsx
   * had to be found and updated separately.
   */
  function renderVideoControls() {
    if (background.mode !== "video") return null;

    return (
      <div className="builder-schema-panel-column builder-video-background-controls">
        <div className="builder-schema-group-title">Video</div>

        <BuilderSettingRow label="Video URL" fullWidth>
          <input
            type="text"
            value={videoUrl}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                videoUrl: normalizeBuilderAssetUrl(event.target.value)
              }))
            }
            placeholder="/api/admin/media-file/..."
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Video File" fullWidth>
          <div className="builder-media-actions">
            <button
              className="secondary-button builder-gallery-button"
              onClick={() => setOpenVideoPicker("clip")}
              type="button"
            >
              Choose Video
            </button>
            {onUploadImage ? (
              <label className="secondary-button builder-gallery-button builder-upload-button">
                <span>Upload Video</span>
                <input
                  className="builder-upload-input"
                  type="file"
                  accept="video/*"
                  onChange={(event) => {
                    onUploadImage(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
        </BuilderSettingRow>

        <BuilderSettingRow label="Poster Image" fullWidth>
          <input
            type="text"
            value={posterUrl}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                posterUrl: normalizeBuilderAssetUrl(event.target.value)
              }))
            }
            placeholder="/api/admin/media-file/..."
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Poster File" fullWidth>
          <button
            className="secondary-button builder-gallery-button"
            onClick={() => setOpenVideoPicker("poster")}
            type="button"
          >
            Choose Poster
          </button>
        </BuilderSettingRow>

        {needsPoster ? (
          <BuilderSettingRow label="" fullWidth>
            <p className="builder-video-background-warning">
              Without a poster image this section will be blank until the video loads — and it is
              what phones and visitors who have asked for reduced motion see instead of the video.
            </p>
          </BuilderSettingRow>
        ) : null}

        <BuilderSettingRow label="Speed">
          <select
            value={String(background.videoSpeed ?? 1)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoSpeed: Number(event.target.value) }))
            }
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">Normal</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
        </BuilderSettingRow>

        <BuilderSettingRow label="Loop">
          <input
            type="checkbox"
            checked={background.videoLoop !== false}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoLoop: event.target.checked }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Loop Fade">
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={String(background.videoLoopFade ?? 0.6)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoLoopFade: Number(event.target.value) }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Start At">
          <input
            type="number"
            min={0}
            step={0.5}
            value={String(background.videoTrimStart ?? 0)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoTrimStart: Number(event.target.value) }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="End At">
          <input
            type="number"
            min={0}
            step={0.5}
            value={String(background.videoTrimEnd ?? 0)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoTrimEnd: Number(event.target.value) }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Blur">
          <input
            type="number"
            min={0}
            max={20}
            value={String(background.videoBlur ?? 0)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoBlur: Number(event.target.value) }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Focus X">
          <input
            type="number"
            min={0}
            max={100}
            value={String(background.videoFocalX ?? 50)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoFocalX: Number(event.target.value) }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Focus Y">
          <input
            type="number"
            min={0}
            max={100}
            value={String(background.videoFocalY ?? 50)}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoFocalY: Number(event.target.value) }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="Play On Phones">
          <input
            type="checkbox"
            checked={background.videoPlayOnMobile === true}
            onChange={(event) =>
              onChange((current) => ({ ...current, videoPlayOnMobile: event.target.checked }))
            }
          />
        </BuilderSettingRow>

        <BuilderSettingRow label="" fullWidth>
          <p className="builder-video-background-note">
            Loop Fade dissolves the clip back into itself instead of cutting; 0 is a hard cut.
            Phones show the poster instead unless Play On Phones is on — a background video is
            megabytes of someone&rsquo;s cell data. Leave both trim boxes at 0 to play the whole clip.
          </p>
        </BuilderSettingRow>

        {videoGallery}
      </div>
    );
  }

  // When no external gallery callback is wired (e.g. cell/page/poll
  // backgrounds), fall back to the standard self-contained gallery picker so
  // backgrounds are chosen the same way as every other image.
  function renderBackgroundGalleryAction() {
    if (onChooseImage) {
      return (
        <button className="secondary-button builder-gallery-button" onClick={onChooseImage} type="button">
          Choose Background Image
        </button>
      );
    }

    return (
      <button
        className="secondary-button builder-gallery-button"
        onClick={() => setIsFallbackGalleryOpen(true)}
        type="button"
      >
        Choose From Gallery
      </button>
    );
  }

  const fallbackGallery = isFallbackGalleryOpen ? (
    <BuilderGalleryModal
      isUploading={false}
      onSelectImage={(path) => {
        onChange((current) => ({ ...current, imageUrl: normalizeBuilderAssetUrl(path) }));
        setIsFallbackGalleryOpen(false);
      }}
      onClose={() => setIsFallbackGalleryOpen(false)}
    />
  ) : null;

  if (horizontal) {
    // One wrapping field strip — mode and its dependent controls share a
    // row instead of stacking full-width rows down the panel. This is the
    // chrome every module wears, so master rules W1/W3/D1/D2 apply here
    // with maximum leverage (rebuilt 2026-08-09; the old markup rendered
    // single-column because its "horizontal" CSS only existed in a
    // social-module-only scope).
    return (
      <div className="builder-background-controls builder-background-controls-horizontal">
        <BuilderModuleFieldStrip>
          {!hideModeRow ? (
            <BuilderModuleField label={modeLabel ?? label} width="select-md">
              <select
                value={background.mode}
                onChange={(event) => handleModeChange(event.target.value as BackgroundSettings["mode"])}
              >
                <option value="none">None</option>
                <option value="color">Color</option>
                <option value="gradient">Gradient</option>
                <option value="image">Image</option>
                {allowVideo ? <option value="video">Video</option> : null}
                <option value="style">Style</option>
              </select>
            </BuilderModuleField>
          ) : null}

          {background.mode === "color" || background.mode === "gradient" ? (
            <BuilderModuleField label="Color" width="color">
              <BuilderThemeColorField
                fallback="#ffffff"
                themeColors={themeColors}
                value={background.color}
                opacity={background.opacity}
                onChangeOpacity={(opacity) => onChange((current) => ({ ...current, opacity }))}
                onClear={() => onChange(() => createDefaultBackgroundSettings())}
                onChange={(color) =>
                  onChange((current) => ({
                    ...current,
                    color
                  }))
                }
              />
            </BuilderModuleField>
          ) : null}

          {background.mode === "gradient" ? (
            <BuilderModuleField label="Color 2" width="color">
              <BuilderThemeColorField
                fallback="#eaf4ff"
                themeColors={themeColors}
                value={background.color2}
                onChange={(color2) =>
                  onChange((current) => ({
                    ...current,
                    color2
                  }))
                }
              />
            </BuilderModuleField>
          ) : null}

          {background.mode === "style" ? (
            <BuilderModuleField label="Style" width="auto">
              <select
                value={background.styleKey}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    styleKey: event.target.value as BackgroundSettings["styleKey"]
                  }))
                }
              >
                <option value="">Choose a style</option>
                {BACKGROUND_STYLE_PRESETS.map((style) => (
                  <option key={style.value} value={style.value}>
                    {style.label}
                  </option>
                ))}
              </select>
            </BuilderModuleField>
          ) : null}

          {/*
            W0: Clear goes through BuilderModuleField like every other
            control, so it lands in the field slot rather than floating
            loose under the strip. It was a bare <button> child of the
            strip until 2026-08-12, which made it an orphan sitting at a
            width and an indent nothing else shared.
          */}
          {!hideClear && background.mode !== "none" ? (
            <BuilderModuleField label="" width="auto">
              <button
                className="secondary-button builder-background-clear-button"
                onClick={() => onChange(() => createDefaultBackgroundSettings())}
                type="button"
              >
                Clear
              </button>
            </BuilderModuleField>
          ) : null}
        </BuilderModuleFieldStrip>

        {background.mode === "image" ? (
          <>
            <BuilderModuleFieldStrip>
              <BuilderModuleField label="Image URL" width="full">
                <input
                  type="text"
                  value={background.imageUrl}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      imageUrl: normalizeBuilderAssetUrl(event.target.value)
                    }))
                  }
                  placeholder="https://... or /api/admin/media-file/..."
                />
              </BuilderModuleField>
            </BuilderModuleFieldStrip>
            <div className="builder-media-actions">
              {renderBackgroundGalleryAction()}
              {onUploadImage ? (
                <label className="secondary-button builder-gallery-button builder-upload-button">
                  <span>Upload Background</span>
                  <input
                    className="builder-upload-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      onUploadImage(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
            {fallbackGallery}
          </>
        ) : null}

        {renderVideoControls()}
      </div>
    );
  }

  return (
    <div className="builder-background-controls">
      <div className={compact ? "builder-background-inline-row" : undefined}>
        <label className="field">
          <span>{modeLabel ?? label}</span>
          <select
            value={background.mode}
            /*
             * Routed through the shared handler rather than repeating its
             * logic, which is what this branch used to do — the two layouts
             * had already drifted, with only the horizontal one seeding theme
             * colours on a mode change.
             */
            onChange={(event) => handleModeChange(event.target.value as BackgroundSettings["mode"])}
          >
            <option value="none">None</option>
            <option value="color">Color</option>
            <option value="gradient">Gradient</option>
            <option value="image">Image</option>
            {allowVideo ? <option value="video">Video</option> : null}
            <option value="style">Style</option>
          </select>
        </label>

        {background.mode === "color" || background.mode === "gradient" ? (
          <label className="field builder-background-inline-color-field">
            {showColorFieldLabel ? <span>Primary color</span> : null}
            <BuilderThemeColorField
              fallback="#ffffff"
              themeColors={themeColors}
              value={background.color}
              opacity={background.opacity}
              onChangeOpacity={(opacity) => onChange((current) => ({ ...current, opacity }))}
              onClear={() => onChange(() => createDefaultBackgroundSettings())}
              onChange={(color) =>
                onChange((current) => ({
                  ...current,
                  color
                }))
              }
            />
          </label>
        ) : null}

        {background.mode === "gradient" ? (
          <label className="field builder-background-inline-color-field">
            <span>Secondary color</span>
            <BuilderThemeColorField
              fallback="#eaf4ff"
              themeColors={themeColors}
              value={background.color2}
              onChange={(color2) =>
                onChange((current) => ({
                  ...current,
                  color2
                }))
              }
            />
          </label>
        ) : null}

        {background.mode === "style" ? (
          <label className="field builder-background-inline-style-field">
            <span>Style</span>
            <select
              value={background.styleKey}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  styleKey: event.target.value as BackgroundSettings["styleKey"]
                }))
              }
            >
              <option value="">Choose a style</option>
              {BACKGROUND_STYLE_PRESETS.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!hideClear && background.mode !== "none" ? (
          <div className="builder-background-inline-action">
            <button
              className="secondary-button"
              onClick={() => onChange(() => createDefaultBackgroundSettings())}
              type="button"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {background.mode === "image" ? (
        <div className="builder-section-background-controls">
          <label className="field">
            <span>Background image URL</span>
            <input
              type="text"
              value={background.imageUrl}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  imageUrl: normalizeBuilderAssetUrl(event.target.value)
                }))
              }
              placeholder="https://... or /api/admin/media-file/..."
            />
          </label>
          <div className="builder-media-actions">
            {renderBackgroundGalleryAction()}
            {onUploadImage ? (
              <label className="secondary-button builder-gallery-button builder-upload-button">
                <span>Upload Background</span>
                <input
                  className="builder-upload-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    onUploadImage(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
          {fallbackGallery}
        </div>
      ) : null}

      {renderVideoControls()}
    </div>
  );
}
