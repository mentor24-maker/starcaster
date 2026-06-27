"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderSettingRow } from "./builder-setting-row";
import {
  BuilderThemeColorSettingRow,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderBlogNewsletterSubscribeModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const s = module.settings;

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  const showImage = s.showImage === "true";

  return (
    <div className="builder-blog-newsletter-settings">

      {/* CRM form binding */}
      <label className="field">
        <span>CRM Form ID</span>
        <input
          type="text"
          value={s.crmFormId ?? ""}
          onChange={(e) => set("crmFormId", e.target.value)}
          placeholder="Paste Form ID from Builder › CRM"
        />
      </label>
      <div className="builder-module-runtime-note">
        <p>
          Create an email-capture form in <strong>Builder › CRM</strong> and paste the Form ID above.
          The form's fields, submit label, and success message are configured there.
        </p>
      </div>

      {/* Decorative copy */}
      <BuilderSettingRow label="Headline" fullWidth>
        <input
          type="text"
          value={s.headline ?? "Stay in the loop"}
          onChange={(e) => set("headline", e.target.value)}
          placeholder="Stay in the loop"
        />
      </BuilderSettingRow>

      <BuilderSettingRow label="Description" fullWidth>
        <textarea
          className="builder-textarea"
          rows={2}
          value={s.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Get new posts delivered to your inbox."
        />
      </BuilderSettingRow>

      {/* Layout */}
      <div className="builder-button-setting-columns">
        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Layout">
            <select value={s.layout ?? "stacked"} onChange={(e) => set("layout", e.target.value)}>
              <option value="stacked">Stacked</option>
              <option value="inline">Inline</option>
            </select>
          </BuilderSettingRow>

          <BuilderThemeColorSettingRow
            fallback="#0f4f8f"
            label="Accent color"
            themeColors={themeColors}
            value={s.accentColor ?? "#0f4f8f"}
            onChange={(accentColor) => set("accentColor", accentColor)}
          />

          <BuilderThemeColorSettingRow
            fallback="#eaf4ff"
            label="Background"
            themeColors={themeColors}
            value={s.bgColor ?? "#eaf4ff"}
            onChange={(bgColor) => set("bgColor", bgColor)}
          />
        </div>

        <div className="builder-button-setting-column">
          <BuilderSettingRow label="Image">
            <select value={s.showImage ?? "false"} onChange={(e) => set("showImage", e.target.value)}>
              <option value="false">None</option>
              <option value="true">Show</option>
            </select>
          </BuilderSettingRow>
        </div>
      </div>

      {showImage ? (
        <BuilderSettingRow label="Image URL" fullWidth>
          <BuilderImagePickerField
            value={s.imageUrl ?? ""}
            onChange={(url) => set("imageUrl", url)}
            placeholder="Decorative image or icon"
          />
        </BuilderSettingRow>
      ) : null}
    </div>
  );
}
