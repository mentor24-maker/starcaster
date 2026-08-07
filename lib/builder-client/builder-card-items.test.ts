import { describe, expect, it } from "vitest";
import {
  createBuilderCardItem,
  parseBuilderCardItems,
  parseCardBody,
  serializeBuilderCardItems
} from "@/lib/builder-card-items";
import { createEmptyModule, normalizeModuleSettings, normalizeModuleType } from "@/lib/builder-template";

describe("parseBuilderCardItems", () => {
  it("fills every field so a partial card cannot render as undefined", () => {
    const [card] = parseBuilderCardItems(JSON.stringify([{ title: "Court Fees" }]));

    expect(card).toEqual({
      id: "card-1",
      title: "Court Fees",
      body: "",
      imageUrl: "",
      imageAlt: "",
      linkUrl: "",
      linkLabel: "",
      icon: ""
    });
  });

  it("returns empty for malformed JSON rather than throwing (standard 5)", () => {
    expect(parseBuilderCardItems("{not json")).toEqual([]);
    expect(parseBuilderCardItems(undefined)).toEqual([]);
    expect(parseBuilderCardItems('{"cards":[]}')).toEqual([]);
  });

  it("survives non-object entries in the array", () => {
    const cards = parseBuilderCardItems(JSON.stringify([null, "nope", 7]));

    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.title === "")).toBe(true);
  });

  it("round-trips through serialize without losing fields", () => {
    const original = parseBuilderCardItems(
      JSON.stringify([{ id: "a", title: "T", body: "B", imageAlt: "A", linkUrl: "/x", linkLabel: "Go", icon: "★" }])
    );

    expect(parseBuilderCardItems(serializeBuilderCardItems(original))).toEqual(original);
  });

  it("keeps slider and feature-card content interchangeable", () => {
    // A card authored in Feature Cards, read back as a slider item.
    const asSlider = parseBuilderCardItems(
      JSON.stringify([{ id: "c1", title: "Pickleball", body: "Open play", icon: "◇", linkLabel: "More" }]),
      "slide"
    );

    expect(asSlider[0].title).toBe("Pickleball");
    expect(asSlider[0].body).toBe("Open play");
    // Slider ignores these, but they must survive the round trip so moving
    // the content back into Feature Cards does not silently drop them.
    expect(asSlider[0].icon).toBe("◇");
    expect(asSlider[0].linkLabel).toBe("More");
  });

  it("uses the id prefix only as a fallback for cards that have no id", () => {
    const cards = parseBuilderCardItems(JSON.stringify([{ id: "kept" }, {}]), "slide");

    expect(cards[0].id).toBe("kept");
    expect(cards[1].id).toBe("slide-2");
  });

  it("creates blank cards with a full field set", () => {
    expect(Object.keys(createBuilderCardItem(1)).sort()).toEqual(
      ["body", "icon", "id", "imageAlt", "imageUrl", "linkLabel", "linkUrl", "title"]
    );
  });
});

describe("parseCardBody", () => {
  it("treats an all-bullet body as a list and strips the markers", () => {
    expect(parseCardBody("- Two Har-Tru courts\n- Lighted until 10pm")).toEqual({
      kind: "list",
      lines: ["Two Har-Tru courts", "Lighted until 10pm"]
    });
  });

  it("accepts •  and * as bullets too", () => {
    expect(parseCardBody("• One\n* Two").kind).toBe("list");
  });

  it("leaves a partly-bulleted body as paragraphs — more likely a typo than a design", () => {
    expect(parseCardBody("Intro line\n- One").kind).toBe("paragraphs");
  });

  it("drops blank lines and handles an empty body", () => {
    expect(parseCardBody("A\n\n\nB").lines).toEqual(["A", "B"]);
    expect(parseCardBody("")).toEqual({ kind: "paragraphs", lines: [] });
  });
});

describe("feature-cards module registration", () => {
  it("is a real type, not silently coerced to text (landmine #1)", () => {
    expect(normalizeModuleType("feature-cards")).toBe("feature-cards");
  });

  it("ships defaults so a freshly dropped module renders", () => {
    const module = createEmptyModule("feature-cards", "main");

    expect(module.type).toBe("feature-cards");
    expect(module.settings.cards).toBe("[]");
    expect(module.settings.cardColumns).toBe("3");
  });

  it("exempts the cards collection from the 10k truncation cap (standard 6)", () => {
    const cards = Array.from({ length: 400 }, (_, index) => ({
      id: `card-${index}`,
      title: `Card ${index}`,
      body: "x".repeat(60)
    }));
    const serialized = JSON.stringify(cards);
    expect(serialized.length).toBeGreaterThan(10000);

    const normalized = normalizeModuleSettings({ cards: serialized });
    expect(normalized.cards).toBe(serialized);
    expect(parseBuilderCardItems(normalized.cards)).toHaveLength(400);
  });

  it("exempts sliderItems too — it was capped at 10k since the slider shipped", () => {
    const items = Array.from({ length: 400 }, (_, index) => ({ id: `s-${index}`, body: "x".repeat(60) }));
    const serialized = JSON.stringify(items);
    expect(serialized.length).toBeGreaterThan(10000);

    expect(normalizeModuleSettings({ sliderItems: serialized }).sliderItems).toBe(serialized);
  });
});
