import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import {
  parseBuilderCardItems,
  serializeBuilderCardItems,
  createBuilderCardItem,
  type BuilderCardItem
} from "@/lib/builder-card-items";

export type BuilderCarouselFormat = "slideshow" | "cards";

export function resolveCarouselFormat(settings: Record<string, string>): BuilderCarouselFormat {
  return settings.format === "cards" ? "cards" : "slideshow";
}

/**
 * Which settings each format actually means something for.
 *
 * The merge's whole premise is that the union of the two old setting sets
 * applies to BOTH formats — a slideshow can now be moved by hand, a card
 * shelf can now rotate on its own. Only three settings are genuinely
 * format-specific, and each is here for a mechanical reason rather than a
 * taste one:
 *
 *   transition  — "fade" needs a single item to fade between. Several cards
 *                 share the frame, so there is nothing to cross-fade.
 *   cardWidth   — the slideshow format gives one item the whole frame; a
 *                 width setting would have nothing to do.
 *   captions    — a card already shows its title and copy BESIDE the picture.
 *                 Captions are how the slideshow format shows the same
 *                 fields, since its item fills the frame edge to edge.
 *
 * Written once, here, and read by both this panel and the renderer, so the
 * editor can never offer a control that renders nothing (Standard 9 — the
 * defect that put a dead `sliderHeight` on every Card Slider ever created).
 */
export function carouselFormatSupports(format: BuilderCarouselFormat) {
  return {
    transition: format === "slideshow",
    cardWidth: format === "cards",
    captions: format === "slideshow"
  };
}

export function parseBuilderCarouselItems(settings: Record<string, string>): BuilderCardItem[] {
  return parseBuilderCardItems(settings.items, "item", "storage");
}

type BuilderCarouselModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

/**
 * Settings editor for the Carousel module.
 *
 * Two equal columns (operator, 2026-08-12), inherited from the Slideshow
 * panel this replaces: the left column is the module CHROME and nothing else
 * — Label, Background, Alignment, the four margins and the two offsets, all
 * rendered by `builder-module-card.tsx` rather than by this file — and the
 * right column holds everything specific to the carousel. So this component
 * renders only the right half; the left half fills itself.
 *
 * Format sits first and alone, above the groups it governs, because it is the
 * only control here that changes which OTHER controls exist. Everything below
 * it is the union of the two modules that merged on 2026-08-16, with the
 * three format-specific controls hidden rather than disabled when the format
 * has no use for them — a disabled control still reads as "a thing this
 * module does", which is exactly the confusion the merge is meant to end.
 *
 * Not schema-driven, for the same reason Feature Cards is not: the item
 * manager is a bespoke item grid, so the two columns are the module's own CSS
 * rather than the generator's axis lattice.
 */
export function BuilderCarouselModuleSettings({
  module,
  onUpdateModule
}: BuilderCarouselModuleSettingsProps) {
  const settings = module.settings;
  const format = resolveCarouselFormat(settings);
  const supports = carouselFormatSupports(format);
  const isCards = format === "cards";
  const items = parseBuilderCarouselItems(settings);

  const noun = isCards ? "card" : "slide";
  const Noun = isCards ? "Card" : "Slide";

  const persist = (next: BuilderCardItem[]) =>
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, items: serializeBuilderCardItems(next) }
    }));

  const set = (key: string, value: string) =>
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const updateItem = (id: string, updates: Partial<BuilderCardItem>) =>
    persist(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));

  const removeItem = (id: string) => persist(items.filter((item) => item.id !== id));

  const moveItem = (id: string, direction: -1 | 1) => {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  };

  const addItem = () => persist([...items, createBuilderCardItem(items.length + 1, "item")]);

  // A checkbox setting written the same way in every group: absent means the
  // normalizer's format-dependent default, which it has already resolved onto
  // the settings by the time this panel sees them.
  const checkbox = (key: string, label: string, fallback: boolean) => (
    <BuilderModuleField label={label} width="check">
      <input
        type="checkbox"
        checked={settings[key] === undefined ? fallback : settings[key] !== "false"}
        onChange={(event) => set(key, String(event.target.checked))}
      />
    </BuilderModuleField>
  );

  return (
    <div className="builder-cards-panel">
      {/* RIGHT — everything that is specifically a carousel. The left column
          is the module chrome, which this file does not render. */}
      <div className="builder-cards-panel-items">
        {/* A column name, one step larger than a group title — it names the
            whole right-hand column, the way "Settings" names the left. */}
        <div className="builder-cards-panel-heading">Carousel</div>

        {/* Each group gets its own `builder-schema-panel-column` — the schema
            generator's column class, borrowed rather than reinvented: inside
            it a field strip becomes one control per row with a shared label
            track. It wraps ONLY the strips, never the item grid below, which
            is a grid in its own right and would become a single cell of it. */}
        <div className="builder-schema-panel-column">
          <div className="builder-schema-group-title">Format</div>
          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Format" width="select-md">
              <select value={format} onChange={(event) => set("format", event.target.value)}>
                <option value="slideshow">Slideshow — one at a time</option>
                <option value="cards">Card slider — a row of cards</option>
              </select>
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          <div className="builder-schema-group-title">Playback</div>
          <BuilderModuleFieldStrip>
            {checkbox("autoplay", "Auto-advance", !isCards)}
            <BuilderModuleField label="Interval (ms)" width="num">
              <BuilderNumberSelectControl
                value={settings.intervalMs ?? "5000"}
                min={1000}
                max={20000}
                step={500}
                fallback="5000"
                onChange={(intervalMs) => set("intervalMs", intervalMs)}
              />
            </BuilderModuleField>
            {supports.transition ? (
              <BuilderModuleField label="Transition" width="select-md">
                <select
                  value={settings.transition === "fade" ? "fade" : "slide"}
                  onChange={(event) => set("transition", event.target.value)}
                >
                  <option value="slide">Slide</option>
                  <option value="fade">Fade</option>
                </select>
              </BuilderModuleField>
            ) : null}
            {checkbox("loop", "Loop", true)}
            {checkbox("pauseOnHover", "Pause on hover", true)}
          </BuilderModuleFieldStrip>

          <div className="builder-schema-group-title">Controls</div>
          <BuilderModuleFieldStrip>
            {checkbox("showArrows", "Arrows", true)}
            {checkbox("showDots", "Dots", !isCards)}
          </BuilderModuleFieldStrip>

          <div className="builder-schema-group-title">Size</div>
          <BuilderModuleFieldStrip>
            {/* 0 means "auto" — the carousel takes its height from the image. */}
            <BuilderModuleField label="Height (0 = auto)" width="num">
              <BuilderNumberSelectControl
                value={settings.heightPx || "0"}
                min={0}
                max={900}
                step={20}
                fallback="0"
                onChange={(heightPx) => set("heightPx", heightPx)}
              />
            </BuilderModuleField>
            {supports.cardWidth ? (
              <BuilderModuleField label="Card width" width="num">
                <BuilderNumberSelectControl
                  value={settings.cardWidth ?? "280"}
                  min={180}
                  max={420}
                  step={10}
                  fallback="280"
                  onChange={(cardWidth) => set("cardWidth", cardWidth)}
                />
              </BuilderModuleField>
            ) : null}
            <BuilderModuleField label="Gap" width="num">
              <BuilderNumberSelectControl
                value={settings.gap ?? (isCards ? "16" : "0")}
                min={0}
                max={40}
                step={2}
                fallback={isCards ? "16" : "0"}
                onChange={(gap) => set("gap", gap)}
              />
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          {supports.captions ? (
            <>
              <div className="builder-schema-group-title">Captions</div>
              <BuilderModuleFieldStrip>
                {/* Off unless explicitly on, so no slideshow that predates the
                    merge gains text it never had. */}
                <BuilderModuleField label="Show captions" width="check">
                  <input
                    type="checkbox"
                    checked={settings.showCaptions === "true"}
                    onChange={(event) => set("showCaptions", String(event.target.checked))}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Position" width="select-md">
                  <select
                    value={settings.captionPosition || "bottom-left"}
                    onChange={(event) => set("captionPosition", event.target.value)}
                  >
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-center">Bottom center</option>
                    <option value="top-left">Top left</option>
                    <option value="top-center">Top center</option>
                    <option value="center">Center</option>
                  </select>
                </BuilderModuleField>
              </BuilderModuleFieldStrip>
            </>
          ) : null}
        </div>

        {/* The items. Titled-column item grid (UI_RULES L6): the image picker
            and the primary text field each get a column, so neither one can
            stretch the way they did as a stacked `label.field`. The remaining
            fields ride a sub-row that spans the grid, which is what that
            mechanism exists for. */}
        <div className="builder-schema-group-title">{isCards ? "Cards" : "Slides"}</div>
        <div className="builder-item-grid builder-item-grid--carousel">
          <span className="builder-item-grid-header">Image</span>
          <span className="builder-item-grid-header">{isCards ? "Title" : "Alt text"}</span>
          <span className="builder-item-grid-header">Action</span>
          {items.map((item, index) => (
            <Fragment key={item.id}>
              <div className="builder-item-grid-picker">
                <BuilderImagePickerField
                  value={item.imageUrl}
                  onChange={(imageUrl) => updateItem(item.id, { imageUrl })}
                />
              </div>
              {isCards ? (
                <input
                  type="text"
                  value={item.title}
                  onChange={(event) => updateItem(item.id, { title: event.target.value })}
                  placeholder={`${Noun} title`}
                  aria-label={`${Noun} ${index + 1} title`}
                />
              ) : (
                <input
                  type="text"
                  value={item.imageAlt}
                  onChange={(event) => updateItem(item.id, { imageAlt: event.target.value })}
                  placeholder="Describe the image"
                  aria-label={`${Noun} ${index + 1} alt text`}
                />
              )}
              <div className="builder-item-grid-actions">
                <button
                  type="button"
                  className="builder-icon-button"
                  onClick={() => moveItem(item.id, -1)}
                  aria-label={`Move ${noun} ${index + 1} up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="builder-icon-button"
                  onClick={() => moveItem(item.id, 1)}
                  aria-label={`Move ${noun} ${index + 1} down`}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="builder-icon-button builder-icon-button-danger"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Delete ${noun} ${index + 1}`}
                  title={`Delete ${noun}`}
                >
                  ✕
                </button>
              </div>

              {/* The rest of the item. A slideshow shows these only when
                  captions are on, because with captions off there is nowhere
                  on the slide for them to appear — an editor that collects
                  copy nothing renders is the defect this merge is cleaning
                  up, not one to reintroduce. The link is the exception: a
                  slide can be clickable with no visible text at all. */}
              <div className="builder-item-grid-sub builder-carousel-item-sub">
                <label className="field">
                  <span>Link</span>
                  <input
                    type="text"
                    value={item.linkUrl}
                    onChange={(event) => updateItem(item.id, { linkUrl: event.target.value })}
                    placeholder="/path-or-url"
                  />
                </label>
                {isCards || settings.showCaptions === "true" ? (
                  <>
                    <label className="field">
                      <span>Link label</span>
                      <input
                        type="text"
                        value={item.linkLabel}
                        onChange={(event) => updateItem(item.id, { linkLabel: event.target.value })}
                        placeholder="Read more"
                      />
                    </label>
                    {isCards ? (
                      <label className="field">
                        <span>Alt text</span>
                        <input
                          type="text"
                          value={item.imageAlt}
                          onChange={(event) => updateItem(item.id, { imageAlt: event.target.value })}
                          placeholder="Describe the image"
                        />
                      </label>
                    ) : (
                      <label className="field">
                        <span>Caption title</span>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(event) => updateItem(item.id, { title: event.target.value })}
                          placeholder="Headline over the image"
                        />
                      </label>
                    )}
                    <label className="field builder-carousel-item-sub-full">
                      <span>Description</span>
                      <textarea
                        className="builder-textarea"
                        rows={2}
                        value={item.body}
                        onChange={(event) => updateItem(item.id, { body: event.target.value })}
                        placeholder={`Add copy for this ${noun}`}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </Fragment>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={addItem}>
          Add {Noun}
        </button>
      </div>
    </div>
  );
}
