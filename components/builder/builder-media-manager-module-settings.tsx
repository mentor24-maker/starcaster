"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

export function BuilderMediaManagerModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  /*
   * The same three axes the Event Manager panel uses (D8): what the module is
   * allowed to hold is Content, the column toggles are Structure, the
   * module's own colour is Frame. Within each axis, blast radius descending
   * (D9).
   *
   * There is no page picker here, unlike the Post Manager: this module
   * manages media in place and there is no second page to send anyone to.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "kinds",
              label: "Media Kinds",
              width: "text-md",
              control: "select",
              options: [
                { value: "all", label: "Images and video" },
                { value: "images", label: "Images only" },
                { value: "videos", label: "Video only" }
              ],
              rendersVia: "MediaManagerPreview"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            { key: "showFilters", label: "Filters", width: "check", control: "checkbox", rendersVia: "MediaManagerPreview" },
            { key: "showSize", label: "Size", width: "check", control: "checkbox", rendersVia: "MediaManagerPreview" },
            { key: "showDate", label: "Date", width: "check", control: "checkbox", rendersVia: "MediaManagerPreview" },
            { key: "showTags", label: "Tags", width: "check", control: "checkbox", rendersVia: "MediaManagerPreview" },
            { key: "showDelete", label: "Delete", width: "check", control: "checkbox", rendersVia: "MediaManagerPreview" }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "accentColor",
              label: "Accent",
              width: "color",
              control: "theme-color",
              dialogLabel: "Accent color",
              themeDefault: "#0f4f8f",
              rendersVia: "MediaManagerPreview"
            }
          ]
        ]
      }
    ]
  };

  return (
    <BuilderSchemaModuleSettings
      module={module}
      onUpdateModule={onUpdateModule}
      schema={schema}
      themeColors={themeColors}
    />
  );
}
