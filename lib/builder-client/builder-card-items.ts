import { normalizeBuilderAssetUrl, resolvePublicBuilderAssetUrl } from "./builder-asset-url";

/**
 * The shared "card" content shape.
 *
 * Two modules render a collection of cards and more will follow:
 *   - `slider`        — a horizontal scroller (settings key `sliderItems`)
 *   - `feature-cards` — a responsive grid (settings key `cards`)
 *
 * They deliberately store the SAME field names so an operator can move
 * content between them without retyping it. `slider` simply ignores the
 * fields it has no use for (`icon`, `linkLabel`, `imageAlt`), and a card
 * that never had them parses with empty defaults — so the two directions
 * are both lossless-or-graceful, never corrupting.
 *
 * Ratified 2026-08-07 on ClickUp 86bbaffu3: Feature Cards is its own
 * module type rather than a layout mode on `slider`, but the item model
 * is shared rather than duplicated so the two cannot drift apart.
 *
 * NOTE: this module is client-side only. It is intentionally NOT imported
 * by `builder-template.ts`, which is bundled for the server where
 * `builder-asset-url` is aliased to a stub.
 */
export type BuilderCardItem = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  linkUrl: string;
  linkLabel: string;
  icon: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/**
 * How to treat `imageUrl` — these are NOT interchangeable:
 *   "display" → `resolvePublicBuilderAssetUrl`, the URL an `<img src>` can
 *               actually fetch on the public site. Use in renderers.
 *   "storage" → `normalizeBuilderAssetUrl`, the canonical value we persist.
 *               Use in settings editors, which read a value back, hand it to
 *               a picker, and write it out again — resolving to a display URL
 *               there would slowly rewrite stored data into proxy paths.
 */
export type BuilderCardImageUrlMode = "display" | "storage";

export function parseBuilderCardItems(
  raw: string | undefined,
  idPrefix = "card",
  imageUrlMode: BuilderCardImageUrlMode = "display"
): BuilderCardItem[] {
  const toImageUrl = imageUrlMode === "storage" ? normalizeBuilderAssetUrl : resolvePublicBuilderAssetUrl;

  try {
    const items = JSON.parse(raw || "[]");
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: str(source.id) || `${idPrefix}-${index + 1}`,
        title: str(source.title),
        body: str(source.body),
        imageUrl: toImageUrl(source.imageUrl),
        imageAlt: str(source.imageAlt),
        linkUrl: str(source.linkUrl),
        linkLabel: str(source.linkLabel),
        icon: str(source.icon)
      };
    });
  } catch {
    // Standard 5: malformed settings fall back to empty, never crash.
    return [];
  }
}

export function serializeBuilderCardItems(items: BuilderCardItem[]): string {
  return JSON.stringify(items);
}

export function createBuilderCardItem(index: number, idPrefix = "card"): BuilderCardItem {
  return {
    id: `${idPrefix}-${Date.now()}-${index}`,
    title: "",
    body: "",
    imageUrl: "",
    imageAlt: "",
    linkUrl: "",
    linkLabel: "",
    icon: ""
  };
}

/**
 * A card body may be written as a bullet list ("- Two Har-Tru courts").
 * Rendering that as one run-on paragraph loses the author's intent, so
 * a body whose every non-empty line is a bullet becomes a real `<ul>`.
 * Anything else stays paragraphs. Detection is all-or-nothing on purpose:
 * a half-bulleted body is far more likely a typo than a mixed design.
 */
export function parseCardBody(body: string): { kind: "list" | "paragraphs"; lines: string[] } {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return { kind: "paragraphs", lines: [] };

  const bullet = /^[-*•]\s+/;
  if (lines.every((line) => bullet.test(line))) {
    return { kind: "list", lines: lines.map((line) => line.replace(bullet, "").trim()) };
  }

  return { kind: "paragraphs", lines };
}
