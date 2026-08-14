"use client";

import type { BackgroundSettings, BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderAlignmentIconGroup } from "./builder-alignment-icon-group";
import { BuilderButtonBackgroundPicker } from "./builder-button-background-picker";
import {
  borderStyleOptions,
  BuilderButtonBorderColorPicker,
  getButtonBorderSettings,
  type ButtonBorderColorSettings
} from "./builder-button-border-picker";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import {
  BuilderSchemaModuleSettings,
  dropShadowFields,
  MODULE_MARGIN_SIDES,
  MODULE_PADDING_SIDES,
  type BuilderSchemaFieldContext,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { BuilderThemeColorField, type BuilderThemePalette } from "./builder-theme-color-field";
import {
  applyButtonBackgroundSettings,
  getButtonBackgroundSettings,
  getModuleAlignment
} from "./builder-utils";
import {
  BUILDER_EMAIL_CONFIRMATION_URL_TOKEN,
  BUILDER_EMAIL_MERGE_TOKENS
} from "@/lib/builder-email-template";

type BuilderButtonModuleSettingsProps = {
  module: BuilderTemplateModule;
  isEmailTemplate?: boolean;
  themeColors?: BuilderThemePalette;
  /** Nested placement (a table cell): drop the rarely-touched extras. */
  compact?: boolean;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  onOpenButtonBackgroundGallery?: () => void;
  onUploadButtonBackgroundMedia?: (file: File | null) => void;
};

/**
 * The pixel font size each Size preset stands for.
 *
 * `buttonSize` only ever set a CSS class whose only declaration is a
 * font-size (`.builder-preview-button-small|medium|large`, 0.85 / 1 / 1.2rem),
 * while `fontSize` writes an inline font-size that beats the class every
 * time. Two controls, one property, and the preset silently lost — exactly
 * the "changing the wrong one does nothing" failure doctrine E6 describes.
 *
 * So the preset now writes BOTH keys: pick Large and the number control
 * reads 19. They cannot disagree, both settings stay reachable (C7), and
 * neither is a dead control (C6).
 */
const BUTTON_SIZE_PRESETS: Record<string, string> = {
  small: "14",
  medium: "16",
  large: "19"
};

/**
 * The Button module's settings panel.
 *
 * Rebuilt 2026-08-11 onto the declarative schema generator. It was the last
 * rich module still hand-rolling its own panel: three collapsed accordion
 * sections built from `BuilderSettingRow`, all shut by default, invented
 * for this one module. That is doctrine E1's "30 independent inventions" in
 * a single file — and because the file was named `*-design-settings.tsx`
 * rather than `*-module-settings.tsx`, no checker ever looked at it.
 *
 * D8 axes (master rule D8): Content / Text / Placement / Frame. Frame holds
 * the pill itself — its fill and its border — which is where a button's
 * "background" belongs; every other axis carries the same controls it
 * carries in every other module. The drop shadow is NOT on Frame: A7 files a
 * shadow by what it shadows, and getButtonModuleStyle renders this one as
 * `text-shadow`, so it sits on Text.
 *
 * A0: no Advanced section. Every setting is on its axis, in the open. The
 * theme-backed colours keep their `theme-color` control (A2) — empty reads
 * "theme" until you change it, which is what protected the theme all along;
 * the collapse only concealed it.
 *
 * D9 order within each axis — blast radius, descending. Text runs size →
 * weight/style → colour → shadow: changing the size resizes the button,
 * changing the shadow blur is the last 2%. Frame runs fill → border colour →
 * border width/style → radius. Placement runs alignment → padding → margins.
 *
 * Not converted to `control: "theme-color"` (A2's empty-means-theme): the
 * three bespoke pickers each carry state a flat hex cannot — background
 * mode + opacity, text colour + hover in one popup, border colour's
 * `transparent`, which is a real value the Anchor variant depends on.
 * Rewriting them to be theme-aware is its own piece of work; wiring them
 * to a control that cannot store their values would have been data loss.
 */
export function BuilderButtonModuleSettings({
  module,
  isEmailTemplate = false,
  themeColors = [],
  compact = false,
  onUpdateModule,
  onOpenButtonBackgroundGallery,
  onUploadButtonBackgroundMedia
}: BuilderButtonModuleSettingsProps) {
  function updateSetting(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function updateButtonBackground(background: BackgroundSettings) {
    onUpdateModule((current) => ({
      ...current,
      settings: applyButtonBackgroundSettings(current.settings, background)
    }));
  }

  function updateButtonBorder(border: ButtonBorderColorSettings) {
    onUpdateModule((current) => ({
      ...current,
      settings: {
        ...current.settings,
        borderStyle: border.style,
        borderColor: border.color
      }
    }));
  }

  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            // D9 rung 1 — the destination leads the axis. Change where the
            // button points and it does something else entirely; change its
            // wording and it says something else. C2: the path is picked from
            // the project's real pages and written for us, with "Custom…" for
            // an external URL. Email templates keep a plain field, because
            // their href is a Supabase merge token, not a page.
            {
              key: "href",
              label: "Link",
              width: "full",
              control: "picker",
              source: "pages",
              valueKind: "path",
              noneLabel: "— No link —",
              placeholder: "/path-or-url",
              visibleWhen: () => !isEmailTemplate,
              rendersVia: "BuilderTemplatePreview"
            },
            {
              key: "href",
              label: "Link",
              width: "full",
              control: "text",
              placeholder: "{{ .ConfirmationURL }}",
              visibleWhen: () => isEmailTemplate,
              rendersVia: "BuilderTemplatePreview"
            }
          ],
          [
            {
              key: "text",
              // NOT "Label" — the module chrome above every panel already
              // uses that word for the internal name, and two "Label" rows on
              // one screen is exactly the unclear wording L7 calls a bug.
              label: "Text",
              width: "full",
              control: "custom",
              rendersVia: "BuilderTemplatePreview",
              // Edits module.text, not a settings key.
              render: (ctx) => (
                <input
                  type="text"
                  value={ctx.module.text}
                  onChange={(event) =>
                    onUpdateModule((current) => ({ ...current, text: event.target.value }))
                  }
                  placeholder="Button text"
                />
              )
            }
          ],
          [
            {
              key: "hrefTokens",
              label: "Merge tokens",
              width: "full",
              control: "custom",
              bare: true,
              visibleWhen: () => isEmailTemplate,
              rendersVia: "resolveEmailMergeTokens",
              render: () => (
                <div className="builder-email-merge-token-row">
                  <p className="builder-email-merge-token-copy">
                    Use Supabase merge tokens in the link — do not hand-build verify URLs or
                    paste raw tokens.
                  </p>
                  <div className="builder-email-merge-token-actions">
                    <button
                      className="secondary-button"
                      onClick={() => updateSetting("href", BUILDER_EMAIL_CONFIRMATION_URL_TOKEN)}
                      type="button"
                    >
                      Use Confirmation URL
                    </button>
                    {BUILDER_EMAIL_MERGE_TOKENS.filter(
                      (entry) => entry.token !== BUILDER_EMAIL_CONFIRMATION_URL_TOKEN
                    ).map((entry) => (
                      <button
                        className="secondary-button"
                        key={entry.token}
                        onClick={() => updateSetting("href", entry.token)}
                        type="button"
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            }
          ]
        ]
      },
      {
        title: "Text",
        strips: [
          [
            // C1 — the knowable values as a preset, writing both keys so the
            // preset and the exact size can never disagree (see the constant).
            {
              key: "buttonSize",
              label: "Size",
              width: "select-sm",
              control: "custom",
              rendersVia: "builder-preview-button-{size}",
              render: (ctx) => {
                const preset = ctx.settings.buttonSize ?? "medium";
                const fontSize = ctx.settings.fontSize ?? "";
                const matches = !fontSize || fontSize === BUTTON_SIZE_PRESETS[preset];
                return (
                  <select
                    value={matches ? preset : "custom"}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!BUTTON_SIZE_PRESETS[next]) return;
                      onUpdateModule((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          buttonSize: next,
                          fontSize: BUTTON_SIZE_PRESETS[next]
                        }
                      }));
                    }}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                    {matches ? null : <option value="custom">Custom</option>}
                  </select>
                );
              }
            },
            {
              key: "fontSize",
              label: "Font Size",
              width: "num",
              control: "number",
              min: 10,
              max: 72,
              fallback: "16",
              rendersVia: "getButtonModuleStyle"
            }
          ],
          [
            // C3 — booleans read as on/off. Bold defaults on, matching the
            // renderer's `settings.bold === "false" ? 500 : 700`.
            {
              key: "bold",
              label: "Bold",
              width: "check",
              control: "checkbox",
              fallback: "true",
              rendersVia: "getButtonModuleStyle"
            },
            {
              key: "italic",
              label: "Italic",
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "getButtonModuleStyle"
            },
            {
              key: "underline",
              label: "Underline",
              width: "check",
              control: "checkbox",
              fallback: "false",
              rendersVia: "getButtonModuleStyle"
            }
          ],
          [
            // A6/A0: text colour is basic and, since A0, so is everything —
            // it keeps the theme-color control, so empty still reads "theme"
            // (`--lp-button-text`) rather than a pre-filled override (A2).
            {
              key: "textColor",
              label: "Text Color",
              width: "color",
              control: "theme-color",
              dialogLabel: "Button text color",
              themeDefault: "#ffffff",
              rendersVia: "getButtonModuleStyle"
            },
            {
              key: "textHoverColor",
              label: "Text Hover",
              width: "color",
              control: "theme-color",
              dialogLabel: "Button text hover color",
              themeDefault: "#ffffff",
              rendersVia: "getButtonModuleStyle"
            }
          ],
          // D9 rung 6 — the last 2%, so it closes the axis. A7 put it here:
          // getButtonModuleStyle renders dropShadow* as `text-shadow`.
          dropShadowFields("getButtonModuleStyle", { visibleWhen: () => !compact })
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
              control: "custom",
              rendersVia: "getModuleAlignment",
              render: (ctx) => (
                <BuilderAlignmentIconGroup
                  value={getModuleAlignment(ctx.settings)}
                  onChange={(alignment) => ctx.set("alignment", alignment)}
                  ariaLabel="Button alignment"
                />
              )
            }
          ],
          [
            // W7 side order, and the renderer's own clamps (1–50) — these are
            // the pill's inner padding, not the module's outer spacing. The
            // fallbacks are the shape a button ships with, so an untouched
            // one shows what it actually renders.
            ...MODULE_PADDING_SIDES.map(({ key, label }) => ({
              key,
              label,
              width: "num" as const,
              control: "custom" as const,
              rendersVia: "getButtonModuleStyle",
              render: (ctx: BuilderSchemaFieldContext) => (
                <BuilderNumberSelectControl
                  value={
                    ctx.settings[key] ??
                    (key === "paddingTop" || key === "paddingBottom"
                      ? ctx.settings.paddingY ?? "12"
                      : ctx.settings.paddingX ?? "24")
                  }
                  min={1}
                  max={50}
                  fallback={key === "paddingTop" || key === "paddingBottom" ? "12" : "24"}
                  onChange={(next) => ctx.set(key, next)}
                />
              )
            }))
          ],
          [
            // Read through the same legacy fallback the renderer resolves
            // with: a table-cell button never passes through
            // normalizeBuilderModuleSettingsForType, so reading the raw key
            // would show 0 while the page renders the pair it was saved with.
            ...MODULE_MARGIN_SIDES.map(({ key, label, legacy }) => ({
              key,
              label,
              width: "num" as const,
              control: "custom" as const,
              rendersVia: "getModuleOuterSpacingStyle",
              render: (ctx: BuilderSchemaFieldContext) => (
                <BuilderNumberSelectControl
                  value={ctx.settings[key] ?? ctx.settings[legacy] ?? "0"}
                  min={0}
                  max={160}
                  step={5}
                  fallback="0"
                  onChange={(next) => ctx.set(key, next)}
                />
              )
            }))
          ],
          [
            {
              key: "buttonHoverColor",
              label: "Hover Fill",
              width: "color",
              control: "custom",
              rendersVia: "getButtonModuleStyle",
              render: (ctx) => (
                <BuilderThemeColorField
                  dialogLabel="Button hover color"
                  fallback="#0f4f8f"
                  themeColors={ctx.themeColors}
                  value={ctx.settings.buttonHoverColor ?? "#0f4f8f"}
                  onChange={(color) => ctx.set("buttonHoverColor", color)}
                />
              )
            }
          ],
          // The border, in the order the A0 sweep settled on everywhere else:
          // style (the mode) → width → colour → radius (D9's rung 6, the last
          // 2%). Each on its own strip — measured at 1180, three of these on
          // one row put the last control outside a table-cell modal (D7/L4).
          [
            {
              key: "borderStyle",
              label: "Border Style",
              width: "select-sm",
              control: "select",
              options: borderStyleOptions,
              fallback: "solid",
              rendersVia: "getButtonModuleStyle"
            }
          ],
          [
            {
              key: "borderWidth",
              label: "Border",
              width: "num",
              control: "number",
              min: 0,
              max: 12,
              fallback: "2",
              rendersVia: "getButtonModuleStyle"
            }
          ],
          [
            {
              key: "borderColor",
              label: "Border Color",
              width: "color",
              control: "custom",
              rendersVia: "getButtonModuleStyle",
              render: (ctx) => {
                const border = getButtonBorderSettings(ctx.settings);
                return (
                  <BuilderButtonBorderColorPicker
                    border={border}
                    borderWidth={ctx.settings.borderWidth ?? "2"}
                    borderRadius={ctx.settings.borderRadius ?? "0"}
                    disabled={border.style === "none"}
                    onChange={updateButtonBorder}
                    themeColors={ctx.themeColors}
                  />
                );
              }
            }
          ],
          [
            {
              key: "borderRadius",
              label: "Radius",
              width: "num",
              control: "number",
              min: 0,
              max: 80,
              step: 5,
              fallback: "0",
              rendersVia: "getButtonModuleStyle"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-button-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
