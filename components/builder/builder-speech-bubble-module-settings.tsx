"use client";

import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeSignedOffsetValue } from "@/lib/builder-template";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderSettingRow } from "./builder-setting-row";

type BuilderSpeechBubbleModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  richTextGallery?: RichTextGalleryBinding;
};

export function BuilderSpeechBubbleModuleSettings({
  module,
  onUpdateModule,
  richTextGallery
}: BuilderSpeechBubbleModuleSettingsProps) {
  function updateSettings(updates: Record<string, string>) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, ...updates }
    }));
  }

  return (
    <div className="builder-speech-bubble-module-settings">
      <BuilderSettingRow fullWidth label="Content">
        <BuilderRichTextEditor
          value={module.text}
          onChange={(value) => onUpdateModule((current) => ({ ...current, text: value }))}
          {...richTextGallery}
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Background Color">
        <input
          type="color"
          value={normalizeBuilderHexColor(module.settings.backgroundColor || "#ffffff")}
          onChange={(event) =>
            updateSettings({ backgroundColor: normalizeBuilderHexColor(event.target.value) })
          }
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Border Color">
        <input
          type="color"
          value={normalizeBuilderHexColor(module.settings.borderColor || "#9ed4ee")}
          onChange={(event) =>
            updateSettings({ borderColor: normalizeBuilderHexColor(event.target.value) })
          }
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Border Size">
        <BuilderNumberSelectControl
          fallback="2"
          max={24}
          min={0}
          value={module.settings.borderThickness ?? "2"}
          onChange={(borderThickness) => updateSettings({ borderThickness })}
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Container Width">
        <BuilderNumberSelectControl
          fallback="520"
          max={900}
          min={200}
          step={10}
          value={module.settings.containerWidth ?? "520"}
          onChange={(containerWidth) => updateSettings({ containerWidth })}
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Container Height">
        <div className="builder-setting-value-stack">
          <BuilderNumberSelectControl
            fallback="0"
            max={800}
            min={0}
            step={10}
            value={module.settings.containerHeight ?? "0"}
            onChange={(containerHeight) => updateSettings({ containerHeight })}
          />
          <span className="builder-module-offset-hint">0 fits content; larger values set a minimum height.</span>
        </div>
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Text Color">
        <input
          type="color"
          value={normalizeBuilderHexColor(module.settings.textColor || "#18324a")}
          onChange={(event) =>
            updateSettings({ textColor: normalizeBuilderHexColor(event.target.value) })
          }
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="X-Index Offset">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            min={-500}
            max={500}
            step={1}
            value={module.settings.offsetX ?? "0"}
            onChange={(event) =>
              updateSettings({ offsetX: normalizeSignedOffsetValue(event.target.value, "0") })
            }
          />
          <span className="builder-module-offset-hint">Positive moves right; negative moves left.</span>
        </div>
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Y-Index Offset">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            min={-500}
            max={500}
            step={1}
            value={module.settings.offsetY ?? "0"}
            onChange={(event) =>
              updateSettings({ offsetY: normalizeSignedOffsetValue(event.target.value, "0") })
            }
          />
          <span className="builder-module-offset-hint">Positive moves up; negative moves down.</span>
        </div>
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Z-Index">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            min={-999}
            max={999999}
            step={1}
            value={module.settings.zIndex ?? "10"}
            onChange={(event) => updateSettings({ zIndex: event.target.value })}
          />
          <span className="builder-module-offset-hint">Higher values stack in front; lower values stack behind.</span>
        </div>
      </BuilderSettingRow>
    </div>
  );
}
