"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  marginFields,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import type { BuilderThemePalette } from "./builder-theme-color-field";
import {
  siteSearchButtonFrameFields,
  siteSearchButtonTypeFields,
  siteSearchFieldSizeFields,
  siteSearchLabelContentFields,
  siteSearchTypeFields
} from "./builder-site-search-field-fields";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

/**
 * The Site Search box. Its only job is to send a query somewhere, so D9 (blast
 * radius, descending) puts the destination first: change Results Page and the
 * module points at a different page entirely; change Placeholder and it looks
 * slightly different.
 */
export function BuilderSiteSearchModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "targetPageUrl",
              label: "Results Page",
              width: "text-md",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "Current page",
              placeholder: "/search",
              rendersVia: "SiteSearchField"
            },
            {
              key: "searchParam",
              label: "Search Param",
              width: "text-md",
              control: "text",
              placeholder: "q",
              rendersVia: "SiteSearchField"
            }
          ],
          [
            {
              key: "siteSearchNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <div className="builder-module-runtime-note">
                  <p>
                    Put a <strong>Site Search Results</strong> module on the page you choose above,
                    and give it the same Search Param. Results cover the text of every module on
                    every published page — headings, copy, table cells, slide captions and image
                    alt text.
                  </p>
                </div>
              )
            }
          ],
          [...siteSearchLabelContentFields()],
          [
            {
              key: "placeholder",
              label: "Placeholder",
              width: "text-md",
              control: "text",
              placeholder: "Search this site…",
              rendersVia: "SiteSearchField"
            },
            {
              key: "showButton",
              label: "Search Button",
              width: "check",
              control: "checkbox",
              rendersVia: "SiteSearchField"
            },
            {
              key: "buttonLabel",
              label: "Button Label",
              width: "text-md",
              control: "text",
              placeholder: "Search",
              rendersVia: "SiteSearchField"
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [...siteSearchTypeFields()],
          [...siteSearchButtonTypeFields()]
        ]
      },
      {
        title: "Frame",
        strips: [
          [...siteSearchFieldSizeFields()],
          [...siteSearchButtonFrameFields()],
          [...marginFields("getModuleOuterSpacingStyle")]
        ]
      }
    ]
  };

  return (
    <div className="builder-site-search-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
