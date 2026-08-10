"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (m: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const NUMBER_INPUT_STYLE = { width: "9ch" } as const;
const RANGE_READOUT_STYLE = { marginLeft: 8, fontSize: 12, minWidth: 36 } as const;

function isLinearSizing(settings: Record<string, string>): boolean {
  return (settings.sizingMode || "linear") === "linear";
}

export function BuilderTractorNavModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: Props) {
  /*
   * D8 axes (2026-08-10): Content / Structure / Placement / Frame. The rings
   * have no text, so the ring colours, opacity and hover fade sit on Frame —
   * they dress the drawn shape the way a border does.
   *
   * (Replaces the D2 panelColumns pairing of content+layout left, style
   * right.)
   *
   * A1 sort (2026-08-10): the two colours moved into Frame's own Advanced
   * section, but stayed `color` controls — see the note there; the
   * normalizer backfills them, so the A2 conversion would silently revert.
   * Inner Opacity, Opacity Step and Transition stay basic with their note —
   * they are the ring effect's own dial, not a colour, border, shadow or
   * font the theme supplies. Z-Index moved to
   * Placement › Advanced per A5; Position X/Y stay basic, because they are
   * where the rings SIT rather than a nudge off that position (the note on
   * Structure still explains their units).
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        // D3: New Tab rides the Dot Link strip instead of its own row.
        // Dot Link narrowed full → text-md so they can share.
        strips: [
          [
            {
              key: "dotUrl",
              label: "Dot Link",
              width: "text-md",
              control: "custom",
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <input
                  type="url"
                  placeholder="https://…"
                  value={settings.dotUrl || ""}
                  onChange={(event) => set("dotUrl", event.target.value)}
                />
              )
            },
            {
              key: "dotNewTab",
              label: "New Tab",
              width: "check",
              control: "checkbox",
              rendersVia: "BuilderTractorNavModule"
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              key: "dotSize",
              label: "Dot Size",
              width: "num",
              control: "number",
              min: 2,
              max: 100,
              fallback: "10",
              rendersVia: "BuilderTractorNavModule"
            },
            {
              key: "ringCount",
              label: "Ring Count",
              width: "num",
              control: "number",
              min: 1,
              max: 30,
              fallback: "10",
              rendersVia: "BuilderTractorNavModule"
            },
            {
              key: "sizingMode",
              label: "Sizing Mode",
              width: "select-md",
              control: "select",
              fallback: "linear",
              options: [
                { value: "linear", label: "Linear" },
                { value: "geometric", label: "Power Curve" }
              ],
              rendersVia: "BuilderTractorNavModule"
            }
          ],
          [
            {
              key: "ringStep",
              label: "Ring Step",
              width: "num",
              control: "number",
              min: 2,
              max: 200,
              fallback: "10",
              visibleWhen: isLinearSizing,
              rendersVia: "BuilderTractorNavModule"
            },
            {
              key: "outerSize",
              label: "Outer Size",
              width: "num",
              control: "number",
              min: 50,
              max: 1400,
              step: 10,
              fallback: "600",
              visibleWhen: (settings) => !isLinearSizing(settings),
              rendersVia: "BuilderTractorNavModule"
            },
            {
              key: "curve",
              label: "Curve",
              width: "text-md",
              control: "custom",
              visibleWhen: (settings) => !isLinearSizing(settings),
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={0.1}
                    value={settings.curve || "2"}
                    onChange={(event) => set("curve", event.target.value)}
                  />
                  <span style={RANGE_READOUT_STYLE}>{parseFloat(settings.curve || "2").toFixed(1)}</span>
                </>
              )
            }
          ],
          [
            // Kept whole on Structure: it explains the units for the sizes
            // above AND for the positions on the next axis.
            {
              key: "layoutNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <span className="builder-module-offset-hint">
                  Sizes are in px; positions are px from the ring center.
                </span>
              )
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "posX",
              label: "Position X",
              width: "num",
              control: "custom",
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <input
                  type="number"
                  step={1}
                  style={NUMBER_INPUT_STYLE}
                  value={settings.posX || "0"}
                  onChange={(event) => set("posX", event.target.value)}
                />
              )
            },
            {
              key: "posY",
              label: "Position Y",
              width: "num",
              control: "custom",
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <input
                  type="number"
                  step={1}
                  style={NUMBER_INPUT_STYLE}
                  value={settings.posY || "0"}
                  onChange={(event) => set("posY", event.target.value)}
                />
              )
            }
          ]
        ],
        // A5: stacking order is a nudge, not everyday placement.
        advanced: [
          [
            {
              key: "zIndex",
              label: "Z-Index",
              width: "num",
              control: "custom",
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <input
                  type="number"
                  step={1}
                  style={NUMBER_INPUT_STYLE}
                  value={settings.zIndex || "-9999"}
                  onChange={(event) => set("zIndex", event.target.value)}
                />
              )
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          [
            {
              key: "innerOpacity",
              label: "Inner Opacity",
              width: "text-md",
              control: "custom",
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={settings.innerOpacity || "90"}
                    onChange={(event) => set("innerOpacity", event.target.value)}
                  />
                  <span style={RANGE_READOUT_STYLE}>{settings.innerOpacity || "90"}%</span>
                </>
              )
            },
            {
              key: "opacityStep",
              label: "Opacity Step",
              width: "num",
              control: "number",
              min: 0,
              max: 50,
              fallback: "10",
              rendersVia: "BuilderTractorNavModule"
            },
            {
              key: "transition",
              label: "Transition",
              width: "text-md",
              control: "custom",
              rendersVia: "BuilderTractorNavModule",
              render: ({ settings, set }) => (
                <>
                  <input
                    type="range"
                    min={0}
                    max={500}
                    step={10}
                    value={settings.transition || "0"}
                    onChange={(event) => set("transition", event.target.value)}
                  />
                  <span style={RANGE_READOUT_STYLE}>{settings.transition || "0"}ms</span>
                </>
              )
            }
          ],
          [
            {
              key: "styleNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <span className="builder-module-offset-hint">
                  Opacity Step is % per ring; Transition is the hover fade in ms.
                </span>
              )
            }
          ]
        ],
        // A1: the ring colour and the dot's hover colour are theme values.
        // Both stay `color` controls rather than becoming `theme-color` (A2):
        // normalizeBuilderModuleSettingsForType backfills an empty color /
        // dotHoverColor with its hex on EVERY load, so "give it back to the
        // theme" would appear to work and silently revert on the next reload.
        // The A2 conversion needs those two backfill lines in
        // lib/builder-client/builder-template.ts to go first.
        advanced: [
          [
            {
              key: "color",
              label: "Color",
              width: "color",
              control: "color",
              dialogLabel: "Ring color",
              fallback: "#0000ff",
              rendersVia: "BuilderTractorNavModule"
            },
            {
              key: "dotHoverColor",
              label: "Hover Color",
              width: "color",
              control: "color",
              dialogLabel: "Dot hover color",
              fallback: "#ffffff",
              rendersVia: "BuilderTractorNavModule"
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-tractor-nav-module-settings">
      <BuilderSchemaModuleSettings
        schema={schema}
        module={module}
        onUpdateModule={onUpdateModule}
        themeColors={themeColors}
      />
    </div>
  );
}
