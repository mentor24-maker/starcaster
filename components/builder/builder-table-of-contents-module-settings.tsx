"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import { TABLE_OF_CONTENTS_DEFAULT_SETTINGS, TABLE_OF_CONTENTS_DEFAULT_TITLE } from "@/lib/table-of-contents";
import { BuilderSchemaModuleSettings, type BuilderSettingsSchema } from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

/**
 * The Table of contents panel (task SC-863). There is no list of headings to
 * manage: the module reads them from the page as it is shown, so the panel
 * only decides which levels to list and how they look.
 *
 * D8 axes: Content (title, which headings) / Structure (indent) / Text
 * (size, then colour — D9, A6). Alignment is not here: the shared module
 * chrome under this panel already offers it, on the same `alignment` key,
 * and two Alignment controls for one setting is the trap navigation had.
 */
const RENDERS_VIA = "builder-template-preview.tsx TableOfContentsModule";

const schema: BuilderSettingsSchema = {
  axes: [
    {
      title: "Content",
      strips: [
        [
          {
            key: "title",
            label: "Title",
            width: "text-md",
            control: "custom",
            rendersVia: RENDERS_VIA,
            // `settings.title ?? default`, not `||`: a title cleared on purpose
            // stays cleared, and the list then shows without one.
            render: ({ settings, set }) => (
              <input
                type="text"
                value={settings.title ?? TABLE_OF_CONTENTS_DEFAULT_TITLE}
                onChange={(event) => set("title", event.target.value)}
                placeholder="No title"
                aria-label="Title"
              />
            )
          }
        ],
        [
          {
            key: "headingLevels",
            label: "Which Headings",
            width: "select-md",
            control: "select",
            options: [
              { value: "h2", label: "H2 only" },
              { value: "h2-h3", label: "H2 and H3" },
              { value: "all", label: "All (H2–H6)" }
            ],
            fallback: TABLE_OF_CONTENTS_DEFAULT_SETTINGS.headingLevels,
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    },
    {
      title: "Structure",
      strips: [
        [
          {
            key: "indentSubheadings",
            label: "Indent Sub-headings",
            width: "check",
            control: "checkbox",
            fallback: TABLE_OF_CONTENTS_DEFAULT_SETTINGS.indentSubheadings,
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    },
    {
      title: "Text",
      strips: [
        [
          {
            key: "fontSize",
            label: "Size",
            width: "num",
            control: "number",
            min: 10,
            max: 32,
            fallback: TABLE_OF_CONTENTS_DEFAULT_SETTINGS.fontSize,
            rendersVia: RENDERS_VIA
          }
        ],
        [
          {
            key: "color",
            label: "Link Color",
            width: "color",
            control: "theme-color",
            dialogLabel: "Link color",
            themeDefault: "#0f4f8f",
            rendersVia: RENDERS_VIA
          }
        ]
      ]
    }
  ]
};

export function BuilderTableOfContentsModuleSettings({ module, onUpdateModule, themeColors = [] }: Props) {
  return (
    <div className="builder-table-of-contents-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
