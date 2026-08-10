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

/**
 * Settings editor for the Feature Cards module.
 *
 * Follows the field-strip layout standard (docs/MODULE_STANDARDS.md rule
 * 10) — strips run content → layout → style → advanced, and every field
 * declares a width token. Every control here is consumed by
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

  // Empty color settings follow the site theme (the renderer resolves them
  // to --crm-theme-* vars). The swatch previews the same theme color the
  // renderer will use, falling back to the factory color on theme-less sites.
  const themeHex = (label: string) => themeColors.find((color) => color.label === label)?.hex || "";
  const borderDefault = themeHex("Secondary") || "#e1e8f0";
  const iconDefault = themeHex("Accent") || "#0b2a4a";
  const iconAltDefault = themeHex("Primary") || "#4f9c3a";

  return (
    <>
      {/* Content — titled-column item grid (UI_RULES L6); the fields that
          cannot fit a column (image picker, alt text, description) render as
          a secondary row spanning the grid under each card's primary row. */}
      <div className={`builder-item-grid builder-item-grid--cards${showIcons ? " builder-item-grid--cards-icons" : ""}`}>
        {showIcons ? <span className="builder-item-grid-header">Icon</span> : null}
        <span className="builder-item-grid-header">Title</span>
        <span className="builder-item-grid-header">Link</span>
        <span className="builder-item-grid-header">Link Text</span>
        <span className="builder-item-grid-header">Action</span>
        {cards.map((card, index) => (
          <Fragment key={card.id}>
            {showIcons ? (
              <input
                type="text"
                value={card.icon}
                maxLength={3}
                onChange={(event) => updateCard(card.id, { icon: event.target.value })}
                placeholder="★"
                aria-label={`Card ${index + 1} icon`}
              />
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

      {/* Layout */}
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

      {/* Style */}
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
            <BuilderModuleField label="Alternate" width="check">
              <input
                type="checkbox"
                checked={module.settings.iconAlternate !== "false"}
                onChange={(event) => set("iconAlternate", event.target.checked ? "true" : "false")}
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
          </>
        ) : null}
      </BuilderModuleFieldStrip>

      {/* Advanced */}
      <details className="hanging-details">
        <summary>Advanced</summary>
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
      </details>
    </>
  );
}
