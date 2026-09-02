"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BlogCardManagerPreview } from "@/components/builder-template-preview";
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
          /*
           * THE DESIGNER ITSELF, not a pointer to it.
           *
           * This said "Configure the card template using the interactive
           * designer in the canvas above", and there was no designer in the
           * canvas above — `renderModulePreview` has a branch for every sibling
           * admin module and never had one for this type, so the working
           * controls rendered only through the public renderer, on a page that
           * is not published. The note was false from the day it shipped and
           * sent the operator looking for something that did not exist
           * (2026-09-02, task 86bbt62dy).
           */
          render: () => (
            <div className="builder-blog-card-manager-settings-designer">
              <p className="builder-blog-card-manager-settings-note">
                Changes here are saved project-wide and applied to every Post Feed module on your site.
              </p>
              <BlogCardManagerPreview />
            </div>
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
