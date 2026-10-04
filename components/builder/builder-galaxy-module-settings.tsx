"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  BuilderSchemaModuleSettings,
  type BuilderSchemaField,
  type BuilderSettingsSchema
} from "./builder-settings-schema";
import { type BuilderThemePalette } from "./builder-theme-color-field";
import { PROXIMITY_PLACEMENT_OPTIONS, proximityIsInline } from "@/lib/effect-placement";
import {
  GALAXY_DEFAULT_PALETTE,
  GALAXY_SETTING_DEFAULTS,
  GALAXY_SETTING_RANGES,
  galaxyInteractionsFor,
  resolveGalaxyInteraction,
  type GalaxyInteraction
} from "@/lib/galaxy-field";
import {
  GALAXY_DEFAULT_HAZE,
  GALAXY_LOOK_DEFAULTS,
  GALAXY_PRESET_OPTIONS,
  GALAXY_PRESETS,
  matchGalaxyPreset
} from "@/lib/galaxy-render";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (m: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

/*
 * The readout beside each slider gets a TRACK in _builder-react-overrides.css,
 * never an inline width (UI_RULES W0) — the same construction TractorNav's
 * panel arrived at after its inline widths left a visible notch (86bbjt1b0).
 */
const READOUT_CLASS = "builder-galaxy-readout";

const INTERACTION_LABELS: Record<GalaxyInteraction, string> = {
  rotate: "Drag to Rotate",
  tilt: "Tilt with Cursor",
  none: "None"
};

/** A slider with its value beside it. Range comes from the engine's own table, so the panel cannot offer a value the engine clamps away. */
function slider(
  key: string,
  label: string,
  options: { min?: number; max?: number; step?: number; suffix?: string; fallback?: string; visibleWhen?: (s: Record<string, string>) => boolean } = {}
): BuilderSchemaField {
  const range = GALAXY_SETTING_RANGES[key];
  const min = options.min ?? range?.min ?? 0;
  const max = options.max ?? range?.max ?? 100;
  const step = options.step ?? (range?.integer ? 1 : 0.05);
  const fallback = options.fallback ?? GALAXY_SETTING_DEFAULTS[key] ?? GALAXY_LOOK_DEFAULTS[key] ?? String(min);
  return {
    key,
    label,
    width: "text-md",
    control: "custom",
    visibleWhen: options.visibleWhen,
    rendersVia: "GalaxyRuntime",
    render: ({ settings, set }) => (
      <>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={settings[key] || fallback}
          onChange={(event) => set(key, event.target.value)}
        />
        <span className={READOUT_CLASS}>
          {settings[key] || fallback}
          {options.suffix ?? ""}
        </span>
      </>
    )
  };
}

function colourSlot(index: number): BuilderSchemaField[] {
  const n = index + 1;
  return [
    {
      key: `c${n}`,
      label: `Colour ${n}`,
      width: "color",
      control: "theme-color",
      themeDefault: GALAXY_DEFAULT_PALETTE[index].hex,
      dialogLabel: `Star colour ${n}`,
      rendersVia: "drawGalaxyFrame"
    },
    {
      key: `w${n}`,
      label: `Share ${n}`,
      width: "num",
      control: "number",
      min: 0,
      max: 100,
      fallback: GALAXY_LOOK_DEFAULTS[`w${n}`],
      rendersVia: "assignGalaxyColours"
    }
  ];
}

export function BuilderGalaxyModuleSettings({ module, onUpdateModule, themeColors = [] }: Props) {
  /*
   * D8 axes: Content / Structure / Placement / Frame. Structure runs in blast
   * radius order (D9) — the preset rewrites everything below it, Star Count
   * decides how much there is to see, the shape controls decide where it
   * goes, and the motion group sits last because it changes nothing in a
   * still. No field carries its own width (W0) and nothing is greyed out: a
   * control that does not apply is hidden.
   */
  const schema: BuilderSettingsSchema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "posterUrl",
              label: "Poster",
              width: "full",
              control: "image",
              rendersVia: "GalaxyRuntime"
            }
          ],
          [
            {
              key: "posterNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <span className="builder-module-offset-hint">
                  The poster is shown instead of the moving galaxy to visitors who
                  have asked their device for less motion, and on browsers that
                  cannot draw it. Leave it empty and they see one still frame.
                </span>
              )
            }
          ]
        ]
      },
      {
        title: "Structure",
        strips: [
          [
            {
              // A preset WRITES values; it is not a mode. The select shows
              // whichever preset the settings currently match, or Custom.
              key: "preset",
              label: "Preset",
              width: "select-md",
              control: "custom",
              rendersVia: "GalaxyRuntime",
              render: ({ settings, setMany }) => {
                const current = matchGalaxyPreset(settings);
                return (
                  <select
                    value={current}
                    onChange={(event) => {
                      const values = GALAXY_PRESETS[event.target.value];
                      if (values) setMany(values);
                    }}
                  >
                    {current === "custom" ? (
                      <option value="custom" disabled>
                        Custom
                      </option>
                    ) : null}
                    {GALAXY_PRESET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                );
              }
            }
          ],
          [slider("particleCount", "Star Count", { step: 100 })],
          [slider("arms", "Arms"), slider("turns", "Turns")],
          [slider("armWidth", "Arm Width"), slider("coreSize", "Core Size")],
          [slider("coreStrength", "Core Stars"), slider("flareStars", "Flare Stars")],
          [slider("starSize", "Star Size", { step: 0.1 })],
          [
            slider("spinSpeed", "Spin Speed", { step: 1 }),
            {
              key: "spinDirection",
              label: "Direction",
              width: "select-md",
              control: "select",
              fallback: "clockwise",
              options: [
                { value: "clockwise", label: "Clockwise" },
                { value: "counterclockwise", label: "Anticlockwise" }
              ],
              rendersVia: "GalaxyRuntime"
            }
          ],
          [slider("differential", "Inner Speed", { step: 1 }), slider("flowSpeed", "Flow", { step: 1 })],
          [slider("twinkle", "Twinkle", { step: 1 })],
          [
            {
              // What the visitor can do to it. The choices depend on Sits:
              // only an In Place galaxy can be pressed on, and a Window one
              // reads the cursor from anywhere on the page instead. The select
              // shows what will actually RUN, so a value left over from the
              // other placement reads as that placement's default, never blank.
              key: "interaction",
              label: "Interaction",
              width: "select-md",
              control: "custom",
              rendersVia: "GalaxyRuntime",
              render: ({ settings, set }) => {
                const inline = proximityIsInline(settings.placement);
                return (
                  <select
                    value={resolveGalaxyInteraction(inline, settings.interaction)}
                    onChange={(event) => set("interaction", event.target.value)}
                  >
                    {galaxyInteractionsFor(inline).map((value) => (
                      <option key={value} value={value}>
                        {INTERACTION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                );
              }
            }
          ]
        ]
      },
      {
        title: "Placement",
        strips: [
          [
            {
              key: "placement",
              label: "Sits",
              width: "select-md",
              control: "select",
              fallback: "window",
              options: [...PROXIMITY_PLACEMENT_OPTIONS],
              rendersVia: "GalaxyRuntime"
            },
            slider("height", "Height", {
              min: 120,
              max: 1200,
              step: 10,
              suffix: "px",
              fallback: "480",
              visibleWhen: (settings) => proximityIsInline(settings.placement)
            })
          ],
          [
            {
              key: "posX",
              label: "Position X",
              width: "num",
              control: "custom",
              rendersVia: "GalaxyRuntime",
              render: ({ settings, set }) => (
                <input type="number" step={1} value={settings.posX || "0"} onChange={(event) => set("posX", event.target.value)} />
              )
            },
            {
              key: "posY",
              label: "Position Y",
              width: "num",
              control: "custom",
              rendersVia: "GalaxyRuntime",
              render: ({ settings, set }) => (
                <input type="number" step={1} value={settings.posY || "0"} onChange={(event) => set("posY", event.target.value)} />
              )
            }
          ],
          [
            {
              key: "zIndex",
              label: "Z-Index",
              width: "num",
              control: "custom",
              rendersVia: "GalaxyRuntime",
              render: ({ settings, set }) => (
                <input type="number" step={1} value={settings.zIndex || "-9999"} onChange={(event) => set("zIndex", event.target.value)} />
              )
            }
          ],
          [
            {
              key: "placementNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: ({ settings }) => (
                <span className="builder-module-offset-hint">
                  {proximityIsInline(settings.placement) ? (
                    <>
                      <strong>In Place:</strong> the galaxy is a block as tall as
                      Height, across the full width of its cell, and scrolls with
                      the page. Position X and Y move its centre within that block,
                      in pixels; positive Y moves it up.
                    </>
                  ) : (
                    <>
                      <strong>Window Center:</strong> the galaxy fills the whole
                      browser window behind the page and does not scroll. Position
                      X and Y move its centre, in pixels; positive Y moves it up.
                    </>
                  )}
                </span>
              )
            }
          ]
        ]
      },
      {
        title: "Frame",
        strips: [
          ...Array.from({ length: GALAXY_DEFAULT_PALETTE.length }, (_, index) => colourSlot(index)),
          [
            {
              key: "haze",
              label: "Haze",
              width: "color",
              control: "theme-color",
              themeDefault: GALAXY_DEFAULT_HAZE,
              dialogLabel: "Haze colour",
              rendersVia: "drawGalaxyFrame"
            },
            slider("hazeStrength", "Haze Strength", { min: 0, max: 100, step: 1, suffix: "%" })
          ],
          [
            slider("glow", "Glow", { min: 0, max: 100, step: 1, suffix: "%" }),
            slider("opacity", "Opacity", { min: 0, max: 100, step: 1, suffix: "%" })
          ],
          [
            {
              key: "frameNote",
              label: "",
              width: "full",
              control: "custom",
              bare: true,
              render: () => (
                <span className="builder-module-offset-hint">
                  Each star wears one of the five colours; Share is how many
                  stars get each one. An emptied colour goes back to the reference
                  galaxy&rsquo;s colour for that slot.
                </span>
              )
            }
          ]
        ]
      }
    ]
  };

  return (
    <div className="builder-galaxy-module-settings">
      <BuilderSchemaModuleSettings schema={schema} module={module} onUpdateModule={onUpdateModule} themeColors={themeColors} />
    </div>
  );
}
