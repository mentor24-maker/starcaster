"use client";

import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { POLL_CONTENT_WIDTH_OPTIONS } from "@/lib/poll-pod-config";
import { BuilderBackgroundControls } from "./builder-background-controls";
import {
  BuilderSchemaModuleSettings,
  marginFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { getModuleBackgroundSettings } from "./builder-utils";

type BuilderCurrentPollModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (module: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onUpdateModuleBackground: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  themeColors?: Array<{ label: string; hex: string }>;
  themeBackgroundColor?: string;
  themePrimaryColor?: string;
};

/**
 * First schema-driven editor (doctrine §4 prerequisite 3) — the declaration
 * below is the whole editor. Strip order, width tokens, and the H+V margin
 * pairing are the generator's problem, not this file's.
 */
export function BuilderCurrentPollModuleSettings({
  module,
  onUpdateModule,
  onUpdateModuleBackground,
  themeColors = [],
  themeBackgroundColor,
  themePrimaryColor
}: BuilderCurrentPollModuleSettingsProps) {
  // D8 axes (2026-08-10): Structure / Placement / Frame. The poll draws its
  // own body, so this editor only ever positions and dresses the shell —
  // Frame carries the background surface, and empties if background moves to
  // Themes.
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Structure",
        strips: [
          [
            {
              key: "size",
              label: "Width",
              width: "select-sm",
              control: "select",
              options: POLL_CONTENT_WIDTH_OPTIONS.map((width) => ({ value: String(width), label: `${width}%` })),
              fallback: "100",
              rendersVia: "getCurrentPollModuleShellStyle"
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "alignment",
              label: "Alignment",
              width: "align",
              control: "align",
              ariaLabel: "Poll alignment",
              rendersVia: "getModuleAlignment"
            },
            ...marginFields("getCurrentPollModuleShellStyle", 160)
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "background",
              label: "Background",
              width: "full",
              control: "custom",
              bare: true,
              rendersVia: "getCurrentPollModuleShellStyle",
              render: () => (
                <BuilderBackgroundControls
                  label="Background"
                  background={getModuleBackgroundSettings(module.settings)}
                  horizontal
                  onChange={onUpdateModuleBackground}
                  themeBackgroundColor={themeBackgroundColor}
                  themeColors={themeColors}
                  themePrimaryColor={themePrimaryColor}
                />
              )
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-current-poll-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
