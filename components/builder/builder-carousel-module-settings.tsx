import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import {
  BuilderThemeColorControlWithDefault,
  type BuilderThemePalette
} from "./builder-theme-color-field";
import {
  CAROUSEL_BORDER_STYLES,
  CAROUSEL_IMAGE_FRAME_DEFAULTS,
  CAROUSEL_IMAGE_FRAME_LIMITS,
  carouselBorderStyle,
  carouselImageShadowIsOn
} from "@/lib/builder-carousel-image-frame";
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

const CAROUSEL_BORDER_STYLE_LABELS: Record<string, string> = {
  none: "None",
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  double: "Double"
};

type BuilderCarouselModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

/**
 * Settings editor for the Carousel module.
 *
 * THREE columns since 2026-08-16 (operator: "move the border controls into
 * its own column to the right of Settings"), and two before that:
 *
 *   1. Settings     — the module CHROME and nothing else: Label, Background,
 *                     Alignment, the four margins and the two offsets, all
 *                     rendered by `builder-module-card.tsx` rather than by
 *                     this file. It fills itself; this component never
 *                     renders it.
 *   2. Image Border — the frame around every picture.
 *   3. Carousel     — everything else about the module, and the items.
 *
 * The chrome column ends at the offsets with half a screen of nothing under
 * it, so column 2 costs no width that was being used. The track list and the
 * placement live in `_builder-react-overrides.css`, copied from the Social
 * panel, which went to three columns the same day for the same reason.
 *
 * Format sits first and alone, above the groups it governs, because it is the
 * only control here that changes which OTHER controls exist. Everything below
 * it is the union of the two modules that merged on 2026-08-16, with the
 * three format-specific controls hidden rather than disabled when the format
 * has no use for them — a disabled control still reads as "a thing this
 * module does", which is exactly the confusion the merge is meant to end.
 *
 * Image Border (2026-08-16) is deliberately NOT one of those three: the
 * operator asked for a border "that applies to all images", so both formats
 * get the identical set and every item in the module wears it.
 *
 * Not schema-driven, for the same reason Feature Cards is not: the item
 * manager runs its own lattice, so the columns are the module's own CSS rather
 * than the generator's axis lattice. Since the panel sweep it runs the SAME
 * lattice as Feature Cards — `.builder-cards-panel-fields`, one labelled block
 * per item (L6a) — rather than the titled-column grid plus `label.field`
 * sub-row it inherited from the Slideshow panel.
 */
export function BuilderCarouselModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
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

  // The four copy fields an item carries beyond its picture, its identifying
  // field and its link. A card always shows them; a slideshow shows them only
  // with captions on, because that is the only place a slide has to put them.
  // Unchanged by the L6a rewrite — it moved these fields, it did not regate
  // them.
  const showItemCopy = isCards || settings.showCaptions === "true";

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
      {/* MIDDLE — the image frame, its own column since 2026-08-16 (operator:
          "move the border controls into its own column to the right of
          Settings"). Same three-column shape the Social panel runs, and for
          the same reason: the chrome column ends at the offsets with half a
          screen of nothing under it, while everything else was queued in one
          tall stack beside it.

          A column of its own is also what makes its labels honest. Every
          field is `display: contents`, so a column's widest label sets the
          track for all of them (W0) — "Shadow Opacity" was setting that
          track for Format, Loop and Gap while it lived among them. */}
      <div className="builder-cards-panel-settings builder-schema-panel-column">
        {/* One frame, every picture, both formats — the operator asked for
            "full border control that applies to ALL images" (2026-08-16),
            so there is no per-item override to get out of step. Numbers,
            limits and the resolved CSS all come from
            `builder-carousel-image-frame.ts`; this panel only names them,
            which is what stops the control and the renderer disagreeing.

            Order is D9, blast radius descending: the border (style, then
            width, colour, corner) and then the shadow, which is the last
            thing anyone reaches for. The shadow's own detail appears only
            once it is switched on — a dozen dead numbers is what an
            Advanced section used to hide, and A0 retired those. */}
        <div className="builder-cards-panel-heading">Image Border</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Style" width="select-md">
            <select
              value={carouselBorderStyle(settings.imageBorderStyle)}
              onChange={(event) => set("imageBorderStyle", event.target.value)}
            >
              {CAROUSEL_BORDER_STYLES.map((value) => (
                <option key={value} value={value}>
                  {CAROUSEL_BORDER_STYLE_LABELS[value]}
                </option>
              ))}
            </select>
          </BuilderModuleField>
          {/* 0 is no border at all, which is what every existing carousel
              has — this ships invisible until it is asked for. */}
          <BuilderModuleField label="Border" width="num">
            <BuilderNumberSelectControl
              value={settings.imageBorderWidth ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.borderWidth)}
              min={CAROUSEL_IMAGE_FRAME_LIMITS.borderWidth.min}
              max={CAROUSEL_IMAGE_FRAME_LIMITS.borderWidth.max}
              fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.borderWidth)}
              onChange={(imageBorderWidth) => set("imageBorderWidth", imageBorderWidth)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Border Color" width="color">
            <BuilderThemeColorControlWithDefault
              value={settings.imageBorderColor ?? ""}
              defaultColor={CAROUSEL_IMAGE_FRAME_DEFAULTS.borderColor}
              themeColors={themeColors}
              dialogLabel="Image border color"
              onChange={(imageBorderColor) => set("imageBorderColor", imageBorderColor)}
            />
          </BuilderModuleField>
          {/* 8 is what the stylesheet already rounded both formats by, so
              an untouched carousel keeps the corners it has always had. */}
          <BuilderModuleField label="Radius" width="num">
            <BuilderNumberSelectControl
              value={settings.imageBorderRadius ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.radius)}
              min={CAROUSEL_IMAGE_FRAME_LIMITS.radius.min}
              max={CAROUSEL_IMAGE_FRAME_LIMITS.radius.max}
              step={2}
              fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.radius)}
              onChange={(imageBorderRadius) => set("imageBorderRadius", imageBorderRadius)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Drop Shadow" width="check">
            <input
              type="checkbox"
              checked={carouselImageShadowIsOn(settings)}
              onChange={(event) => set("imageShadow", String(event.target.checked))}
            />
          </BuilderModuleField>
          {carouselImageShadowIsOn(settings) ? (
            <>
              <BuilderModuleField label="Shadow Color" width="color">
                <BuilderThemeColorControlWithDefault
                  value={settings.imageShadowColor ?? ""}
                  defaultColor={CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowColor}
                  themeColors={themeColors}
                  dialogLabel="Image drop shadow color"
                  onChange={(imageShadowColor) => set("imageShadowColor", imageShadowColor)}
                />
              </BuilderModuleField>
              <BuilderModuleField label="Shadow X" width="num">
                <BuilderNumberSelectControl
                  value={settings.imageShadowX ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowX)}
                  min={CAROUSEL_IMAGE_FRAME_LIMITS.shadowOffset.min}
                  max={CAROUSEL_IMAGE_FRAME_LIMITS.shadowOffset.max}
                  fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowX)}
                  onChange={(imageShadowX) => set("imageShadowX", imageShadowX)}
                />
              </BuilderModuleField>
              <BuilderModuleField label="Shadow Y" width="num">
                <BuilderNumberSelectControl
                  value={settings.imageShadowY ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowY)}
                  min={CAROUSEL_IMAGE_FRAME_LIMITS.shadowOffset.min}
                  max={CAROUSEL_IMAGE_FRAME_LIMITS.shadowOffset.max}
                  fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowY)}
                  onChange={(imageShadowY) => set("imageShadowY", imageShadowY)}
                />
              </BuilderModuleField>
              <BuilderModuleField label="Shadow Blur" width="num">
                <BuilderNumberSelectControl
                  value={settings.imageShadowBlur ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowBlur)}
                  min={CAROUSEL_IMAGE_FRAME_LIMITS.shadowBlur.min}
                  max={CAROUSEL_IMAGE_FRAME_LIMITS.shadowBlur.max}
                  step={2}
                  fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowBlur)}
                  onChange={(imageShadowBlur) => set("imageShadowBlur", imageShadowBlur)}
                />
              </BuilderModuleField>
              <BuilderModuleField label="Shadow Spread" width="num">
                <BuilderNumberSelectControl
                  value={settings.imageShadowSpread ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowSpread)}
                  min={CAROUSEL_IMAGE_FRAME_LIMITS.shadowSpread.min}
                  max={CAROUSEL_IMAGE_FRAME_LIMITS.shadowSpread.max}
                  fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowSpread)}
                  onChange={(imageShadowSpread) => set("imageShadowSpread", imageShadowSpread)}
                />
              </BuilderModuleField>
              {/* Without this a shadow is flat black, which no photograph
                  wants. 30% is the softness the default X/Y/Blur assume. */}
              <BuilderModuleField label="Shadow Opacity" width="num">
                <BuilderNumberSelectControl
                  value={settings.imageShadowOpacity ?? String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowOpacity)}
                  min={CAROUSEL_IMAGE_FRAME_LIMITS.shadowOpacity.min}
                  max={CAROUSEL_IMAGE_FRAME_LIMITS.shadowOpacity.max}
                  step={5}
                  fallback={String(CAROUSEL_IMAGE_FRAME_DEFAULTS.shadowOpacity)}
                  onChange={(imageShadowOpacity) => set("imageShadowOpacity", imageShadowOpacity)}
                />
              </BuilderModuleField>
            </>
          ) : null}
        </BuilderModuleFieldStrip>
      </div>

      {/* RIGHT — everything else that is specifically a carousel, and the
          items. A column name here, one step larger than a group title: it
          names a whole column, the way "Settings" and "Image Border" name
          the two to its left. */}
      <div className="builder-cards-panel-items">
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
            {/* 0 means "auto" — the picture keeps its own proportions.
                The label names what the number actually sizes, which is not
                the same thing in the two formats: the slideshow's frame IS
                the picture, while a card slider's row takes its height from
                the cards in it, so there the setting is the card picture's
                height. Naming it "Height" in both left the operator setting a
                number that visibly did nothing (2026-08-16). */}
            <BuilderModuleField
              label={isCards ? "Image height (0 = auto)" : "Height (0 = auto)"}
              width="num"
            >
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

        {/* The items. ONE LABELLED BLOCK PER ITEM, on its own lattice
            (UI_RULES L6a) — the same shape and the same CSS as Feature
            Cards, not a second pattern.

            It was a titled-column grid (L6) with a spanning sub-row of
            `label.field` boxes, and L6a names that exact combination as the
            one to convert: "a manager with fields that cannot [be columns]
            — pickers, long text — takes the labelled block, because that is
            the one where the spanning secondary row was already breaking
            the column alignment." This manager had all three at once: an
            image picker, a description textarea, and four fields riding a
            sub-row whose auto-fit tracks were measured independently of the
            three columns above them, so nothing below an item's first row
            lined up with anything above it.

            The sub-row's `label.field` was also the shape W0 says to retire
            rather than style — it stacks its label above a full-width box,
            which is a second label geometry inside one panel. Every field
            here is a `BuilderModuleField` now, so the whole manager reads
            the one lattice.

            `data-lattice-pairs="2"` is what makes any of this checkable.
            `check_panels` only measures a manager that declares itself:
            selecting on `[data-lattice-pairs]` and `[data-lattice-columns]`,
            it found neither here and skipped the manager in silence — the
            panel passed every sweep while never being looked at. */}
        <div className="builder-schema-group-title">{isCards ? "Cards" : "Slides"}</div>
        <div className="builder-cards-panel-fields" data-lattice-pairs="2">
          {items.map((item, index) => {
            // What the item is called in its own head row. A card is known by
            // its title and a slide by its alt text — the same field each
            // format already showed first — falling back to the position when
            // the item is still blank.
            const itemName = (isCards ? item.title : item.imageAlt) || `${Noun} ${index + 1}`;

            return (
              <Fragment key={item.id}>
                <div className="builder-card-editor-head">
                  <span className="builder-card-editor-name">{itemName}</span>
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
                </div>

                {/* The 2x2. Which fields an item shows is unchanged by this
                    rewrite — only where they sit. The first pair is the field
                    that identifies the item and its link, both of which every
                    item has in both formats. */}
                {isCards ? (
                  <BuilderModuleField label="Title" width="text-md" className="builder-card-field--a">
                    <input
                      type="text"
                      value={item.title}
                      onChange={(event) => updateItem(item.id, { title: event.target.value })}
                      placeholder={`${Noun} title`}
                      aria-label={`${Noun} ${index + 1} title`}
                    />
                  </BuilderModuleField>
                ) : (
                  <BuilderModuleField label="Alt text" width="text-md" className="builder-card-field--a">
                    <input
                      type="text"
                      value={item.imageAlt}
                      onChange={(event) => updateItem(item.id, { imageAlt: event.target.value })}
                      placeholder="Describe the image"
                      aria-label={`${Noun} ${index + 1} alt text`}
                    />
                  </BuilderModuleField>
                )}
                <BuilderModuleField label="Link" width="text-md" className="builder-card-field--b">
                  <input
                    type="text"
                    value={item.linkUrl}
                    onChange={(event) => updateItem(item.id, { linkUrl: event.target.value })}
                    placeholder="/path-or-url"
                    aria-label={`${Noun} ${index + 1} link`}
                  />
                </BuilderModuleField>

                {/* A slideshow shows these only when captions are on, because
                    with captions off there is nowhere on the slide for them to
                    appear — an editor that collects copy nothing renders is
                    the defect the merge was cleaning up, not one to
                    reintroduce. The link above is the exception: a slide can
                    be clickable with no visible text at all. */}
                {showItemCopy ? (
                  <>
                    <BuilderModuleField label="Link label" width="text-md" className="builder-card-field--a">
                      <input
                        type="text"
                        value={item.linkLabel}
                        onChange={(event) => updateItem(item.id, { linkLabel: event.target.value })}
                        placeholder="Read more"
                        aria-label={`${Noun} ${index + 1} link label`}
                      />
                    </BuilderModuleField>
                    {isCards ? (
                      <BuilderModuleField label="Alt text" width="text-md" className="builder-card-field--b">
                        <input
                          type="text"
                          value={item.imageAlt}
                          onChange={(event) => updateItem(item.id, { imageAlt: event.target.value })}
                          placeholder="Describe the image"
                          aria-label={`${Noun} ${index + 1} alt text`}
                        />
                      </BuilderModuleField>
                    ) : (
                      <BuilderModuleField label="Caption title" width="text-md" className="builder-card-field--b">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(event) => updateItem(item.id, { title: event.target.value })}
                          placeholder="Headline over the image"
                          aria-label={`${Noun} ${index + 1} caption title`}
                        />
                      </BuilderModuleField>
                    )}
                  </>
                ) : null}

                {/* Too wide for half a row, so it spans to the block's right
                    edge (L8). `--picker` is what pushes the Gallery button
                    onto that edge instead of leaving it wherever the input
                    ran out. */}
                <BuilderModuleField
                  label="Image"
                  width="full"
                  className="builder-card-field--wide builder-card-field--picker"
                >
                  <BuilderImagePickerField
                    value={item.imageUrl}
                    onChange={(imageUrl) => updateItem(item.id, { imageUrl })}
                  />
                </BuilderModuleField>

                {showItemCopy ? (
                  <BuilderModuleField label="Description" width="full" className="builder-card-field--wide">
                    <textarea
                      className="builder-textarea"
                      rows={2}
                      value={item.body}
                      onChange={(event) => updateItem(item.id, { body: event.target.value })}
                      placeholder={`Add copy for this ${noun}`}
                      aria-label={`${Noun} ${index + 1} description`}
                    />
                  </BuilderModuleField>
                ) : null}
              </Fragment>
            );
          })}
        </div>
        <button type="button" className="secondary-button" onClick={addItem}>
          Add {Noun}
        </button>
      </div>
    </div>
  );
}
