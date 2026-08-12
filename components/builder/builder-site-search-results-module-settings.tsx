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
 * Site Search Results. D9 order: the Search Param decides whether this module
 * sees a query at all, so it leads; the built-in search box is next (it changes
 * whether the page works on its own); then what each result shows; then wording.
 */
export function BuilderSiteSearchResultsModuleSettings({
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
              key: "searchParam",
              label: "Search Param",
              width: "text-md",
              control: "text",
              placeholder: "q",
              rendersVia: "SiteSearchResultsPreview"
            },
            {
              key: "limit",
              label: "Max Results",
              width: "num",
              control: "number",
              min: 1,
              max: 200,
              rendersVia: "SiteSearchResultsPreview"
            }
          ],
          [
            {
              key: "searchParamNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <div className="builder-module-runtime-note">
                  <p>
                    The Search Param must match the one on the <strong>Site Search</strong> box that
                    sends visitors here. Pages are ranked best match first: a page whose NAME matches
                    outranks one whose heading matches, which outranks one that mentions the words in
                    its body. Text that repeats on most pages — a footer, a contact strip — is pushed
                    to the bottom automatically.
                  </p>
                </div>
              )
            }
          ],
          [
            {
              key: "showSearchField",
              label: "Search Box",
              width: "check",
              control: "checkbox",
              rendersVia: "SiteSearchResultsPreview"
            },
            {
              key: "showResultCount",
              label: "Result Count",
              width: "check",
              control: "checkbox",
              rendersVia: "SiteSearchResultsPreview"
            },
            {
              key: "showOtherMatches",
              label: "Extra Matches",
              width: "check",
              control: "checkbox",
              rendersVia: "SiteSearchResultsPreview"
            },
            {
              key: "showMatchLocation",
              label: "Where It Matched",
              width: "check",
              control: "checkbox",
              rendersVia: "SiteSearchResultsPreview"
            }
          ],
          [
            {
              key: "emptyMessage",
              label: "No Results Text",
              width: "full",
              control: "text",
              placeholder: "Nothing on this site matched that search.",
              rendersVia: "SiteSearchResultsPreview"
            }
          ],
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
              key: "buttonLabel",
              label: "Button Label",
              width: "text-md",
              control: "text",
              placeholder: "Search",
              rendersVia: "SiteSearchField"
            }
          ],
          [...siteSearchLabelContentFields()]
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
          // On this module `accentColor` paints the result links AND the
          // button — one accent for the whole block, which is why the shared
          // strip is used here rather than a second colour control.
          [...siteSearchButtonFrameFields()],
          [...marginFields("getModuleOuterSpacingStyle")]
        ]
      }
    ]
  };

  return (
    <div className="builder-site-search-results-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
