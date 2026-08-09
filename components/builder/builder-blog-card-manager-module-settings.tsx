"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogCardManagerModuleSettings({ module, onUpdateModule }: Props) {
  const schema: BuilderSettingsSchema = {
    content: [
      [
        {
          key: "note",
          label: "Note",
          width: "full",
          control: "custom",
          bare: true,
          render: () => (
            <p className="builder-blog-card-manager-settings-note">
              Configure the card template using the interactive designer in the canvas above. Changes are saved project-wide and applied to all Post Feed modules.
            </p>
          )
        }
      ]
    ]
  };

  return (
    <div className="builder-blog-card-manager-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} />
    </div>
  );
}
