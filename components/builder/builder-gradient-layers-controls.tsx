import { Fragment } from "react";
import type { BackgroundSettings, BuilderGradientLayer, BuilderGradientStop } from "@/lib/builder-template";
import {
  BUILDER_GRADIENT_LAYER_LIMIT,
  BUILDER_GRADIENT_RADIAL_SIZES,
  BUILDER_GRADIENT_STOP_LIMIT,
  createDefaultGlowLayer,
  gradientLayerFromTwoColour,
  normalizeBuilderGradientLayers,
  withGradientLayers
} from "@/lib/builder-template";
import { BuilderSettingRow } from "./builder-setting-row";
import { BuilderThemeColorField } from "./builder-theme-color-field";

type BuilderGradientLayersControlsProps = {
  background: BackgroundSettings;
  onChange: (updater: (background: BackgroundSettings) => BackgroundSettings) => void;
  themeColors?: Array<{ label: string; hex: string }>;
};

function clampInput(typed: string, min: number, max: number): number | null {
  if (typed.trim() === "") return null;
  const parsed = Number(typed);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The layer editor for a gradient background (task 86bctde1m). Mounted by
 * BuilderBackgroundControls in BOTH of its layouts, so there is one copy of
 * it — the reason the Video panel is a single render function too.
 *
 * A two-colour gradient shows one button, "Use Layers", which turns its own
 * two colours into layer 1. From there every layer is a group of rows:
 * linear or radial, its angle or its centre and shape, and its colour stops,
 * each with its own see-through-ness. The first layer listed is painted on
 * top, which is CSS order and is also how a person reads a stack.
 *
 * Every write goes through `withGradientLayers`, which keeps the two-colour
 * fields mirroring the bottom layer for surfaces that only know two colours,
 * and removing the last layer puts the background back to plain two-colour
 * mode with that layer's ends.
 */
export function BuilderGradientLayersControls({
  background,
  onChange,
  themeColors = []
}: BuilderGradientLayersControlsProps) {
  const layers = normalizeBuilderGradientLayers(background.gradientLayers);

  function writeLayers(update: (current: BuilderGradientLayer[]) => BuilderGradientLayer[]) {
    onChange((current) => {
      const existing = normalizeBuilderGradientLayers(current.gradientLayers);
      const next = normalizeBuilderGradientLayers(update(existing));
      return withGradientLayers(current, next);
    });
  }

  function updateLayer(index: number, patch: Partial<BuilderGradientLayer>) {
    writeLayers((current) => current.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)));
  }

  function updateStop(layerIndex: number, stopIndex: number, patch: Partial<BuilderGradientStop>) {
    writeLayers((current) =>
      current.map((layer, i) =>
        i === layerIndex
          ? { ...layer, stops: layer.stops.map((stop, j) => (j === stopIndex ? { ...stop, ...patch } : stop)) }
          : layer
      )
    );
  }

  function moveLayer(index: number, delta: number) {
    writeLayers((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  if (!layers.length) {
    return (
      <div className="builder-schema-panel-column builder-gradient-layers-controls">
        <div className="builder-schema-group-title">Gradient Layers</div>
        <BuilderSettingRow label="Layers">
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              onChange((current) => withGradientLayers(current, [gradientLayerFromTwoColour(current)]))
            }
          >
            Use Layers
          </button>
        </BuilderSettingRow>
      </div>
    );
  }

  return (
    <div className="builder-schema-panel-column builder-gradient-layers-controls" data-gradient-layer-count={layers.length}>
      <div className="builder-schema-group-title">Gradient Layers</div>
      {layers.map((layer, index) => {
        const name = `Layer ${index + 1}`;
        return (
          // Fragments, not wrapper divs: the panel column is ONE grid whose rows
          // sit directly in it (UI_RULES W0), and a wrapper would start its own.
          <Fragment key={index}>
            <BuilderSettingRow label={index === 0 && layers.length > 1 ? `${name} (top)` : name}>
              <select
                value={layer.kind}
                onChange={(event) =>
                  updateLayer(index, { kind: event.target.value === "radial" ? "radial" : "linear" })
                }
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
              </select>
            </BuilderSettingRow>

            {layer.kind === "linear" ? (
              <BuilderSettingRow label="Angle">
                <input
                  type="number"
                  min={0}
                  max={360}
                  step={5}
                  value={String(layer.angle)}
                  onChange={(event) => {
                    const angle = clampInput(event.target.value, 0, 360);
                    if (angle !== null) updateLayer(index, { angle });
                  }}
                />
              </BuilderSettingRow>
            ) : (
              <>
                <BuilderSettingRow label="Shape">
                  <select
                    value={layer.shape}
                    onChange={(event) =>
                      // A size that does not suit the new shape is dropped by the normalizer.
                      updateLayer(index, { shape: event.target.value === "circle" ? "circle" : "ellipse" })
                    }
                  >
                    <option value="ellipse">Ellipse</option>
                    <option value="circle">Circle</option>
                  </select>
                </BuilderSettingRow>
                <BuilderSettingRow label="Size">
                  <select
                    value={layer.size || "farthest-corner"}
                    onChange={(event) => updateLayer(index, { size: event.target.value })}
                  >
                    {BUILDER_GRADIENT_RADIAL_SIZES.map((size) => (
                      <option key={size.value} value={size.value}>
                        {size.label}
                      </option>
                    ))}
                    {layer.size && !BUILDER_GRADIENT_RADIAL_SIZES.some((size) => size.value === layer.size) ? (
                      <option value={layer.size}>{layer.size}</option>
                    ) : null}
                  </select>
                </BuilderSettingRow>
                <BuilderSettingRow label="Centre X %">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={String(layer.x)}
                    onChange={(event) => {
                      const x = clampInput(event.target.value, 0, 100);
                      if (x !== null) updateLayer(index, { x });
                    }}
                  />
                </BuilderSettingRow>
                <BuilderSettingRow label="Centre Y %">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={String(layer.y)}
                    onChange={(event) => {
                      const y = clampInput(event.target.value, 0, 100);
                      if (y !== null) updateLayer(index, { y });
                    }}
                  />
                </BuilderSettingRow>
              </>
            )}

            {layer.stops.map((stop, stopIndex) => (
              <Fragment key={stopIndex}>
                <BuilderSettingRow label={`Stop ${stopIndex + 1}`}>
                  <BuilderThemeColorField
                    fallback="#ffffff"
                    themeColors={themeColors}
                    value={stop.color}
                    opacity={stop.alpha}
                    onChangeOpacity={(alpha) => updateStop(index, stopIndex, { alpha })}
                    onChange={(color) => updateStop(index, stopIndex, { color })}
                  />
                </BuilderSettingRow>
                <BuilderSettingRow label={`Stop ${stopIndex + 1} At %`}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={String(stop.position)}
                    onChange={(event) => {
                      const position = clampInput(event.target.value, 0, 100);
                      if (position !== null) updateStop(index, stopIndex, { position });
                    }}
                  />
                </BuilderSettingRow>
              </Fragment>
            ))}

            <BuilderSettingRow label="Stops">
              <div className="builder-media-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={layer.stops.length >= BUILDER_GRADIENT_STOP_LIMIT}
                  onClick={() => {
                    const last = layer.stops[layer.stops.length - 1];
                    updateLayer(index, { stops: [...layer.stops, { ...last, position: 100 }] });
                  }}
                >
                  Add Stop
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={layer.stops.length <= 2}
                  onClick={() => updateLayer(index, { stops: layer.stops.slice(0, -1) })}
                >
                  Remove Stop
                </button>
              </div>
            </BuilderSettingRow>

            <BuilderSettingRow label="Order">
              <div className="builder-media-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveLayer(index, -1)}
                >
                  Move Up
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={index === layers.length - 1}
                  onClick={() => moveLayer(index, 1)}
                >
                  Move Down
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => writeLayers((current) => current.filter((_, i) => i !== index))}
                >
                  Remove Layer
                </button>
              </div>
            </BuilderSettingRow>
          </Fragment>
        );
      })}
      <BuilderSettingRow label="Layers">
        <button
          className="secondary-button"
          type="button"
          disabled={layers.length >= BUILDER_GRADIENT_LAYER_LIMIT}
          onClick={() => writeLayers((current) => [createDefaultGlowLayer(), ...current])}
        >
          Add Layer
        </button>
      </BuilderSettingRow>
    </div>
  );
}
