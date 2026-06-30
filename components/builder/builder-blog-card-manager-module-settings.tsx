"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function BuilderBlogCardManagerModuleSettings({ module: _module, onUpdateModule: _onUpdateModule }: Props) {
  return (
    <div className="builder-blog-card-manager-settings">
      <p className="builder-blog-card-manager-settings-note">
        Configure the card template using the interactive designer in the canvas above. Changes are saved project-wide and applied to all Post Feed modules.
      </p>
    </div>
  );
}
