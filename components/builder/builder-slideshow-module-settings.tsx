import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";

export type BuilderSlideshowSlide = { id: string; url: string; alt: string };

/**
 * Slides as stored on the module, tolerant of anything the importer wrote.
 *
 * Empty-url slides stay: a just-added slide must survive until the operator
 * picks its image. Renderers filter empties at display time.
 */
export function parseBuilderSlideshowSlides(settings: Record<string, string>): BuilderSlideshowSlide[] {
  try {
    const raw = JSON.parse(settings.slides || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map((entry, index) => ({
      id: String((entry as BuilderSlideshowSlide)?.id || `slide-${index}`),
      url: String((entry as BuilderSlideshowSlide)?.url || "").trim(),
      alt: String((entry as BuilderSlideshowSlide)?.alt || "")
    }));
  } catch {
    return [];
  }
}

type BuilderSlideshowModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * Settings editor for the Slideshow module.
 *
 * Two equal columns (operator, 2026-08-12), the same shape as Feature Cards:
 * every module-wide setting on the left, nothing but the slide list on the
 * right. Before this the whole editor was a single stacked column of
 * `label.field` boxes — the shape W0 is retiring — so a slide's image URL and
 * its alt text each ran the entire width of the panel, roughly 2,000px of
 * input for a field nobody types into by hand.
 *
 * That is W9: no field spans its container. The slide rows are a titled-column
 * item grid (L6), so each field is bounded by its column, and the shared cap
 * `--builder-field-long-max` stops the columns themselves growing without
 * limit on a wide screen.
 *
 * Not schema-driven, for the same reason Feature Cards is not: the slide
 * manager is a bespoke item grid, so the two columns are the module's own CSS
 * rather than the generator's axis lattice.
 */
export function BuilderSlideshowModuleSettings({
  module,
  onUpdateModule
}: BuilderSlideshowModuleSettingsProps) {
  const slides = parseBuilderSlideshowSlides(module.settings);

  const persist = (next: BuilderSlideshowSlide[]) =>
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, slides: JSON.stringify(next) } }));

  const set = (key: string, value: string) =>
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const updateSlide = (id: string, updates: Partial<BuilderSlideshowSlide>) =>
    persist(slides.map((slide) => (slide.id === id ? { ...slide, ...updates } : slide)));

  const removeSlide = (id: string) => persist(slides.filter((slide) => slide.id !== id));

  const moveSlide = (id: string, direction: -1 | 1) => {
    const index = slides.findIndex((slide) => slide.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= slides.length) return;
    const next = [...slides];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  };

  const addSlide = () =>
    persist([...slides, { id: `slide-${Date.now()}-${slides.length + 1}`, url: "", alt: "" }]);

  return (
    <div className="builder-cards-panel">
      {/* LEFT — everything that applies to the whole slideshow.
          `builder-schema-panel-column` is the schema generator's own column
          class, borrowed rather than reinvented: inside it a field strip
          becomes one control per row with a shared label track, which is what
          keeps a narrow column from running its fields off the edge. */}
      <div className="builder-cards-panel-settings builder-schema-panel-column">
        <div className="builder-schema-group-title">Slideshow</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Transition" width="select-md">
            <select
              value={module.settings.transition === "fade" ? "fade" : "slide"}
              onChange={(event) => set("transition", event.target.value)}
            >
              <option value="slide">Slide</option>
              <option value="fade">Fade</option>
            </select>
          </BuilderModuleField>
          <BuilderModuleField label="Interval (ms)" width="num">
            <BuilderNumberSelectControl
              value={module.settings.intervalMs ?? "5000"}
              min={1000}
              max={20000}
              step={500}
              fallback="5000"
              onChange={(intervalMs) => set("intervalMs", intervalMs)}
            />
          </BuilderModuleField>
          {/* 0 means "auto" — the slideshow takes its height from the image. */}
          <BuilderModuleField label="Height (0 = auto)" width="num">
            <BuilderNumberSelectControl
              value={module.settings.heightPx || "0"}
              min={0}
              max={900}
              step={20}
              fallback="0"
              onChange={(heightPx) => set("heightPx", heightPx === "0" ? "" : heightPx)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
      </div>

      {/* RIGHT — the slides themselves. Titled-column item grid (UI_RULES L6):
          the image picker and the alt text each get a column, so neither one
          can stretch the way it did as a stacked `label.field`. */}
      <div className="builder-cards-panel-items">
        <div className="builder-schema-group-title">Slides</div>
        <div className="builder-item-grid builder-item-grid--slides">
          <span className="builder-item-grid-header">Image</span>
          <span className="builder-item-grid-header">Alt text</span>
          <span className="builder-item-grid-header">Action</span>
          {slides.map((slide, index) => (
            <Fragment key={slide.id}>
              <div className="builder-item-grid-picker">
                <BuilderImagePickerField
                  value={slide.url}
                  onChange={(url) => updateSlide(slide.id, { url })}
                />
              </div>
              <input
                type="text"
                value={slide.alt}
                onChange={(event) => updateSlide(slide.id, { alt: event.target.value })}
                placeholder="Describe the image"
                aria-label={`Slide ${index + 1} alt text`}
              />
              <div className="builder-item-grid-actions">
                <button
                  type="button"
                  className="builder-icon-button"
                  onClick={() => moveSlide(slide.id, -1)}
                  aria-label={`Move slide ${index + 1} up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="builder-icon-button"
                  onClick={() => moveSlide(slide.id, 1)}
                  aria-label={`Move slide ${index + 1} down`}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="builder-icon-button builder-icon-button-danger"
                  onClick={() => removeSlide(slide.id)}
                  aria-label={`Delete slide ${index + 1}`}
                  title="Delete slide"
                >
                  ✕
                </button>
              </div>
            </Fragment>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={addSlide}>
          Add Slide
        </button>
      </div>
    </div>
  );
}
