import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  createBuilderCardItem,
  parseBuilderCardItems,
  serializeBuilderCardItems,
  type BuilderCardItem
} from "@/lib/builder-card-items";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderThemeColorControlWithDefault, type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderFeatureCardsModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const COLUMN_OPTIONS = ["1", "2", "3", "4", "5", "6"];

const ASPECT_OPTIONS: { value: string; label: string }[] = [
  { value: "4-3", label: "4 : 3" },
  { value: "16-9", label: "16 : 9" },
  { value: "3-2", label: "3 : 2" },
  { value: "1-1", label: "Square" }
];

/* Icon badge options. The values match the sets the renderer validates
   against in `builder-template-preview.tsx` — labels say what the
   operator sees, not what the CSS calls it. */
const ICON_PLACEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "above", label: "Over Top Edge" },
  { value: "on-image", label: "On The Image" },
  { value: "inline", label: "Above The Title" }
];

/* Symbol or picture. The two are stored in different card fields (`icon`
   and `iconImageUrl`), so this only decides which one renders and which
   control the card list offers — flipping it back restores the other. */
const ICON_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "symbol", label: "Symbol" },
  { value: "image", label: "Image" }
];

/** The gallery category the icon picker opens filtered to. */
const ICON_GALLERY_CATEGORY = "Icon";

const ICON_SHAPE_OPTIONS: { value: string; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "square", label: "Rounded Square" },
  { value: "plain", label: "No Background" }
];

/* The per-card icon glyph. Every one of these is a TEXT-presentation
   character, not an emoji: the renderer paints the glyph with the Icon
   Text colour, and an emoji ignores `color` and would always come out in
   its own fixed colours. Any glyph a card already carries — typed in
   before this was a dropdown — is appended to this list at render time
   so switching the control cannot silently drop it. */
const CARD_ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "★", label: "★  Star" },
  { value: "☆", label: "☆  Star Open" },
  { value: "✓", label: "✓  Check" },
  { value: "✔", label: "✔  Check Bold" },
  { value: "✕", label: "✕  Cross" },
  { value: "✚", label: "✚  Plus" },
  { value: "●", label: "●  Dot" },
  { value: "◉", label: "◉  Target" },
  { value: "■", label: "■  Square" },
  { value: "◆", label: "◆  Diamond" },
  { value: "▲", label: "▲  Triangle" },
  { value: "♥", label: "♥  Heart" },
  { value: "♦", label: "♦  Card Suit" },
  { value: "❖", label: "❖  Diamond Frame" },
  { value: "✦", label: "✦  Sparkle" },
  { value: "✱", label: "✱  Asterisk" },
  { value: "→", label: "→  Arrow" },
  { value: "➜", label: "➜  Arrow Bold" },
  { value: "☎", label: "☎  Phone" },
  { value: "✉", label: "✉  Envelope" }
];

/**
 * Settings editor for the Feature Cards module.
 *
 * Follows the field-strip layout standard (docs/MODULE_STANDARDS.md rule
 * 10) — strips run content → layout → style → advanced, and every field
 * declares a width token. Every control here is consumed by
 * `FeatureCardsModulePreview` (rule 13); nothing is decorative.
 *
 * Two columns (operator, 2026-08-12): "in the left column are all the
 * global settings, and the right column is for all the elements." So the
 * left holds every module-wide control, grouped Layout / Card / Icons /
 * Link, and the right holds nothing but the card list. Before this the
 * cards ran across the full width and the settings sat underneath them,
 * which put the controls off the bottom of the panel on any module with
 * more than two or three cards.
 *
 * Advanced is gone with it (A0, operator 8/13). Radius, Card Color,
 * Border Color, Shadow, the icon colours and the link fields were behind
 * a `<details>`; they are open on their group now. The colours are still
 * `BuilderThemeColorControlWithDefault` with `hint="theme"`, so A2 holds:
 * empty means "follow the theme", and normalizeBuilderModuleSettingsForType
 * still converts the old factory hexes to empty.
 *
 * This editor is not schema-driven — the card manager is a bespoke titled
 * grid (L6) — so the two columns are the module's own CSS rather than the
 * generator's axis lattice. Every control here is consumed by
 * `FeatureCardsModulePreview` (rule 13); nothing is decorative.
 */
export function BuilderFeatureCardsModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: BuilderFeatureCardsModuleSettingsProps) {
  // "storage": an editor round-trips values back into settings, so it must
  // keep the canonical stored URL rather than a resolved display URL.
  const cards = parseBuilderCardItems(module.settings.cards, "card", "storage");

  const set = (key: string, value: string) =>
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const persist = (next: BuilderCardItem[]) => set("cards", serializeBuilderCardItems(next));

  const updateCard = (id: string, updates: Partial<BuilderCardItem>) =>
    persist(cards.map((card) => (card.id === id ? { ...card, ...updates } : card)));

  const removeCard = (id: string) => persist(cards.filter((card) => card.id !== id));

  const moveCard = (id: string, direction: -1 | 1) => {
    const index = cards.findIndex((card) => card.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cards.length) return;
    const next = [...cards];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  };

  const addCard = () => persist([...cards, createBuilderCardItem(cards.length + 1)]);

  const showIcons = module.settings.showIcons !== "false";
  // Anything but an explicit "image" is a symbol — every module built before
  // image icons existed has no `iconType` at all.
  const iconType = module.settings.iconType === "image" ? "image" : "symbol";
  const showSymbolColumn = showIcons && iconType === "symbol";

  // Empty color settings follow the site theme (the renderer resolves them
  // to --crm-theme-* vars). The swatch previews the same theme color the
  // renderer will use, falling back to the factory color on theme-less sites.
  const themeHex = (label: string) => themeColors.find((color) => color.label === label)?.hex || "";
  const borderDefault = themeHex("Secondary") || "#e1e8f0";
  const iconDefault = themeHex("Accent") || "#0b2a4a";
  const iconAltDefault = themeHex("Primary") || "#4f9c3a";
  // The glyph sits on the badge colour, so its default is white — except
  // with no badge behind it ("No Background"), where white would be
  // invisible and the renderer falls back to the badge colour instead.
  const glyphDefault = module.settings.iconShape === "plain" ? iconDefault : "#ffffff";

  return (
    <div className="builder-cards-panel">
      {/* LEFT — everything that applies to the whole module.
          `builder-schema-panel-column` is the schema generator's own column
          class, borrowed rather than reinvented: inside it a field strip
          becomes one control per row with a shared label track, which is
          what keeps a narrow column from running its fields off the edge
          (W0). Without it the strips stayed horizontal and Gap overhung the
          card column. */}
      <div className="builder-cards-panel-settings builder-schema-panel-column">
      <div className="builder-schema-group-title">Layout</div>
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Columns" width="select-sm">
          <select value={module.settings.cardColumns ?? "3"} onChange={(event) => set("cardColumns", event.target.value)}>
            {COLUMN_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </BuilderModuleField>
        <BuilderModuleField label="Gap" width="num">
          <BuilderNumberSelectControl
            value={module.settings.cardGap ?? "12"}
            min={0}
            max={48}
            fallback="12"
            onChange={(cardGap) => set("cardGap", cardGap)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Align" width="select-sm">
          <select value={module.settings.cardAlign ?? "center"} onChange={(event) => set("cardAlign", event.target.value)}>
            <option value="center">Center</option>
            <option value="left">Left</option>
          </select>
        </BuilderModuleField>
        <BuilderModuleField label="Image Shape" width="select-md">
          <select value={module.settings.imageAspect ?? "4-3"} onChange={(event) => set("imageAspect", event.target.value)}>
            {ASPECT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      <div className="builder-schema-group-title">Card</div>
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Radius" width="num">
          <BuilderNumberSelectControl
            value={module.settings.cardRadius ?? "18"}
            min={0}
            max={48}
            fallback="18"
            onChange={(cardRadius) => set("cardRadius", cardRadius)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Card Color" width="color">
          <BuilderThemeColorControlWithDefault
            defaultColor="#ffffff"
            dialogLabel="Card background color"
            hint="theme"
            themeColors={themeColors}
            value={module.settings.cardBackground ?? ""}
            onChange={(cardBackground) => set("cardBackground", cardBackground)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Border Color" width="color">
          <BuilderThemeColorControlWithDefault
            defaultColor={borderDefault}
            dialogLabel="Card border color"
            hint="theme"
            themeColors={themeColors}
            value={module.settings.cardBorderColor ?? ""}
            onChange={(cardBorderColor) => set("cardBorderColor", cardBorderColor)}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Shadow" width="check">
          <input
            type="checkbox"
            checked={module.settings.cardShadow !== "false"}
            onChange={(event) => set("cardShadow", event.target.checked ? "true" : "false")}
          />
        </BuilderModuleField>
        <BuilderModuleField label="Hover Lift" width="check">
          <input
            type="checkbox"
            checked={module.settings.cardHoverLift !== "false"}
            onChange={(event) => set("cardHoverLift", event.target.checked ? "true" : "false")}
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      {/* Icons. Placement, size, shape and stacking were hardcoded in CSS
          until 2026-08-12 — "In Front" is the one the operator asked for
          by name: with it off the card image paints over the icon, which
          is what every card did before this panel existed. */}
      <div className="builder-schema-group-title">Icons</div>
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Icons" width="check">
          <input
            type="checkbox"
            checked={showIcons}
            onChange={(event) => set("showIcons", event.target.checked ? "true" : "false")}
          />
        </BuilderModuleField>
        {showIcons ? (
          <>
            {/* First on the axis (D9): it decides which per-card field the
                card list even shows. Symbol and image are stored in separate
                fields, so switching between them is reversible. */}
            <BuilderModuleField label="Icon Type" width="select-md">
              <select value={iconType} onChange={(event) => set("iconType", event.target.value)}>
                {ICON_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </BuilderModuleField>
            <BuilderModuleField label="Place" width="select-md">
              <select
                value={module.settings.iconPlacement ?? "above"}
                onChange={(event) => set("iconPlacement", event.target.value)}
              >
                {ICON_PLACEMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </BuilderModuleField>
            <BuilderModuleField label="Icon Align" width="select-sm">
              <select value={module.settings.iconAlign ?? "center"} onChange={(event) => set("iconAlign", event.target.value)}>
                <option value="center">Center</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </BuilderModuleField>
            <BuilderModuleField label="In Front" width="check">
              <input
                type="checkbox"
                checked={module.settings.iconFront !== "false"}
                onChange={(event) => set("iconFront", event.target.checked ? "true" : "false")}
              />
            </BuilderModuleField>
            <BuilderModuleField label="Shape" width="select-md">
              <select value={module.settings.iconShape ?? "circle"} onChange={(event) => set("iconShape", event.target.value)}>
                {ICON_SHAPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </BuilderModuleField>
            <BuilderModuleField label="Icon Size" width="num">
              <BuilderNumberSelectControl
                value={module.settings.iconSize ?? "48"}
                min={16}
                max={160}
                step={5}
                fallback="48"
                onChange={(iconSize) => set("iconSize", iconSize)}
              />
            </BuilderModuleField>
            <BuilderModuleField label="Alternate" width="check">
              <input
                type="checkbox"
                checked={module.settings.iconAlternate !== "false"}
                onChange={(event) => set("iconAlternate", event.target.checked ? "true" : "false")}
              />
            </BuilderModuleField>
          </>
        ) : null}
      </BuilderModuleFieldStrip>

      {showIcons ? (
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Icon Color" width="color">
            <BuilderThemeColorControlWithDefault
              defaultColor={iconDefault}
              dialogLabel="Icon badge color"
              hint="theme"
              themeColors={themeColors}
              value={module.settings.iconColor ?? ""}
              onChange={(iconColor) => set("iconColor", iconColor)}
            />
          </BuilderModuleField>
          {module.settings.iconAlternate !== "false" ? (
            <BuilderModuleField label="2nd Color" width="color">
              <BuilderThemeColorControlWithDefault
                defaultColor={iconAltDefault}
                dialogLabel="Alternating icon badge color"
                hint="theme"
                themeColors={themeColors}
                value={module.settings.iconAltColor ?? ""}
                onChange={(iconAltColor) => set("iconAltColor", iconAltColor)}
              />
            </BuilderModuleField>
          ) : null}
          <BuilderModuleField label="Icon Text" width="color">
            <BuilderThemeColorControlWithDefault
              defaultColor={glyphDefault}
              dialogLabel="Icon glyph color"
              themeColors={themeColors}
              value={module.settings.iconTextColor ?? ""}
              onChange={(iconTextColor) => set("iconTextColor", iconTextColor)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
      ) : null}

      <div className="builder-schema-group-title">Link</div>
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Default Link Text" width="text-md">
          <input
            type="text"
            value={module.settings.linkLabel ?? "Learn More"}
            onChange={(event) => set("linkLabel", event.target.value)}
            placeholder="Learn More"
          />
        </BuilderModuleField>
        <BuilderModuleField label="Arrow" width="check">
          <input
            type="checkbox"
            checked={module.settings.linkArrow !== "false"}
            onChange={(event) => set("linkArrow", event.target.checked ? "true" : "false")}
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>
      </div>

      {/* RIGHT — the cards themselves. Titled-column item grid (UI_RULES
          L6); the fields that cannot fit a column (image picker, alt text,
          description) render as a secondary row spanning the grid under
          each card's primary row. */}
      <div className="builder-cards-panel-items">
      <div className="builder-cards-panel-heading">Feature Cards</div>
      {/* Only the SYMBOL icon gets a column of its own. An image icon is a
          URL plus a Gallery button — the same shape as the card image, which
          is why it renders in the sub-row with the other pickers rather than
          being squeezed into a column that cannot hold it. */}
      <div className={`builder-item-grid builder-item-grid--cards${showSymbolColumn ? " builder-item-grid--cards-icons" : ""}`}>
        {showSymbolColumn ? <span className="builder-item-grid-header">Icon</span> : null}
        <span className="builder-item-grid-header">Title</span>
        <span className="builder-item-grid-header">Link</span>
        <span className="builder-item-grid-header">Link Text</span>
        <span className="builder-item-grid-header">Action</span>
        {cards.map((card, index) => (
          <Fragment key={card.id}>
            {showSymbolColumn ? (
              <select
                className="builder-item-grid-icon-select"
                value={card.icon}
                onChange={(event) => updateCard(card.id, { icon: event.target.value })}
                aria-label={`Card ${index + 1} icon`}
              >
                <option value="">None</option>
                {CARD_ICON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {/* A glyph typed in before this became a dropdown is not in
                    the list; keep it selectable so opening the panel does not
                    rewrite the card. */}
                {card.icon && !CARD_ICON_OPTIONS.some((option) => option.value === card.icon) ? (
                  <option value={card.icon}>{`${card.icon}  (current)`}</option>
                ) : null}
              </select>
            ) : null}
            <input
              type="text"
              value={card.title}
              onChange={(event) => updateCard(card.id, { title: event.target.value })}
              placeholder={`Card ${index + 1}`}
              aria-label={`Card ${index + 1} title`}
            />
            <input
              type="text"
              value={card.linkUrl}
              onChange={(event) => updateCard(card.id, { linkUrl: event.target.value })}
              placeholder="/path-or-url"
              aria-label={`Card ${index + 1} link`}
            />
            <input
              type="text"
              value={card.linkLabel}
              onChange={(event) => updateCard(card.id, { linkLabel: event.target.value })}
              placeholder={module.settings.linkLabel || "Learn More"}
              aria-label={`Card ${index + 1} link text`}
            />
            <div className="builder-item-grid-actions">
              <button
                type="button"
                className="builder-icon-button"
                onClick={() => moveCard(card.id, -1)}
                aria-label={`Move ${card.title || `card ${index + 1}`} up`}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="builder-icon-button"
                onClick={() => moveCard(card.id, 1)}
                aria-label={`Move ${card.title || `card ${index + 1}`} down`}
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="builder-icon-button builder-icon-button-danger"
                onClick={() => removeCard(card.id)}
                aria-label={`Delete ${card.title || `card ${index + 1}`}`}
                title="Delete card"
              >
                ✕
              </button>
            </div>
            <div className="builder-item-grid-sub">
              <BuilderModuleFieldStrip>
                {showIcons && iconType === "image" ? (
                  <BuilderModuleField label="Icon Image" width="full">
                    <BuilderImagePickerField
                      value={card.iconImageUrl}
                      onChange={(iconImageUrl) => updateCard(card.id, { iconImageUrl })}
                      galleryCategory={ICON_GALLERY_CATEGORY}
                      buttonLabel="Choose Icon"
                      placeholder="Pick an icon from the gallery"
                    />
                  </BuilderModuleField>
                ) : null}
                <BuilderModuleField label="Image" width="full">
                  <BuilderImagePickerField
                    value={card.imageUrl}
                    onChange={(imageUrl) => updateCard(card.id, { imageUrl })}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Alt text" width="text-md">
                  <input
                    type="text"
                    value={card.imageAlt}
                    onChange={(event) => updateCard(card.id, { imageAlt: event.target.value })}
                    placeholder="Describe the image"
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Description" width="full">
                  <textarea
                    className="builder-textarea"
                    rows={3}
                    value={card.body}
                    onChange={(event) => updateCard(card.id, { body: event.target.value })}
                    placeholder={"Copy for this card.\nStart every line with “- ” to make a bullet list."}
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>
            </div>
          </Fragment>
        ))}
      </div>
      <button type="button" className="secondary-button" onClick={addCard}>
        Add Card
      </button>
      </div>
    </div>
  );
}
