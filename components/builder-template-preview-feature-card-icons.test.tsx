import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  createEmptyModule,
  normalizeLayoutSections
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The Feature Cards icon badge. Every geometry value here was hardcoded in
 * CSS until 2026-08-12 — these tests exist so the settings that replaced
 * them cannot quietly stop reaching the markup, and so the layering fix
 * (an icon that used to paint behind the card image) cannot regress.
 */
const CARDS = JSON.stringify([
  {
    id: "c1",
    title: "Courts",
    body: "Clay courts.",
    icon: "★",
    iconImageUrl: "/icons/racquet.svg",
    imageUrl: "/a.jpg",
    imageAlt: "Courts"
  },
  {
    id: "c2",
    title: "Juniors",
    body: "Camps.",
    icon: "●",
    iconImageUrl: "/icons/ball.svg",
    imageUrl: "/b.jpg",
    imageAlt: "Juniors"
  }
]);

function renderCards(settings: Record<string, string>) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          layout: "single",
          background: { mode: "color", color: "#ffffff" },
          modules: [{ id: "m1", type: "feature-cards", column: "main", settings: { cards: CARDS, ...settings } }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

describe("feature card icons", () => {
  it("puts the icon in front of the card image by default — the bug this fixes", () => {
    // The badge is written before the image and neither declared a paint
    // order, so the image covered it. 3 is what puts it back on top.
    expect(renderCards({})).toContain("--feature-card-icon-z:3");
  });

  it("drops the icon back behind the image when In Front is turned off", () => {
    // 0, not -1: a negative index would send it behind the card itself.
    expect(renderCards({ iconFront: "false" })).toContain("--feature-card-icon-z:0");
  });

  it("carries the icon size through to the markup", () => {
    expect(renderCards({ iconSize: "72" })).toContain("--feature-card-icon-size:72px");
  });

  it("keeps the old 48px badge for a module saved before the setting existed", () => {
    expect(renderCards({})).toContain("--feature-card-icon-size:48px");
  });

  it("clamps an out-of-range size rather than emitting it", () => {
    expect(renderCards({ iconSize: "9999" })).toContain("--feature-card-icon-size:160px");
    expect(renderCards({ iconSize: "0" })).toContain("--feature-card-icon-size:16px");
  });

  it("emits placement, alignment and shape as classes the stylesheet answers", () => {
    const html = renderCards({ iconPlacement: "on-image", iconAlign: "right", iconShape: "square" });

    expect(html).toContain("builder-preview-feature-cards-icon-on-image");
    expect(html).toContain("builder-preview-feature-cards-icon-align-right");
    expect(html).toContain("builder-preview-feature-cards-icon-shape-square");
  });

  it("falls back to the default class when a stored value is not one we style", () => {
    // Without this an unknown value would emit a class no rule matches and
    // the badge would lose its position entirely.
    const html = renderCards({ iconPlacement: "sideways", iconShape: "hexagon" });

    expect(html).toContain("builder-preview-feature-cards-icon-above");
    expect(html).toContain("builder-preview-feature-cards-icon-shape-circle");
  });

  it("colors the glyph itself when the badge has no background to sit on", () => {
    // White on nothing is invisible, so "plain" hands the glyph the badge
    // color instead.
    const html = renderCards({ iconShape: "plain", iconColor: "#0b2a4a" });

    expect(html).toContain("background:transparent");
    expect(html).toContain("color:#0b2a4a");
  });

  it("lets Icon Text override the glyph color on a filled badge", () => {
    expect(renderCards({ iconColor: "#0b2a4a", iconTextColor: "#ffd400" })).toContain("color:#ffd400");
  });

  it("gives a new module the defaults that reproduce the old look", () => {
    const module = createEmptyModule("feature-cards", "main");

    expect(module.settings.iconSize).toBe("48");
    expect(module.settings.iconPlacement).toBe("above");
    expect(module.settings.iconAlign).toBe("center");
    expect(module.settings.iconShape).toBe("circle");
    expect(module.settings.iconFront).toBe("true");
    expect(module.settings.iconType).toBe("symbol");
  });

  it("renders the picture instead of the glyph when the icon type is image", () => {
    const html = renderCards({ iconType: "image" });

    expect(html).toContain('src="/icons/racquet.svg"');
    expect(html).toContain("builder-preview-feature-card-badge-img");
    expect(html).not.toContain("★");
  });

  it("keeps the glyph for a module saved before image icons existed", () => {
    // No `iconType` at all is the state of every module built before
    // 2026-08-12 — it has to keep reading as "symbol", not as empty.
    const html = renderCards({});

    expect(html).toContain("★");
    expect(html).not.toContain("builder-preview-feature-card-badge-img");
  });

  it("keeps the badge, and its shape settings, around an image icon", () => {
    // The picture sits inside the same badge as the glyph, which is what
    // lets shape/size/placement keep working without a second set of rules.
    const html = renderCards({ iconType: "image", iconShape: "square", iconSize: "72" });

    expect(html).toContain("builder-preview-feature-card-badge");
    expect(html).toContain("builder-preview-feature-cards-icon-shape-square");
    expect(html).toContain("--feature-card-icon-size:72px");
  });

  it("hides the badge on a card with no icon picture, rather than an empty disc", () => {
    const html = renderToStaticMarkup(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([
          {
            id: "row-1",
            layout: "single",
            background: { mode: "color", color: "#ffffff" },
            modules: [
              {
                id: "m1",
                type: "feature-cards",
                column: "main",
                // A card with a glyph but no picture: switching the module to
                // image icons must not leave a coloured disc with nothing in it.
                settings: { cards: JSON.stringify([{ id: "c1", title: "Courts", icon: "★" }]), iconType: "image" }
              }
            ]
          }
        ])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    );

    expect(html).not.toContain("builder-preview-feature-card-badge");
  });
});
